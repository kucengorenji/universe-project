import { HALF, SIZE, COVER, heightAt, lineDist, walk } from '../battlefield/generateField.js';

// The battlefield as the rules see it (no three.js): what blocks movement, sight and bullets,
// a 1 m navigation grid for the AI, line of sight, and bullet raycasts against the scenery
// and the units' hitboxes. Built once from generateField() output.
//
// Blockers are vertical cylinders { kind: 'cyl', x, z, r, y0, y1 } or yawed boxes
// { kind: 'box', x, z, yaw, hx, hz, y0, y1 } (y relative to the ground under the centre),
// flagged move / sight / bullet.

const HOUSE_H = { f_house_small: 6, f_house: 7, f_house_tall: 10, f_townhouse: 9, f_shop: 7, f_tavern: 8 };
const CELL = 8; // spatial hash cell (m)
export const GRID = 1; // navigation cell (m)
export const GN = SIZE / GRID; // cells per side
export const FREE = 0, BLOCKED = 1, WATER = 2;

/** Hitbox heights of an infantry soldier by stance: [body top, head centre]. */
const STANCE = { stand: [1.45, 1.62], crouch: [1.0, 1.18], down: [0.35, -1] };

export class Arena {
  constructor(field) {
    this.field = field;
    this.blockers = [];
    this.hash = new Map();
    const add = (b, flags) => {
      Object.assign(b, { move: true, sight: true, bullet: true }, flags);
      b.ground = flags.groundY ?? heightAt(field, b.x, b.z);
      b.reach = b.kind === 'cyl' ? b.r : Math.hypot(b.hx, b.hz);
      this.blockers.push(b);
    };
    const box = (x, z, yaw, hx, hz, h, flags = {}) => add({ kind: 'box', x, z, yaw, hx, hz, y0: -0.3, y1: h }, flags);
    const cyl = (x, z, r, h, flags = {}) => add({ kind: 'cyl', x, z, r, y0: -0.3, y1: h }, flags);

    for (const h of field.houses) if (!h.ruined) box(h.x, h.z, h.yaw, h.w / 2, h.d / 2, HOUSE_H[h.kind] || 7, { tag: 'house' });
    for (const c of field.cover) {
      const C = COVER[c.type];
      const s = Math.sin(c.yaw), k = Math.cos(c.yaw);
      // local (u, v) -> world: x = cx + u cos + v sin, z = cz - u sin + v cos
      const at = (u, v) => [c.x + u * k + v * s, c.z - u * s + v * k];
      switch (c.type) {
        case 'sandbag_wall': box(c.x, c.z, c.yaw, C.hx, 0.32, 0.9, { tag: 'low' }); break;
        case 'sandbag_arc': {
          // the quarter ring bulges toward -z locally (see military_kit.py): three straight runs
          box(...at(0, 0), c.yaw, 0.7, 0.3, 0.9, { tag: 'low' });
          box(...at(1.05, 0.38), c.yaw - 0.6, 0.6, 0.3, 0.9, { tag: 'low' });
          box(...at(-1.05, 0.38), c.yaw + 0.6, 0.6, 0.3, 0.9, { tag: 'low' });
          break;
        }
        case 'barricade': box(c.x, c.z, c.yaw, C.hx, 0.3, 1.15, { tag: 'low' }); break;
        case 'hedgehog': cyl(c.x, c.z, 0.7, 1.3, { sight: false, bullet: false }); break;
        case 'wire': box(c.x, c.z, c.yaw, C.hx, 0.25, 1, { sight: false, bullet: false }); break;
        case 'crate': box(c.x, c.z, c.yaw, 0.5, 0.28, 0.5, { tag: 'low' }); break;
        case 'drum': cyl(c.x, c.z, 0.3, 0.9, { tag: 'low' }); break;
        case 'ruin_wall': box(c.x, c.z, c.yaw, 2, 0.18, 2.3, { tag: 'high' }); break;
        case 'tent': box(c.x, c.z, c.yaw, 1.25, 1.5, 1.9, { tag: 'high' }); break;
      }
    }
    for (const t of field.trees) cyl(t.x, t.z, 0.35 * (t.s || 1), 4, { tag: 'tree' });
    for (const h of field.hedges) for (const s of walk(h.pts, 1.3)) cyl(s.x, s.z, 0.7, 1.5, { tag: 'hedge' });
    if (field.windmill) cyl(field.windmill.x, field.windmill.z, 2.6, 9, { tag: 'house' });
    if (field.watchtower) cyl(field.watchtower.x, field.watchtower.z, 1.5, 1, { sight: false, bullet: false });
    // bridge decks: the same height fieldBuilder lays them at
    this.decks = field.bridges.map((b) => {
      const ex = Math.sin(b.yaw) * (b.length / 2), ez = Math.cos(b.yaw) * (b.length / 2);
      return Math.max(heightAt(field, b.x + ex, b.z + ez), heightAt(field, b.x - ex, b.z - ez), 0.1) + 0.05;
    });
    for (const [k, b] of field.bridges.entries()) {
      for (const side of [-1, 1]) {
        const ox = Math.cos(b.yaw) * side * (b.width / 2 - 0.2), oz = -Math.sin(b.yaw) * side * (b.width / 2 - 0.2);
        box(b.x + ox, b.z + oz, b.yaw, 0.25, b.length / 2 + 2, 0.9, { tag: 'low', groundY: this.decks[k] });
      }
    }
    for (const b of this.blockers) {
      for (const key of this.cellsAround(b.x, b.z, b.reach)) {
        if (!this.hash.has(key)) this.hash.set(key, []);
        this.hash.get(key).push(b);
      }
    }
    this.buildGrid();
  }

