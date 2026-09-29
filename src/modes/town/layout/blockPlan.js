import { voronoi, area, centroid, insetConvex, WARDS, pickWeighted } from './wards.js';
import { riverDistance } from './townPlan.js';

// Town plan v3, after the ideas behind watabou's Neighbourhood generator
// (an own implementation, not a port): the town is one smooth outline, a few
// long streets give it its structure (a template: area, street, square or
// ring), and every region between them is cut in two, again and again, by
// straight streets until the pieces are block-sized. Blocks are then lined
// with continuous rows of houses facing their streets, and what is left
// inside a block stays a garden or a yard.
//
// Why: Voronoi cells made every street a chain of short, randomly angled
// edges (a zigzag), and the wall followed the cells' outer corners (a star).
// Here the long streets are smooth curves, block streets are straight, cuts
// meet their parent street in a T, and the wall follows the smoothed town edge.
//
// Polygons are arrays of { x, z, e } in counter-clockwise order (x right,
// z up); `e` is the edge from that vertex to the next one:
//   a street object { kind, w }  a street runs along it (its centreline)
//   EDGE                         the town edge (no street, the wall is outside)

const TAU = Math.PI * 2;
export const EDGE = { kind: 'edge', w: 0 };
export const TEMPLATES = ['area', 'street', 'square', 'ring'];

/** How the street hierarchy, the blocks and the rows of houses are sized, per era. */
const ERA = {
  fantasy: {
    plaza: [13, 18, 24], // hamlet, town, capital
    main: 7,
    ring: 5.5,
    lane: [4.6, 3.6], // first cuts, later cuts
    kinds: { main: 'main', ring: 'ring', lane: 'lane', plaza: 'ring' },
    block: 1700, // target block area, m²
    minThin: 27, // narrowest block: two rows of houses back to back
    pavement: 1.1,
    setback: 0,
    cutChaos: 0.22, // radians of wobble on block cuts
    offChaos: 0.3, // how far off the middle a cut may fall
    bandSpacing: 60 // ring template: radial streets this far apart
  },
  modern: {
    plaza: [12, 15, 19],
    main: 14,
    ring: 11,
    lane: [10, 8],
    kinds: { main: 'main', ring: 'collector', lane: 'residential', plaza: 'collector' },
    block: 3600,
    minThin: 44,
    pavement: 2.6,
    setback: 1.2,
    cutChaos: 0.05,
    offChaos: 0.2,
    bandSpacing: 110
  }
};

/** Kepadatan (density): block size, gaps between houses and empty lots. */
export const DENSITY = {
  sparse: { block: 1.4, gap: 2.4, empty: 0.14, yard: 0.3, courtyard: 1.4 },
  normal: { block: 1, gap: 1, empty: 0.05, yard: 0, courtyard: 1 },
  dense: { block: 0.72, gap: 0.35, empty: 0.01, yard: -0.2, courtyard: 0.6 }
};

// ---------------------------------------------------------------- geometry

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function pointInPolygon(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function distToPolyEdge(poly, x, z) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(a.x + dx * t - x, a.z + dz * t - z));
  }
  return best;
}

export function isConvex(poly) {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const c = poly[(i + 2) % poly.length];
    if ((b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x) < -1e-6) return false;
  }
  return true;
}

/** Principal axis of a polygon's vertices: { angle, major, minor } (extents in metres). */
function axisOf(poly) {
  const c = centroid(poly);
  let xx = 0;
  let zz = 0;
  let xz = 0;
  for (const p of poly) {
    const dx = p.x - c.x;
    const dz = p.z - c.z;
    xx += dx * dx;
    zz += dz * dz;
    xz += dx * dz;
  }
  const angle = 0.5 * Math.atan2(2 * xz, xx - zz);
  const ux = Math.cos(angle);
  const uz = Math.sin(angle);
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const p of poly) {
    const u = (p.x - c.x) * ux + (p.z - c.z) * uz;
    const v = -(p.x - c.x) * uz + (p.z - c.z) * ux;
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  return { c, angle, major: u1 - u0, minor: v1 - v0, u0, u1 };
}

/**
 * Split a simple (possibly concave) polygon by the line through (ox, oz)
 * along (dx, dz). Returns { pieces, chords }: the new edges carry `label`,
 * the chords are the stretches of the line inside the polygon.
 */
