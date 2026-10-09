import { createNoise3D } from '../../math/simplex3d.js';
import BRIDGES from './bridges.json' with { type: 'json' };

// Valley height field (docs/FARM_PLAN.md §6). Site first, in this order:
//   1. the raw terrain is shaped (noise, rim, river bed);
//   3. features (the village square) take the best-scoring candidate site, or are left out;
//   2. bridges pick a straight, narrow reach of the river, cross it square to the flow, and get
//      two abutment pads at one shared height; the path is rerouted over the deck;
//   1. every pad (house, field, square, abutments) is flattened with a smooth shoulder.
// The kit never adapts to the ground; the ground is shaped for the kit. Pure and DOM-free: the
// mesh, placement, walking and tests all read the same grid.

export const GRID_STEP = 1; // metres between height samples

/** Closest distance from (x, z) to a polyline. */
export function polylineDistance(points, x, z) {
  return closestOnPolyline(points, x, z).d;
}

/** Closest point on a polyline: distance, the point, and the arc length there. */
export function closestOnPolyline(points, x, z) {
  let best = { d: Infinity, x: 0, z: 0, s: 0 };
  let run = 0;
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1], [bx, bz] = points[i];
    const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1, len = Math.sqrt(len2);
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2));
    const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { d, x: px, z: pz, s: run + t * len };
    run += len;
  }
  return best;
}

/** Point and unit tangent at arc length s along a polyline. */
export function pointAt(points, s) {
  let run = 0;
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1], [bx, bz] = points[i];
    const len = Math.hypot(bx - ax, bz - az);
    if (s <= run + len || i === points.length - 1) {
      const t = Math.min(1, Math.max(0, (s - run) / (len || 1)));
      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, tx: (bx - ax) / len, tz: (bz - az) / len };
    }
    run += len;
  }
  return null;
}

const polylineLength = (points) => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - points[i][0], p[1] - points[i][1]), 0);

/** Unit tangent of a polyline averaged over [s - w, s + w] (chord direction). */
export function tangentAt(points, s, w = 3) {
  const a = pointAt(points, s - w), b = pointAt(points, s + w);
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
}

/**
 * Signed distance to a (rotated) rectangle pad: negative inside. rot (degrees) turns the pad's
 * local +x towards (cos rot, sin rot) in (x, z).
 */
