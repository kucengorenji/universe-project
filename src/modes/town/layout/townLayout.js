import { BIOMES, isWater } from '../../../map/mapGenerator.js';
import { mulberry32 } from '../../../math/random.js';
import { dryFootprint, footprintSamples } from '../../../world/landUsePlan.js';
import { buildingId, seedFor } from '../../../world/identity.js';
import { describeRelief } from '../../../world/townRelief.js';
import { createNoise3D } from '../../../math/simplex3d.js';
import { planWards, planRivers, planBridges, fillBlock, farmStrips, riverDistance, frontStep } from './townPlan.js';
import { planVegetation } from './vegetation.js';
import { planTownGreenery } from './townGreenery.js';
import { planNeighbourhoods } from './neighbourhoodPlan.js';
import { planStreetLights } from './streetLightPlan.js';
import { planRoofs } from './roofPlan.js';
import { clearDoorApproaches } from './doorClearance.js';
import { planHedgerows } from './fieldEdges.js';
import { isVillage, planVillage } from './villagePlan.js';
import { planBlocks } from './blockPlan.js';
import { pavementWidth } from '../scale.js';
import { TOWN_LAYOUT_VERSION } from '../../../world/versions.js';

// Town layout: a city and its surroundings, cut out of the planet's hex map
// and unrolled onto a flat, metre-scale disc (a tabletop diorama). Pure data:
// the builder turns it into meshes, the mode uses its colliders and graphs.
//
// Coordinates: x/z in metres, city centre at the origin, y up.
// Orientation ("yaw") everywhere in the layout: an item's local X axis points
// along (cos yaw, sin yaw) in x/z and its front (+Z) along (-sin yaw, cos yaw).
// In three.js that is rotation.y = -yaw.

