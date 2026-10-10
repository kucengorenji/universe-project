// Grass that gives way under the player (LIVING_WORLD_BOOK Proof 1). The blades have no
// state of their own, so the contact is a handful of "pushers": the live one under the
// player's feet, and a few released footprints that fade out over about a second. The shader
// (groundCover.js) bends any blade near a pusher away from it, root fixed; nothing here
// touches colliders, layout or saves.

export const PUSH_RADIUS = 0.55; // m
export const MAX_TIP_OFFSET = 0.2; // m at the tip of the tallest blade
export const MAX_BEND_DEG = 25;
export const ATTACK_S = 0.1; // contact -> full bend
export const RECOVERY_S = 1.1; // release -> blade at rest
export const STAMP_SPACING = 0.45; // m between released footprints

/** 0 -> 1 while the player stands on the blade. Full bend after 0.1 s. */
export const attack = (age) => Math.min(1, Math.max(0, age) / ATTACK_S);

/** 1 -> 0 after the player left: >= 80 % back at 0.8 s, 100 % at 1.1 s. */
export function recovery(age) {
  if (age <= 0) return 1;
  if (age >= RECOVERY_S) return 0;
  return 0.5 * (1 + Math.cos(Math.PI * (age / RECOVERY_S)));
}

/** How much of the push a blade at `distance` from a pusher feels: 1 under the foot, 0 at the radius. */
export function influence(distance, radius = PUSH_RADIUS) {
  if (distance >= radius) return 0;
  const x = 1 - distance / radius;
  return x * x * (3 - 2 * x);
}

/** The tip offset (m) and its direction for one blade, the same maths the shader runs. */
export function bladeOffset(blade, pusher, { tip = 1 } = {}) {
  const dx = blade.x - pusher.x, dz = blade.z - pusher.z;
  const distance = Math.hypot(dx, dz);
  const amount = MAX_TIP_OFFSET * pusher.strength * influence(distance, pusher.radius ?? PUSH_RADIUS) * tip * tip;
  if (!amount) return { x: 0, z: 0, amount: 0 };
  // a blade exactly under the foot falls toward +x rather than nowhere
  const nx = distance > 1e-6 ? dx / distance : 1, nz = distance > 1e-6 ? dz / distance : 0;
  return { x: nx * amount, z: nz * amount, amount };
}

export class GrassContact {
  /** `slots` is how many pushers the shader reads (6, or 4 on the Low tier). */
  constructor({ slots = 6 } = {}) {
    this.slots = slots;
    this.live = null; // { x, z, age }
    this.released = []; // { x, z, age }
    this.lastStamp = null;
    this.metrics = { stamps: 0, peakActive: 0, contacts: 0, lastContactAt: null, enabled: true };
  }

  /** Forget everything (route change, pause menu reset): no blade may stay bent. */
  reset() {
    this.live = null;
    this.released.length = 0;
    this.lastStamp = null;
  }

  /**
   * One frame. `dt` is active seconds (0 while paused freezes the fade), `pos` is where the
   * player stands, or null when nobody is walking on the ground (diorama, interior, driving).
   */
  update(dt, pos) {
    for (const p of this.released) p.age += dt;
    this.released = this.released.filter((p) => p.age < RECOVERY_S);
    if (!pos) {
      if (this.live) this.release();
      return this;
    }
    if (!this.live) {
      this.live = { x: pos.x, z: pos.z, age: dt }; // the first frame of contact already counts
      this.lastStamp = { x: pos.x, z: pos.z };
      this.metrics.contacts++;
    } else {
      this.live.x = pos.x;
      this.live.z = pos.z;
      this.live.age += dt;
      // Where the player has been leaves a footprint that recovers on its own
      if (Math.hypot(pos.x - this.lastStamp.x, pos.z - this.lastStamp.z) >= STAMP_SPACING) {
        this.released.push({ x: this.lastStamp.x, z: this.lastStamp.z, age: 0 });
        this.lastStamp = { x: pos.x, z: pos.z };
        this.metrics.stamps++;
        if (this.released.length > this.slots - 1) this.released.shift();
      }
    }
    this.metrics.peakActive = Math.max(this.metrics.peakActive, this.active);
    return this;
  }

  release() {
    this.released.push({ x: this.live.x, z: this.live.z, age: 0 });
    if (this.released.length > this.slots - 1) this.released.shift();
    this.live = null;
    this.lastStamp = null;
  }

  get active() { return (this.live ? 1 : 0) + this.released.length; }

  /** The pushers as { x, z, strength, radius }, live first, strongest signal for the shader. */
  pushers() {
    const out = [];
    if (this.live) out.push({ x: this.live.x, z: this.live.z, strength: attack(this.live.age), radius: PUSH_RADIUS });
    for (let i = this.released.length - 1; i >= 0; i--) {
      const p = this.released[i];
      out.push({ x: p.x, z: p.z, strength: recovery(p.age), radius: PUSH_RADIUS });
    }
    return out.slice(0, this.slots);
  }

  /** Copy into the shader's vec4 array: (x, z, radius, strength); unused slots get strength 0. */
  writeTo(vectors) {
    const list = this.pushers();
    for (let i = 0; i < vectors.length; i++) {
      const p = list[i];
      if (p) vectors[i].set(p.x, p.z, p.radius, p.strength);
      else vectors[i].set(0, 0, 0, 0);
    }
  }

  /** Strongest bend any pusher gives a blade at (x, z): 0 means it is at rest. */
  strengthAt(x, z) {
    let best = 0;
    for (const p of this.pushers()) best = Math.max(best, p.strength * influence(Math.hypot(x - p.x, z - p.z), p.radius));
    return best;
  }
}
