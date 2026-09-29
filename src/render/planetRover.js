import * as THREE from 'three';
import { BIOMES } from '../map/mapGenerator.js';
import { Car, VEHICLE_TYPES } from '../modes/town/vehicle.js';
import { buildKitModel, kitMaterial, poseKitWheels } from '../modes/town/vehicleKit.js';
import { createToonMaterial } from './assetLibrary.js';

// Free driving on the globe (Mako style). The car physics are the town's
// (grip, drift, handbrake), run in a small tangent plane that is re-anchored
// under the rover every frame and wrapped back onto the sphere.

const M_PER_UNIT = 40; // how many "metres" of car physics one globe unit is
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();

export class PlanetRover {
  /**
   * pr: the PlanetRenderer (tiles, surface radius, camera, groups)
   * start: unit vector on the planet (planet space)
   * kit:   a town vehicle (assembled kit) to drive instead of the rover; pack: the town pack
   */
  constructor(pr, start, heading, { kit = null, pack = null } = {}) {
    this.pr = pr;
    this.pos = start.clone().normalize();
    this.fwd = (heading || new THREE.Vector3(0, 1, 0)).clone();
    this.fwd.addScaledVector(this.pos, -this.fwd.dot(this.pos)).normalize();
    if (this.fwd.lengthSq() < 1e-6) this.fwd.set(1, 0, 0).addScaledVector(this.pos, -this.pos.x).normalize();
    // A town vehicle keeps its handling, a little quicker across the open planet
    const base = kit ? VEHICLE_TYPES[kit.physics] || VEHICLE_TYPES.sedan : VEHICLE_TYPES.suv;
    const spec = kit ? { ...base, top: base.top * 1.25, accel: base.accel * 1.15 } : { ...base, top: 30, accel: 13, grip: 6.5, drift: 1.3 };
    this.car = new Car(spec, { x: 0, z: 0, yaw: 0 });
    this.kit = kit;
    this.dist = 0;
    this.hint = pr.locate(this.pos, pr.hexasphere.tiles[0]);
    this.camPos = null;
    this.camLook = new THREE.Vector3();

    const tr = pr.tileRadius;
    const rover = pr.roverPack?.rover;
    if (kit && pack?.[kit.body]) {
      // The same car (or cart) the player drove out of town: town models face +Z in metres
      this.model = buildKitModel(kit, pack, kitMaterial(createToonMaterial));
      this.mesh = this.model.group;
      this.mesh.rotation.y = Math.PI / 2;
      // Same size on screen whatever it is (a bus would fill the chase view)
      this.mesh.scale.setScalar((tr * 0.75) / Math.max(4.4, base.length || 4.5));
    } else if (rover) {
      // Six-wheeled rover from the space pack: nose +Z, so turn it to the planet-pack +X convention
      this.mesh = new THREE.Mesh(rover[0] || rover[1], pr.propMaterial);
      this.mesh.rotation.y = Math.PI / 2;
      this.mesh.scale.setScalar(tr * 0.75);
    } else {
      const geo = pr.assetLods.truck?.[0] || pr.assetLods.truck?.[1] || pr.assets?.truck;
      this.mesh = new THREE.Mesh(geo, pr.propMaterial);
      this.mesh.scale.setScalar(tr * 0.42);
    }
    this.mesh.castShadow = false;
    this.holder = new THREE.Group();
    this.holder.add(this.mesh);
    pr.planetGroup.add(this.holder);
  }

  /** Tile under a planet-space direction, walking from the last known tile. */
  tileAt(dir) {
    this.hint = this.pr.locate(dir, this.hint);
    return this.hint;
  }

  /** Rover can't drive into the sea (rounded coast) or up the mountain massifs. */
  blockedDir(dir) {
    const t = this.tileAt(dir);
    if (t.biome === BIOMES.MOUNTAIN) return true;
    return !this.pr.isDry(dir, t, 0.02);
  }

  /** Local tangent frame at the rover: n up, f forward (yaw 0), l = the car's local +X. */
  frame() {
    const n = this.pos;
    const f = this.fwd;
    const l = _v2.crossVectors(n, f).normalize(); // n x f points to the car's left (= local +X)
    return { n, f, l };
  }