export function splitPolygon(poly, ox, oz, dx, dz, label) {
  const nx = -dz;
  const nz = dx;
  const side = poly.map((p) => {
    const v = (p.x - ox) * nx + (p.z - oz) * nz;
    return Math.abs(v) < 1e-7 ? 1e-7 : v;
  });
  const ring = [];
  const crossings = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const j = (i + 1) % poly.length;
    ring.push({ x: a.x, z: a.z, e: a.e, cross: false });
    if (side[i] > 0 !== side[j] > 0) {
      const b = poly[j];
      const t = side[i] / (side[i] - side[j]);
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const c = { x, z, e: a.e, cross: true, s: (x - ox) * dx + (z - oz) * dz, idx: ring.length };
      ring.push(c);
      crossings.push(c);
    }
  }
  if (crossings.length < 2 || crossings.length % 2) return { pieces: [poly], chords: [] };
  crossings.sort((p, q) => p.s - q.s);
  const chords = [];
  for (let k = 0; k + 1 < crossings.length; k += 2) {
    crossings[k].partner = crossings[k + 1].idx;
    crossings[k + 1].partner = crossings[k].idx;
    chords.push([
      [crossings[k].x, crossings[k].z],
      [crossings[k + 1].x, crossings[k + 1].z]
    ]);
  }
  const seen = new Set();
  const pieces = [];
  for (let start = 0; start < ring.length; start++) {
    if (ring[start].cross || seen.has(start)) continue;
    const piece = [];
    let cur = start;
    for (let guard = 0; guard < ring.length * 2; guard++) {
      const r = ring[cur];
      seen.add(cur);
      if (r.cross) {
        // Arrived along the boundary: cross the chord, then carry on from its far end
        piece.push({ x: r.x, z: r.z, e: label });
        const p = ring[r.partner];
        piece.push({ x: p.x, z: p.z, e: p.e });
        cur = (r.partner + 1) % ring.length;
      } else {
        piece.push({ x: r.x, z: r.z, e: r.e });
        cur = (cur + 1) % ring.length;
      }
      if (cur === start) break;
    }
    if (piece.length >= 3 && area(piece) > 1e-9) pieces.push(piece);
  }
  return { pieces, chords };
}

// ---------------------------------------------------------------- the plan

/**
 * @param L  the layout being built
 * @param K  generator context (rng, fields, street and occupancy helpers)
 * @param plan  { template: 'auto' | TEMPLATES, density: 'sparse' | 'normal' | 'dense',
 *                streetDensity: the density the streets are cut for (defaults to density;
 *                the town planner keeps it 'normal' so a density change never moves a street) }
 * @returns true when the town was planned
 */
