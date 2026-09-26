import { BIOMES, isWater, mulberry32 } from '../../map/mapGenerator.js';
import { createNoise3D } from '../../math/simplex3d.js';

// Town layout: a city and its surroundings, cut out of the planet's hex map
// and unrolled onto a flat, metre-scale disc (a tabletop diorama). Pure data:
// the builder turns it into meshes, the mode uses its colliders and graphs.
//
// Coordinates: x/z in metres, city centre at the origin, y up.
// Orientation ("yaw") everywhere in the layout: an item's local X axis points
// along (cos yaw, sin yaw) in x/z and its front (+Z) along (-sin yaw, cos yaw).
// In three.js that is rotation.y = -yaw.

export const TILE_M = 85; // one hex tile radius, in metres
export const DIORAMA_R = 620; // radius of the playable disc

const TAU = Math.PI * 2;
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------- 2D helpers

function segDist2(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz || 1e-9;
  let t = ((px - ax) * dx + (pz - az) * dz) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - px;
  const qz = az + dz * t - pz;
  return qx * qx + qz * qz;
}

/** Oriented rectangles overlap (separating axis test). r = { x, z, hw, hd, yaw } */
function obbOverlap(a, b, pad = 0) {
  const axes = [a.yaw, a.yaw + Math.PI / 2, b.yaw, b.yaw + Math.PI / 2];
  for (const ang of axes) {
    const ax = Math.cos(ang);
    const az = Math.sin(ang);
    const proj = (r) => {
      const c = r.x * ax + r.z * az;
      const e = Math.abs(Math.cos(r.yaw - ang)) * (r.hw + pad) + Math.abs(Math.sin(r.yaw - ang)) * (r.hd + pad);
      return [c - e, c + e];
    };
    const [a0, a1] = proj(a);
    const [b0, b1] = proj(b);
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
}

/** Uniform grid over the disc for "anything near here?" queries. */
class Grid {
  constructor(cell) {
    this.cell = cell;
    this.map = new Map();
  }
  key(i, j) {
    return (i + 512) * 1024 + (j + 512);
  }
  add(x, z, r, item) {
    const c = this.cell;
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++) {
      for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++) {
        const k = this.key(i, j);
        if (!this.map.has(k)) this.map.set(k, []);
        this.map.get(k).push(item);
      }
    }
  }
  near(x, z, r) {
    const c = this.cell;
    const out = new Set();
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++) {
      for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++) {
        const list = this.map.get(this.key(i, j));
        if (list) list.forEach((it) => out.add(it));
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------- fields

/**
 * Smooth per-point blend of the hex tiles around the city: land, city, forest,
 * mountain, ... each in 0..1. Hex tiles are only the source: the fields are
 * rounded so coasts, forests and the city edge read as natural outlines.
 */
class Fields {
  constructor(tiles) {
    this.tiles = tiles;
    this.grid = new Grid(TILE_M * 2);
    tiles.forEach((t) => this.grid.add(t.x, t.z, 0, t));
    this.reach = TILE_M * 1.5;
  }
  sample(x, z, out = {}) {
    out.land = out.city = out.otherCity = out.forest = out.mountain = out.farm = out.desert = out.tundra = out.beach = out.deep = out.plains = out.river = 0;
    let wsum = 0;
    let best = null;
    let bestD = Infinity;
    for (const t of this.grid.near(x, z, this.reach)) {
      const d = Math.hypot(t.x - x, t.z - z);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
      const q = 1 - (d / this.reach) ** 2;
      if (q <= 0) continue;
      const w = q * q;
      wsum += w;
      if (!t.water) out.land += w;
      if (t.city) out.city += w;
      if (t.otherCity) out.otherCity += w;
      if (t.biome === BIOMES.FOREST) out.forest += w;
      if (t.biome === BIOMES.MOUNTAIN) out.mountain += w;
      if (t.farm) out.farm += w;
      if (t.biome === BIOMES.DESERT) out.desert += w;
      if (t.biome === BIOMES.TUNDRA) out.tundra += w;
      if (t.biome === BIOMES.BEACH) out.beach += w;
      if (t.biome === BIOMES.OCEAN_DEEP) out.deep += w;
      if (t.biome === BIOMES.PLAINS) out.plains += w;
    }
    if (wsum > 0) for (const k of ['land', 'city', 'otherCity', 'forest', 'mountain', 'farm', 'desert', 'tundra', 'beach', 'deep', 'plains']) out[k] /= wsum;
    else out.land = best && !best.water ? 1 : 0;
    out.tile = best;
    return out;
  }
}

// ---------------------------------------------------------------- main

/**
 * @param {object} p
 *   map: planet map data, hexasphere: tiles with that map applied,
 *   cityIndex, planetType, seed
 */
export function generateTownLayout({ map, hexasphere, cityIndex, planetType = 'terran', detail = 1 }) {
  const city = map.cities[cityIndex];
  const tileMap = hexasphere.tileMap;
  const seed = ((map.seed || 1) * 131 + cityIndex * 977) >>> 0;
  const rng = mulberry32(seed);
  const noise = createNoise3D(seed);
  const modern = city.style === 'modern';

  // Local tangent frame at the city centre
  const cityTiles = city.tiles || [city.tileId];
  const n = [0, 0, 0];
  cityTiles.forEach((id) => {
    const c = tileMap.get(id).center;
    n[0] += c.x;
    n[1] += c.y;
    n[2] += c.z;
  });
  const nl = Math.hypot(...n);
  const N = n.map((v) => v / nl);
  const ref = Math.abs(N[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (v) => {
    const l = Math.hypot(...v);
    return v.map((x) => x / l);
  };
  const U = norm(cross(N, ref));
  const V = norm(cross(N, U));
  const center0 = tileMap.get(city.tileId);
  const unitTr = center0.center.distanceTo(center0.corners[0]);
  const k = TILE_M / unitTr;
  const project = (c) => [(c.x * U[0] + c.y * U[1] + c.z * U[2]) * k, (c.x * V[0] + c.y * V[1] + c.z * V[2]) * k];

  // Tiles within reach of the disc
  const maxAngle = ((DIORAMA_R + TILE_M * 3) / TILE_M) * unitTr;
  const cosMax = Math.cos(maxAngle);
  const local = [];
  const byId = new Map();
  const visit = [city.tileId];
  const seen = new Set(visit);
  while (visit.length) {
    const t = tileMap.get(visit.pop());
    const dot = t.center.x * N[0] + t.center.y * N[1] + t.center.z * N[2];
    if (dot < cosMax) continue;
    const [x, z] = project(t.center);
    const rec = {
      id: t.id,
      x,
      z,
      biome: t.biome,
      water: isWater(t),
      city: t.cityIndex === cityIndex,
      otherCity: t.cityIndex !== null && t.cityIndex !== undefined && t.cityIndex !== cityIndex,
      farm: t.farmIndex !== null && t.farmIndex !== undefined,
      river: t.hasRiver,
      riverTo: t.riverNeighborId,
      road: t.road,
      elevation: t.elevation
    };
    local.push(rec);
    byId.set(t.id, rec);
    for (const nb of t.neighbors) if (!seen.has(nb)) {
      seen.add(nb);
      visit.push(nb);
    }
  }
  const fields = new Fields(local);
  const S = {};
  const at = (x, z) => fields.sample(x, z, S);
  const inCity = (x, z, th = 0.5) => fields.sample(x, z, S).city > th;

  // City reach (average distance to its rounded edge)
  let cityR = 0;
  const edgeAt = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    let r = 10;
    while (r < DIORAMA_R && inCity(Math.cos(a) * r, Math.sin(a) * r, 0.5)) r += 4;
    edgeAt.push(r);
    cityR += r / 24;
  }
  const edgeRadius = (a) => {
    const f = ((((a % TAU) + TAU) % TAU) / TAU) * 24;
    const i = Math.floor(f);
    return edgeAt[i % 24] * (1 - (f - i)) + edgeAt[(i + 1) % 24] * (f - i);
  };

  // ------------------------------------------------------------ roads leaving town
  const exits = [];
  const routeList = [...(map.landRoutes || [])].filter((r) => r.from === cityIndex || r.to === cityIndex);
  for (const r of routeList) {
    const path = r.from === cityIndex ? r.path : [...r.path].reverse();
    const pts = path.map((id) => byId.get(id)).filter(Boolean);
    const firstOut = pts.find((t) => !t.city);
    if (!firstOut) continue;
    const angle = Math.atan2(firstOut.z, firstOut.x);
    if (exits.some((e) => Math.abs(Math.atan2(Math.sin(e.angle - angle), Math.cos(e.angle - angle))) < 0.5)) continue;
    exits.push({ angle, path: pts.filter((t) => !t.city).map((t) => [t.x, t.z]), to: map.cities[r.from === cityIndex ? r.to : r.from]?.name });
  }

  const layout = {
    seed,
    name: city.name,
    style: city.style,
    modern,
    capital: city.type === 'capital',
    owner: city.owner,
    size: cityTiles.length,
    planetType,
    cityR,
    tiles: local,
    fields,
    streets: [],
    buildings: [],
    props: [],
    trees: [],
    walls: [],
    fields2: null,
    docks: [],
    colliders: [],
    exits,
    spawn: { x: 0, z: 0, yaw: 0 },
    walkGraph: [],
    driveGraph: []
  };

  // ------------------------------------------------------------ occupancy
  const occ = new Grid(24);
  const rects = [];
  const segs = [];
  const segGrid = new Grid(24);
  const addStreet = (pts, w, kind) => {
    const s = { pts, w, kind };
    layout.streets.push(s);
    for (let i = 0; i + 1 < pts.length; i++) {
      const seg = { ax: pts[i][0], az: pts[i][1], bx: pts[i + 1][0], bz: pts[i + 1][1], hw: w / 2, street: s };
      segs.push(seg);
      const mx = (seg.ax + seg.bx) / 2;
      const mz = (seg.az + seg.bz) / 2;
      segGrid.add(mx, mz, Math.hypot(seg.bx - seg.ax, seg.bz - seg.az) / 2 + w, seg);
    }
    return s;
  };
  /** Clearance from a point to the nearest street edge. */
  const streetClear = (x, z, r = 20, ignore = null) => {
    let best = Infinity;
    for (const s of segGrid.near(x, z, r)) {
      if (s.street === ignore) continue;
      best = Math.min(best, Math.sqrt(segDist2(x, z, s.ax, s.az, s.bx, s.bz)) - s.hw);
    }
    return best;
  };
  const free = (rect, pad = 0.6) => {
    for (const o of occ.near(rect.x, rect.z, Math.max(rect.hw, rect.hd) + 30)) if (obbOverlap(rect, o, pad)) return false;
    return true;
  };
  const claim = (rect, collide = true) => {
    rects.push(rect);
    occ.add(rect.x, rect.z, Math.hypot(rect.hw, rect.hd), rect);
    if (collide) layout.colliders.push({ type: 'box', x: rect.x, z: rect.z, hw: rect.hw, hd: rect.hd, yaw: rect.yaw });
  };
  const place = (list, asset, x, z, yaw, w, d, extra = {}) => {
    const rect = { x, z, yaw, hw: w / 2, hd: d / 2 };
    if (!free(rect, extra.pad ?? 0.6)) return false;
    claim(rect, extra.collide !== false);
    list.push({ asset, x, z, yaw, w, d, h: extra.h, tint: extra.tint ?? 0.94 + rng() * 0.12, variant: extra.variant ?? Math.floor(rng() * 4) });
    return true;
  };

  // ------------------------------------------------------------ city plan
  if (modern) planModern(layout, { rng, noise, at, inCity, edgeRadius, addStreet, streetClear, place, claim, segs });
  else planFantasy(layout, { rng, noise, at, inCity, edgeRadius, addStreet, streetClear, place, claim, segs, free });

  // Roads out of town to the edge of the disc, along the planet's route
  for (const e of exits) {
    const start = [Math.cos(e.angle) * edgeRadius(e.angle) * 0.92, Math.sin(e.angle) * edgeRadius(e.angle) * 0.92];
    const pts = [start];
    for (const p of e.path) {
      if (Math.hypot(p[0], p[1]) > DIORAMA_R + 60) break;
      if (Math.hypot(p[0], p[1]) < Math.hypot(...start) + 30) continue;
      pts.push(p);
    }
    if (pts.length < 2) {
      pts.push([Math.cos(e.angle) * (DIORAMA_R + 40), Math.sin(e.angle) * (DIORAMA_R + 40)]);
    }
    // Resample into a gentle curve
    const smoothPts = chaikin(chaikin(pts));
    addStreet(smoothPts, modern ? 10 : 5.5, 'road');
  }

  planSurroundings(layout, { rng, noise, at, place, streetClear, claim, local, modern, planetType, detail });
  buildGraphs(layout);
  return layout;
}

function chaikin(pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    out.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// ---------------------------------------------------------------- fantasy

function planFantasy(L, { rng, noise, at, inCity, edgeRadius, addStreet, streetClear, place, claim, free }) {
  const big = L.capital || L.size >= 5;
  const plazaR = L.capital ? 24 : L.size >= 3 ? 19 : 14;
  L.plaza = { x: 0, z: 0, r: plazaR };
  claim({ x: 0, z: 0, hw: plazaR * 0.72, hd: plazaR * 0.72, yaw: 0 }, false);

  // Main streets: toward each road exit, topped up to 3-5 evenly spread ones
  const angles = L.exits.map((e) => e.angle);
  const want = L.size >= 5 ? 5 : L.size >= 3 ? 4 : 3;
  while (angles.length < want) {
    let best = 0;
    let bestSep = -1;
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2 + rng() * 0.1;
      const sep = Math.min(...angles.map((b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))), 9);
      if (sep > bestSep) {
        bestSep = sep;
        best = a;
      }
    }
    angles.push(best);
  }
  const mains = [];
  for (const a0 of angles) {
    let a = a0;
    let x = Math.cos(a) * plazaR * 0.9;
    let z = Math.sin(a) * plazaR * 0.9;
    const pts = [[x, z]];
    for (let i = 0; i < 80; i++) {
      a += noise.noise(x * 0.01, z * 0.01, a0) * 0.12;
      a += Math.atan2(Math.sin(a0 - a), Math.cos(a0 - a)) * 0.08; // keep heading out
      x += Math.cos(a) * 9;
      z += Math.sin(a) * 9;
      pts.push([x, z]);
      if (!inCity(x, z, 0.42)) break;
    }
    mains.push(addStreet(pts, 7, 'main'));
    L.walls.gates = L.walls.gates || [];
    L.walls.gates.push({ x, z, angle: a });
  }

  // Landmark beside the plaza, in the widest gap between main streets, facing it
  {
    const sorted = [...angles].map((a) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)).sort((a, b) => a - b);
    let la = 0;
    let gap = -1;
    sorted.forEach((a, i) => {
      const b = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + Math.PI * 2;
      if (b - a > gap) {
        gap = b - a;
        la = (a + b) / 2;
      }
    });
    const [asset, w, d] = L.capital ? ['f_castle', 44, 44] : L.size >= 3 ? ['f_temple', 16, 24] : ['f_tower', 8, 8];
    for (let tries = 0; tries < 6 && !L.landmark; tries++) {
      const dist = plazaR + Math.hypot(w, d) / 2 + 4 + tries * 7;
      const x = Math.cos(la) * dist;
      const z = Math.sin(la) * dist;
      if (!inCity(x, z, 0.6)) continue;
      if (place(L.buildings, asset, x, z, la + Math.PI / 2, w, d, { pad: 2, tint: 1 })) L.landmark = { asset, x, z, yaw: la + Math.PI / 2, w, d };
    }
  }

  // Ring lanes (break where the landmark stands)
  const R = L.cityR;
  const rings = R > 160 ? [0.45, 0.78] : R > 105 ? [0.56] : [];
  for (const frac of rings) {
    const rr = R * frac;
    let run = [];
    for (let i = 0; i <= 90; i++) {
      const a = (i / 90) * Math.PI * 2;
      const r = rr * (1 + noise.noise(Math.cos(a) * 2, Math.sin(a) * 2, 7) * 0.12);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (inCity(x, z, 0.55) && free({ x, z, hw: 3, hd: 3, yaw: 0 }, 0)) run.push([x, z]);
      else {
        if (run.length > 3) addStreet(run, 5, 'ring');
        run = [];
      }
    }
    if (run.length > 3) addStreet(run, 5, 'ring');
  }

  // Lanes branching off the main streets and the rings
  const rings2 = L.streets.filter((s) => s.kind === 'ring');
  for (const m of [...mains, ...rings2]) {
    let acc = 0;
    for (let i = 1; i < m.pts.length; i++) {
      const [ax, az] = m.pts[i - 1];
      const [bx, bz] = m.pts[i];
      acc += Math.hypot(bx - ax, bz - az);
      if (acc < 27 || Math.hypot(bx, bz) < L.plaza.r + 18) continue;
      acc = 0;
      const dir = Math.atan2(bz - az, bx - ax);
      for (const side of [-1, 1]) {
        if (rng() > 0.86) continue;
        let a = dir + side * (Math.PI / 2 + (rng() - 0.5) * 0.5);
        let x = bx;
        let z = bz;
        const pts = [[x, z]];
        const len = 24 + rng() * 42;
        for (let s = 0; s < len; s += 7) {
          a += (rng() - 0.5) * 0.25;
          const nx = x + Math.cos(a) * 7;
          const nz = z + Math.sin(a) * 7;
          if (!inCity(nx, nz, 0.52) || (pts.length > 1 && streetClear(nx, nz, 20, m) < 6) || !free({ x: nx, z: nz, hw: 2.5, hd: 2.5, yaw: 0 }, 0)) break;
          x = nx;
          z = nz;
          pts.push([x, z]);
        }
        if (pts.length >= 3) addStreet(pts, 4, 'lane');
      }
    }
  }

  // Plaza furniture
  L.props.push({ asset: 'f_well', x: 0, z: 0, yaw: rng() * 6, w: 3.2, d: 3.2 });
  L.colliders.push({ type: 'circle', x: 0, z: 0, r: 1.8 });
  const stalls = L.capital ? 7 : L.size >= 3 ? 5 : 3;
  for (let i = 0; i < stalls; i++) {
    const a = (i / stalls) * Math.PI * 2 + rng() * 0.3;
    const r = plazaR * (0.55 + rng() * 0.15);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (streetClear(x, z, 12) < 1.5) continue;
    L.props.push({ asset: 'f_market_stall', x, z, yaw: a + Math.PI / 2, w: 3.6, d: 2.6, tint: 0.9 + rng() * 0.2, variant: i % 3 });
    L.colliders.push({ type: 'box', x, z, hw: 1.8, hd: 1.3, yaw: a + Math.PI / 2 });
  }

  // Houses along every street, facing it, bigger toward the centre
  const typeAt = (r) => {
    const t = r / Math.max(60, L.cityR);
    const roll = rng();
    if (t < 0.4) return roll < 0.45 ? ['f_house_tall', 7, 8] : roll < 0.7 ? ['f_townhouse', 6, 10] : roll < 0.85 ? ['f_shop', 8, 8] : ['f_tavern', 12, 9];
    if (t < 0.75) return roll < 0.5 ? ['f_house', 8, 7] : roll < 0.8 ? ['f_house_tall', 7, 8] : ['f_townhouse', 6, 10];
    return roll < 0.6 ? ['f_house_small', 6, 6] : ['f_house', 8, 7];
  };
  fillStreetFronts(L, { rng, inCity, streetClear, place, typeAt, cityTh: 0.5, list: L.buildings, kinds: ['main', 'ring', 'lane'] });

  // Back plots: houses, trees and sheds where no street reaches
  for (let i = 0; i < 180 + L.size * 70; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * L.cityR;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (!inCity(x, z, 0.55) || streetClear(x, z, 16) < 5) continue;
    if (rng() < 0.4) {
      if (place(L.trees, rng() < 0.7 ? 'tree_round' : 'tree_round_b', x, z, rng() * 6, 3.2, 3.2, { pad: 0.2, collide: false })) {
        L.colliders.push({ type: 'circle', x, z, r: 0.7 });
      }
    } else place(L.buildings, 'f_house_small', x, z, rng() * 6, 6, 6);
  }

  // Walls with towers (big towns) or a palisade (small ones)
  const wallKind = big ? 'f_wall' : L.size >= 2 ? 'f_palisade' : null;
  if (wallKind) {
    const pts = [];
    const steps = Math.max(28, Math.round((L.cityR * Math.PI * 2) / 11));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const r = edgeRadius(a) * 0.97 + 2;
      pts.push([Math.cos(a) * r, Math.sin(a) * r, a]);
    }
    const gates = L.walls.gates || [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, az, aa] = pts[i];
      const [bx, bz] = pts[(i + 1) % pts.length];
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      const nearGate = gates.some((g) => Math.hypot(g.x - mx, g.z - mz) < (big ? 11 : 7)) || streetClear(mx, mz, 12) < 1;
      // Water edges stay open (harbour side)
      if (at(mx, mz).land < 0.55) continue;
      if (!nearGate) {
        const len = Math.hypot(bx - ax, bz - az);
        L.walls.push({ asset: wallKind, x: mx, z: mz, yaw: Math.atan2(bz - az, bx - ax), len });
        L.colliders.push({ type: 'box', x: mx, z: mz, hw: len / 2, hd: big ? 1.4 : 0.5, yaw: Math.atan2(bz - az, bx - ax) });
      }
      if (big && i % 4 === 0 && !nearGate) {
        L.props.push({ asset: 'f_wall_tower', x: ax, z: az, yaw: aa, w: 6, d: 6 });
        L.colliders.push({ type: 'circle', x: ax, z: az, r: 3 });
      }
    }
    if (big) for (const g of gates) L.props.push({ asset: 'f_gate', x: g.x, z: g.z, yaw: g.angle + Math.PI / 2, w: 12, d: 6 });
  }

  // Street lamps (torch posts) along main streets
  scatterAlong(L, ['main'], 26, (x, z, yaw) => {
    L.props.push({ asset: 'f_lamp', x, z, yaw, w: 0.6, d: 0.6 });
    L.colliders.push({ type: 'circle', x, z, r: 0.3 });
  }, { side: 4.2, rng });
  L.spawn = { x: plazaR * 0.5, z: 0, yaw: Math.PI };
}

