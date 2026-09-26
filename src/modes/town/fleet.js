import * as THREE from 'three';
import { Car, VEHICLE_TYPES } from './vehicle.js';

// Every vehicle in town that the player is not driving: parked cars and carts,
// and traffic running the streets. All drawn instanced (one mesh per model),
// all enterable: the player can take any of them, traffic included.

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class Fleet {
  constructor(builder, scene, { shadows }) {
    this.builder = builder;
    this.scene = scene;
    this.shadows = shadows;
    this.vehicles = [];
    this.groups = new Map(); // model key -> { inst, res, slots }
    this.color = new THREE.Color();
  }

  /**
   * v: { asset, variant, type, x, z, yaw, mode: 'parked' | 'traffic', line?, tint? }
   * Call build() once all vehicles are added.
   */
  add(v) {
    const res = this.builder.resolve(v.asset, v.variant ?? 0);
    if (!res) return null;
    const spec = VEHICLE_TYPES[v.type] || VEHICLE_TYPES.sedan;
    const car = new Car(spec, v);
    car.y = this.builder.groundAt(v.x, v.z);
    const vehicle = { ...v, res, spec, car, hidden: false, stopped: 0, id: this.vehicles.length };
    if (v.mode === 'traffic') this.initRoute(vehicle, v.line, v.s ?? 0, v.dir ?? 1);
    this.vehicles.push(vehicle);
    return vehicle;
  }

  initRoute(v, line, s, dir) {
    const lens = [0];
    for (let k = 1; k < line.pts.length; k++) lens.push(lens[k - 1] + Math.hypot(line.pts[k].x - line.pts[k - 1].x, line.pts[k].z - line.pts[k - 1].z));
    v.route = { line, lens, total: lens[lens.length - 1], s, dir, lane: line.w >= 10 ? line.w / 4 : 0 };
    v.cruise = v.cruise ?? (v.type === 'caravan' || v.type === 'cart' ? 2.4 : 8 + Math.random() * 4);
    v.speed = v.cruise;
  }

  build() {
    for (const v of this.vehicles) {
      const key = v.res.key;
      if (!this.groups.has(key)) this.groups.set(key, { res: v.res, slots: [] });
      const g = this.groups.get(key);
      v.slot = g.slots.length;
      v.group = g;
      g.slots.push(v);
    }
    for (const g of this.groups.values()) {
      const inst = new THREE.InstancedMesh(g.res.lods[0] || g.res.lods[1], this.builder.material, g.slots.length);
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      inst.castShadow = this.shadows;
      inst.receiveShadow = this.shadows;
      inst.frustumCulled = false;
      g.slots.forEach((v, i) => inst.setColorAt(i, this.color.setScalar(v.tint ?? 1)));
      g.inst = inst;
      this.scene.add(inst);
    }
    this.writeAll();
  }

  write(v) {
    const g = v.group;
    if (!g?.inst) return;
    if (v.hidden) g.inst.setMatrixAt(v.slot, ZERO);
    else {
      const c = v.car;
      _q.setFromEuler(_e.set(-c.pitch, c.yaw, c.roll, 'YXZ'));
      _m.compose(_v.set(c.x, c.y + c.bob, c.z), _q, _s).multiply(v.res.fix);
      g.inst.setMatrixAt(v.slot, _m);
    }
    g.dirty = true;
  }

  writeAll() {
    this.vehicles.forEach((v) => this.write(v));
    this.flush();
  }

  flush() {
    for (const g of this.groups.values()) {
      if (g.dirty && g.inst) {
        g.inst.instanceMatrix.needsUpdate = true;
        g.dirty = false;
      }
    }
  }

  /** Where along its street a traffic vehicle is: position and heading. */
  routePose(v) {
    const r = v.route;
    let k = 1;
    while (k < r.lens.length - 1 && r.lens[k] < r.s) k++;
    const a = r.line.pts[k - 1];
    const b = r.line.pts[k];
    const t = (r.s - r.lens[k - 1]) / (r.lens[k] - r.lens[k - 1] || 1);
    const dx = (b.x - a.x) * r.dir;
    const dz = (b.z - a.z) * r.dir;
    const len = Math.hypot(dx, dz) || 1;
    // Right-hand traffic: the lane sits to the right of the direction of travel
    return {
      x: a.x + (b.x - a.x) * t - (dz / len) * r.lane,
      z: a.z + (b.z - a.z) * t + (dx / len) * r.lane,
      yaw: Math.atan2(dx, dz)
    };
  }

  /**
   * obstacles: [{ x, z }] the traffic brakes for (the player, the player's car)
   */
  update(dt, obstacles) {
    for (const v of this.vehicles) {
      if (v.hidden || v.mode !== 'traffic') continue;
      const c = v.car;
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
      const want = v.stopped > 0 ? 0 : clear < 6 ? 0 : clear < 16 ? v.cruise * ((clear - 6) / 10) : v.cruise;
      v.speed += (want - v.speed) * (1 - Math.exp(-dt * (want < v.speed ? 5 : 1.5)));
      if (v.stopped > 0) v.stopped -= dt;
      const r = v.route;
      r.s += v.speed * r.dir * dt;
      if (r.s > r.total || r.s < 0) {
        r.dir *= -1; // U-turn at the end of the street
        r.s = THREE.MathUtils.clamp(r.s, 0, r.total);
      }
      const p = this.routePose(v);
      // Smooth the heading so U-turns and corners swing instead of snapping
      let d = p.yaw - c.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      c.yaw += d * (1 - Math.exp(-dt * 6));
      c.vx = (p.x - c.x) / Math.max(dt, 1e-3);
      c.vz = (p.z - c.z) / Math.max(dt, 1e-3);
      c.x = p.x;
      c.z = p.z;
      c.y = this.builder.groundAt(c.x, c.z);
      this.write(v);
    }
    this.flush();
  }

  /** Enterable vehicle nearest to (x, z) within `reach` metres of its side. */
  nearest(x, z, reach = 3.2) {
    let best = null;
    let bestD = reach;
    for (const v of this.vehicles) {
      if (v.hidden) continue;
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

  /** Put a vehicle back as parked where the player left it. */
  park(v, car) {
    v.car = car;
    v.mode = 'parked';
    v.hidden = false;
    this.write(v);
    this.flush();
  }

  dispose() {
    for (const g of this.groups.values()) g.inst?.dispose();
  }
}