  *cellsAround(x, z, r) {
    for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++)
      for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) yield i * 4096 + j;
  }

  near(x, z, r) {
    const out = new Set();
    for (const key of this.cellsAround(x, z, r)) for (const b of this.hash.get(key) || []) out.add(b);
    return out;
  }

  /** Ground height, or the deck where a bridge spans the river. */
  ground(x, z) {
    const h = heightAt(this.field, x, z);
    const k = this.bridgeAt(x, z);
    return k < 0 ? h : Math.max(h, this.decks[k]);
  }

  /** Index of the bridge whose deck covers (x, z), or -1. */
  bridgeAt(x, z, pad = 0) {
    return this.field.bridges.findIndex((b) => {
      const dx = x - b.x, dz = z - b.z;
      const u = dx * Math.cos(b.yaw) - dz * Math.sin(b.yaw), v = dx * Math.sin(b.yaw) + dz * Math.cos(b.yaw);
      return Math.abs(u) < b.width / 2 - 0.3 + pad && Math.abs(v) < b.length / 2 + 2;
    });
  }

  onBridge(x, z) {
    return this.bridgeAt(x, z) >= 0;
  }

  inWater(x, z) {
    const r = this.field.river;
    return !!r && lineDist(x, z, r.pts) < r.width / 2 + 0.6 && !this.onBridge(x, z);
  }

  // ---------------------------------------------------------------- navigation grid
  buildGrid() {
    const g = new Uint8Array(GN * GN);
    for (let j = 0; j < GN; j++) {
      for (let i = 0; i < GN; i++) {
        const [x, z] = this.cellCentre(i, j);
        if (this.inWater(x, z)) g[j * GN + i] = WATER;
        else if (i === 0 || j === 0 || i === GN - 1 || j === GN - 1 || this.blockedAt(x, z, 0.45)) g[j * GN + i] = BLOCKED;
      }
    }
    this.grid = g;
  }

  cellCentre(i, j) {
    return [-HALF + (i + 0.5) * GRID, -HALF + (j + 0.5) * GRID];
  }

  cellOf(x, z) {
    const i = Math.max(0, Math.min(GN - 1, Math.floor((x + HALF) / GRID)));
    const j = Math.max(0, Math.min(GN - 1, Math.floor((z + HALF) / GRID)));
    return [i, j];
  }

  walkable(x, z) {
    const [i, j] = this.cellOf(x, z);
    return this.grid[j * GN + i] === FREE;
  }

  /** Is a circle of radius r at (x, z) overlapping a movement blocker? */
  blockedAt(x, z, r) {
    for (const b of this.near(x, z, r + 0.1)) if (b.move && overlap(b, x, z, r)) return true;
    return false;
  }

  /**
   * Move a circle from (x, z) by (dx, dz): pushed out of blockers, never into water or off the map.
   * others: [{ x, z, r }] other units to keep apart from. Returns [x, z].
   */
  slide(x, z, dx, dz, r, others = []) {
    let nx = x + dx, nz = z + dz;
    for (let pass = 0; pass < 3; pass++) {
      for (const b of this.near(nx, nz, r + 0.1)) if (b.move) [nx, nz] = pushOut(b, nx, nz, r);
      for (const o of others) {
        const ddx = nx - o.x, ddz = nz - o.z, d = Math.hypot(ddx, ddz), min = r + o.r;
        if (d < min && d > 1e-6) {
          nx = o.x + (ddx / d) * min;
          nz = o.z + (ddz / d) * min;
        }
      }
    }
    if (this.inWater(nx, nz) || Math.abs(nx) > HALF - 1 || Math.abs(nz) > HALF - 1) return [x, z];
    return [nx, nz];
  }

  // ---------------------------------------------------------------- sight and bullets
  /** Unobstructed sight from a to b ({x, y, z}, world y), through scenery and terrain (units ignored). */
  los(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const L = Math.hypot(dx, dy, dz);
    if (L < 0.01) return true;
    const hit = this.castScenery(a, { x: dx / L, y: dy / L, z: dz / L }, L - 0.3, 'sight');
    return !hit;
  }

  /** Nearest scenery hit along a ray: { t, blocker } or { t, terrain: true } or null. flag: 'sight' | 'bullet'. */
  castScenery(o, d, maxT, flag = 'bullet') {
    let best = null;
    const seen = new Set();
    const step = CELL * 0.5;
    for (let t = 0; t <= maxT + step; t += step) {
      const px = o.x + d.x * Math.min(t, maxT), pz = o.z + d.z * Math.min(t, maxT);
      for (const b of this.near(px, pz, 1)) {
        if (seen.has(b) || !b[flag]) continue;
        seen.add(b);
        const hit = rayBlocker(o, d, b);
        if (hit !== null && hit >= 0 && hit <= maxT && (!best || hit < best.t)) best = { t: hit, blocker: b };
      }
      if (best && best.t < t - step) break;
    }
    // terrain: march, refine the first crossing
    const lim = best ? best.t : maxT;
    for (let t = 0.6; t <= lim; t += 0.6) {
      const y = o.y + d.y * t;
      if (y < this.ground(o.x + d.x * t, o.z + d.z * t) - 0.05) {
        let lo = t - 0.6, hi = t;
        for (let k = 0; k < 6; k++) {
          const m = (lo + hi) / 2;
          if (o.y + d.y * m < this.ground(o.x + d.x * m, o.z + d.z * m) - 0.05) hi = m;
          else lo = m;
        }
        return { t: hi, terrain: true };
      }
    }
    return best;
  }

  /**
   * A bullet: nearest of scenery and unit hitboxes. units: battle units with x, z, yaw, kind,
   * stance; skip: the shooter. Returns { t, point, unit?, part?, blocker?, terrain? } or null.
   */
  bullet(o, d, maxT, units, skip = null) {
    let best = this.castScenery(o, d, maxT, 'bullet');
    for (const u of units) {
      if (u === skip || u.state === 'dead' || u.state === 'evac') continue;
      const hit = rayUnit(o, d, u, this.ground(u.x, u.z));
      if (hit && hit.t <= maxT && (!best || hit.t < best.t)) best = { t: hit.t, unit: u, part: hit.part };
    }
    if (best) best.point = { x: o.x + d.x * best.t, y: o.y + d.y * best.t, z: o.z + d.z * best.t };
    return best;
  }

  /** Points a shooter looks from and at: eye of an infantry unit by stance, the gun of a vehicle. */
  eye(u) {
    const g = this.ground(u.x, u.z);
    if (u.kind === 'tank') return { x: u.x, y: g + 2.3, z: u.z };
    if (u.kind === 'bunker') return { x: u.x, y: g + 1.15, z: u.z };
    return { x: u.x, y: g + (u.stance === 'crouch' ? 1.12 : 1.55), z: u.z };
  }

  /** Where to aim at a unit: chest of infantry, centre of vehicles. */
  aimPoint(u) {
    const g = this.ground(u.x, u.z);
    if (u.kind === 'tank') return { x: u.x, y: g + 1.4, z: u.z };
    if (u.kind === 'bunker') return { x: u.x, y: g + 1.1, z: u.z };
    const [top] = STANCE[u.state === 'down' ? 'down' : u.stance] || STANCE.stand;
    return { x: u.x, y: g + top * 0.75, z: u.z };
  }

  /** Can a see b (eye to aim point, and to the head, so a peeking head counts)? */
  sees(a, b) {
    const e = this.eye(a);
    if (this.los(e, this.aimPoint(b))) return true;
    if (b.kind === 'infantry' && b.state !== 'down') {
      const g = this.ground(b.x, b.z);
      return this.los(e, { x: b.x, y: g + (STANCE[b.stance] || STANCE.stand)[1], z: b.z });
    }
    return false;
  }
}

