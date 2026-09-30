import * as THREE from 'three';
import { Car, VEHICLE_TYPES } from './vehicle.js';
import { trafficPose, advanceTraffic } from '../navigation/trafficRoute.js';
import { assemble, vehicleGeometry as wrap } from './vehicleKit.js';

// Every vehicle in town: parked cars and carts, traffic running the streets,
// and the one the player drives. Each is assembled from the kit (body,
// wheels, accessories, horses) and every part is drawn instanced: one mesh per
// model for the whole town, paint per instance. Wheels spin with the distance
// travelled and the front ones steer. Every vehicle can be taken, traffic too.

const _m = new THREE.Matrix4();
const _base = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _rot = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const WHITE = new THREE.Color(1, 1, 1);

export class Fleet {
  constructor(builder, scene, { shadows, rng = Math.random }) {
    this.builder = builder;
    this.scene = scene;
    this.shadows = shadows;
    this.rng = rng;
    this.vehicles = [];
    this.meshes = [];
  }

  /**
   * v: { type (a kit recipe), x, z, yaw, mode: 'parked' | 'traffic', line?, s?, dir? }
   * Call build() once all vehicles are added.
   */
  add(v) {
    const kit = v.kit || assemble(v.type, this.rng); // a vehicle arriving from the planet keeps its kit
    if (!this.builder.townPack[kit.body]) return null;
    const spec = VEHICLE_TYPES[kit.physics] || VEHICLE_TYPES.sedan;
    const car = new Car(spec, v);
    car.y = this.builder.groundAt(v.x, v.z);
    const vehicle = { ...v, kit, spec, car, hidden: false, stopped: 0, id: this.vehicles.length, dist: 0, steerVis: 0, slots: [] };
    if (v.mode === 'traffic') this.initRoute(vehicle, v.line, v.s ?? 0, v.dir ?? 1);
    this.vehicles.push(vehicle);
    return vehicle;
  }

  initRoute(v, line, s, dir) {
    const lens = [0];
    for (let k = 1; k < line.pts.length; k++) lens.push(lens[k - 1] + Math.hypot(line.pts[k].x - line.pts[k - 1].x, line.pts[k].z - line.pts[k - 1].z));
    v.route = { line, lens, total: lens[lens.length - 1], s, dir, lane: line.w >= 6 ? line.w / 4 : 0 };
    v.cruise = v.cruise ?? (['caravan', 'cart', 'wagon'].includes(v.type) ? 2.4 : 8 + this.rng() * 4);
    v.speed = v.cruise;
    Object.assign(v.car, trafficPose(v.route));
  }

  /** One instanced mesh per model, a slot in it for every use of that model. */
  build() {
    const need = new Map();
    const want = (asset, entry) => {
      if (!this.builder.townPack[asset]) return;
      if (!need.has(asset)) need.set(asset, []);
      need.get(asset).push(entry);
    };
    for (const v of this.vehicles) {
      const k = v.kit;
      want(k.body, { v, local: null, paint: k.paint });
      for (const w of k.wheels) want(w.kind, { v, wheel: w, paint: WHITE });
      for (const p of k.parts) want(p.asset, { v, local: new THREE.Matrix4().compose(_v.set(p.x, p.y, p.z), _q.identity(), new THREE.Vector3(p.sx, p.sy, p.sz)), paint: p.paint });
      for (const h of k.horses) want('vh_horse', { v, horse: h, paint: h.paint });
    }
    for (const [asset, list] of need) {
      const lods = this.builder.townPack[asset];
      const geo = wrap(lods[0] || lods[1]);
      const paint = new Float32Array(list.length * 3);
      list.forEach((e, i) => e.paint.toArray(paint, i * 3));
      geo.setAttribute('aPaint', new THREE.InstancedBufferAttribute(paint, 3));
      const inst = new THREE.InstancedMesh(geo, this.builder.material, list.length);
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      inst.castShadow = this.shadows;
      inst.receiveShadow = this.shadows;
      inst.frustumCulled = false;
      inst.name = `fleet:${asset}`;
      list.forEach((e, i) => e.v.slots.push({ inst, i, local: e.local, wheel: e.wheel, horse: e.horse }));
      this.meshes.push({ inst, dirty: true });
      this.scene.add(inst);
    }
    this.writeAll();
  }