/** Line both sides of the given streets with building lots that face them. */
function fillStreetFronts(L, { rng, inCity, streetClear, place, typeAt, cityTh, list, kinds }) {
  for (const s of L.streets) {
    if (!kinds.includes(s.kind)) continue;
    for (const side of [-1, 1]) {
      let carry = rng() * 4;
      for (let i = 0; i + 1 < s.pts.length; i++) {
        const [ax, az] = s.pts[i];
        const [bx, bz] = s.pts[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        const dx = (bx - ax) / len;
        const dz = (bz - az) / len;
        let t = carry;
        while (t < len) {
          const [asset, w, d] = typeAt(Math.hypot(ax + dx * t, az + dz * t));
          const off = s.w / 2 + 1.2 + d / 2;
          const x = ax + dx * t - dz * off * side;
          const z = az + dz * t + dx * off * side;
          // Frontage along the street, front (+Z) facing it
          const yaw = Math.atan2(-dz * side, -dx * side);
          if (inCity(x, z, cityTh) && streetClear(x, z, 24, s) > d / 2 + 0.8) {
            place(list, asset, x, z, yaw, w, d, { pad: 0.35 });
          }
          t += w + 0.6 + rng() * 1.8;
        }
        carry = t - len;
      }
    }
  }
}

function scatterAlong(L, kinds, every, fn, { side, rng }) {
  for (const s of L.streets) {
    if (!kinds.includes(s.kind)) continue;
    let acc = rng() * every;
    for (let i = 0; i + 1 < s.pts.length; i++) {
      const [ax, az] = s.pts[i];
      const [bx, bz] = s.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const dx = (bx - ax) / len;
      const dz = (bz - az) / len;
      let t = acc;
      while (t < len) {
        const sd = (Math.floor(t / every) % 2 ? 1 : -1) * (s.w / 2 + side - 3.5);
        // yaw with the front (+Z) pointing along the street
        fn(ax + dx * t - dz * sd, az + dz * t + dx * sd, Math.atan2(dz, dx) - Math.PI / 2);
        t += every;
      }
      acc = t - len;
    }
  }
}

// ---------------------------------------------------------------- modern

function planModern(L, { rng, at, inCity, addStreet, streetClear, place, claim }) {
  const axis = rng() * Math.PI;
  const ca = Math.cos(axis);
  const sa = Math.sin(axis);
  const toWorld = (u, v) => [u * ca - v * sa, u * sa + v * ca];
  const pitch = L.size <= 2 ? 50 : 62; // road centre to road centre
  const road = 12;
  const n = Math.ceil((L.cityR + pitch) / pitch);
  const lineInCity = (u0, v0, u1, v1, w, kind) => {
    let run = [];
    const steps = Math.ceil(Math.hypot(u1 - u0, v1 - v0) / 8);
    for (let i = 0; i <= steps; i++) {
      const u = u0 + ((u1 - u0) * i) / steps;
      const v = v0 + ((v1 - v0) * i) / steps;
      const [x, z] = toWorld(u, v);
      if (inCity(x, z, 0.42)) run.push([x, z]);
      else {
        if (run.length > 2) addStreet(run, w, kind);
        run = [];
      }
    }
    if (run.length > 2) addStreet(run, w, kind);
  };
  for (let i = -n; i <= n; i++) {
    const w = i === 0 ? 18 : road;
    const kind = i === 0 ? 'main' : 'grid';
    lineInCity(i * pitch - pitch / 2, -n * pitch, i * pitch - pitch / 2, n * pitch, w, kind);
    lineInCity(-n * pitch, i * pitch - pitch / 2, n * pitch, i * pitch - pitch / 2, i === 0 ? 18 : road, kind);
  }
  L.grid = { axis, pitch, road };

  // Blocks
  const inner = pitch - road - 4; // buildable block size (with sidewalks)
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const [x, z] = toWorld(i * pitch, j * pitch);
      const s = at(x, z);
      // Edge blocks count too: each lot is checked on its own below
      if (s.city < 0.25 || s.land < 0.6) continue;
      const ring = Math.max(Math.abs(i), Math.abs(j));
      const yaw = axis;
      if (i === 0 && j === 0) {
        // Civic plaza with the landmark spire
        L.plaza = { x, z, r: inner / 2 };
        place(L.buildings, 'm_spire', x, z, yaw, 22, 22, { tint: 1 });
        L.landmark = { asset: 'm_spire', x, z };
        for (const [du, dv] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const [tx, tz] = toWorld(i * pitch + du * inner * 0.38, j * pitch + dv * inner * 0.38);
          place(L.trees, 'tree_round_b', tx, tz, rng() * 6, 4, 4, { collide: false });
        }
        continue;
      }
      if (rng() < 0.1 && ring > 0) {
        // Park block
        for (let t = 0; t < 14; t++) {
          const [tx, tz] = toWorld(i * pitch + (rng() - 0.5) * inner * 0.85, j * pitch + (rng() - 0.5) * inner * 0.85);
          if (place(L.trees, rng() < 0.6 ? 'tree_round_b' : 'tree_round', tx, tz, rng() * 6, 4, 4, { collide: false })) L.colliders.push({ type: 'circle', x: tx, z: tz, r: 0.7 });
        }
        L.props.push({ asset: 'm_bench', x, z, yaw, w: 2, d: 0.8 });
        continue;
      }
      // Lots: towers downtown, apartments around, houses at the edge
      const t = Math.hypot(x, z) / Math.max(80, L.cityR);
      let lots;
      const downtown = L.capital || L.size >= 3;
      if (downtown && ring === 1 && rng() < 0.7) lots = [[0, 0, rng() < 0.5 ? 'm_tower_a' : 'm_tower_b', 30, 30]];
      else if ((downtown && ring <= 2) || t < 0.45) lots = [[-0.24, -0.24, 'm_office', 22, 22], [0.24, 0.24, 'm_office', 22, 22], [0.24, -0.24, 'm_apartment', 20, 16], [-0.24, 0.24, 'm_apartment', 20, 16]];
      else if (t < 0.8) lots = [[-0.25, 0, 'm_apartment', 20, 16], [0.25, 0, 'm_apartment', 20, 16], [0, 0.32, 'm_shop', 14, 10], [0, -0.32, 'm_shop', 14, 10]];
      else {
        lots = [];
        for (const du of [-0.3, 0, 0.3]) for (const dv of [-0.28, 0.28]) lots.push([du, dv, rng() < 0.8 ? 'm_house' : 'm_shop', 12, 10]);
      }
      for (const [du, dv, asset, w, d] of lots) {
        const [bx, bz] = toWorld(i * pitch + du * inner, j * pitch + dv * inner);
        if (!inCity(bx, bz, 0.5)) continue;
        // Face the nearer outer edge of the block
        const face = Math.abs(du) > Math.abs(dv) ? (du > 0 ? -Math.PI / 2 : Math.PI / 2) : dv > 0 ? 0 : Math.PI;
        place(L.buildings, asset, bx, bz, yaw + face, w, d, { pad: 0.5 });
      }
    }
  }

  // Street lights, trees on the avenue, parked cars
  scatterAlong(L, ['main', 'grid'], 24, (x, z, yaw) => {
    if (streetClear(x, z, 12) < 0.2) return;
    L.props.push({ asset: 'm_lamp', x, z, yaw, w: 0.5, d: 0.5 });
    L.colliders.push({ type: 'circle', x, z, r: 0.25 });
  }, { side: 5, rng });
  scatterAlong(L, ['main'], 14, (x, z) => {
    if (streetClear(x, z, 12) < 0.5) return;
    if (place(L.trees, 'tree_round_b', x, z, rng() * 6, 3, 3, { collide: false, pad: 0.1 })) L.colliders.push({ type: 'circle', x, z, r: 0.6 });
  }, { side: 7, rng });
  scatterAlong(L, ['grid'], 19, (x, z, yaw) => {
    if (rng() > 0.35) return;
    L.props.push({ asset: 'm_car', x, z, yaw, w: 2, d: 4.4, tint: rng(), variant: Math.floor(rng() * 5), parked: true });
    L.colliders.push({ type: 'box', x, z, hw: 1, hd: 2.2, yaw });
  }, { side: 1.8, rng });
  void claim;
  L.spawn = { x: L.plaza?.x ?? 0, z: (L.plaza?.z ?? 0) + (L.plaza?.r ?? 10) + 6, yaw: 0 };
}