  toDir(x, z) {
    const { n, f, l } = this.frame();
    const R = this.pr.landR;
    return _v.copy(n).multiplyScalar(R).addScaledVector(f, z / M_PER_UNIT).addScaledVector(l, x / M_PER_UNIT).normalize().clone();
  }

  update(dt, input) {
    const car = this.car;
    car.x = 0;
    car.z = 0;
    car.yaw = 0;
    car.y = 0;
    const world = {
      heightAt: () => 0,
      resolve: (x, z) => ({ x, z }),
      blocked: (x, z) => this.blockedDir(this.toDir(x, z))
    };
    car.update(dt, input, world);
    if (this.model) {
      this.dist += car.forwardSpeed * dt;
      poseKitWheels(this.model, this.dist, -car.steer);
    }
    // Wrap the step back onto the sphere: new position, heading turned by the yaw change
    const newPos = this.toDir(car.x, car.z);
    const { n } = this.frame();
    _q.setFromAxisAngle(n, car.yaw);
    this.fwd.applyQuaternion(_q);
    // Re-express the velocity in the new heading frame (the car's yaw goes back to 0)
    const c = Math.cos(car.yaw);
    const s = Math.sin(car.yaw);
    const vx = car.vx * c - car.vz * s;
    const vz = car.vx * s + car.vz * c;
    car.vx = vx;
    car.vz = vz;
    // Parallel transport of the heading to the new point
    const rot = _q.setFromUnitVectors(this.pos, newPos);
    this.fwd.applyQuaternion(rot);
    this.pos.copy(newPos);
    this.fwd.addScaledVector(this.pos, -this.fwd.dot(this.pos)).normalize();
    this.place();
  }

  place() {
    const R = this.pr.landR;
    const n = this.pos;
    const f = this.fwd;
    // Planet-pack vehicles face +X: basis (x = forward, y = up, z = forward x up)
    _m.makeBasis(f, n, _v.crossVectors(f, n).normalize());
    this.holder.quaternion.setFromRotationMatrix(_m);
    // Lean out of corners a touch (roll about the forward axis)
    this.holder.rotateX(-this.car.roll * 2);
    this.holder.position.copy(n).multiplyScalar(R + this.pr.tileRadius * 0.02);
  }

  /** Chase camera above the surface, behind the direction of travel. */
  updateCamera(dt, camera) {
    const tr = this.pr.tileRadius;
    const world = this.pr.planetGroup.matrixWorld;
    const P = this.holder.position.clone().applyMatrix4(world);
    const n = this.pos.clone().transformDirection(world);
    const speed = this.car.speed / M_PER_UNIT;
    // Velocity direction in planet space: forward * vz + left * vx (car local)
    const { f, l } = this.frame();
    const vel = f.clone().multiplyScalar(this.car.vz).addScaledVector(l, this.car.vx);
    const dir = (vel.lengthSq() > 4 ? vel : f.clone()).normalize().transformDirection(world);
    const back = 1.7 + Math.min(1.0, speed * 1.1);
    const want = P.clone().addScaledVector(dir, -back * tr).addScaledVector(n, (0.55 + speed * 0.25) * tr);
    if (!this.camPos) this.camPos = want.clone();
    this.camPos.lerp(want, 1 - Math.exp(-dt * 6));
    const floor = this.pr.landR + tr * 0.3;
    if (this.camPos.length() < floor) this.camPos.setLength(floor);
    camera.position.copy(this.camPos);
    camera.up.copy(n);
    this.camLook.copy(P).addScaledVector(dir, tr * 1.8).addScaledVector(n, tr * 0.2);
    camera.lookAt(this.camLook);
    const fov = 42 + Math.min(16, this.car.speed * 0.5);
    if (Math.abs(camera.fov - fov) > 0.1) {
      camera.fov += (fov - camera.fov) * (1 - Math.exp(-dt * 3));
      camera.updateProjectionMatrix();
    }
  }

  dispose() {
    this.pr.planetGroup.remove(this.holder);
    this.model?.group.traverse((o) => {
      if (!o.isInstancedMesh) return;
      o.dispose();
      o.geometry.dispose();
    });
  }
}