  write(v) {
    if (v.hidden) {
      for (const s of v.slots) s.inst.setMatrixAt(s.i, ZERO);
      this.markDirty(v);
      return;
    }
    const c = v.car;
    _q.setFromEuler(_e.set(-c.pitch, c.yaw, c.roll, 'YXZ'));
    _base.compose(_v.set(c.x, c.y + c.bob, c.z), _q, _s.set(1, 1, 1));
    const moving = Math.abs(c.forwardSpeed ?? 0) > 0.2 || (v.mode === 'traffic' && v.speed > 0.2);
    for (const s of v.slots) {
      if (s.wheel) {
        const w = s.wheel;
        // Spin with the distance rolled, steer the front ones
        _local.makeTranslation(w.x, w.y, w.z);
        if (w.steer) _local.multiply(_rot.makeRotationY(v.steerVis));
        _local.multiply(_rot.makeRotationX(v.dist / w.r));
        _local.multiply(_rot.makeScale(w.w, w.r, w.r));
        _m.multiplyMatrices(_base, _local);
      } else if (s.horse) {
        // A trot: the horse bobs as it walks
        const bob = moving ? Math.abs(Math.sin(v.dist * 1.9 + s.horse.x * 2)) * 0.07 : 0;
        _local.makeTranslation(s.horse.x, bob, s.horse.z);
        _m.multiplyMatrices(_base, _local);
      } else if (s.local) _m.multiplyMatrices(_base, s.local);
      else _m.copy(_base);
      s.inst.setMatrixAt(s.i, _m);
    }
    this.markDirty(v);
  }

  markDirty(v) {
    for (const s of v.slots) s.inst.userData.dirty = true;
  }

  writeAll() {
    this.vehicles.forEach((v) => this.write(v));
    this.flush();
  }

  flush() {
    for (const m of this.meshes) {
      if (m.inst.userData.dirty) {
        m.inst.instanceMatrix.needsUpdate = true;
        m.inst.userData.dirty = false;
      }
    }
  }

  /** Where along its street a traffic vehicle is: position and heading. */
  routePose(v) {
    return trafficPose(v.route);
  }