// ---------------------------------------------------------------- geometry
function toLocal(b, x, z) {
  const dx = x - b.x, dz = z - b.z;
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  return [dx * c - dz * s, dx * s + dz * c];
}

function overlap(b, x, z, r) {
  if (b.kind === 'cyl') return Math.hypot(x - b.x, z - b.z) < b.r + r;
  const [u, v] = toLocal(b, x, z);
  const cu = Math.max(-b.hx, Math.min(b.hx, u)), cv = Math.max(-b.hz, Math.min(b.hz, v));
  return Math.hypot(u - cu, v - cv) < r;
}

function pushOut(b, x, z, r) {
  if (b.kind === 'cyl') {
    const dx = x - b.x, dz = z - b.z, d = Math.hypot(dx, dz), min = b.r + r;
    if (d >= min) return [x, z];
    if (d < 1e-6) return [b.x + min, z];
    return [b.x + (dx / d) * min, b.z + (dz / d) * min];
  }
  const [u, v] = toLocal(b, x, z);
  let cu = Math.max(-b.hx, Math.min(b.hx, u)), cv = Math.max(-b.hz, Math.min(b.hz, v));
  let du = u - cu, dv = v - cv, d = Math.hypot(du, dv);
  let nu, nv;
  if (d >= r) return [x, z];
  if (d < 1e-6) {
    // centre inside: leave by the nearest face
    const ex = b.hx - Math.abs(u), ez = b.hz - Math.abs(v);
    if (ex < ez) [nu, nv] = [Math.sign(u || 1) * (b.hx + r), v];
    else [nu, nv] = [u, Math.sign(v || 1) * (b.hz + r)];
  } else [nu, nv] = [cu + (du / d) * r, cv + (dv / d) * r];
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  return [b.x + nu * c + nv * s, b.z - nu * s + nv * c];
}

