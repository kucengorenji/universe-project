// Cars and carts: the traffic fleet, arriving and leaving by road, getting in and out, driving and the gauges.
// Methods of the town instance (mixed into TownMode, see mixin.js): they use its state and are called as this.<name>().

import * as THREE from 'three';
import { segDist2 } from '../layout/townLayout.js';
import { WATER_Y } from '../scale.js';
import { Colliders } from '../navigation/colliders.js';
import { Fleet } from '../vehicles/fleet.js';
import { Car } from '../vehicles/vehicle.js';
import { FLEETS, pickRecipe } from '../vehicles/vehicleKit.js';
import { t as tr } from '../../../i18n/index.js';
import { _v } from './shared.js';

export class VehicleMethods {
  /**
   * What stops a car: buildings, the town wall and its towers. Trees, lamps,
   * fences, benches and stalls are driven through (they only slow the car a touch).
   */
  buildVehicleColliders() {
    const key = (x, z) => `${Math.round(x * 10)},${Math.round(z * 10)}`;
    const walls = new Set((this.layout.walls || []).map((w) => key(w.x, w.z)));
    const towers = new Set((this.layout.props || []).filter((p) => p.asset === 'f_wall_tower').map((p) => key(p.x, p.z)));
    const inBuilding = (x, z) => {
      for (const b of this.cameraBlockers.near(x, z, 0.5)) {
        const dx = x - b.x, dz = z - b.z, ca = Math.cos(b.yaw), sa = Math.sin(b.yaw);
        if (Math.abs(dx * ca + dz * sa) <= b.hw + 0.5 && Math.abs(-dx * sa + dz * ca) <= b.hd + 0.5) return true;
      }
      return false;
    };
    const solid = this.layout.colliders.filter((c) =>
      c.type === 'box' ? walls.has(key(c.x, c.z)) || inBuilding(c.x, c.z) : towers.has(key(c.x, c.z)) && c.r >= 2
    );
    // Buildings without a layout collider still stop the car (their footprint box)
    for (const b of this.cameraBlockers.near(0, 0, 1e5)) if (!solid.some((c) => c.type === 'box' && Math.hypot(c.x - b.x, c.z - b.z) < 0.6)) solid.push(b);
    return new Colliders(solid);
  }

  /** Parked cars along the streets and traffic on the bigger ones; every one of them can be taken. */
  buildFleet(rng, shadows) {
    const L = this.layout;
    // Modern towns get cars, fantasy towns carts and caravans, all assembled from the kit
    const style = L.modern ? 'modern' : 'fantasy';
    this.fleet = new Fleet(this.builder, this.scene, { shadows, rng });
    if (!this.builder.townPack.vb_sedan && !this.builder.townPack.vb_cart) return;
    const pick = () => ({ type: pickRecipe(FLEETS[style], rng) });
    const buses = L.modern ? [{ type: 'bus' }] : [];
    // Parked: the layout's roadside spots (modern), or carts left by the main streets (fantasy)
    for (const p of L.props) {
      if (!p.parked) continue;
      const k = pick();
      this.fleet.add({ ...k, x: p.x, z: p.z, yaw: -p.yaw, mode: 'parked' });
    }
    const lines = L.driveGraph.filter((l) => l.pts.length >= 2);
    if (!L.modern) {
      const mains = L.streets.filter((st) => st.kind === 'main' || st.kind === 'road');
      for (let i = 0; i < Math.min(6, mains.length * 2); i++) {
        const st = mains[i % mains.length];
        const k = Math.min(st.pts.length - 2, 2 + Math.floor(rng() * Math.max(1, st.pts.length - 4)));
        if (k < 1) continue;
        const [ax, az] = st.pts[k];
        const [bx, bz] = st.pts[k + 1];
        const len = Math.hypot(bx - ax, bz - az) || 1;
        const off = st.w / 2 + 1.4;
        const x = ax - ((bz - az) / len) * off;
        const z = az + ((bx - ax) / len) * off;
        // The whole length must be clear, horses included (they stand ahead of the cart)
        const tx = (bx - ax) / len;
        const tz = (bz - az) / len;
        const clear = [-3, 0, 3, 5].every((d) => {
          const px = x + tx * d;
          const pz = z + tz * d;
          const r = this.colliders.resolve(px, pz, 1.3);
          return r.x === px && r.z === pz;
        });
        if (!clear) continue;
        this.fleet.add({ ...pick(), x, z, yaw: Math.atan2(bx - ax, bz - az), mode: 'parked' });
      }
    }
    // Arriving by road: the player's vehicle, at the edge on the road that faces where they came from
    if (this.arrival?.drive) {
      const d = this.arrival.drive;
      const at = this.roadEntry(d.dir, d.fromCity);
      const type = d.kit?.type || (L.modern ? 'suv' : 'cart');
      this.roadVehicle = this.fleet.add({ type, kit: d.kit?.type ? d.kit : undefined, x: at.x, z: at.z, yaw: at.yaw, mode: 'parked' });
    }
    // Traffic
    const n = Math.min(L.modern ? 22 : 8, lines.length * 3);
    const mains = lines.filter((l) => l.w >= 18);
    for (let i = 0; i < n; i++) {
      // Every sixth vehicle on a main avenue is a bus
      const bus = buses.length && mains.length && i % 6 === 0;
      const line = bus ? mains[i % mains.length] : lines[i % lines.length];
      const kind = bus ? buses[i % buses.length] : pick();
      const v = this.fleet.add({ ...kind, x: line.pts[0].x, z: line.pts[0].z, yaw: 0, mode: 'traffic', line, s: rng() * 400, dir: rng() < 0.5 ? 1 : -1 });
      if (!v) continue;
      v.route.s = Math.min(v.route.total, v.route.s);
      const p = this.fleet.routePose(v);
      Object.assign(v.car, { x: p.x, z: p.z, yaw: p.yaw });
    }
    this.fleet.build();
  }