export function planBlocks(L, K, plan = {}) {
  const { rng, at, addStreet, claim, free, fp, buildable, streetClear } = K;
  const E = L.modern ? ERA.modern : ERA.fantasy;
  const D = DENSITY[plan.density] || DENSITY.normal;
  const DS = DENSITY[plan.streetDensity] || D; // block size, i.e. where the streets go
  const sizeIdx = L.capital ? 2 : L.size >= 3 ? 1 : 0;
  const S = {};

  // 1. One smooth town outline: the rounded city field, stopped by water
  const N = 96;
  const raw = [];
  const coast = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    const c = Math.cos(a);
    const s = Math.sin(a);
    let r = 6;
    let wet = false;
    const cap = Math.min(L.dioramaR - 60, Math.max(90, L.cityR * 1.5));
    for (; r < cap; r += 3) {
      const f = at(c * r, s * r, S);
      if (f.land < 0.62) {
        wet = true;
        break;
      }
      if (f.city < 0.42) break;
    }
    raw.push(Math.max(0, r - (wet ? 10 : 0)));
    coast.push(wet);
  }
  // Opening (min filter, then a wide moving average): no spikes, no notches
  const plazaR = E.plaza[sizeIdx];
  let outerR = raw.map((_, i) => Math.max(plazaR + 45, Math.min(...[-2, -1, 0, 1, 2].map((k) => raw[(i + k + N) % N]))));
  for (let pass = 0; pass < 6; pass++) outerR = outerR.map((_, i) => [-2, -1, 0, 1, 2].reduce((s, k) => s + outerR[(i + k + N) % N], 0) / 5);
  const lerpRing = (arr, a) => {
    const f = ((((a % TAU) + TAU) % TAU) / TAU) * N;
    const i = Math.floor(f);
    const t = f - i;
    return arr[i % N] * (1 - t) + arr[(i + 1) % N] * t;
  };
  const outer = (a) => lerpRing(outerR, a);
  const onCoast = (a) => coast[Math.round((((a % TAU) + TAU) % TAU) / TAU * N) % N];

  // 2. Template and its axis
  const auto = L.modern ? (rng() < 0.6 ? 'street' : 'square') : L.capital ? 'ring' : ['area', 'street', 'square', 'ring'][Math.floor(rng() * 4)];
  const template = TEMPLATES.includes(plan.template) ? plan.template : auto;
  const axis = L.exits.length ? L.exits[0].angle : rng() * TAU;
  // Preferred block orientation at a point (cuts snap to it or its normal)
  const orient = (x, z) => (template === 'ring' || template === 'area' ? Math.atan2(z, x) : axis);
  const orientPull = template === 'area' ? 0.35 : template === 'ring' && !L.modern ? 0.8 : 1;

  // Plaza: a disc, or a rectangle square facing the axis
  const sq = template === 'square' ? { hw: plazaR * 1.25, hh: plazaR * 0.9 } : null;
  const inner = (a) => {
    if (!sq) return plazaR;
    const u = Math.abs(Math.cos(a - axis));
    const v = Math.abs(Math.sin(a - axis));
    return Math.min(sq.hw / Math.max(u, 1e-6), sq.hh / Math.max(v, 1e-6));
  };
  const P = (t, a) => {
    const i = inner(a);
    const r = i + (outer(a) - i) * t;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r };
  };

  // 3. Arteries: from the plaza to each gate, a few gentle curves
  // Planned templates keep their streets square to the axis: a road coming in
  // at another angle joins the nearest of them, or snaps to the cross axis
  let angles;
  if (template === 'street' || template === 'square') {
    const grid = template === 'street' ? [axis, axis + Math.PI] : [0, 1, 2, 3].map((k) => axis + (k * Math.PI) / 2);
    angles = grid.slice();
    for (const e of L.exits) {
      const choices = [0, 1, 2, 3].map((k) => axis + (k * Math.PI) / 2);
      const near = choices.reduce((p, q) => (Math.abs(wrap(q - e.angle)) < Math.abs(wrap(p - e.angle)) ? q : p));
      if (!angles.some((a) => Math.abs(wrap(a - near)) < 0.1)) angles.push(near);
    }
  } else angles = L.exits.map((e) => e.angle);
  const want = template === 'street' ? 2 : template === 'square' ? 4 : L.modern ? 4 : sizeIdx === 2 ? 5 : sizeIdx === 1 ? 4 : 3;
  while (angles.length < want) {
    let best = 0;
    let gap = -1;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU + rng() * 0.05;
      const sep = Math.min(9, ...angles.map((b) => Math.abs(wrap(a - b))));
      if (sep > gap && !onCoast(a)) {
        gap = sep;
        best = a;
      }
    }
    angles.push(best);
  }
  // Merge arteries that are too close to leave blocks between them
  angles = angles.map((a) => ((a % TAU) + TAU) % TAU).sort((p, q) => p - q);
  const merged = [];
  for (const a of angles) if (!merged.length || a - merged[merged.length - 1] > 0.5) merged.push(a);
  if (merged.length > 1 && merged[0] + TAU - merged[merged.length - 1] < 0.5) merged.pop();
  angles = merged;
  const straight = template === 'street' || template === 'square' || L.modern;
  const radials = angles.map((a, j) => {
    const prev = angles[(j - 1 + angles.length) % angles.length];
    const next = angles[(j + 1) % angles.length];
    const room = Math.min(Math.abs(wrap(a - prev)), Math.abs(wrap(next - a)));
    const bend = (rng() - 0.5) * Math.min(straight ? 0.08 : 0.3, room * 0.35);
    return { a, bend, theta: (t) => a + bend * Math.sin(Math.PI * t) };
  });
  const W = (kind, level = 0) => (kind === 'lane' ? E.lane[Math.min(1, level)] : kind === 'main' ? E.main + (L.capital && !L.modern ? 1 : 0) : E.ring);
  const street = (kind, level) => ({ kind: E.kinds[kind], w: W(kind, level), role: kind });
  const plazaStreet = { kind: E.kinds.plaza, w: L.modern ? E.ring : 5, role: 'plaza' };
  for (const r of radials) r.street = street('main');

  // Rings (ring template; big towns of the other templates get one collector)
  const ringT = template === 'ring' ? (L.cityR > 150 ? [0.34, 0.66] : [0.5]) : L.cityR > 190 ? [0.55] : [];
  const bands = [0, ...ringT, 1];
  const rings = ringT.map(() => street('ring'));

  // Per band: its radial streets (arteries + band streets in the outer bands)
  const bandRadials = [];
  for (let k = 0; k + 1 < bands.length; k++) {
    const list = radials.map((r) => ({ theta: r.theta, street: r.street, artery: r }));
    if (k > 0 && template === 'ring') {
      const tm = (bands[k] + bands[k + 1]) / 2;
      const extra = [];
      for (let j = 0; j < radials.length; j++) {
        const a0 = radials[j].theta(tm);
        let a1 = radials[(j + 1) % radials.length].theta(tm);
        while (a1 <= a0) a1 += TAU;
        const arc = (a1 - a0) * (plazaR + (L.cityR - plazaR) * tm);
        const n = Math.max(0, Math.round(arc / (E.bandSpacing * Math.sqrt(DS.block))) - 1);
        for (let m = 1; m <= n; m++) {
          const a = a0 + ((a1 - a0) * (m + (rng() - 0.5) * 0.3)) / (n + 1);
          const bend = (rng() - 0.5) * 0.04;
          extra.push({ theta: (t) => a + bend * (t - tm), street: street('lane') });
        }
      }
      list.push(...extra);
    }
    const tm = (bands[k] + bands[k + 1]) / 2;
    list.sort((p, q) => (((p.theta(tm) % TAU) + TAU) % TAU) - (((q.theta(tm) % TAU) + TAU) % TAU));
    bandRadials.push(list);
  }

  // 4. Draw the structural streets
  const ARC = 5; // sample spacing on curves, metres
  const riverSafe = (x, z) => riverDistance(L, x, z) > 1.5;
  const dryAt = (x, z) => at(x, z, S).land > 0.55;
  const addRun = (pts, st, { bridge = false } = {}) => {
    // Streets stop at water; structural streets may cross rivers (bridged later)
    let run = [];
    const flush = () => {
      if (run.length > 1) addStreet(run, st.w, st.kind);
      run = [];
    };
    for (const p of pts) {
      if (dryAt(p[0], p[1]) && (bridge || riverSafe(p[0], p[1]))) run.push(p);
      else flush();
    }
    flush();
  };
  const radialPts = (theta, t0, t1) => {
    const a = theta((t0 + t1) / 2);
    const len = (outer(a) - inner(a)) * (t1 - t0);
    const n = Math.max(2, Math.ceil(len / ARC));
    return Array.from({ length: n + 1 }, (_, i) => {
      const t = t0 + ((t1 - t0) * i) / n;
      const p = P(t, theta(t));
      return [p.x, p.z];
    });
  };
  const ringPts = (t, a0, a1) => {
    const len = (a1 - a0) * (plazaR + (L.cityR - plazaR) * t);
    const n = Math.max(2, Math.ceil(len / ARC));
    return Array.from({ length: n + 1 }, (_, i) => {
      const p = P(t, a0 + ((a1 - a0) * i) / n);
      return [p.x, p.z];
    });
  };
  for (const r of radials) addRun(radialPts(r.theta, 0, 1), r.street, { bridge: true });
  const plazaLoop = ringPts(0, 0, TAU);
  addRun(plazaLoop, plazaStreet, { bridge: true });
  ringT.forEach((t, k) => addRun(ringPts(t, 0, TAU), rings[k], { bridge: true }));
  bandRadials.forEach((list, k) => {
    for (const r of list) if (!r.artery) addRun(radialPts(r.theta, bands[k], bands[k + 1]), r.street);
  });

  // 5. Regions between them, each bisected down to blocks
  const regions = [];
  bandRadials.forEach((list, k) => {
    const t0 = bands[k];
    const t1 = bands[k + 1];
    const lo = k === 0 ? plazaStreet : rings[k - 1];
    const hi = k + 1 < bands.length - 1 ? rings[k] : EDGE;
    for (let j = 0; j < list.length; j++) {
      const A = list[j];
      const B = list[(j + 1) % list.length];
      const unwrap = (b, a) => {
        while (b <= a) b += TAU;
        return b;
      };
      const a0 = A.theta(t0);
      const b0 = unwrap(B.theta(t0), a0);
      const a1 = A.theta(t1);
      const b1 = unwrap(B.theta(t1), a1);
      const poly = [];
      const push = (pts, e) => pts.slice(0, -1).forEach(([x, z]) => poly.push({ x, z, e }));
      // Counter-clockwise: out along A, the outer ring, in along B, the inner ring
      push(radialPts(A.theta, t0, t1), A.street);
      push(ringPts(t1, a1, b1), hi);
      push(radialPts((t) => unwrap(B.theta(t), A.theta(t)), t0, t1).reverse(), B.street);
      push(ringPts(t0, a0, b0).reverse(), lo);
      if (poly.length >= 3 && area(poly) > 50) regions.push({ poly, band: k });
    }
  });

  const blocks = [];
  const cutStreets = [];
  const bisect = (poly, level) => {
    const A = area(poly);
    const ax = axisOf(poly);
    const c = ax.c;
    const t = Math.min(1, Math.hypot(c.x, c.z) / Math.max(80, L.cityR));
    const target = E.block * DS.block * (0.75 + t * 0.7) * (0.85 + rng() * 0.3);
    if (A < target * 1.3 || ax.minor < E.minThin * 1.1) return blocks.push({ poly, level });
    for (let attempt = 0; attempt < 5; attempt++) {
      // Across the long axis, near the middle, snapped toward the template's grain
      let dir = ax.angle + Math.PI / 2;
      const o = orient(c.x, c.z);
      const snap = [o, o + Math.PI / 2].reduce((best, g) => (Math.abs(wrap(2 * (dir - g))) < Math.abs(wrap(2 * (dir - best))) ? g : best), o);
      if (orientPull >= 1 || Math.abs(wrap(2 * (dir - snap))) < 1.2) dir += (wrap(2 * (snap - dir)) / 2) * orientPull;
      dir += (rng() - 0.5) * E.cutChaos * (attempt ? 0.5 : 1);
      const off = (rng() - 0.5) * E.offChaos * (attempt ? 0.5 : 1) * ax.major;
      let ox = c.x + Math.cos(ax.angle) * off;
      let oz = c.z + Math.sin(ax.angle) * off;
      if (attempt < 3 && !sq && orientPull < 1 && poly.some((p) => p.e === plazaStreet)) {
        // Around the square, cut parallel to it: the blocks facing it keep their whole frontage
        const a = Math.atan2(c.z, c.x);
        const r = inner(a) + E.minThin * (1.25 + rng() * 0.3);
        dir = a + Math.PI / 2 + (rng() - 0.5) * E.cutChaos * 0.5;
        ox = Math.cos(a) * r;
        oz = Math.sin(a) * r;
      }
      const st = street('lane', level);
      const { pieces, chords } = splitPolygon(poly, ox, oz, Math.cos(dir), Math.sin(dir), st);
      if (pieces.length < 2) continue;
      if (pieces.some((p) => area(p) < target * 0.3 || axisOf(p).minor < E.minThin)) continue;
      cutStreets.push({ chords, st });
      for (const p of pieces) bisect(p, level + 1);
      return;
    }
    blocks.push({ poly, level });
  };
  for (const r of regions) bisect(r.poly, 0);
  for (const { chords, st } of cutStreets) {
    for (const [p, q] of chords) {
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 4) continue;
      const n = Math.max(1, Math.ceil(len / ARC));
      addRun(Array.from({ length: n + 1 }, (_, i) => [p[0] + ((q[0] - p[0]) * i) / n, p[1] + ((q[1] - p[1]) * i) / n]), st);
    }
  }

  // 6. What each block is for
  const gates = radials.map((r) => {
    const p = P(1, r.theta(1));
    return { x: p.x, z: p.z, angle: r.theta(1), coast: onCoast(r.theta(1)) };
  });
  for (const ex of L.exits) {
    let best = null;
    for (const g of gates) if (!best || Math.abs(wrap(g.angle - ex.angle)) < Math.abs(wrap(best.angle - ex.angle))) best = g;
    if (!best) continue;
    ex.gate = { x: best.x, z: best.z };
    // A road meeting the town away from its gate runs round outside the wall to it
    const diff = wrap(ex.angle - best.angle);
    if (Math.abs(diff) > 0.2) {
      ex.via = [];
      const n = Math.ceil(Math.abs(diff) / 0.08);
      for (let i = 1; i <= n; i++) {
        const a = best.angle + (diff * i) / n;
        const r = outer(a) + 18 + 10 * Math.sin((Math.PI * i) / n);
        ex.via.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
    }
  }
  const richAngle = axis + Math.PI * (0.5 + rng());
  for (const b of blocks) {
    const c = centroid(b.poly);
    b.c = c;
    b.area = area(b.poly);
    b.t = Math.hypot(c.x, c.z) / Math.max(80, L.cityR);
    b.plaza = b.poly.some((p) => p.e === plazaStreet);
    b.edge = b.poly.some((p) => p.e === EDGE);
    const wet = [0, 1, 2, 3, 4, 5].some((k) => at(c.x + Math.cos(k) * 30, c.z + Math.sin(k) * 30, S).land < 0.55);
    const nearGate = gates.some((g) => !g.coast && Math.hypot(g.x - c.x, g.z - c.z) < 55);
    if (L.modern) {
      b.ward = wet && b.t > 0.35 ? 'industrial' : b.t < 0.3 || b.plaza ? 'cbd' : b.t < 0.58 ? 'commercial' : b.t < 0.85 ? 'residential' : 'suburb';
    } else {
      const rich = Math.abs(wrap(Math.atan2(c.z, c.x) - richAngle)) < 0.7 && b.t > 0.25 && b.t < 0.8;
      b.ward = b.plaza || b.t < 0.28 ? 'merchant' : wet && L.isCoastal !== false ? 'docks' : nearGate ? 'gate' : rich ? 'patriciate' : b.t > 0.78 && L.size >= 3 && rng() < 0.6 ? 'slum' : 'craftsmen';
    }
  }

  // Parks: a few whole blocks, convex ones away from the plaza
  const convexInset = (b) =>
    isConvex(b.poly) ? insetConvex(b.poly, (e) => (e === EDGE ? 2 : e.w / 2 + E.pavement)) : [];
  const nParks = Math.max(1, Math.round(blocks.length / (L.modern ? 10 : 14)));
  const parkable = blocks.filter((b) => !b.plaza && b.t > 0.2 && b.t < 0.85 && b.area > E.block * 0.6 && isConvex(b.poly) && axisOf(b.poly).minor > axisOf(b.poly).major * 0.45);
  for (let i = 0; i < nParks && parkable.length; i++) {
    const b = parkable.splice(Math.floor(rng() * parkable.length), 1)[0];
    const poly = convexInset(b);
    if (poly.length < 3) continue;
    const pc = centroid(poly);
    const probes = [pc, ...poly, ...poly.map((p) => ({ x: (p.x + pc.x) / 2, z: (p.z + pc.z) / 2 }))];
    if (!probes.every((p) => at(p.x, p.z, S).land > 0.78 && riverDistance(L, p.x, p.z) > 2)) continue;
    b.ward = 'park';
    const c = centroid(poly);
    L.parks.push({ x: c.x, z: c.z, poly: poly.map((p) => ({ x: p.x, z: p.z })), style: L.modern ? 'public' : 'garden' });
  }

  // Plaza: paved square, a well and market stalls
  const plazaPoly = [];
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * TAU;
    const r = inner(a) + plazaStreet.w / 2;
    plazaPoly.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  L.plaza = { x: 0, z: 0, r: sq ? sq.hh : plazaR, poly: plazaPoly };
  claim({ x: 0, z: 0, hw: (sq ? sq.hw : plazaR) * 0.72, hd: (sq ? sq.hh : plazaR) * 0.72, yaw: sq ? axis : 0 }, false);
  if (!L.modern) {
    L.props.push({ asset: 'f_well', x: 0, z: 0, yaw: rng() * 6, w: 3.2, d: 3.2 });
    L.colliders.push({ type: 'circle', x: 0, z: 0, r: 1.8 });
    const stalls = [3, 5, 7][sizeIdx];
    for (let i = 0; i < stalls; i++) {
      const a = (i / stalls) * TAU + rng() * 0.3;
      const r = inner(a) * 0.55;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const yaw = a + Math.PI / 2;
      L.props.push({ asset: 'f_market_stall', x, z, yaw, w: 3.6, d: 2.6, tint: 0.9 + rng() * 0.2, variant: i % 3 });
      L.colliders.push({ type: 'box', x, z, hw: 1.8, hd: 1.3, yaw });
    }
  }

  // 7. Buildings: continuous rows along each block's streets
  const clearOf = (x, z) => streetClear(x, z, 30) >= E.pavement - 0.3;
  const fits = (b, rect) => {
    const ca = Math.cos(rect.yaw);
    const sa = Math.sin(rect.yaw);
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const x = rect.x + u * rect.hw * ca - v * rect.hd * sa;
      const z = rect.z + u * rect.hw * sa + v * rect.hd * ca;
      if (!pointInPolygon(b.poly, x, z) || !clearOf(x, z)) return false;
    }
    return free(rect, 0.05) && buildable(rect);
  };
  const runsOf = (poly) => {
    // Consecutive edges of the same street and gently turning: one frontage
    const runs = [];
    const n = poly.length;
    let first = 0;
    for (let i = 0; i < n; i++) {
      const prev = poly[(i - 1 + n) % n];
      if (prev.e !== poly[i].e || turn(poly, (i - 1 + n) % n) > 0.5) {
        first = i;
        break;
      }
    }
    let run = null;
    for (let k = 0; k < n; k++) {
      const i = (first + k) % n;
      const e = poly[i].e;
      if (run && run.e === e && turn(poly, (i - 1 + n) % n) <= 0.5) run.pts.push(poly[(i + 1) % n]);
      else {
        if (run) runs.push(run);
        run = { e, pts: [poly[i], poly[(i + 1) % n]] };
      }
    }
    if (run) runs.push(run);
    return runs.filter((r) => r.e !== EDGE);
  };
  const along = (pts) => {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    const at2 = (s) => {
      let i = 1;
      while (i < pts.length - 1 && cum[i] < s) i++;
      const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, z: pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t };
    };
    return { len: cum[cum.length - 1], at: at2 };
  };
  const NOMINAL = { f_house_small: [6, 6], f_house: [8, 7], f_house_tall: [7, 8], f_townhouse: [6, 10], f_shop: [8, 8], f_tavern: [12, 9], barn: [14, 10], f_tower: [8, 8], f_temple: [16, 24], f_castle: [44, 44], m_house: [12, 10], m_apartment: [20, 16], m_office: [22, 22], m_shop: [14, 10], m_tower_a: [30, 30], m_tower_b: [30, 30], m_spire: [22, 22] };
  /** Try to stand `asset` with its front on the frontage at arc length s; returns the width taken. */
  const stand = (b, ward, run, path, s, asset, { maxScale = 1.22, minScale = 0.84, tint, variant, sy } = {}) => {
    const [nw, nd] = NOMINAL[asset] || [8, 8];
    const F = fp(asset, nw, nd);
    const off = run.e.w / 2 + E.pavement + E.setback;
    for (const sx of [1, 1.12, 0.92, maxScale, minScale].filter((v) => v <= maxScale && v >= minScale)) {
      const w = F.w * sx;
      if (s + w > path.len + 0.01) continue;
      const p0 = path.at(s);
      const p1 = path.at(s + w);
      const tx0 = p1.x - p0.x;
      const tz0 = p1.z - p0.z;
      const tl = Math.hypot(tx0, tz0) || 1;
      const tx = tx0 / tl;
      const tz = tz0 / tl;
      const nx = -tz; // into the block (left of a CCW edge)
      const nz = tx;
      for (const sz of [1.18, 1, 0.9, maxScale, minScale]) {
        if (sz > maxScale || sz < minScale) continue;
        const d = F.d * sz;
        const fx = (p0.x + p1.x) / 2 + nx * off;
        const fz = (p0.z + p1.z) / 2 + nz * off;
        const rect = { x: fx + nx * (d / 2), z: fz + nz * (d / 2), yaw: Math.atan2(nx, -nz), hw: w / 2, hd: d / 2 };
        if (!fits(b, rect)) continue;
        const Xx = -nz;
        const Xz = nx;
        const x = rect.x - Xx * F.cx * sx + nx * F.cz * sz;
        const z = rect.z - Xz * F.cx * sx + nz * F.cz * sz;
        const item = { asset, x, z, yaw: rect.yaw, w: F.w * sx, d: F.d * sz, sx, sz, tint: tint ?? 0.92 + rng() * 0.16, variant: variant ?? Math.floor(rng() * 4), ward };
        if (sy) item.sy = sy;
        L.buildings.push(item);
        claim(rect);
        return { w, rect };
      }
    }
    return null;
  };

  // Landmarks first: a temple (or tower) facing the plaza, a castle at the edge
  const landmarkBlock = (cands, asset, faceRole) => {
    for (const b of cands) {
      const runs = runsOf(b.poly).filter((r) => !faceRole || r.e.role === faceRole).sort((p, q) => along(q.pts).len - along(p.pts).len);
      for (const run of runs) {
        const path = along(run.pts);
        const [nw] = NOMINAL[asset];
        const F = fp(asset, nw, NOMINAL[asset][1]);
        for (const s of [1, 0.9, 0.8, 0.7]) {
          const w = F.w * s;
          if (w > path.len - 2) continue;
          const got = stand(b, 'landmark', run, path, (path.len - w) / 2, asset, { maxScale: s, minScale: s, tint: 1, variant: 0, sy: s });
          if (got) {
            b.ward = 'landmark';
            const item = L.buildings[L.buildings.length - 1];
            L.landmark ||= { asset, x: item.x, z: item.z, yaw: item.yaw, w: item.w, d: item.d };
            return true;
          }
        }
      }
    }
    return false;
  };
  const byArea = (list) => list.sort((p, q) => q.area - p.area);
  if (L.modern) {
    landmarkBlock(byArea(blocks.filter((b) => b.plaza && b.ward !== 'park')), 'm_spire', 'plaza');
  } else {
    if (L.capital) landmarkBlock(byArea(blocks.filter((b) => b.edge && b.t > 0.45 && b.ward !== 'park' && b.area > 2200)), 'f_castle', null);
    const civic = L.size >= 3 ? 'f_temple' : 'f_tower';
    const central = byArea(blocks.filter((b) => b.t < 0.5 && b.ward !== 'park' && b.ward !== 'landmark'));
    landmarkBlock(central.filter((b) => b.plaza), civic, 'plaza') || landmarkBlock(central, civic, 'main');
  }

  for (const b of blocks) {
    if (b.ward === 'park' || b.ward === 'landmark') continue;
    const ward = WARDS[b.ward] || WARDS.craftsmen;
    const pool = b.ward === 'cbd' && L.modern ? [...ward.pool, ['m_tower_a', 2], ['m_tower_b', 1]] : ward.pool;
    const empty = Math.max(0, (ward.lots?.emptyProb ?? 0.05) + D.empty - 0.04);
    const baseGap = (ward.gap ?? 0.4) * D.gap;
    for (const run of runsOf(b.poly)) {
      const path = along(run.pts);
      let s = 0.4 + rng() * 1.2;
      let guard = 0;
      while (s < path.len - 3 && guard++ < 200) {
        if (rng() < empty) {
          s += 6 + rng() * 6; // a garden gap in the row
          continue;
        }
        let got = null;
        const order = [];
        const left = pool.slice();
        while (left.length) {
          const a = pickWeighted(left, rng);
          order.push(a);
          left.splice(left.findIndex(([p]) => p === a), 1);
        }
        for (const asset of order) if ((got = stand(b, b.ward, run, path, s, asset))) break;
        if (got) s += got.w + baseGap + rng() * (ward.gapChaos ?? 0.6) * D.gap;
        else s += 1.5;
      }
    }
  }

  // 8. Courtyards and gardens: trees in what is left inside the blocks
  for (const b of blocks) {
    if (b.ward === 'park') continue;
    const ward = WARDS[b.ward] || WARDS.craftsmen;
    const yard = Math.min(0.95, Math.max(0.05, (ward.yard ?? 0.3) + D.yard + (b.ward === 'landmark' ? 0.5 : 0)));
    const tries = Math.round((b.area / 45) * yard * D.courtyard);
    const ax = axisOf(b.poly);
    for (let i = 0; i < tries; i++) {
      const u = (rng() - 0.5) * ax.major;
      const v = (rng() - 0.5) * ax.minor;
      const x = ax.c.x + Math.cos(ax.angle) * u - Math.sin(ax.angle) * v;
      const z = ax.c.z + Math.sin(ax.angle) * u + Math.cos(ax.angle) * v;
      if (!pointInPolygon(b.poly, x, z) || streetClear(x, z, 20) < 2.5 || distToPolyEdge(b.poly, x, z) < 3) continue;
      const pick = L.modern ? [['t_birch', 0], ['t_oak', 0], ['t_cypress', 0], ['b_bush', 0]] : [['t_fruit', 0], ['t_fruit', 1], ['t_oak', 0], ['t_birch', 0], ['b_bush', 1]];
      const [asset, variant] = pick[Math.floor(rng() * pick.length)];
      const small = asset.startsWith('b_');
      const size = small ? 2 : 3.2 + rng() * 1.4;
      if (K.place(L.trees, asset, x, z, rng() * TAU, size * 0.7, size * 0.7, { pad: 0.3, collide: false, variant })) {
        if (!small) L.colliders.push({ type: 'circle', x, z, r: 0.6 });
      }
    }
  }

  // 9. Walls: along the smooth town edge, open to the water, gates on the arteries
  const big = L.capital || L.size >= 5;
  const wallKind = L.modern ? null : big ? 'f_wall' : L.size >= 2 ? 'f_palisade' : null;
  L.walls.gates = gates.filter((g) => !g.coast).map((g) => ({ x: g.x, z: g.z }));
  if (wallKind) {
    const off = big ? 5 : 3.5;
    const fine = 720;
    const loop = [];
    for (let i = 0; i < fine; i++) {
      const a = (i / fine) * TAU;
      const r = outer(a) + off;
      loop.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, a });
    }
    const piece = 9;
    const pts = [loop[0]];
    let acc = 0;
    for (let i = 1; i <= fine; i++) {
      const p = loop[i % fine];
      const q = loop[i - 1];
      acc += Math.hypot(p.x - q.x, p.z - q.z);
      if (acc >= piece) {
        pts.push(p);
        acc = 0;
      }
    }
    if (Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].z - pts[0].z) < piece * 0.5) pts.pop();
    const gateR = big ? 10 : 6;
    const wet = (x, z) => at(x, z, S).land < 0.6 || riverDistance(L, x, z) < 3;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const mx = (a.x + b.x) / 2;
      const mz = (a.z + b.z) / 2;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const yaw = Math.atan2(b.z - a.z, b.x - a.x);
      const atGate = gates.some((g) => Math.hypot(g.x - mx, g.z - mz) < gateR + off) || streetClear(mx, mz, 14) < 0.5;
      if (atGate || wet(mx, mz) || wet(a.x, a.z) || wet(b.x, b.z)) continue;
      L.walls.push({ asset: wallKind, x: mx, z: mz, yaw, len: len * 1.02 });
      L.colliders.push({ type: 'box', x: mx, z: mz, hw: (len * 1.02) / 2, hd: big ? 1.4 : 0.5, yaw });
      if (big && i % 5 === 0 && !gates.some((g) => Math.hypot(g.x - a.x, g.z - a.z) < gateR + off + 4)) {
        L.props.push({ asset: 'f_wall_tower', x: a.x, z: a.z, yaw: a.a, w: 6, d: 6 });
        L.colliders.push({ type: 'circle', x: a.x, z: a.z, r: 3 });
      }
    }
    if (big) {
      for (const g of gates) {
        if (g.coast || wet(g.x, g.z)) continue;
        const gx = g.x + Math.cos(g.angle) * off;
        const gz = g.z + Math.sin(g.angle) * off;
        L.props.push({ asset: 'f_gate', x: gx, z: gz, yaw: g.angle + Math.PI / 2, w: 12, d: 6 });
      }
    }
  }

  // 10. Countryside cells for the farms: Voronoi outside the town edge only
  const R = L.dioramaR;
  const sites = [];
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * TAU;
    const r = outer(a) + 12;
    sites.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, town: true });
  }
  const farGrid = [];
  for (let i = 0; i < 3000; i++) {
    const a = rng() * TAU;
    const r = Math.sqrt(rng()) * (R + 60);
    if (r < outer(a) + 60) continue;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const min = 100 + rng() * 50;
    if (farGrid.some((s) => Math.hypot(s.x - x, s.z - z) < min)) continue;
    const s = { x, z, town: false };
    farGrid.push(s);
    sites.push(s);
  }
  const cells = voronoi(sites, R + 80);
  L.farmCells = [];
  for (const c of cells) {
    if (c.site.town || !c.poly.length) continue;
    const m = centroid(c.poly);
    const s = at(m.x, m.z, S);
    if (s.land < 0.5 || riverDistance(L, m.x, m.z) < 4) continue;
    if (!c.poly.every((v) => Math.hypot(v.x, v.z) < R - 30 && Math.hypot(v.x, v.z) > outer(Math.atan2(v.z, v.x)) + 8)) continue;
    const nearTown = c.poly.some((p) => p.e >= 0 && cells[p.e]?.site.town);
    L.farmCells.push({ poly: c.poly, x: m.x, z: m.z, area: Math.abs(area(c.poly)), nearTown });
  }

  L.wards = blocks.map((b) => ({ ward: b.ward, poly: b.poly.map((p) => [p.x, p.z]), x: b.c.x, z: b.c.z }));
  L.outline = Array.from({ length: N }, (_, i) => {
    const a = (i / N) * TAU;
    return [Math.cos(a) * outerR[i], Math.sin(a) * outerR[i]];
  });
  L.morphology = { version: L.layoutVersion, kind: 'bisected-neighbourhood', template, density: plan.density || 'normal', blocks: blocks.length, arteries: radials.length, rings: ringT.length };
  const sp = P(0, axis + 0.3);
  L.spawn = { x: sp.x * 0.6, z: sp.z * 0.6, yaw: Math.PI };
  return blocks.length > 0;
}

/** Turning angle at the vertex after edge i (radians, unsigned). */
function turn(poly, i) {
  const n = poly.length;
  const a = poly[i];
  const b = poly[(i + 1) % n];
  const c = poly[(i + 2) % n];
  return Math.abs(wrap(Math.atan2(c.z - b.z, c.x - b.x) - Math.atan2(b.z - a.z, b.x - a.x)));
}