export const TILE_M = 85; // one hex tile radius, in metres
export const DIORAMA_MAX = 860; // largest playable disc (a big capital); each town sizes its own
export const HORIZON_M = 4400; // tiles are gathered this far out, for the horizon

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
  constructor(tiles, tileM = TILE_M) {
    this.tiles = tiles;
    this.grid = new Grid(tileM * 2);
    tiles.forEach((t) => this.grid.add(t.x, t.z, 0, t));
    this.reach = tileM * 1.5;
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

/** The seed the original town of a city is built from (also its save namespace). */
export function townBaseSeed(map, cityIndex) {
  return ((map.seed || 1) * 131 + cityIndex * 977) >>> 0;
}

/**
 * @param {object} p
 *   map: planet map data, hexasphere: tiles with that map applied,
 *   cityIndex, planetType, seed
 *   layoutVersion: older versions are kept for towns whose saved interiors refer
 *     to their buildings; 4 bisects blocks, 5 keeps metre-scale assets in half-area towns
 *   variant: 0 is the original town, another number rerolls the settlement
 *   options: { density: 0.75 | 1 | 1.3, template: 'auto' | 'area' | 'street' | 'square' | 'ring' }
 */
/**
 * The planner's density (0.75 / 1 / 1.3) as the block planner's density names. Streets
 * are always cut for normal density: in the planner, density thins or packs the lots of
 * the same street plan.
 */
function blockPlanOptions({ density = 1, template = 'auto' } = {}) {
  return { template, density: density < 0.9 ? 'sparse' : density > 1.1 ? 'dense' : 'normal', streetDensity: 'normal' };
}

export function generateTownLayout({ map, hexasphere, cityIndex, planetType = 'terran', detail = 1, footprints = {}, layoutVersion = TOWN_LAYOUT_VERSION, variant = 0, options = {} }) {
  const city = map.cities[cityIndex];
  const tileMap = hexasphere.tileMap;
  // Variant 0 is the original town. A reroll keeps the ground (relief comes from
  // the base seed, coast/rivers/roads from the planet) and replans the settlement.
  const baseSeed = townBaseSeed(map, cityIndex);
  const seed = variant ? seedFor(baseSeed, 'town-variant', variant) : baseSeed;
  const rng = mulberry32(seed);
  const noise = createNoise3D(seed);
  const modern = city.style === 'modern';
  // Compact settlements halve area, while assets, roads and people keep their
  // metre scale. Legacy layouts retain their exact projection and disc bounds.
  const linearScale = layoutVersion >= 5 ? Math.SQRT1_2 : 1;
  const tileM = TILE_M * linearScale;
  const maxR = DIORAMA_MAX * linearScale;

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
  const k = tileM / unitTr;
  const project = (c) => [(c.x * U[0] + c.y * U[1] + c.z * U[2]) * k, (c.x * V[0] + c.y * V[1] + c.z * V[2]) * k];

  // Keep the source tile selection stable; compact towns project it nearer.
  const maxAngle = (HORIZON_M / TILE_M) * unitTr;
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
  const fields = new Fields(local, tileM);
  const S = {};
  const at = (x, z) => fields.sample(x, z, S);
  const inCity = (x, z, th = 0.5) => fields.sample(x, z, S).city > th;

  // City reach (average distance to its rounded edge)
  let cityR = 0;
  const edgeAt = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    let r = 10 * linearScale;
    while (r < maxR && inCity(Math.cos(a) * r, Math.sin(a) * r, 0.5)) r += 4 * linearScale;
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
    const toIndex = r.from === cityIndex ? r.to : r.from;
    exits.push({ angle, path: pts.filter((t) => !t.city).map((t) => [t.x, t.z]), to: map.cities[toIndex]?.name, toIndex });
  }

  const layout = {
    frame: { N, U, V }, // town x = U, y = N (up), z = V on the planet
    seed,
    baseSeed,
    variant,
    options: { density: options.density ?? 1 },
    layoutVersion,
    name: city.name,
    style: city.style,
    modern,
    capital: city.type === 'capital',
    owner: city.owner,
    size: cityTiles.length,
    planetType,
    cityR,
    // The playable disc grows with the city: a hamlet sits on a small table, a capital on a big one
    dioramaR: Math.min(Math.round(maxR), Math.max(Math.round(400 * linearScale), Math.round(cityR * 1.7 + 220 * linearScale))),
    tiles: local,
    fields,
    relief: describeRelief(local, cityR, baseSeed),
    streets: [],
    buildings: [],
    props: [],
    trees: [],
    parks: [],
    paths: [],
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
  /**
   * Real footprint of an asset (the modelled bounding box of all its variants,
   * which is not centred on the origin when porches or balconies stick out).
   * Falls back to the nominal size when the pack does not have the model.
   */
  const fp = (asset, w, d) => {
    const f = footprints[asset];
    if (!f) return { w, d, cx: 0, cz: 0, front: d / 2 };
    return { w: f.maxX - f.minX, d: f.maxZ - f.minZ, cx: (f.maxX + f.minX) / 2, cz: (f.maxZ + f.minZ) / 2, front: f.maxZ };
  };
  const place = (list, asset, x, z, yaw, w, d, extra = {}) => {
    const f = list===layout.trees ? { w, d, cx:0, cz:0 } : fp(asset, w, d);
    // Rect centre = origin + footprint offset in the item's own axes
    const ca = Math.cos(yaw);
    const sa = Math.sin(yaw);
    const rx = x + ca * f.cx - sa * f.cz;
    const rz = z + sa * f.cx + ca * f.cz;
    const trunk = list===layout.trees && /^(t_|tree_)/.test(asset);
    const rect = { x: rx, z: rz, yaw, hw: trunk ? Math.min(.8,f.w/2) : f.w / 2, hd: trunk ? Math.min(.8,f.d/2) : f.d / 2 };
    if (layoutVersion>=2 && list===layout.buildings && layout.parks.some(p=>{
      const xs=p.poly.map(v=>v.x),zs=p.poly.map(v=>v.z),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
      return obbOverlap(rect,{x:(minX+maxX)/2,z:(minZ+maxZ)/2,hw:(maxX-minX)/2,hd:(maxZ-minZ)/2,yaw:0},.7);
    })) return false;
    if (!dryFootprint(rect, at, (px, pz) => riverDistance(layout, px, pz))) return false;
    if (!free(rect, extra.pad ?? 0.6)) return false;
    claim(rect, extra.collide !== false);
    list.push({ ...extra, asset, x, z, yaw, w: f.w, d: f.d, h: extra.h, tint: extra.tint ?? 0.94 + rng() * 0.12, variant: extra.variant ?? Math.floor(rng() * 4) });
    return true;
  };

  // ------------------------------------------------------------ city plan
  planRivers(layout, byId, local, chaikin);
  const buildable = rect => dryFootprint(rect, at, (x, z) => riverDistance(layout, x, z));
  const K = { rng, noise, at, inCity, edgeRadius, addStreet, streetClear, place, claim, segs, free, fp, footprints, buildable };
  const torches = () =>
    scatterAlong(layout, ['main'], 26, (x, z, yaw) => {
      if (streetClear(x, z, 10) < 0.3) return;
      layout.props.push({ asset: 'f_lamp', x, z, yaw, w: 0.6, d: 0.6 });
      layout.colliders.push({ type: 'circle', x, z, r: 0.3 });
    }, { side: 4.2, rng });
  // v4: towns and cities are bisected into blocks; a small fantasy town stays a street village
  const village = isVillage(layout);
  if (layoutVersion >= 4 && !village && planBlocks(layout, K, blockPlanOptions(options))) {
    if (!modern) torches();
  } else if (modern && layoutVersion >= 2) planNeighbourhoods(layout, K, fillStreetFronts);
  else if (modern) planModern(layout, K);
  else if ((village && planVillage(layout, K, fillStreetFronts)) || planWards(layout, K, fillStreetFronts)) torches(); // torch posts along the arteries
  else planFantasy(layout, K);

  // Roads out of town to the edge of the disc, along the planet's route
  for (const e of exits) {
    const start = e.gate ? [e.gate.x, e.gate.z] : [Math.cos(e.angle) * edgeRadius(e.angle) * 0.92, Math.sin(e.angle) * edgeRadius(e.angle) * 0.92];
    const pts = [start, ...(e.via || [])];
    // Out to the painted far ground, so the road visibly carries on past the disc
    const reach = 1050;
    const from = Math.hypot(...pts[pts.length - 1]);
    for (const p of e.path) {
      if (Math.hypot(p[0], p[1]) > reach) break;
      if (Math.hypot(p[0], p[1]) < from + 30) continue;
      pts.push(p);
    }
    const last = pts[pts.length - 1];
    if (Math.hypot(last[0], last[1]) < reach - 100) {
      const a = pts.length > 1 ? Math.atan2(last[1] - pts[pts.length - 2][1], last[0] - pts[pts.length - 2][0]) : e.angle;
      pts.push([last[0] + Math.cos(a) * (reach - Math.hypot(last[0], last[1])), last[1] + Math.sin(a) * (reach - Math.hypot(last[0], last[1]))]);
    }
    // Resample into a gentle curve
    const smoothPts = chaikin(chaikin(pts));
    e.road = addStreet(smoothPts, modern ? (layoutVersion >= 3 ? 8 : 10) : 5.5, 'road');
  }

  planBridges(layout);
  planSurroundings(layout, { rng: mulberry32(seedFor(seed, 'surroundings')), noise, at, place, streetClear, claim, free, local, modern, planetType, detail, addStreet });
  for (const b of layout.buildings) b.id = buildingId(seed, b);
  planTownGreenery(layout, K);
  planStreetLights(layout, K);
  planRoofs(layout);
  clearDoorApproaches(layout, footprints);
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

function planFantasy(L, { rng, noise, at, inCity, edgeRadius, addStreet, streetClear, place, claim, free, fp }) {
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
  fillStreetFronts(L, { rng, inCity, streetClear, place, typeAt, cityTh: 0.5, list: L.buildings, kinds: ['main', 'ring', 'lane'], fp });

  // Back plots: houses, trees and sheds where no street reaches
  for (let i = 0; i < 180 + L.size * 70; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * L.cityR;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (!inCity(x, z, 0.55) || streetClear(x, z, 16) < 5) continue;
    if (rng() < 0.4) {
      const garden = [['t_oak', 0], ['t_fruit', 0], ['t_fruit', 1], ['t_birch', 0]][Math.floor(rng() * 4)];
      if (place(L.trees, garden[0], x, z, rng() * 6, 3.2, 3.2, { pad: 0.2, collide: false, variant: garden[1] })) {
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
function fillStreetFronts(L, { rng, inCity, streetClear, place, typeAt, cityTh, list, kinds, fp }) {
  // Density option: a sparse town leaves some frontage as gardens, a dense one
  // packs houses closer. At 1 no extra random numbers are drawn (original towns).
  const density = L.options?.density ?? 1;
  const pad = density > 1 ? 0.15 : 0.35;
  const garden = () => density < 1 && rng() < (1 - density) * 1.6;
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
          const [asset, w0, d0] = typeAt(Math.hypot(ax + dx * t, az + dz * t), ax + dx*t, az + dz*t);
          const { w, d, front } = fp(asset, w0, d0);
          // The model's front face sits a pavement's width from the street edge
          const off = s.w / 2 + (L.layoutVersion >= 3 ? pavementWidth(L) + 0.5 : 1.1) + front;
          const x = ax + dx * t - dz * off * side;
          const z = az + dz * t + dx * off * side;
          // Frontage along the street, front (+Z) facing it
          const yaw = Math.atan2(-dz * side, -dx * side);
          if (inCity(x, z, cityTh) && streetClear(x, z, 24, s) > d / 2 + 0.8 && !garden()) {
            place(list, asset, x, z, yaw, w, d, { pad });
          }
          t += frontStep(L, w, 0.5, rng() * 1.6);
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

function planModern(L, K) {
  const { rng, at, inCity, addStreet, streetClear, place, claim } = K;
  // Regional access anchors the district; bounded warping and unequal blocks
  // keep modern street hierarchy without reproducing the medieval grammar.
  const axis = L.exits.length ? L.exits[0].angle : rng() * Math.PI;
  const ca = Math.cos(axis);
  const sa = Math.sin(axis);
  const pitch = L.size <= 2 ? 50 : 62; // road centre to road centre
  const phase=rng()*6.28;
  const toWorld = (u,v) => {
    const a=u+Math.sin(u/pitch*1.7+phase)*pitch*.12+Math.sin(v/(pitch*3)+phase)*pitch*.15;
    const b=v+Math.sin(v/pitch*1.3+phase+2)*pitch*.12;
    return [a*ca-b*sa,a*sa+b*ca];
  };
  const road = 12;
  const n = Math.ceil((L.cityR + pitch) / pitch);
  const lineInCity = (u0, v0, u1, v1, w, kind) => {
    let run = [];
    const steps = Math.ceil(Math.hypot(u1 - u0, v1 - v0) / 8);
    for (let i = 0; i <= steps; i++) {
      const u = u0 + ((u1 - u0) * i) / steps;
      const v = v0 + ((v1 - v0) * i) / steps;
      const [x, z] = toWorld(u, v);
      if (inCity(x, z, 0.42) && at(x,z).land>.58) run.push([x, z]);
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
  L.grid = { axis, pitch, road, organic:true, junctions:[] };
  for(let i=-n;i<=n;i++)for(let j=-n;j<=n;j++){
    const [x,z]=toWorld((i-.5)*pitch,(j-.5)*pitch);
    if(inCity(x,z,.5)&&at(x,z).land>.8)L.grid.junctions.push({x,z,w:i===0||j===0?18:road});
  }

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
          place(L.trees, 't_cypress', tx, tz, rng() * 6, 4, 4, { collide: false, variant: 0 });
        }
        continue;
      }
      if (rng() < 0.1 && ring > 0) {
        const half=inner*.45;
        const poly=[[-half,-half],[half,-half],[half,half],[-half,half]].map(([u,v])=>{const p=toWorld(i*pitch+u,j*pitch+v);return{x:p[0],z:p[1]};});
        L.parks.push({x,z,poly,style:'public'});
        continue;
      }
      // Downtown towers stand alone; other blocks are lined around their edge,
      // every building facing its street, sized by its real footprint
      const t = Math.hypot(x, z) / Math.max(80, L.cityR);
      const downtown = L.capital || L.size >= 3;
      if (downtown && ring === 1 && rng() < 0.7) {
        place(L.buildings, rng() < 0.5 ? 'm_tower_a' : 'm_tower_b', x, z, yaw + Math.floor(rng() * 4) * (Math.PI / 2), 30, 30, { pad: 0.5 });
        continue;
      }
      // Zoning: offices and towers downtown, then shops and flats, then
      // houses with gardens; blocks on the water are the port's warehouses
      const nearWater = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([du, dv]) => {
        const [wx, wz] = toWorld(i * pitch + du * pitch * 0.6, j * pitch + dv * pitch * 0.6);
        return at(wx, wz).land < 0.5;
      });
      const zone = nearWater && ring > 1 ? 'industrial' : (downtown && ring <= 2) || t < 0.35 ? 'cbd' : t < 0.6 ? 'commercial' : t < 0.85 ? 'residential' : 'suburb';
      // Block corners (CCW) in world space; every edge faces a street
      const half = inner / 2;
      const block = [[-half, -half], [half, -half], [half, half], [-half, half]].map(([du, dv]) => {
        const [bx, bz] = toWorld(i * pitch + du, j * pitch + dv);
        return { x: bx, z: bz, e: -1 };
      });
      fillBlock(L, block, zone, K, { setback: 1.2, keep: (bx, bz) => inCity(bx, bz, 0.45) && at(bx, bz).land > 0.6 });
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
    if (place(L.trees, 't_birch', x, z, rng() * 6, 3, 3, { collide: false, pad: 0.1, variant: 0 })) L.colliders.push({ type: 'circle', x, z, r: 0.6 });
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

function planSurroundings(L, { rng, noise, at, place, streetClear, claim, free, local, modern, planetType, detail, addStreet }) {
  const flora = { ice: 'snow', desert: 'dry', lava: 'none', barren: 'none' }[planetType] || 'green';
  // Farmland: long plots with crop rows in their own direction
  const fields = [];
  // Ward-planned towns: the countryside cells near town (and on farm tiles) are
  // cut into parallel strips, each its own crop, with a barn by the road
  const S0 = {};
  for (const c of L.farmCells || []) {
    const s = at(c.x, c.z, S0);
    const fertile = s.land > 0.8 && s.forest < 0.4 && s.mountain < 0.3 && s.desert < 0.5 && s.tundra < 0.5;
    if (!fertile || !(s.farm > 0.25 || (c.nearTown && rng() < 0.65))) continue;
    if (riverDistance(L, c.x, c.z) < 12) continue;
    const dry = (f) => {
      // Every corner and the middle on dry land, away from rivers
      const ca = Math.cos(f.yaw);
      const sa = Math.sin(f.yaw);
      return [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1]].every(([u, v]) => {
        const x = f.x + (u * f.w * ca - v * f.d * sa) / 2;
        const z = f.z + (u * f.w * sa + v * f.d * ca) / 2;
        return at(x, z, S0).land > 0.78 && riverDistance(L, x, z) > 4;
      });
    };
    const strips = farmStrips(c, rng).filter((f) => streetClear(f.x, f.z, 40) > Math.min(f.w, f.d) / 2 + 3 && dry(f));
    fields.push(...strips);
    if (strips.length && rng() < 0.55) {
      const f = strips[0];
      const bx = f.x + Math.cos(f.yaw) * (f.w / 2 + 9);
      const bz = f.z + Math.sin(f.yaw) * (f.w / 2 + 9);
      if (streetClear(bx, bz, 20) > 6) place(L.buildings, rng() < 0.8 ? 'barn' : 'windmill', bx, bz, f.yaw + Math.PI / 2, 14, 10);
    }
  }
  // v3 villages: crofts and furlongs square to the street, laid out by the plan
  for (const f of L.crofts || []) fields.push(f);
  for (const t of L.farmCells ? [] : local) {
    if (!t.farm || t.city || Math.hypot(t.x, t.z) > L.dioramaR - 60) continue;
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
  L.fields2 = fields.filter(f => {
    const rect = { x: f.x, z: f.z, hw: f.w / 2, hd: f.d / 2, yaw: f.yaw };
    if (!free(rect, 1) || !dryFootprint(rect, at, (x, z) => riverDistance(L, x, z), 4)) return false;
    if (!footprintSamples(rect).every(p => streetClear(p.x, p.z, 8) > 2)) return false;
    claim(rect, false);
    return true;
  });
  // v3: hedgerows and fences bound the fields (their own random stream)
  if (L.layoutVersion >= 3) planHedgerows(L, { rng: mulberry32(seedFor(L.seed, 'hedgerows')), place, at, streetClear, flora });

  // Trees in clumps, flower patches, rock groups
  const S = {};

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
    const dockRect = { x:d.x,z:d.z,yaw:d.a-Math.PI/2,hw:modern?3.5:2,hd:modern?17:11 };
    if (!free(dockRect, 2)) continue;
    claim(dockRect, false);
    L.docks.push({ asset: modern ? 'm_dock' : 'f_dock', x: d.x, z: d.z, yaw: d.a - Math.PI / 2, len: modern ? 34 : 22 });
    if (L.layoutVersion >= 4) connectDock(L, d, modern ? 34 : 22, { at, addStreet });
    for(const along of [-.25,.25]){
      const x=d.x+Math.cos(d.a)*along*(modern?34:22)-Math.sin(d.a)*(modern?2.3:1.1);
      const z=d.z+Math.sin(d.a)*along*(modern?34:22)+Math.cos(d.a)*(modern?2.3:1.1);
      L.props.push({asset:'g_crate',x,z,yaw:d.a,w:1.2,d:1.2,variant:0,tint:1,deck:true});
      L.colliders.push({type:'box',x,z,hw:.6,hd:.6,yaw:d.a});
    }
    const bx = d.x + Math.cos(d.a) * (modern ? 26 : 16) + Math.cos(d.a + Math.PI / 2) * 8;
    const bz = d.z + Math.sin(d.a) * (modern ? 26 : 16) + Math.sin(d.a + Math.PI / 2) * 8;
    const shipRect = { x:bx,z:bz,yaw:d.a,hw:modern?5:2.5,hd:modern?20:6 };
    if (footprintSamples(shipRect).every(p=>at(p.x,p.z).land<0.45)) L.props.push({ asset: modern ? 'container_ship' : 'boat', x: bx, z: bz, yaw: d.a, w: modern ? 10 : 5, d: modern ? 40 : 12, floating: true });
  }
  L.isPort = L.docks.length > 0;
  planVegetation(L, { rng: mulberry32(seedFor(L.seed, 'vegetation')), noise, at, place, streetClear, fields: L.fields2, flora, detail });
}

/**
 * v4: a harbour is reached by road. From the landward end of the dock a quay road runs to
 * the nearest street (cars and walkers can get there); skipped when water or a building is in the way.
 */
function connectDock(L, d, len, { at, addStreet }) {
  const land = [d.x - Math.cos(d.a) * len * 0.5, d.z - Math.sin(d.a) * len * 0.5];
  const inland = [-Math.cos(d.a), -Math.sin(d.a)];
  const inside = (o, x, z) => {
    const c = Math.cos(o.yaw), s = Math.sin(o.yaw), dx = x - o.x, dz = z - o.z;
    return Math.abs(dx * c + dz * s) < o.w / 2 + 1 && Math.abs(-dx * s + dz * c) < o.d / 2 + 1;
  };
  // A leg is usable when it stays on land (after the beach at the dock) and clear of buildings
  const clear = (a, b, beach) => {
    const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3));
    for (let i = 1; i < n; i++) {
      const x = a[0] + ((b[0] - a[0]) * i) / n;
      const z = a[1] + ((b[1] - a[1]) * i) / n;
      if ((!beach || i / n > 0.15) && at(x, z).land < 0.45) return false;
      if (L.buildings.some((o) => inside(o, x, z))) return false;
    }
    return true;
  };
  // The nearest point of every street segment, closest first
  const targets = [];
  for (const s of L.streets) {
    for (let i = 0; i + 1 < s.pts.length; i++) {
      const [ax, az] = s.pts[i];
      const [bx, bz] = s.pts[i + 1];
      const dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((land[0] - ax) * dx + (land[1] - az) * dz) / (dx * dx + dz * dz || 1)));
      const p = [ax + dx * t, az + dz * t];
      targets.push({ p, dist: Math.hypot(p[0] - land[0], p[1] - land[1]) });
    }
  }
  targets.sort((a, b) => a.dist - b.dist);
  if (!targets.length || targets[0].dist < 3) return;
  for (const { p, dist } of targets.slice(0, 40)) {
    if (dist > 140) break;
    // Straight to the street, or first a stretch inland from the dock, then across
    const quay = (pts) => Object.assign(addStreet(pts, L.modern ? 8 : 4.6, L.modern ? 'road' : 'lane'), { quay: true });
    if (clear(land, p, true)) return quay([land, p]);
    for (const k of [12, 22, 34]) {
      const corner = [land[0] + inland[0] * k, land[1] + inland[1] * k];
      if (clear(land, corner, true) && clear(corner, p, false)) return quay([land, corner, p]);
    }
  }
}

// ---------------------------------------------------------------- navigation graphs

/** Source polylines; the pedestrian network splits these at real junctions. */
function buildGraphs(L) {
  const walk = [];
  const drive = [];
  for (const s of L.streets) {
    const line = s.pts.map(([x, z]) => ({ x, z }));
    walk.push({ pts: line, w: s.w, kind: 'street', id: `street:${walk.length}` });
    // v3 streets are narrower, so what cars use follows the street's role
    const drivable = L.layoutVersion >= 3 ? (L.modern ? ['main', 'collector', 'road'] : ['main', 'road']).includes(s.kind) : s.w >= (L.modern ? 10 : 5.5);
    if (drivable) drive.push({ pts: line, w: s.w });
  }
  for(const path of L.paths||[])walk.push({pts:path.pts.map(([x,z])=>({x,z})),w:path.w,kind:path.kind,id:path.id});
  L.walkGraph = walk;
  L.driveGraph = drive;
}

export { smooth, segDist2 };