  /**
   * Where a vehicle coming from planet direction `dir` enters: the road out of
   * town that points that way (else straight in from that side), near the edge,
   * facing into town.
   */
  roadEntry(dir, fromCity) {
    const L = this.layout;
    const R = L.dioramaR - 45;
    let a = 0;
    if (dir) {
      const [x, y, z] = dir;
      const { U, V } = L.frame;
      a = Math.atan2(x * V[0] + y * V[1] + z * V[2], x * U[0] + y * U[1] + z * U[2]);
    }
    const angleDistance = (e) => Math.abs(Math.atan2(Math.sin(e.angle - a), Math.cos(e.angle - a)));
    const roads = L.exits.filter((e) => e.road).sort((x, y) =>
      Number(y.toIndex === fromCity) - Number(x.toIndex === fromCity) || angleDistance(x) - angleDistance(y)
    );
    for (const best of roads) {
      // Search inward along the road if its outer edge crosses water.
      const pts = best.road.pts;
      for (let i = pts.length - 1; i > 0; i--) {
        const [x0, z0] = pts[i - 1];
        const [x1, z1] = pts[i];
        if (Math.hypot(x0, z0) < R) {
          const t = THREE.MathUtils.clamp((R - Math.hypot(x0, z0)) / Math.max(1e-3, Math.hypot(x1, z1) - Math.hypot(x0, z0)), 0, 1);
          const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) * t / 5));
          for (let j = steps; j >= 0; j--) {
            const u = t * j / steps;
            const x = x0 + (x1 - x0) * u;
            const z = z0 + (z1 - z0) * u;
            if (Math.hypot(x, z) > R || this.builder.heightAt(x, z) < WATER_Y + 0.1) continue;
            const clear = this.colliders.resolve(x, z, 2);
            if (Math.hypot(clear.x - x, clear.z - z) > 0.1) continue;
            return { x, z, yaw: Math.atan2(x0 - x1, z0 - z1), exit: best };
          }
        }
      }
    }
    return { ...L.spawn, exit: null };
  }

  /** Straight into the driver's seat, rolling into town. */
  startRoadArrival() {
    const v = this.roadVehicle;
    const car = new Car(v.spec, { x: v.car.x, z: v.car.z, yaw: v.car.yaw });
    car.y = v.car.y;
    const speed = Math.min(12, v.spec.top * 0.45);
    car.vx = Math.sin(car.yaw) * speed;
    car.vz = Math.cos(car.yaw) * speed;
    this.fleet.drive(v, car);
    this.drive = { v, car, obj: this.vehicleObject() };
    this.placePlayer(car.x, car.z);
    this.setView('drive', { fromTransfer: true });
    this.chase.reset(car);
    this.arrivedByRoad = true;
    this.roadGrace = 3; // seconds before the edge can send you back out
    this.ctx.missions?.emit('visit_town');
  }

  /** Close to the rim on a road out: say where it goes; over the rim, drive on across the planet. */
  checkRoadOut(dt) {
    this.roadHint = null;
    const d = this.drive;
    if (!d || this.leaving || this.transfer) return;
    if (this.roadGrace > 0) {
      this.roadGrace -= dt;
      return;
    }
    const c = d.car;
    const R = this.layout.dioramaR;
    const r = Math.hypot(c.x, c.z);
    if (r < R - 130 || c.vx * c.x + c.vz * c.z <= 0) return;
    let exit = null;
    for (const e of this.layout.exits) {
      if (!e.road) continue;
      const p = e.road.pts;
      for (let i = 0; i + 1 < p.length && !exit; i++) {
        if (segDist2(c.x, c.z, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]) < 14 * 14) exit = e;
      }
      if (exit) break;
    }
    if (!exit) return;
    this.roadHint = tr('town.roadHint', { city: exit.to || tr('town.roadHint.next') });
    if (r > R - 32) {
      this.leaving = { kit: d.v.kit, type: d.v.type, fromCity: this.route.city, toCity: exit.toIndex };
      this.ctx.director.go({ mode: 'planet', planet: this.route.planet, city: null });
    }
  }

  /** A handle that follows the player's car (the fleet itself draws the car, wheels and all). */
  vehicleObject() {
    const holder = new THREE.Group();
    this.scene.add(holder);
    return holder;
  }

  /** Door the player uses: the driver's side (left of the car). */
  doorOf(car, spec) {
    const lx = Math.cos(car.yaw);
    const lz = -Math.sin(car.yaw);
    const side = spec.width / 2 + 0.7;
    const back = -spec.length * 0.08;
    return { x: car.x + lx * side + Math.sin(car.yaw) * back, z: car.z + lz * side + Math.cos(car.yaw) * back };
  }

  /** Stop a traffic vehicle, walk to its door, and get in. */
  enterVehicle(v) {
    if (this.transfer || !v) return;
    if (v.mode === 'traffic') v.stopped = 1e9;
    const p = this.player;
    this.transfer = { kind: 'enter', v, t0: this.ctx.engine.time, dur: 0.95, from: { x: p.x, z: p.z }, fromTraffic: v.mode === 'traffic' };
    this.hud.setPrompt(null);
  }

  exitVehicle() {
    const d = this.drive;
    if (this.transfer || !d || d.car.speed > 4) return;
    this.transfer = { kind: 'exit', v: d.v, t0: this.ctx.engine.time, dur: 0.7 };
    this.hud.setPrompt(null);
  }

  updateTransfer(t) {
    const tr = this.transfer;
    const raw = Math.min(1, (t - tr.t0) / tr.dur);
    const p = this.player;
    if (tr.kind === 'enter') {
      const car = tr.v.car;
      const door = this.doorOf(car, tr.v.spec);
      const walkT = Math.min(1, raw / 0.55);
      p.x = THREE.MathUtils.lerp(tr.from.x, door.x, walkT);
      p.z = THREE.MathUtils.lerp(tr.from.z, door.z, walkT);
      p.y = this.builder.groundAt(p.x, p.z);
      p.speed = walkT < 1 ? 2.3 : 0;
      const face = walkT < 1 ? Math.atan2(door.x - tr.from.x, door.z - tr.from.z) : car.yaw;
      let dy = face - p.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      p.yaw += dy * 0.25;
      if (raw >= 1) {
        this.transfer = null;
        // Keep the existing exploration checklist reachable without a fleeing-driver effect.
        if (tr.fromTraffic) this.ctx.missions?.emit('carjack');
        this.ctx.audio?.sfx('carDoor');
        this.ctx.audio?.sfx('ignition');
        const drive = new Car(tr.v.spec, { x: car.x, z: car.z, yaw: car.yaw });
        drive.y = car.y;
        this.fleet.drive(tr.v, drive);
        this.drive = { v: tr.v, car: drive, obj: this.vehicleObject(tr.v) };
        drive.apply(this.drive.obj);
        this.chase.reset(drive);
        this.setView('drive', { fromTransfer: true });
      }
    } else {
      const d = this.drive;
      d.car.vx *= 0.8;
      d.car.vz *= 0.8;
      if (raw >= 1) {
        this.transfer = null;
        this.ctx.audio?.sfx('carDoor');
        const door = this.doorOf(d.car, d.v.spec);
        this.scene.remove(d.obj);
        this.fleet.park(d.v, d.car);
        this.drive = null;
        this.placePlayer(door.x, door.z);
        p.yaw = d.car.yaw + Math.PI / 2;
        this.setView('walk', { fromTransfer: true });
      }
    }
  }

  /** What the world looks like to the player's car. */
  driveWorld() {
    const exclude = this.drive?.v;
    return {
      heightAt: (x, z) => this.builder.groundAt(x, z),
      resolve: (x, z, r) => {
        const a = this.vehicleColliders.resolve(x, z, r);
        return this.fleet.resolve(a.x, a.z, r, exclude);
      },
      blocked: (x, z) => this.builder.surfaceAt(x, z) < WATER_Y - 0.3 || Math.hypot(x, z) > this.layout.dioramaR - 8
    };
  }

  updateDrive(dt) {
    const d = this.drive;
    if (!d) return;
    const i = this.intent();
    const input = this.transfer ? { forward: 0, right: 0 } : { forward: i.forward, right: i.right, handbrake: this.keys.has(' '), boost: i.run };
    d.car.update(dt, input, this.driveWorld());
    this.brushProps(d.car, dt);
    d.car.apply(d.obj);
    this.checkRoadOut(dt);
    this.engineSound(d.car, ['cart', 'wagon', 'caravan'].includes(d.v.type));
    this.driveAcc = (this.driveAcc || 0) + d.car.speed * dt;
    if (this.driveAcc > 25) {
      this.ctx.missions?.emit('drive_m', this.driveAcc);
      this.driveAcc = 0;
    }
  }

  /** Props (trees, lamps, fences...) do not stop the car: running through one only scrubs a little speed. */
  brushProps(car, dt) {
    const S = car.spec;
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    let touching = false;
    for (const s of [-1, 1]) {
      const cx = car.x + fx * S.length * 0.32 * s, cz = car.z + fz * S.length * 0.32 * s;
      const r = this.colliders.resolve(cx, cz, S.width * 0.45);
      if (Math.hypot(r.x - cx, r.z - cz) > 0.02) touching = true;
    }
    if (touching && car.speed > 1) {
      const k = Math.exp(-dt * 1.2);
      car.vx *= k;
      car.vz *= k;
      if (!this.brushing) this.ctx.audio?.sfx('hit', { strength: Math.min(0.35, car.speed / 40) });
    }
    this.brushing = touching;
  }

  /** Engine note with a fake gearbox: revs climb through each gear and drop on the shift. */
  engineSound(car, horse) {
    const audio = this.ctx.audio;
    if (!audio) return;
    const top = car.spec.top || 30;
    const sp = Math.abs(car.forwardSpeed);
    if (horse) {
      // Carts are pulled: hooves instead of an engine
      this.hoof = (this.hoof || 0) + sp * 0.016 * 1.6;
      if (this.hoof > 1 && sp > 0.5) {
        this.hoof = 0;
        audio.sfx('step', { surface: 'wood' });
      }
      return;
    }
    const gears = 5;
    const g = Math.min(gears - 1, Math.floor((sp / top) * gears));
    const inGear = (sp / top) * gears - g;
    const rpm = Math.min(1, 0.18 + inGear * 0.72 + car.throttle * (g === 0 ? 0.25 : 0.08));
    audio.engine('car', { speed01: Math.min(1, sp / top), throttle: car.throttle, rpm, skid: car.skid * Math.min(1, car.speed / 6) });
    if (car.impact > 0.25 && !this.lastImpact) audio.sfx('hit', { strength: Math.min(1, car.impact) });
    this.lastImpact = car.impact > 0.25;
  }

  /** Minimap (every other frame) and the speedometer. */
  updateGauges() {
    if (this.view === 'diorama') return;
    this.gaugeFrame = (this.gaugeFrame || 0) + 1;
    const car = this.drive?.car;
    if (car && this.view === 'drive') {
      const top = car.spec.top || 30;
      const sp = Math.abs(car.forwardSpeed);
      const gear = car.forwardSpeed < -0.5 ? 'R' : sp < 0.3 ? 'N' : String(1 + Math.min(4, Math.floor((sp / top) * 5)));
      this.speedo.set(sp * 3.6, sp / (top * 1.25), gear);
    }
    if (this.gaugeFrame % 2) return;
    const dir = this.camera.getWorldDirection(_v);
    const pos = car && this.view === 'drive' ? car : this.player;
    const cars = [];
    for (const v of this.fleet.vehicles) if (!v.hidden && v.mode === 'traffic') cars.push(v.car);
    this.minimap.draw(pos, pos.yaw, { x: dir.x, z: dir.z }, cars, this.view === 'drive' ? 160 : 90, { doors: this.view === 'walk' });
  }
}