  /**
   * obstacles: [{ x, z }] the traffic brakes for (the player, the player's car)
   */
  update(dt, obstacles) {
    for (const v of this.vehicles) {
      if (v.hidden) continue;
      const c = v.car;
      if (v.mode === 'player') {
        // The player's car: its physics runs in the mode, the fleet only draws it
        v.dist += (c.forwardSpeed ?? 0) * dt;
        v.steerVis = -c.steer;
        this.write(v);
        continue;
      }
      if (v.mode !== 'traffic') continue;
      // Brake for anything close ahead in our path, including other traffic
      const fx = Math.sin(c.yaw);
      const fz = Math.cos(c.yaw);
      let clear = Infinity;
      const check = (x, z) => {
        const dx = x - c.x;
        const dz = z - c.z;
        const ahead = dx * fx + dz * fz;
        const side = Math.abs(dx * fz - dz * fx);
        if (ahead > 0 && side < 2.2) clear = Math.min(clear, ahead);
      };
      for (const o of obstacles) check(o.x, o.z);
      for (const o of this.vehicles) if (o !== v && !o.hidden) check(o.car.x, o.car.z);
      const r=v.route, remaining=r.dir>0?r.total-r.s:r.s;
      const cruise=r.turn!==undefined?Math.min(2.5,v.cruise):Math.min(v.cruise,2.5+remaining*.6);
      const want = v.stopped > 0 ? 0 : clear < 6 ? 0 : clear < 16 ? cruise * ((clear - 6) / 10) : cruise;
      v.speed += (want - v.speed) * (1 - Math.exp(-dt * (want < v.speed ? 5 : 1.5)));
      if (v.stopped > 0) v.stopped -= dt;
      advanceTraffic(r, v.speed*dt, dt);
      const p = this.routePose(v);
      // Smooth the heading so U-turns and corners swing instead of snapping
      let d = p.yaw - c.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const turn = d * (1 - Math.exp(-dt * 6));
      c.yaw += turn;
      // Front wheels follow the turn the car is making
      const yawRate = turn / Math.max(dt, 1e-3);
      v.steerVis += (THREE.MathUtils.clamp(Math.atan((yawRate * v.spec.wheelbase) / Math.max(v.speed, 1.5)), -0.5, 0.5) - v.steerVis) * (1 - Math.exp(-dt * 8));
      v.dist += v.speed * dt;
      c.vx = (p.x - c.x) / Math.max(dt, 1e-3);
      c.vz = (p.z - c.z) / Math.max(dt, 1e-3);
      c.x = p.x;
      c.z = p.z;
      c.y = this.builder.groundAt(c.x, c.z);
      const axle=v.spec.wheelbase/2,dx=Math.sin(c.yaw)*axle,dz=Math.cos(c.yaw)*axle;
      const pitch=Math.atan2(this.builder.groundAt(c.x+dx,c.z+dz)-this.builder.groundAt(c.x-dx,c.z-dz),v.spec.wheelbase);
      const settle=1-Math.exp(-dt*10);
      c.pitch+=(pitch-c.pitch)*settle;
      c.roll+=(THREE.MathUtils.clamp(-v.speed*yawRate*.008,-.055,.055)-c.roll)*settle;
      this.write(v);
    }
    this.flush();
  }

  /** Enterable vehicle nearest to (x, z) within `reach` metres of its side. */
  nearest(x, z, reach = 3.2) {
    let best = null;
    let bestD = reach;
    for (const v of this.vehicles) {
      if (v.hidden || v.mode === 'player') continue;
      const d = Math.hypot(v.car.x - x, v.car.z - z) - v.spec.width * 0.5;
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  /** Push a circle out of every vehicle (two circles per vehicle). */
  resolve(x, z, r, exclude = null) {
    for (const v of this.vehicles) {
      if (v === exclude || v.hidden) continue;
      const c = v.car;
      const fx = Math.sin(c.yaw);
      const fz = Math.cos(c.yaw);
      const half = v.spec.length * 0.3;
      const vr = v.spec.width * 0.55;
      for (const s of [-1, 1]) {
        const cx = c.x + fx * half * s;
        const cz = c.z + fz * half * s;
        const dx = x - cx;
        const dz = z - cz;
        const d = Math.hypot(dx, dz);
        if (d < r + vr && d > 1e-6) {
          x = cx + (dx / d) * (r + vr);
          z = cz + (dz / d) * (r + vr);
        }
      }
    }
    return { x, z };
  }

  hide(v) {
    v.hidden = true;
    this.write(v);
    this.flush();
  }

  /** The player takes a vehicle: from now on it follows their car. */
  drive(v, car) {
    v.car = car;
    v.mode = 'player';
    v.hidden = false;
  }

  /** Put a vehicle back as parked where the player left it. */
  park(v, car) {
    v.car = car;
    v.mode = 'parked';
    v.hidden = false;
    this.write(v);
    this.flush();
  }

  dispose() {
    for (const m of this.meshes) {
      this.scene.remove(m.inst);
      m.inst.dispose();
      // The fleet owns this wrapper (including its per-instance paint buffer),
      // while the source pack remains in the asset library for later towns.
      m.inst.geometry.dispose();
    }
    this.meshes = [];
  }
}