export function padDistance(pad, x, z) {
  const a = -(pad.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const lx = (x - pad.x) * c - (z - pad.z) * s, lz = (x - pad.x) * s + (z - pad.z) * c;
  const qx = Math.abs(lx) - pad.w / 2, qz = Math.abs(lz) - pad.d / 2;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * How well a rectangle suits a feature (0..1): flat under it, close to a path, clear of the river.
 * Weights: flatness 0.5, access 0.3, water 0.2.
 */
export function siteScore({ rawAt, paths, river }, rect) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) {
    const h = rawAt(rect.x - rect.w / 2 + (rect.w * i) / 6, rect.z - rect.d / 2 + (rect.d * j) / 6);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  const flat = 1 - Math.min(1, (hi - lo) / 2.5);
  const edge = Math.min(...paths.map((p) => polylineDistance(p.points, rect.x, rect.z))) - Math.max(rect.w, rect.d) / 2;
  const access = 1 - Math.min(1, Math.max(0, edge) / 14);
  const clear = Math.min(1, Math.max(0, polylineDistance(river.points, rect.x, rect.z) - river.width / 2 - Math.max(rect.w, rect.d) / 2) / 6);
  return { score: 0.5 * flat + 0.3 * access + 0.2 * clear, flat, access, clear, range: hi - lo };
}

/** Bridge over the river where `path` crosses it (rule 2). Returns null if the path never crosses. */
export function planBridge({ rawAt, river, water }, path) {
  const length = polylineLength(river.points);
  // Where the path comes closest to the river's centre line
  let cross = null;
  for (let s = 0; s <= length; s += 0.5) {
    const p = pointAt(river.points, s), d = polylineDistance(path.points, p.x, p.z);
    if (!cross || d < cross.d) cross = { s, d };
  }
  if (!cross || cross.d > river.width) return null;
  // Within 12 m of it, the straightest reach (and the nearest, as a tie-break)
  let best = null;
  for (let s = Math.max(6, cross.s - 12); s <= Math.min(length - 6, cross.s + 12); s += 0.5) {
    const a = tangentAt(river.points, s - 3, 3), b = tangentAt(river.points, s + 3, 3);
    const bend = Math.acos(Math.min(1, a.x * b.x + a.z * b.z));
    const cost = bend * 10 + Math.abs(s - cross.s) * 0.04;
    if (!best || cost < best.cost) best = { s, cost, bend };
  }
  const at = pointAt(river.points, best.s), t = tangentAt(river.points, best.s, 2.5);
  const n = { x: -t.z, z: t.x }; // across the flow
  const span = BRIDGES.lengths.find((l) => l >= river.width + 2 * BRIDGES.bank) ?? BRIDGES.lengths.at(-1);
  const A = BRIDGES.abutment;
  const end = (k) => ({ x: at.x + n.x * k, z: at.z + n.z * k });
  const outer = span / 2 + A.length / 2 - 0.3;
  // Both abutments at one height: the higher bank, never below the flood line
  const y = Math.max(rawAt(end(-outer).x, end(-outer).z), rawAt(end(outer).x, end(outer).z), water + 0.7);
  const rot = (Math.atan2(n.z, n.x) * 180) / Math.PI;
  const pads = [-1, 1].map((k) => ({ id: `abutment_${k < 0 ? 'a' : 'b'}`, ...end(k * outer), w: A.length, d: A.width, rot, margin: A.margin, y }));
  return { x: at.x, z: at.z, n, t, span, y, rot, pads, bend: best.bend, ends: [end(-span / 2), end(span / 2)], abutmentEnds: [end(-span / 2 - A.length), end(span / 2 + A.length)] };
}

/** Deck height along a bridge at signed distance u from its centre (bridges.json curve). */
export function deckHeight(bridge, u) {
  const t = (u + bridge.span / 2) / bridge.span;
  return bridge.y + BRIDGES.lift + BRIDGES.arch[String(bridge.span)] * Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
}

/** Reroute a path over a bridge: keep its points outside the abutments, join through the deck. */
function routeOver(path, bridge) {
  const side = ([x, z]) => (x - bridge.x) * bridge.n.x + (z - bridge.z) * bridge.n.z;
  const clear = bridge.span / 2 + BRIDGES.abutment.length;
  const first = side(path.points[0]) < 0 ? -1 : 1;
  // Points that would kink back towards the abutment (within 2 m of it) are dropped as well
  const near = path.points.filter((p) => Math.sign(side(p)) === first && Math.abs(side(p)) > clear + 2);
  const far = path.points.filter((p) => Math.sign(side(p)) !== first && Math.abs(side(p)) > clear + 2);
  const [a0, a1] = first < 0 ? [bridge.abutmentEnds[0], bridge.ends[0]] : [bridge.abutmentEnds[1], bridge.ends[1]];
  const [b1, b0] = first < 0 ? [bridge.ends[1], bridge.abutmentEnds[1]] : [bridge.ends[0], bridge.abutmentEnds[0]];
  const points = [...near, [a0.x, a0.z], [a1.x, a1.z], [b1.x, b1.z], [b0.x, b0.z], ...far];
  return { ...path, points, deck: near.length + 1 }; // segment index deck -> deck + 1 is over the water
}

export function buildHeightField(layout) {
  const noise = createNoise3D(layout.seed).noise;
  const half = layout.size / 2, n = Math.round(layout.size / GRID_STEP) + 1;
  const river = layout.river;
  const raw = (x, z) => {
    let h = noise(x * 0.025, 0, z * 0.025) * 0.9 + noise(x * 0.07, 3.3, z * 0.07) * 0.25;
    // The valley rim: hills behind (north) and to the sides; the south stays open towards the camera
    const r = Math.hypot(x * 0.95, (z + 6) * (z > 0 ? 0.75 : 1.05));
    const rim = smooth(40, 76, r) * (z > 4 ? 0.35 : 1);
    h += rim * (13 + noise(x * 0.04, 7.1, z * 0.04) * 5);
    const d = polylineDistance(river.points, x, z);
    h -= (1 - smooth(river.width / 2 - 0.6, river.width / 2 + 3.2, d)) * (1.7 + h * 0.15);
    return h;
  };
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = raw(-half + i * GRID_STEP, -half + j * GRID_STEP);
  const rawAt = (x, z) => bilinear(heights, n, half, x, z); // read only before the pads are applied

  const pads = layout.pads.map((p) => ({ ...p }));
  let paths = layout.paths.map((p) => ({ ...p, points: p.points.map((q) => [...q]) }));
  const site = { rawAt, river, water: layout.water, paths };

  // 3. Features: the best candidate that passes, or none
  const features = [], featureObjects = [];
  for (const f of layout.features || []) {
    const scored = f.candidates.map(([x, z]) => ({ x, z, ...siteScore(site, { x, z, w: f.w, d: f.d }) }));
    const pick = scored.reduce((a, b) => (b.score > a.score ? b : a));
    const placed = pick.score >= f.minScore;
    features.push({ id: f.id, placed, ...pick, candidates: scored });
    if (!placed) continue;
    pads.push({ id: f.id, x: pick.x, z: pick.z, w: f.w, d: f.d, rot: 0, margin: f.margin ?? 3 });
    for (const o of f.contents) featureObjects.push({ ...o, x: pick.x + o.dx, z: pick.z + o.dz, pad: f.id });
    // A spur from the square's open side to the nearest path
    const exit = [pick.x + (f.exit?.[0] ?? 0), pick.z + (f.exit?.[1] ?? f.d / 2)];
    const nearest = paths.map((p) => closestOnPolyline(p.points, ...exit)).reduce((a, b) => (b.d < a.d ? b : a));
    paths.push({ kind: 'dirt', width: 1.4, points: [[pick.x + (f.exit?.[0] ?? 0) * 0.5, pick.z + (f.exit?.[1] ?? f.d / 2) * 0.5], exit, [nearest.x, nearest.z]] });
  }

  // 2. Bridges where paths cross the river
  const bridges = [];
  for (const c of layout.crossings || []) {
    const bridge = planBridge(site, paths[c.path]);
    if (!bridge) continue;
    bridges.push(bridge);
    pads.push(...bridge.pads);
    paths[c.path] = routeOver(paths[c.path], bridge);
  }

  // 1. Pads: a fixed height (abutments), or the mean of the raw terrain under the footprint
  for (const pad of pads) {
    if (pad.y !== undefined) continue;
    let sum = 0, count = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = -half + i * GRID_STEP, z = -half + j * GRID_STEP;
      if (padDistance(pad, x, z) <= 0) { sum += heights[j * n + i]; count++; }
    }
    pad.y = count ? sum / count : raw(pad.x, pad.z);
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -half + i * GRID_STEP, z = -half + j * GRID_STEP;
    for (const pad of pads) {
      const k = 1 - smooth(0, pad.margin, padDistance(pad, x, z));
      if (k > 0) heights[j * n + i] += (pad.y - heights[j * n + i]) * k;
    }
  }
  const heightAt = (x, z) => bilinear(heights, n, half, x, z);
  /** The bridge deck under a point, or null. */
  const deckAt = (x, z) => {
    for (const b of bridges) {
      const u = (x - b.x) * b.n.x + (z - b.z) * b.n.z, v = (x - b.x) * b.t.x + (z - b.z) * b.t.z;
      if (Math.abs(u) <= b.span / 2 && Math.abs(v) <= BRIDGES.width / 2) return { bridge: b, y: deckHeight(b, u) };
    }
    return null;
  };
  /** What a walker stands on: the deck where there is one, else the ground. */
  const surfaceAt = (x, z) => {
    const deck = deckAt(x, z);
    return deck ? Math.max(deck.y, heightAt(x, z)) : heightAt(x, z);
  };
  const riverDistance = (x, z) => polylineDistance(river.points, x, z);
  return {
    size: layout.size, half, n, heights, pads: new Map(pads.map((p) => [p.id, p])), paths, bridges, features, featureObjects,
    heightAt, surfaceAt, deckAt, riverDistance, water: layout.water
  };
}

/** Bilinear over the grid: the same surface the mesh draws (up to its triangle diagonal). */
function bilinear(heights, n, half, x, z) {
  const fx = Math.min(n - 1.001, Math.max(0, (x + half) / GRID_STEP));
  const fz = Math.min(n - 1.001, Math.max(0, (z + half) / GRID_STEP));
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const h00 = heights[j * n + i], h10 = heights[j * n + i + 1], h01 = heights[(j + 1) * n + i], h11 = heights[(j + 1) * n + i + 1];
  return (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
}