/** Ray (origin o, unit dir d) against a vertical cylinder [y0, y1] above ground g: entry t or null. */
function rayCyl(o, d, x, z, r, y0, y1) {
  const ox = o.x - x, oz = o.z - z;
  const a = d.x * d.x + d.z * d.z;
  let tin = -Infinity, tout = Infinity;
  if (a > 1e-9) {
    const b = ox * d.x + oz * d.z, c = ox * ox + oz * oz - r * r;
    const disc = b * b - a * c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    tin = (-b - sq) / a;
    tout = (-b + sq) / a;
  } else if (ox * ox + oz * oz > r * r) return null;
  // height slab
  if (Math.abs(d.y) > 1e-9) {
    const t0 = (y0 - o.y) / d.y, t1 = (y1 - o.y) / d.y;
    tin = Math.max(tin, Math.min(t0, t1));
    tout = Math.min(tout, Math.max(t0, t1));
  } else if (o.y < y0 || o.y > y1) return null;
  if (tin > tout || tout < 0) return null;
  return Math.max(0, tin);
}

/** Ray against a yawed box: entry t or null. */
function rayBox(o, d, x, z, yaw, hx, hz, y0, y1) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const ou = (o.x - x) * c - (o.z - z) * s, ov = (o.x - x) * s + (o.z - z) * c;
  const du = d.x * c - d.z * s, dv = d.x * s + d.z * c;
  let tin = -Infinity, tout = Infinity;
  for (const [p, q, lo, hi] of [[ou, du, -hx, hx], [ov, dv, -hz, hz], [o.y, d.y, y0, y1]]) {
    if (Math.abs(q) < 1e-9) {
      if (p < lo || p > hi) return null;
      continue;
    }
    const t0 = (lo - p) / q, t1 = (hi - p) / q;
    tin = Math.max(tin, Math.min(t0, t1));
    tout = Math.min(tout, Math.max(t0, t1));
  }
  if (tin > tout || tout < 0) return null;
  return Math.max(0, tin);
}

