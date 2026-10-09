import * as THREE from 'three';
import { insideSolid } from './scatter.js';

// Things you can pick up (docs/FARM_PLAN.md §5.3): lifted over the head, carried, thrown in an
// arc, bouncing once or twice with a puff of dust. Into the shipping bin they sparkle and go;
// into the river they splash and sink. The flight is a plain ballistic step, no physics engine.

export const GRAVITY = 9.8;
export const THROW = { forward: 4.2, up: 3.4 }; // m/s, from over the head
const RADIUS = { stone_small: 0.12, log: 0.14, apple: 0.1, crop_ripe: 0.12 };

/**
 * One flight step for an item { p, v, r }: gravity, then a bounce on whatever the ground is.
 * Returns 'bounce' with the impact speed, 'rest' once it settles, or null in the air.
 */
export function stepFlight(item, dt, surfaceAt) {
  item.v.y -= GRAVITY * dt;
  item.p.addScaledVector(item.v, dt);
  const floor = surfaceAt(item.p.x, item.p.z) + item.r;
  if (item.p.y > floor) return null;
  item.p.y = floor;
  const impact = -item.v.y;
  if (impact > 1.4) {
    item.v.y = impact * 0.32;
    item.v.x *= 0.5;
    item.v.z *= 0.5;
    return { kind: 'bounce', impact };
  }
  item.v.set(0, 0, 0);
  return { kind: 'rest', impact };
}

export class Pickups {
  constructor(kit, ground, { solids = [], effects = null, bin = null } = {}) {
    this.kit = kit;
    this.ground = ground;
    // The bin takes what lands in it: its solid only stops walkers, not thrown things
    this.solids = solids.filter((s) => s.kit !== 'shipping_bin');
    this.effects = effects;
    this.bin = bin; // { x, z, w, d, rot (three.js), top }
    this.group = new THREE.Group();
    this.group.name = 'pickups';
    this.items = [];
    this.shipped = 0;
  }

  spawn(kind, x, z, { y = null, v = null } = {}) {
    const mesh = new THREE.Group();
    for (const { geometry, material } of this.kit[kind]) {
      const part = new THREE.Mesh(geometry, material);
      part.castShadow = true;
      part.receiveShadow = true;
      mesh.add(part);
    }
    mesh.rotation.y = Math.random() * Math.PI * 2;
    const r = RADIUS[kind] ?? 0.12;
    const ground = this.ground.surfaceAt(x, z);
    const item = { kind, mesh, r, state: v ? 'flying' : 'ground', p: new THREE.Vector3(x, y ?? ground, z), v: v ? v.clone() : new THREE.Vector3() };
    mesh.position.copy(item.p);
    this.group.add(mesh);
    this.items.push(item);
    return item;
  }

  /**
   * A living thing that can also be picked up (a chicken): its own root is the item's mesh and
   * its position is shared, so it can walk about between being carried and thrown.
   */
  adopt(kind, animal, r = 0.18) {
    const item = { kind, mesh: animal.root, r, state: 'ground', p: animal.root.position, v: new THREE.Vector3(), animal };
    this.items.push(item);
    return item;
  }

  /** The item lying in front of (x, z) along `facing`, within reach. */
  inFront(x, z, facing, reach = 1.1) {
    let best = null, bestD = reach;
    for (const it of this.items) {
      if (it.state !== 'ground') continue;
      const dx = it.p.x - x, dz = it.p.z - z, d = Math.hypot(dx, dz);
      if (d > reach || (d > 0.25 && (dx * facing.x + dz * facing.z) / d < 0.35)) continue;
      if (d < bestD) { best = it; bestD = d; }
    }
    return best;
  }

  carry(item) {
    item.state = 'carried';
    if (item.animal) item.animal.held = true;
  }

  /** Throw from over the head along facing (unit x, z). */
  throw(item, from, facing) {
    item.state = 'flying';
    item.p.copy(from);
    item.v.set(facing.x * THROW.forward, THROW.up, facing.z * THROW.forward);
  }

  /** Where the carried item rides: just above the actor's head. */
  holdAt(item, head) {
    item.p.copy(head);
    item.mesh.position.copy(head);
  }

  update(dt) {
    for (const it of this.items) {
      if (it.state !== 'flying') continue;
      const before = it.p.clone();
      const hit = stepFlight(it, dt, this.ground.surfaceAt);
      // The bin's opening first (it is also a solid), then walls turn it back
      if (this.inBin(it) && it.p.y < this.bin.top + 0.5 && !it.animal) {
        this.ship(it);
        continue;
      }
      if (insideSolid(this.solids, it.p.x, it.p.z, it.r)) {
        it.p.x = before.x;
        it.p.z = before.z;
        it.v.x *= -0.35;
        it.v.z *= -0.35;
      }
      it.mesh.position.copy(it.p);
      if (!it.animal) it.mesh.rotation.x += dt * 6;
      const ground = this.ground.surfaceAt(it.p.x, it.p.z);
      if (ground < this.ground.water && it.p.y < this.ground.water + it.r && !this.ground.deckAt(it.p.x, it.p.z)) {
        this.effects?.burst('splash', new THREE.Vector3(it.p.x, this.ground.water + 0.02, it.p.z), 14, { speed: 2.4 });
        this.remove(it);
        continue;
      }
      if (hit?.kind === 'bounce') this.effects?.burst('dust', it.p, Math.min(10, 3 + Math.round(hit.impact)), { speed: 1.1 });
      if (hit?.kind === 'rest') {
        it.state = 'ground';
        if (it.animal) {
          // Back on its feet: a startled dash
          it.animal.held = false;
          it.animal.state = 'flee';
          it.animal.fleeFor = 1.2;
        } else it.mesh.rotation.x = 0;
      }
    }
    this.items = this.items.filter((it) => it.state !== 'gone');
  }

  inBin(it) {
    const b = this.bin;
    if (!b) return false;
    const a = -b.rot, c = Math.cos(a), s = Math.sin(a), dx = it.p.x - b.x, dz = it.p.z - b.z;
    return Math.abs(dx * c - dz * s) < b.w / 2 && Math.abs(dx * s + dz * c) < b.d / 2;
  }

  ship(it) {
    this.effects?.burst('sparkle', new THREE.Vector3(this.bin.x, this.bin.top + 0.3, this.bin.z), 16, { speed: 1.6 });
    this.shipped++;
    this.remove(it);
  }

  remove(it) {
    if (it.animal) {
      // Animals are never shipped or drowned: they flutter back out onto the bank
      it.state = 'ground';
      it.animal.held = false;
      it.v.set(0, 0, 0);
      return;
    }
    it.state = 'gone';
    this.group.remove(it.mesh);
  }

  count(kind) {
    return this.items.filter((it) => it.kind === kind && it.state !== 'gone').length;
  }
}
