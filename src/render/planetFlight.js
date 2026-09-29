import * as THREE from 'three';
import { Ship, SHIPS, proceduralShipGeometry } from '../modes/space/ship.js';

// Flying the player's ship low over a planet. The flight model is the space
// mode's own (Ship.update, same handling per hull), run in a small tangent
// frame that is re-anchored under the ship every frame and wrapped back onto
// the sphere, with altitude kept between the ground and a high ceiling.

const M_PER_UNIT = 40; // how many "metres" one globe unit is (speed readout, missions)
const SHIP_KEY = 'planet_globe_ship';
const PACE = 0.3; // globe distance per ship length flown, relative to space (the ground makes speed read faster)
const CLEAR = 0.1; // lowest the ship may fly above the ground (globe units)
const CEILING = 0.34; // highest altitude, as a fraction of the planet radius
const POLAR = 1.2; // default chase camera angle from the local up

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

const savedShip = () => {
  try {
    return SHIPS[localStorage.getItem(SHIP_KEY)] ? localStorage.getItem(SHIP_KEY) : 'frigate';
  } catch {
    return 'frigate';
  }
};

/** Sky shell around the planet: haze on the horizon, deeper blue overhead, darker the higher you climb. */
function createSkyDome(radius, sky) {
  const base = new THREE.Color(sky);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      // Deeper than the plain sky colour: the tone mapping pales bright blues a lot
      uHorizon: { value: base.clone().lerp(new THREE.Color(0xffffff), 0.15) },
      uZenith: { value: base.clone().offsetHSL(0, 0.2, -0.2) },
      uSpace: { value: new THREE.Color(0x0c1733) },
      uHigh: { value: 0 }
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: `
      uniform vec3 uHorizon;
      uniform vec3 uZenith;
      uniform vec3 uSpace;
      uniform float uHigh;
      varying vec3 vWorld;
      void main() {
        vec3 dir = normalize(vWorld - cameraPosition);
        float h = dot(dir, normalize(cameraPosition));
        vec3 zenith = mix(uZenith, uSpace, uHigh);
        vec3 col = mix(uHorizon, zenith, pow(smoothstep(-0.03, 0.42, h), 0.7));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

export class PlanetFlight {
  /**
   * pr:      the PlanetRenderer (tiles, radii, camera, groups)
   * start:   unit vector on the planet (planet space)
   * heading: rough direction of travel (planet space)
   * pack:    the space pack (ship models); a stand-in is built without it
   */
  constructor(pr, start, heading, { pack = null, altitude = 0.3, speed = 0 } = {}) {
    this.pr = pr;
    this.pos = start.clone().normalize();
    this.fwd = (heading || new THREE.Vector3(0, 1, 0)).clone();
    this.fwd.addScaledVector(this.pos, -this.fwd.dot(this.pos));
    if (this.fwd.lengthSq() < 1e-8) this.fwd.set(1, 0, 0).addScaledVector(this.pos, -this.pos.x);
    this.fwd.normalize();
    this.hint = pr.locate(this.pos, pr.hexasphere.tiles[0]);
    this.camHint = this.hint;
    this.ceiling = pr.radius * CEILING;
    // One ship length is about three quarters of a tile across
    this.S = pr.tileRadius * 0.55;

    const cfg = SHIPS[savedShip()] || SHIPS.frigate;
    const own = !pack?.[cfg.asset];
    const lods = own ? [proceduralShipGeometry()] : [0, 1, 2].map((i) => pack[cfg.asset][i]);
    this.ship = new Ship(lods, cfg);
    this.ownsGeometry = own;
    this.ship.object.scale.setScalar(this.S);
    this.ship.velocity.set(0, 0, speed);
    this.holder = new THREE.Group();
    this.holder.add(this.ship.object);
    pr.planetGroup.add(this.holder);

    this.alt = Math.max(altitude, this.floorAt(this.pos, this.hint) + CLEAR * 1.5);
    this.dist = 0; // globe units flown, for missions
    this.rig = { az: 0, polar: POLAR, dist: 4.4, lastInput: -10, look: new THREE.Vector3(), pos: null };

    this.sky = createSkyDome(pr.radius * 3, pr.look?.sky ?? 0x9dc0e3);
    pr.scene.add(this.sky);
    this.buildStreaks();
    this.place();
  }

  get speed() {
    return this.ship.speed;
  }

  /** Metres per second over the ground (and through the air). */
  get metresPerSecond() {
    return this.ship.speed * this.S * PACE * M_PER_UNIT;
  }

  tileAt(dir, hint) {
    return this.pr.locate(dir, hint);
  }

  /**
   * Ground under a direction as height above the land radius: sea and land
   * from the rounded coast, mountain tiles at their peak (neighbours ramp in
   * over half a tile so the floor rises before the slope does).
   */
  floorAt(dir, tile) {
    const pr = this.pr;
    let h = pr.surfaceRadius(dir, tile) - pr.landR;
    const peaks = pr.mountainPeaks;
    if (!peaks?.size) return h;
    const spacing = pr.tileSpacing / pr.radius;
    const tm = pr.hexasphere.tileMap;
    const own = peaks.get(tile.id);
    if (own) h = Math.max(h, own);
    for (const id of tile.neighbors) {
      const p = peaks.get(id);
      if (!p) continue;
      const d = dir.distanceTo(tm.get(id).center) / spacing;
      h = Math.max(h, p * THREE.MathUtils.clamp((1.05 - d) / 0.45, 0, 1));
    }
    return h;
  }

  /** Local frame at the ship: n up, f forward, l = the ship's local +X (its left). */
  frame() {
    const n = this.pos;
    const f = this.fwd;
    const l = _v2.crossVectors(n, f).normalize();
    return { n, f, l };
  }

  /** input: { forward, turn, strafe, lift, boost } in -1..1, as in space. */
  update(dt, input) {
    if (!(dt > 0)) return;
    const ship = this.ship;
    ship.position.set(0, 0, 0);
    ship.yaw = 0;
    ship.update(dt, input);
    const d = ship.position;
    const k = this.S * PACE;
    const { n, f, l } = this.frame();
    const r = this.pr.landR + this.alt;
    const newPos = _v.copy(n).multiplyScalar(r).addScaledVector(f, d.z * k).addScaledVector(l, d.x * k).normalize().clone();
    this.alt += d.y * k;
    this.dist += Math.hypot(d.x, d.y, d.z) * k;
    // The nose turned by `yaw`: turn the frame with it, re-express the velocity in it
    const yaw = ship.yaw;
    this.fwd.applyQuaternion(_q.setFromAxisAngle(n, yaw));
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const { x: vx, z: vz } = ship.velocity;
    ship.velocity.x = vx * c - vz * s;
    ship.velocity.z = vx * s + vz * c;
    // Carry the heading over to the new point (parallel transport)
    this.fwd.applyQuaternion(_q.setFromUnitVectors(this.pos, newPos));
    this.pos.copy(newPos);
    this.fwd.addScaledVector(this.pos, -this.fwd.dot(this.pos)).normalize();
    ship.yaw = 0;
    ship.position.set(0, 0, 0);
    ship.object.quaternion.setFromEuler(_e.set(-ship.pitch, 0, ship.bank));

    // Stay between the ground and the ceiling: eased, with the velocity into the limit cancelled
    this.hint = this.tileAt(this.pos, this.hint);
    const floor = this.floorAt(this.pos, this.hint) + CLEAR;
    if (this.alt < floor) {
      this.alt += (floor - this.alt) * (1 - Math.exp(-dt * 14));
      if (this.alt < floor - CLEAR * 0.6) this.alt = floor - CLEAR * 0.6;
      if (ship.velocity.y < 0) ship.velocity.y = 0;
    } else if (this.alt > this.ceiling) {
      this.alt += (this.ceiling - this.alt) * (1 - Math.exp(-dt * 4));
      if (ship.velocity.y > 0) ship.velocity.y *= Math.exp(-dt * 6);
    }
    this.place();
  }

  place() {
    const { n, f, l } = this.frame();
    // Ship space: x = left, y = up, z = nose (the space mode's world axes at yaw 0)
    _m.makeBasis(l, n, f);
    this.holder.quaternion.setFromRotationMatrix(_m);
    this.holder.position.copy(n).multiplyScalar(this.pr.landR + this.alt);
  }

  /** Height above the ground under the ship. */
  get clearance() {
    return this.alt - this.floorAt(this.pos, this.hint);
  }

  /** City under the ship (low enough to land), else null. */
  cityBelow() {
    const ci = this.hint?.cityIndex;
    if (ci === null || ci === undefined) return null;
    return this.alt < this.ceiling * 0.45 ? ci : null;
  }

  // ------------------------------------------------------------------ camera

  /** Mouse orbit around the ship (drag), as in space. */
  look(dx, dy, now) {
    this.rig.az -= dx * 0.006;
    this.rig.polar = THREE.MathUtils.clamp(this.rig.polar - dy * 0.005, 0.3, 2.2);
    this.rig.lastInput = now;
  }

  zoom(deltaY) {
    this.rig.dist = THREE.MathUtils.clamp(this.rig.dist * Math.exp(deltaY * 0.0012), 1.8, 16);
  }

  /** Ship-space point (x left, y up, z forward, in ship lengths) -> world. */
  toWorld(x, y, z, out) {
    const { n, f, l } = this.frame();
    const S = this.S;
    out.copy(this.holder.position).addScaledVector(l, x * S).addScaledVector(n, y * S).addScaledVector(f, z * S);
    return out.applyMatrix4(this.pr.planetGroup.matrixWorld);
  }

  updateCamera(dt, now, camera) {
    const rig = this.rig;
    const ship = this.ship;
    // Drift back behind the ship once the player stops orbiting the camera
    if (now - rig.lastInput > 2.5 && ship.speed > 3) {
      rig.az *= Math.exp(-dt * 1.2);
      rig.polar += (POLAR - rig.polar) * (1 - Math.exp(-dt * 1.2));
    }
    const az = Math.PI + rig.az;
    const sp = Math.sin(rig.polar);
    const want = this.toWorld(sp * Math.sin(az) * rig.dist, 0.25 + Math.cos(rig.polar) * rig.dist, sp * Math.cos(az) * rig.dist, new THREE.Vector3());
    const look = this.toWorld(0, 0.25 + Math.sin(ship.pitch) * 1.5, Math.cos(ship.pitch) * 1.5, new THREE.Vector3());
    if (!rig.pos) {
      rig.pos = want.clone();
      rig.look.copy(look);
    }
    // A little lag behind the ship: speed and turns show in the framing
    rig.pos.lerp(want, 1 - Math.exp(-dt * 5.5));
    rig.look.lerp(look, 1 - Math.exp(-dt * 9));
    // Never below the ground under the camera
    const inv = _m.copy(this.pr.planetGroup.matrixWorld).invert();
    const local = _v.copy(rig.pos).applyMatrix4(inv);
    const dir = _v2.copy(local).normalize();
    this.camHint = this.tileAt(dir, this.camHint);
    const minR = this.pr.landR + this.floorAt(dir, this.camHint) + 0.05;
    if (local.length() < minR) rig.pos.copy(local.setLength(minR).applyMatrix4(this.pr.planetGroup.matrixWorld));

    camera.position.copy(rig.pos);
    const boost = ship.boostFx || 0;
    if (boost > 0.05) {
      const j = boost * 0.05 * this.S;
      camera.position.x += (Math.random() - 0.5) * j;
      camera.position.y += (Math.random() - 0.5) * j;
      camera.position.z += (Math.random() - 0.5) * j;
    }
    camera.up.copy(this.pos).transformDirection(this.pr.planetGroup.matrixWorld);
    camera.lookAt(rig.look);
    const fov = 55 + Math.min(14, ship.speed * 0.18) + boost * 6;
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov += (fov - camera.fov) * (1 - Math.exp(-dt * 5.5));
      camera.updateProjectionMatrix();
    }
    // The sky darkens toward space near the ceiling
    this.sky.material.uniforms.uHigh.value = 0.75 * THREE.MathUtils.smoothstep(this.alt, this.ceiling * 0.3, this.ceiling);
    this.updateStreaks(camera);
  }

  // ------------------------------------------------------------------ speed lines

  buildStreaks() {
    const n = 220;
    const box = this.S * 30;
    this.streakBox = box;
    this.streakPts = [];
    for (let i = 0; i < n; i++) this.streakPts.push(new THREE.Vector3((Math.random() - 0.5) * box * 2, (Math.random() - 0.5) * box * 1.2, (Math.random() - 0.5) * box * 2));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.streaks = new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.streaks.frustumCulled = false;
    this.pr.scene.add(this.streaks);
  }

  updateStreaks(camera) {
    const on = THREE.MathUtils.smoothstep(this.ship.speed, 24, 55);
    this.streaks.material.opacity = on * 0.5;
    this.streaks.visible = on > 0.01;
    if (!this.streaks.visible) return;
    // Velocity in world space
    const v = this.ship.velocity;
    const { n, f, l } = this.frame();
    const dir = _v.copy(l).multiplyScalar(v.x).addScaledVector(n, v.y).addScaledVector(f, v.z).transformDirection(this.pr.planetGroup.matrixWorld);
    const len = Math.min(6, this.ship.speed * 0.07) * this.S;
    const c = camera.position;
    const box = this.streakBox;
    const arr = this.streaks.geometry.attributes.position.array;
    this.streakPts.forEach((p, i) => {
      for (const ax of ['x', 'y', 'z']) {
        const d = p[ax] - c[ax];
        if (d > box) p[ax] -= box * 2;
        else if (d < -box) p[ax] += box * 2;
      }
      arr.set([p.x, p.y, p.z, p.x - dir.x * len, p.y - dir.y * len, p.z - dir.z * len], i * 6);
    });
    this.streaks.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.pr.planetGroup.remove(this.holder);
    if (this.ownsGeometry) this.ship.geometries.forEach((g) => g.dispose());
    this.ship.dispose();
    this.pr.scene.remove(this.sky, this.streaks);
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.streaks.geometry.dispose();
    this.streaks.material.dispose();
  }
}