function rayBlocker(o, d, b) {
  const g = b.ground;
  return b.kind === 'cyl' ? rayCyl(o, d, b.x, b.z, b.r, g + b.y0, g + b.y1) : rayBox(o, d, b.x, b.z, b.yaw, b.hx, b.hz, g + b.y0, g + b.y1);
}

/** Ray against a unit's hitbox: { t, part: 'head' | 'body' | 'weak' | 'armor' } or null. */
export function rayUnit(o, d, u, g) {
  if (u.kind === 'tank') {
    const t = rayBox(o, d, u.x, u.z, u.yaw, 1.8, 3.7, g, g + 2.5);
    if (t === null) return null;
    // the radiator: the back of the engine deck (the tank's front is local +z)
    const px = o.x + d.x * t - u.x, pz = o.z + d.z * t - u.z, py = o.y + d.y * t - g;
    const back = -(px * Math.sin(u.yaw) + pz * Math.cos(u.yaw));
    return { t, part: back > 2.9 && py > 0.9 ? 'weak' : 'armor' };
  }
  if (u.kind === 'bunker') {
    const t = rayCyl(o, d, u.x, u.z, 2.3, g, g + 2.1);
    return t === null ? null : { t, part: 'armor' };
  }
  const [top, head] = STANCE[u.state === 'down' ? 'down' : u.stance] || STANCE.stand;
  let best = null;
  if (head > 0) {
    // the head: a sphere of radius 0.14
    const cx = u.x, cy = g + head, cz = u.z;
    const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
    const b = ox * d.x + oy * d.y + oz * d.z, c = ox * ox + oy * oy + oz * oz - 0.14 * 0.14;
    const disc = b * b - c;
    if (disc >= 0) {
      const t = -b - Math.sqrt(disc);
      if (t >= 0) best = { t, part: 'head' };
    }
  }
  const tb = rayCyl(o, d, u.x, u.z, u.state === 'down' ? 0.5 : 0.27, g, g + top);
  if (tb !== null && (!best || tb < best.t)) best = { t: tb, part: 'body' };
  return best;
}
