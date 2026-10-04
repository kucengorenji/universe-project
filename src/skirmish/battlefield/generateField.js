import { mulberry32 } from '../../math/random.js';
import { createNoise3D } from '../../math/simplex3d.js';

// Skirmish battlefield generator: a 1930s European countryside skirmish map from a seed.
// Pure data (no three.js), so it runs in node --test, in the flat prep map and in the 3D builder.
//
// Frame: metres, x east, z south, y up; the map is SIZE x SIZE centred on the origin. The
// player's base camp is near the south edge, the enemy's near the north edge; the main road
// joins them through a village, which holds the neutral camp. A river may cross between them
// (bridged where roads meet it). The enemy dug in: a trench line, wire, a bunker or two and a tank.

export const SIZE = 200;
export const HALF = SIZE / 2;
export const RES = 2; // metres per height sample
export const WATER_Y = -1.15;

export const DEFAULTS = { size: 'normal', cover: 1, time: 'day', weather: 'clear', river: 'auto' };

/** Footprints of the village houses from town.glb (width along the street, depth). */
export const HOUSES = {
  f_house_small: { w: 6.5, d: 6, variants: 3 },
  f_house: { w: 8, d: 7, variants: 3 },
  f_house_tall: { w: 7.5, d: 7, variants: 2 },
  f_townhouse: { w: 6.5, d: 7, variants: 2 },
  f_shop: { w: 8.5, d: 7.5, variants: 2 },
  f_tavern: { w: 12, d: 9, variants: 0 }
};

/** Cover kinds: footprint (half extents along/across, m), height class (low = crouch cover, high = full). */
export const COVER = {
  sandbag_wall: { hx: 1.2, hz: 0.35, height: 'low', asset: 'p_sandbag_wall' },
  sandbag_arc: { hx: 1.4, hz: 0.9, height: 'low', asset: 'p_sandbag_arc' },
  barricade: { hx: 1.25, hz: 0.5, height: 'low', asset: 'p_barricade' },
  hedgehog: { hx: 0.8, hz: 0.8, height: 'none', asset: 'p_hedgehog' },
  wire: { hx: 1.4, hz: 0.15, height: 'none', asset: 'p_wire' },
  crate: { hx: 0.5, hz: 0.3, height: 'low', asset: 'p_crate' },
  drum: { hx: 0.3, hz: 0.3, height: 'low', asset: 'p_drum' },
  ruin_wall: { hx: 2.0, hz: 0.4, height: 'high', asset: 'p_ruin_wall' },
  tent: { hx: 1.3, hz: 1.6, height: 'high', asset: 'p_tent' }
};

// ---------------------------------------------------------------- geometry helpers
const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Distance from (x, z) to segment a-b, and the parameter of the nearest point. */
export function segDist(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L = dx * dx + dz * dz || 1;
  const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / L, 0, 1);
  return [Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t), t];
}

/** Distance from a point to a polyline. */
export function lineDist(x, z, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, segDist(x, z, pts[i - 1], pts[i])[0]);
  return best;
}