// ---------------------------------------------------------------- outside the walls

function planSurroundings(L, { rng, noise, at, place, streetClear, local, modern, planetType, detail }) {
  const flora = { ice: 'snow', desert: 'dry', lava: 'none', barren: 'none' }[planetType] || 'green';
  // Farmland: long plots with crop rows in their own direction
  const fields = [];
  for (const t of local) {
    if (!t.farm || t.city) continue;
    const plots = 2 + Math.floor(rng() * 2);
    for (let p = 0; p < plots; p++) {
      const x = t.x + (rng() - 0.5) * 80;
      const z = t.z + (rng() - 0.5) * 80;
      if (at(x, z).land < 0.8 || streetClear(x, z, 30) < 8) continue;
      const crop = rng() < 0.55 ? 'wheat' : rng() < 0.6 ? 'crop' : 'plowed';
      fields.push({ x, z, w: 40 + rng() * 25, d: 28 + rng() * 20, yaw: rng() * Math.PI, crop });
    }
    if (rng() < 0.7) {
      const x = t.x + (rng() - 0.5) * 40;
      const z = t.z + (rng() - 0.5) * 40;
      if (streetClear(x, z, 20) > 6) place(L.buildings, 'barn', x, z, rng() * 6, 14, 10);
    }
    if (rng() < 0.35) {
      const x = t.x + (rng() - 0.5) * 60;
      const z = t.z + (rng() - 0.5) * 60;
      if (streetClear(x, z, 20) > 6) place(L.buildings, 'windmill', x, z, rng() * 6, 9, 9);
    }
  }
  L.fields2 = fields;

  // Trees, rocks and bushes over the whole disc, driven by the blended fields
  const S = {};
  const R = DIORAMA_R;
  const tries = Math.round(9000 * (0.45 + detail * 0.55)); // fewer trees on lighter tiers
  for (let i = 0; i < tries; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * R;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const s = at(x, z, S);
    if (s.land < 0.62 || s.city > 0.3 || s.otherCity > 0.3) continue;
    if (streetClear(x, z, 20) < 3) continue;
    if (fields.some((f) => Math.hypot(f.x - x, f.z - z) < Math.max(f.w, f.d) * 0.55)) continue;
    const dens = noise.noise(x * 0.006, z * 0.006, 3) * 0.5 + 0.5;
    let asset = null;
    let size = 4;
    if (flora === 'none') {
      if (rng() < 0.18) {
        asset = rng() < 0.5 ? 'rock' : 'rock_b';
        size = 2 + rng() * 5;
      }
    } else if (s.mountain > 0.5) {
      if (rng() < 0.25) {
        asset = flora === 'snow' || s.mountain > 0.8 ? 'tree_pine_snow' : rng() < 0.6 ? 'tree_pine' : 'rock';
        size = 4 + rng() * 3;
      }
    } else if (s.forest > 0.45) {
      if (rng() < 0.55 + dens * 0.35) {
        const pine = flora === 'snow' || Math.abs(noise.noise(x * 0.01, z * 0.01, 9)) > 0.25;
        asset = flora === 'snow' ? 'tree_pine_snow' : flora === 'dry' ? (rng() < 0.5 ? 'tree_palm' : 'tree_acacia') : pine ? (rng() < 0.5 ? 'tree_pine' : 'tree_pine_b') : rng() < 0.6 ? 'tree_round' : 'tree_round_b';
        size = 4.5 + rng() * 2.5;
      }
    } else if (s.desert > 0.5) {
      if (rng() < 0.05) {
        asset = rng() < 0.6 ? 'cactus' : 'rock_mesa';
        size = asset === 'cactus' ? 3 : 8 + rng() * 8;
      }
    } else if (s.tundra > 0.5) {
      if (rng() < 0.06) asset = 'tree_pine_snow';
    } else if (s.beach > 0.5) {
      if (flora === 'green' && rng() < 0.03) asset = 'tree_palm';
    } else {
      // Open land: a scattering of trees, bushes and grass
      const roll = rng();
      if (roll < 0.035 + dens * 0.05) asset = flora === 'dry' ? 'tree_acacia' : flora === 'snow' ? 'tree_pine_snow' : rng() < 0.7 ? 'tree_round' : 'tree_pine';
      else if (roll < 0.12 && flora !== 'snow') {
        asset = rng() < 0.5 ? 'bush' : 'bush_b';
        size = 2;
      } else if (roll < 0.3 && flora === 'green') {
        asset = 'grass_tuft';
        size = 1.2;
      }
    }
    if (!asset) continue;
    const small = size < 2.5;
    if (place(L.trees, asset, x, z, rng() * Math.PI * 2, size * 0.7, size * 0.7, { collide: false, pad: small ? -0.5 : 0.1 })) {
      if (!small) L.colliders.push({ type: 'circle', x, z, r: Math.min(1.2, size * 0.15) });
    }
  }

  // Harbour: docks and boats where the town meets the water
  const shore = [];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    for (let r = 20; r < L.cityR + 60; r += 5) {
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const s = at(x, z, S);
      if (s.land < 0.5) {
        if (s.city > 0.05 || r < L.cityR + 30) shore.push({ x, z, a });
        break;
      }
    }
  }
  const docks = shore.filter((_, i) => i % 4 === 0).slice(0, L.capital ? 4 : 2);
  for (const d of docks) {
    L.docks.push({ asset: modern ? 'm_dock' : 'f_dock', x: d.x, z: d.z, yaw: d.a - Math.PI / 2, len: modern ? 34 : 22 });
    const bx = d.x + Math.cos(d.a) * (modern ? 26 : 16) + Math.cos(d.a + Math.PI / 2) * 8;
    const bz = d.z + Math.sin(d.a) * (modern ? 26 : 16) + Math.sin(d.a + Math.PI / 2) * 8;
    L.props.push({ asset: modern ? 'container_ship' : 'boat', x: bx, z: bz, yaw: d.a, w: modern ? 10 : 5, d: modern ? 40 : 12, floating: true });
  }
  L.isPort = docks.length > 0;
}

// ---------------------------------------------------------------- navigation graphs

/** Street polylines as a node/edge graph (pedestrians walk it, cars drive the wider ones). */
function buildGraphs(L) {
  const walk = [];
  const drive = [];
  for (const s of L.streets) {
    const line = s.pts.map(([x, z]) => ({ x, z }));
    walk.push({ pts: line, w: s.w });
    if (s.w >= (L.modern ? 10 : 5.5)) drive.push({ pts: line, w: s.w });
  }
  L.walkGraph = walk;
  L.driveGraph = drive;
}

export { smooth, segDist2 };