function chaikin(pts, rounds = 2) {
  let p = pts;
  for (let r = 0; r < rounds; r++) {
    const out = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [a, b] = [p[i], p[i + 1]];
      out.push([lerp(a[0], b[0], 0.25), lerp(a[1], b[1], 0.25)], [lerp(a[0], b[0], 0.75), lerp(a[1], b[1], 0.75)]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

/** Points every `step` metres along a polyline, with the unit tangent. */
export function walk(pts, step) {
  const out = [];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) continue;
    const tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L;
    for (let s = carry; s < L; s += step) out.push({ x: a[0] + tx * s, z: a[1] + tz * s, tx, tz });
    carry = (carry - L) % step;
    if (carry < 0) carry += step;
  }
  return out;
}

/** Segment intersection point of polylines a and b (first found), or null. */
function crossing(a, b) {
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      const [p, p2, q, q2] = [a[i - 1], a[i], b[j - 1], b[j]];
      const r = [p2[0] - p[0], p2[1] - p[1]], s = [q2[0] - q[0], q2[1] - q[1]];
      const den = r[0] * s[1] - r[1] * s[0];
      if (Math.abs(den) < 1e-9) continue;
      const t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / den;
      const u = ((q[0] - p[0]) * r[1] - (q[1] - p[1]) * r[0]) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
        const len = Math.hypot(r[0], r[1]);
        return { x: p[0] + r[0] * t, z: p[1] + r[1] * t, tx: r[0] / len, tz: r[1] / len };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------- generator
/**
 * @param {number} seed
 * @param {object} params  see DEFAULTS: cover 0.5..1.5 (density), time, weather, river ('auto' | 'yes' | 'no')
 */
export function generateField(seed, params = {}) {
  const P = { ...DEFAULTS, ...params };
  const rng = mulberry32(seed >>> 0 || 1);
  const R = (a = 0, b = 1) => a + (b - a) * rng();
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const noise = createNoise3D(seed);
  const field = { seed, params: P, size: SIZE, res: RES, waterY: WATER_Y };

  // --- camps and the village
  const player = { x: R(-35, 35), z: HALF - 18 };
  const enemy = { x: R(-35, 35), z: -HALF + 18 };
  const village = { x: R(-22, 22), z: R(-12, 12), r: R(34, 44) };
  field.camps = [
    { id: 'player', side: 'fed', x: player.x, z: player.z, r: 9 },
    { id: 'enemy', side: 'imp', x: enemy.x, z: enemy.z, r: 9 },
    { id: 'village', side: null, x: village.x + R(-4, 4), z: village.z + R(-4, 4), r: 7 }
  ];

  // --- roads: the main road wanders camp -> village -> camp; a cross road leaves the village east or west
  const wobble = (a, b, n, amp) => {
    const pts = [[a.x, a.z]];
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const nx = -(b.z - a.z), nz = b.x - a.x;
      const L = Math.hypot(nx, nz) || 1;
      const off = (rng() - 0.5) * 2 * amp;
      pts.push([lerp(a.x, b.x, t) + (nx / L) * off, lerp(a.z, b.z, t) + (nz / L) * off]);
    }
    pts.push([b.x, b.z]);
    return pts;
  };
  const main = chaikin([...wobble({ x: player.x, z: HALF + 6 }, village, 3, 8), ...wobble(village, { x: enemy.x, z: -HALF - 6 }, 3, 8).slice(1)], 3);
  const east = rng() < 0.5 ? 1 : -1;
  const cross = chaikin(wobble(village, { x: east * (HALF + 6), z: village.z + R(-30, 30) }, 3, 10), 3);
  const lane = chaikin(wobble({ x: village.x + R(-8, 8), z: village.z + R(-6, 6) }, { x: -east * (HALF * 0.65), z: village.z + R(15, 40) }, 2, 6), 2);
  field.roads = [
    { id: 'main', width: 6, pts: main },
    { id: 'cross', width: 5, pts: cross },
    { id: 'lane', width: 3.5, pts: lane }
  ];
  const roadDist = (x, z) => Math.min(...field.roads.map((r) => lineDist(x, z, r.pts) - r.width / 2));

  // --- river: across the map between the village and one of the camps
  const wantRiver = P.river === 'yes' || (P.river === 'auto' && rng() < 0.6);
  field.river = null;
  field.bridges = [];
  if (wantRiver) {
    const side = rng() < 0.5 ? 1 : -1; // between the village and the player (1) or the enemy (-1)
    const z0 = village.z + side * R(26, 34);
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const x = -HALF - 10 + (SIZE + 20) * (i / 8);
      pts.push([x, z0 + noise.noise(x * 0.012, 7.3, seed * 0.001) * 18]);
    }
    field.river = { width: 9, pts: chaikin(pts, 3) };
    for (const road of field.roads) {
      const c = crossing(road.pts, field.river.pts);
      if (c) field.bridges.push({ x: c.x, z: c.z, yaw: Math.atan2(c.tx, c.tz), length: 14, width: road.width + 1 });
    }
  }
  const riverDist = (x, z) => (field.river ? lineDist(x, z, field.river.pts) - field.river.width / 2 : Infinity);

  // --- enemy line: a zig-zag trench across the approach, in front of the enemy camp
  const tz = enemy.z + R(26, 34);
  const trench = [];
  for (let x = -40; x <= 40; x += 8) trench.push([enemy.x * 0.4 + x, tz + ((x / 8) % 2 ? 2.5 : -2.5) + R(-1, 1)]);
  // corners cut once, so the plank walls and banks turn without folding over
  field.trenches = [{ width: 1.8, depth: 1.5, pts: chaikin(trench, 1) }];
  const trenchDist = (x, z) => Math.min(...field.trenches.map((t) => lineDist(x, z, t.pts) - t.width / 2));

  // --- terrain heights
  const n = SIZE / RES + 1;
  const heights = new Float32Array(n * n);
  const hill = { x: -east * R(45, 70), z: village.z + R(-25, 25) };
  const villageY = 0.6;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -HALF + i * RES, z = -HALF + j * RES;
      let h = noise.fbm(x / 90, z / 90, 0.5, 4) * 3.2 + noise.noise(x / 25, z / 25, 3.1) * 0.5;
      h += 3.5 * Math.exp(-((x - hill.x) ** 2 + (z - hill.z) ** 2) / (2 * 22 * 22));
      // the village and the camps sit on level ground
      const dv = Math.hypot(x - village.x, z - village.z);
      h = lerp(villageY, h, smooth(village.r * 0.7, village.r + 12, dv));
      for (const c of field.camps) h = lerp(villageY * 0.5 + h * 0.5, h, smooth(c.r + 4, c.r + 18, Math.hypot(x - c.x, z - c.z)));
      // roads ease the slopes
      const dr = roadDist(x, z);
      if (dr < 6) h = lerp(h * 0.85, h, smooth(0, 6, dr));
      // the river runs in a valley with a level water line
      const dw = riverDist(x, z);
      if (dw < 22) h = lerp(lerp(WATER_Y - 1.4, 0.1, smooth(-field.river.width / 2, 2, dw)), h, smooth(4, 22, dw));
      // trenches are cut in
      const dt = trenchDist(x, z);
      if (dt < 1.5) h -= field.trenches[0].depth * (1 - smooth(-0.2, 1.5, dt));
      heights[j * n + i] = h;
    }
  }
  field.heights = heights;
  field.n = n;
  field.heightAt = (x, z) => heightAt(field, x, z);

  // --- village houses along the roads
  const houses = [];
  const occupied = (x, z, r) =>
    houses.some((h) => Math.hypot(h.x - x, h.z - z) < r + Math.max(h.w, h.d) * 0.55) ||
    field.camps.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + r) ||
    riverDist(x, z) < r + 4 ||
    Math.abs(x) > HALF - r - 2 ||
    Math.abs(z) > HALF - r - 2;
  // buildings, trees and fields also keep clear of the trench line
  const blocked = (x, z, r) => occupied(x, z, r) || trenchDist(x, z) < r + 6;
  const kinds = Object.keys(HOUSES);
  for (const road of field.roads) {
    for (const s of walk(road.pts, 3)) {
      const dv = Math.hypot(s.x - village.x, s.z - village.z);
      if (dv > village.r * (road.id === 'lane' ? 0.8 : 1)) continue;
      for (const side of [1, -1]) {
        if (rng() < 0.45) continue;
        const kind = rng() < 0.08 && dv < village.r * 0.5 ? 'f_tavern' : pick(kinds.filter((k) => k !== 'f_tavern'));
        const H = HOUSES[kind];
        const setback = road.width / 2 + 1.6 + H.d / 2 + R(0, 1.5);
        const x = s.x - s.tz * side * setback, z = s.z + s.tx * side * setback;
        const r = Math.max(H.w, H.d) * 0.55;
        if (blocked(x, z, r) || roadDist(x, z) < H.d / 2 + 0.8) continue;
        // the front (+z of the asset) faces the road
        const yaw = Math.atan2(s.x - x, s.z - z);
        const ruined = rng() < 0.18;
        houses.push({ kind, variant: H.variants ? Math.floor(rng() * H.variants) : -1, x, z, yaw, w: H.w, d: H.d, ruined });
      }
    }
  }
  field.houses = houses;
  // each house stands on a level pad: the ground under it is levelled to its corners' mean
  for (const h of houses) {
    const c = Math.cos(h.yaw), sn = Math.sin(h.yaw);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => heightAt(field, h.x + (u * h.w) / 2 * c + (v * h.d) / 2 * sn, h.z - (u * h.w) / 2 * sn + (v * h.d) / 2 * c));
    const target = corners.reduce((a, b) => a + b, 0) / 4;
    const R0 = Math.max(h.w, h.d) / 2 + 1, R1 = R0 + 3;
    const [i0, i1] = [Math.max(0, Math.floor((h.x - R1 + HALF) / RES)), Math.min(n - 1, Math.ceil((h.x + R1 + HALF) / RES))];
    const [j0, j1] = [Math.max(0, Math.floor((h.z - R1 + HALF) / RES)), Math.min(n - 1, Math.ceil((h.z + R1 + HALF) / RES))];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = -HALF + i * RES, z = -HALF + j * RES;
        // distance in the house's own frame (a rounded rectangle)
        const u = Math.abs((x - h.x) * c - (z - h.z) * sn) - h.w / 2, v = Math.abs((x - h.x) * sn + (z - h.z) * c) - h.d / 2;
        const d = Math.hypot(Math.max(u, 0), Math.max(v, 0));
        const k = 1 - smooth(1, 4, d);
        if (k > 0) heights[j * n + i] = lerp(heights[j * n + i], target, k);
      }
    }
  }

  // --- landmark: a windmill on the hill
  field.windmill = null;
  for (let tries = 0; tries < 30 && !field.windmill; tries++) {
    const x = hill.x + R(-15, 15), z = hill.z + R(-15, 15);
    if (!blocked(x, z, 6) && roadDist(x, z) > 8 && Math.abs(x) < HALF - 12) field.windmill = { x, z, yaw: R(0, TAU) };
  }

  // --- fields with hedgerows, in the countryside
  const fields = [];
  const hedges = [];
  const CELL = 34;
  for (let gz = -HALF; gz < HALF; gz += CELL) {
    for (let gx = -HALF; gx < HALF; gx += CELL) {
      const cx = gx + CELL / 2 + R(-4, 4), cz = gz + CELL / 2 + R(-4, 4);
      // fields keep their whole extent (not just the centre) off the village and the camps
      if (Math.hypot(cx - village.x, cz - village.z) < village.r + CELL * 0.4) continue;
      if (field.camps.some((c) => Math.hypot(c.x - cx, c.z - cz) < c.r + 12 + CELL * 0.45)) continue;
      const w = CELL * R(0.7, 0.92), d = CELL * R(0.7, 0.92);
      const yaw = R(-0.25, 0.25);
      const kind = rng() < 0.38 ? 'wheat' : rng() < 0.6 ? 'meadow' : 'plough';
      const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([u, v]) => [
        cx + u * Math.cos(yaw) + v * Math.sin(yaw),
        cz - u * Math.sin(yaw) + v * Math.cos(yaw)
      ]);
      fields.push({ kind, x: cx, z: cz, w, d, yaw, poly: corners });
      // hedges along some sides, broken where roads, rivers and trenches pass
      for (let e = 0; e < 4; e++) {
        if (rng() > 0.4) continue;
        const [a, b] = [corners[e], corners[(e + 1) % 4]];
        let run = [];
        for (let t = 0; t <= 1.0001; t += 1 / 12) {
          const x = lerp(a[0], b[0], t), z = lerp(a[1], b[1], t);
          const ok = roadDist(x, z) > 2.5 && riverDist(x, z) > 2 && trenchDist(x, z) > 4 && !blocked(x, z, 0.5);
          if (ok) run.push([x, z]);
          if ((!ok || t > 0.999) && run.length > 1) {
            hedges.push({ pts: run });
            run = [];
          } else if (!ok) run = [];
        }
      }
    }
  }
  field.fields = fields;
  field.hedges = hedges;

  // --- tall grass: wheat fields plus loose patches of rough grass
  field.grass = fields.filter((f) => f.kind === 'wheat').map((f) => ({ kind: 'wheat', poly: f.poly }));
  for (let i = 0; i < 10; i++) {
    const x = R(-HALF + 10, HALF - 10), z = R(-HALF + 30, HALF - 30);
    if (blocked(x, z, 5) || roadDist(x, z) < 3) continue;
    const r = R(4, 9);
    const poly = Array.from({ length: 9 }, (_, k) => {
      const a = (k / 9) * TAU;
      const rr = r * R(0.7, 1.15);
      return [x + Math.cos(a) * rr, z + Math.sin(a) * rr];
    });
    field.grass.push({ kind: 'rough', poly });
  }

  // --- trees: a wood on one flank, trees along hedges, gardens in the village
  const trees = [];
  const treeOk = (x, z, r = 2.5) => !blocked(x, z, r) && roadDist(x, z) > r && trenchDist(x, z) > 5 && !trees.some((t) => Math.hypot(t.x - x, t.z - z) < r * 1.4);
  const wood = { x: east * R(60, 82), z: R(-50, 50) };
  for (let i = 0; i < 70; i++) {
    const a = R(0, TAU), rr = Math.sqrt(rng()) * 30;
    const x = wood.x + Math.cos(a) * rr * 0.7, z = wood.z + Math.sin(a) * rr;
    if (treeOk(x, z)) trees.push({ kind: rng() < 0.6 ? 't_pine' : 't_spruce', x, z, s: R(0.85, 1.25), yaw: R(0, TAU) });
  }
  for (const h of hedges) {
    for (const s of walk(h.pts, 9)) {
      if (rng() < 0.35 && treeOk(s.x, s.z)) trees.push({ kind: pick(['t_oak', 't_oak', 't_birch']), x: s.x, z: s.z, s: R(0.8, 1.2), yaw: R(0, TAU) });
    }
  }
  for (const hs of houses) {
    if (rng() < 0.5) {
      const x = hs.x - Math.sin(hs.yaw) * (hs.d / 2 + 4), z = hs.z - Math.cos(hs.yaw) * (hs.d / 2 + 4);
      if (treeOk(x, z, 2)) trees.push({ kind: pick(['t_oak', 't_birch', 't_oak']), x, z, s: R(0.7, 1), yaw: R(0, TAU) });
    }
  }
  field.trees = trees;

  // --- cover and fortifications
  const cover = [];
  const coverOk = (x, z, r) =>
    !occupied(x, z, r) && !trees.some((t) => Math.hypot(t.x - x, t.z - z) < r + 1.5) && !cover.some((c) => Math.hypot(c.x - x, c.z - z) < r + 2.5) && trenchDist(x, z) > 1.5;
  const put = (type, x, z, yaw, side = null) => {
    const C = COVER[type];
    if (!coverOk(x, z, Math.max(C.hx, C.hz))) return false;
    cover.push({ type, x, z, yaw, side });
    return true;
  };
  // camps: tents, crates and a ring of sandbags round the flag
  for (const c of field.camps) {
    const side = c.side;
    const facing = c.id === 'enemy' ? 0 : c.id === 'player' ? Math.PI : R(0, TAU); // yaw 0: front (+z) faces south
    if (c.id !== 'village') {
      for (let k = 0; k < 3; k++) {
        const a = facing + Math.PI + (k - 1) * 0.7;
        put('tent', c.x + Math.sin(a) * 13, c.z + Math.cos(a) * 13, a + Math.PI, side);
      }
    }
    for (let k = 0; k < 5; k++) {
      const a = R(0, TAU);
      put(rng() < 0.6 ? 'crate' : 'drum', c.x + Math.sin(a) * R(6, 10), c.z + Math.cos(a) * R(6, 10), R(0, TAU), side);
    }
    for (let k = -1; k <= 1; k++) {
      const a = facing + k * 0.9;
      put('sandbag_arc', c.x + Math.sin(a) * 6, c.z + Math.cos(a) * 6, a, side);
    }
  }
  // the enemy line: wire in front of the trench, bunkers astride it, hedgehogs on the road
  for (const s of walk(trench, 3.2)) if (rng() < 0.7) put('wire', s.x + R(-1, 1), s.z + 7 + R(-1, 1), Math.atan2(-s.tz, s.tx), 'imp'); // along the trench
  const bunkers = [];
  for (const t of [0.25, 0.75].slice(0, P.cover >= 0.9 ? 2 : 1)) {
    const k = Math.round(t * (trench.length - 1));
    const [bx, bz] = [trench[k][0] + R(-3, 3), trench[k][1] - 7];
    if (!occupied(bx, bz, 3.5) && roadDist(bx, bz) > 4) bunkers.push({ x: bx, z: bz, yaw: R(-0.2, 0.2) });
  }
  field.bunkers = bunkers;
  const mainCross = crossing(main, trench) || { x: enemy.x, z: tz, tx: 0, tz: 1 };
  for (const dx of [-5, 5]) put('hedgehog', mainCross.x + dx, mainCross.z + 9, R(0, TAU), 'imp');
  put('sandbag_wall', mainCross.x + 4.5, mainCross.z - 2, 0, 'imp');
  field.watchtower = null;
  for (let tries = 0; tries < 20 && !field.watchtower; tries++) {
    const x = enemy.x + R(-24, 24), z = enemy.z + R(4, 16);
    if (!blocked(x, z, 3) && roadDist(x, z) > 4) field.watchtower = { x, z, yaw: 0 };
  }
  // the enemy tank waits on the main road in front of its camp
  const tankAt = walk(main, 1).reverse().find((s) => s.z > enemy.z + 10) || { x: enemy.x, z: enemy.z + 12, tx: 0, tz: 1 };
  field.tank = { x: tankAt.x, z: tankAt.z, yaw: Math.atan2(-tankAt.tx, -tankAt.tz) };
  // barricades where roads leave the village
  for (const road of field.roads) {
    const exit = walk(road.pts, 1).find((s, i, all) => i > 0 && (Math.hypot(s.x - village.x, s.z - village.z) - village.r) * (Math.hypot(all[i - 1].x - village.x, all[i - 1].z - village.z) - village.r) < 0);
    if (exit && rng() < 0.85) put(rng() < 0.5 ? 'barricade' : 'sandbag_wall', exit.x + exit.tz * road.width * 0.25, exit.z - exit.tx * road.width * 0.25, Math.atan2(exit.tx, exit.tz), null); // long side across the road
  }
  // scattered cover across the no man's land, more of it with a higher cover setting
  const want = Math.round(16 * P.cover);
  for (let tries = 0, made = 0; tries < want * 12 && made < want; tries++) {
    const x = R(-HALF + 12, HALF - 12), z = R(enemy.z + 34, player.z - 16);
    if (roadDist(x, z) < 2.5 || riverDist(x, z) < 3) continue;
    const roll = rng();
    const type = roll < 0.45 ? 'sandbag_wall' : roll < 0.65 ? 'sandbag_arc' : roll < 0.8 ? 'ruin_wall' : roll < 0.9 ? 'barricade' : 'crate';
    // cover faces up and down the map: across the line of fire
    if (put(type, x, z, (rng() < 0.5 ? 0 : Math.PI) + R(-0.4, 0.4))) made++;
  }
  // ruined houses leave a broken wall
  for (const h of houses) if (h.ruined) cover.push({ type: 'ruin_wall', x: h.x, z: h.z, yaw: h.yaw, side: null, house: true });
  field.cover = cover;

  // --- the enemy base holds: guard posts behind sandbags across the approach, and a bunker on it
  field.guardPosts = [];
  for (let k = 0; k < 3; k++) {
    for (let tries = 0; tries < 30; tries++) {
      const a = (k - 1) * 0.75 + R(-0.15, 0.15); // fanned across the southern approach
      const r = R(11, 15);
      const x = enemy.x + Math.sin(a) * r, z = enemy.z + Math.cos(a) * r;
      if (blocked(x, z, 1.2) || field.guardPosts.some((g) => Math.hypot(g.x - x, g.z - z) < 5)) continue;
      put('sandbag_arc', x + Math.sin(a) * 1.6, z + Math.cos(a) * 1.6, a, 'imp');
      field.guardPosts.push({ x, z, yaw: a });
      break;
    }
  }
  for (let tries = 0; tries < 30; tries++) {
    const x = enemy.x + R(-10, 10), z = enemy.z + R(18, 24);
    if (occupied(x, z, 3.5) || roadDist(x, z) < 4 || bunkers.some((b) => Math.hypot(b.x - x, b.z - z) < 12)) continue;
    bunkers.push({ x, z, yaw: R(-0.2, 0.2), base: true });
    break;
  }

  // --- deployment: slots in front of the player's camp; the enemy's spread along its line
  const slots = (c, toward, count, spread) => {
    const out = [];
    for (let tries = 0; out.length < count && tries < 200; tries++) {
      const a = toward + R(-spread, spread);
      const r = R(5, 16);
      const x = c.x + Math.sin(a) * r, z = c.z + Math.cos(a) * r;
      if (blocked(x, z, 0.8) || cover.some((k) => Math.hypot(k.x - x, k.z - z) < Math.max(COVER[k.type].hx, COVER[k.type].hz) + 0.8) || out.some((o) => Math.hypot(o.x - x, o.z - z) < 3)) continue;
      out.push({ x, z, yaw: toward });
    }
    return out;
  };
  field.deploy = { fed: slots(field.camps[0], Math.PI, 8, 1.1), imp: slots(field.camps[1], 0, 10, 1.3) };
  return field;
}

/** Bilinear terrain height at (x, z). */
export function heightAt(field, x, z) {
  const n = field.n;
  const fx = clamp((x + HALF) / RES, 0, n - 1.001), fz = clamp((z + HALF) / RES, 0, n - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz);
  const u = fx - i, v = fz - j;
  const H = field.heights;
  return lerp(lerp(H[j * n + i], H[j * n + i + 1], u), lerp(H[(j + 1) * n + i], H[(j + 1) * n + i + 1], u), v);
}
