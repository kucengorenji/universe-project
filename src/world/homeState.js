import { buildingId, seedFor } from './identity.js';
import { describeBuilding, localToTown, townToLocal } from './buildingBlueprint.js';
import { pavementWidth } from '../modes/town/scale.js';
import { riverDistance } from '../modes/town/layout/townPlan.js';

const copy = value => structuredClone(value);
const validPolygon = poly => Array.isArray(poly) && poly.length >= 3 && poly.every(p => Number.isFinite(p.x) && Number.isFinite(p.z));
const rectPoints = ({ minX, maxX, minZ, maxZ }) => [
  { x: minX, z: minZ }, { x: maxX, z: minZ }, { x: maxX, z: maxZ }, { x: minX, z: maxZ }
];
const asPoints = poly => (poly || []).map(p => Array.isArray(p) ? { x: p[0], z: p[1] } : { x: p.x, z: p.z });
const obstaclePoints = obstacle => Array.isArray(obstacle) ? obstacle : obstacle.points || obstacle.polygon || rectPoints(obstacle);

export function homeKey(planet, city, homeId) { return `home:${planet}:${city}:${homeId}`; }

export function loadHomeRecord(state, { planet, city, home }) {
  return state.get(homeKey(planet, city, home));
}

export function listTownHomes(state, planet, city) {
  const prefix = `home:${planet}:${city}:`;
  return [...state.records.keys()].filter(key => key.startsWith(prefix)).map(key => state.get(key)).filter(Boolean);
}

export function ensureHomeRecord(state, { planet, city, townSeed, layoutSeed, layoutVersion, building, plot, obstacles = [] }) {
  const id = building.id || buildingId(layoutSeed, building);
  const key = homeKey(planet, city, id);
  const existing = state.get(key);
  if (existing) return existing;
  const spec = describeBuilding({ ...building, id });
  const w = spec?.footprint.w || building.w || 8, d = spec?.footprint.d || building.d || 8;
  const record = {
    schemaVersion: 1, id, planet, city, townSeed, layoutSeed, layoutVersion,
    buildingId: id, seed: seedFor(layoutSeed, id, 'home'),
    origin: { x: building.x, z: building.z, yaw: building.yaw },
    source: { asset: building.asset, w, d, floors: Math.min(3, spec?.floors || 2) },
    plot: validPolygon(plot) ? copy(plot) : rectPoints({ minX: -w / 2 - 2, maxX: w / 2 + 2, minZ: -d / 2 - 5, maxZ: d / 2 + 1 }),
    obstacles: copy(obstacles), draft: null, applied: null
  };
  state.set(key, record);
  return copy(record);
}

function requireHome(state, route) {
  const record = loadHomeRecord(state, route);
  if (!record) throw new Error('Kavling rumah tidak ditemukan. Pilih rumah dari kota terlebih dahulu.');
  return record;
}

export function saveHomeDraft(state, route, blueprint) {
  const record = requireHome(state, route);
  record.draft = copy(blueprint);
  state.set(homeKey(route.planet, route.city, record.id), record);
  return copy(record);
}

export function applyHomeDraft(state, route, blueprint) {
  const record = requireHome(state, route);
  const bp = blueprint || record.draft;
  if (!bp || !validPolygon(bp.plot)) throw new Error('Pekarangan rumah belum valid.');
  if (record.obstacles.some(o => polygonsOverlap(bp.plot, obstaclePoints(o)))) throw new Error('Pekarangan mengambil jalan, kavling tetangga, atau lahan yang dilindungi.');
  const worldPlot = bp.plot.map(p => localToTown(record.origin, p));
  for (const neighbor of listTownHomes(state, route.planet, route.city)) {
    if (neighbor.id === record.id) continue;
    const other = (neighbor.applied?.plot || neighbor.plot).map(p => localToTown(neighbor.origin, p));
    if (polygonsOverlap(worldPlot, other)) throw new Error('Pekarangan bertabrakan dengan kavling rumah lain.');
  }
  record.draft = copy(bp);
  record.applied = copy(bp);
  record.plot = copy(bp.plot);
  state.set(homeKey(route.planet, route.city, record.id), record);
  return copy(record);
}

function inside(poly, point) {
  let yes = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    const cross = (b.x - a.x) * (point.z - a.z) - (b.z - a.z) * (point.x - a.x);
    if (Math.abs(cross) < 1e-8 && point.x >= Math.min(a.x, b.x) - 1e-8 && point.x <= Math.max(a.x, b.x) + 1e-8 && point.z >= Math.min(a.z, b.z) - 1e-8 && point.z <= Math.max(a.z, b.z) + 1e-8) return false;
    if ((a.z > point.z) !== (b.z > point.z) && point.x < (b.x - a.x) * (point.z - a.z) / (b.z - a.z) + a.x) yes = !yes;
  }
  return yes;
}

export function polygonsOverlap(a, b) {
  if (!validPolygon(a) || !validPolygon(b)) return false;
  const cross = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    const p = a[i], q = a[(i + 1) % a.length], r = b[j], s = b[(j + 1) % b.length];
    if (cross(p, q, r) * cross(p, q, s) < -1e-9 && cross(r, s, p) * cross(r, s, q) < -1e-9) return true;
  }
  // Centroids also catch identical rectangles and coincident edges; touching a boundary is allowed.
  const center = poly => poly.reduce((sum, p) => ({ x: sum.x + p.x / poly.length, z: sum.z + p.z / poly.length }), { x: 0, z: 0 });
  const ca = center(a), cb = center(b);
  const cornerProbes = poly => poly.map((p, i) => {
    const previous = poly[(i + poly.length - 1) % poly.length], next = poly[(i + 1) % poly.length];
    return { x: p.x + (previous.x + next.x - 2 * p.x) * 1e-5, z: p.z + (previous.z + next.z - 2 * p.z) * 1e-5 };
  });
  return a.some(p => inside(b, p)) || b.some(p => inside(a, p)) ||
    (inside(a, ca) && inside(b, ca)) || (inside(b, cb) && inside(a, cb)) ||
    [...cornerProbes(a), ...cornerProbes(b)].some(p => inside(a, p) && inside(b, p));
}

function assetBounds(building, footprints) {
  const f = footprints[building.asset];
  const sx = building.sx ?? 1, sz = building.sz ?? 1;
  return f ? { minX: f.minX * sx, maxX: f.maxX * sx, minZ: f.minZ * sz, maxZ: f.maxZ * sz } :
    { minX: -building.w / 2, maxX: building.w / 2, minZ: -building.d / 2, maxZ: building.d / 2 };
}

/** Protect the current town geometry; new claims never regenerate or move its streets and neighbors. */
export function townHomeContext(layout, building, footprints = {}, homes = []) {
  const obstacles = [];
  const limit = 40;
  const base = assetBounds(building, footprints);
  const own = rectPoints(base);
  const local = point => townToLocal(building, point);
  const add = (kind, id, worldPoints) => {
    const points = worldPoints.map(local);
    if (points.every(p => p.x < -limit - 8) || points.every(p => p.x > limit + 8) || points.every(p => p.z < -limit - 8) || points.every(p => p.z > limit + 8)) return;
    obstacles.push({ kind, id, points });
  };
  for (const other of layout.buildings) {
    if (other.id === building.id) continue;
    const f = assetBounds(other, footprints);
    let parcel = rectPoints({ minX: f.minX - .15, maxX: f.maxX + .15, minZ: f.minZ - 3, maxZ: f.maxZ + .15 });
    // A shared narrow courtyard cannot create a reservation through an existing shell.
    if (polygonsOverlap(own, parcel.map(p => local(localToTown(other, p))))) parcel = rectPoints(f);
    add('neighbor-plot', other.id, parcel.map(p => localToTown(other, p)));
  }
  for (const home of homes) {
    if (home.buildingId === building.id) continue;
    add('home-claim', home.id, (home.applied?.plot || home.plot).map(p => localToTown(home.origin, p)));
  }
  const lines = [...(layout.streets || []), ...(layout.paths || [])];
  lines.forEach((line, index) => {
    const pts = asPoints(line.pts);
    const half = (line.w || 1.2) / 2 + ((layout.streets || []).includes(line) ? pavementWidth(layout) : .3);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], distance = Math.hypot(b.x - a.x, b.z - a.z);
      if (!distance) continue;
      const nx = -(b.z - a.z) / distance * half, nz = (b.x - a.x) / distance * half;
      add('road', `road:${index}:${i}`, [{ x: a.x + nx, z: a.z + nz }, { x: b.x + nx, z: b.z + nz }, { x: b.x - nx, z: b.z - nz }, { x: a.x - nx, z: a.z - nz }]);
    }
  });
  (layout.parks || []).forEach((park, i) => add('park', `park:${i}`, asPoints(park.poly)));
  if (layout.plaza?.poly) add('plaza', 'plaza', asPoints(layout.plaza.poly));
  else if (layout.plaza) {
    const p = layout.plaza;
    add('plaza', 'plaza', rectPoints({ minX: p.x - p.r, maxX: p.x + p.r, minZ: p.z - p.r, maxZ: p.z + p.r }));
  }
  for (const field of layout.fields2 || []) {
    add('farm', `farm:${field.x}:${field.z}`, rectPoints({ minX: -field.w / 2, maxX: field.w / 2, minZ: -field.d / 2, maxZ: field.d / 2 }).map(p => localToTown(field, p)));
  }
  for (const prop of [...(layout.walls || []), ...(layout.docks || []), ...(layout.props || []).filter(p => !p.parked)]) {
    const w = prop.len || prop.w || .8, d = prop.d || prop.w || .8;
    if (!Number.isFinite(prop.x + prop.z)) continue;
    add('facility', `${prop.asset}:${prop.x}:${prop.z}`, rectPoints({ minX: -w / 2 - .2, maxX: w / 2 + .2, minZ: -d / 2 - .2, maxZ: d / 2 + .2 }).map(p => localToTown({ ...prop, yaw: prop.yaw || 0 }, p)));
  }
  const dry = p => {
    const world = localToTown(building, p);
    return (!layout.fields || layout.fields.sample(world.x, world.z).land >= .72) && riverDistance(layout, world.x, world.z) >= 2;
  };
  // The local grid also records coasts/rivers where no explicit polygon exists in the town data.
  for (let x = -limit; x < limit; x += 3) for (let z = -limit; z < limit; z += 3) {
    const points = rectPoints({ minX: x, maxX: x + 3, minZ: z, maxZ: z + 3 });
    if (!points.every(dry) && !polygonsOverlap(points, own)) obstacles.push({ kind: 'water', id: `water:${x}:${z}`, points });
  }
  for (const bounds of [
    { minX: -limit - 1000, maxX: -limit, minZ: -limit - 1000, maxZ: limit + 1000 },
    { minX: limit, maxX: limit + 1000, minZ: -limit - 1000, maxZ: limit + 1000 },
    { minX: -limit, maxX: limit, minZ: -limit - 1000, maxZ: -limit },
    { minX: -limit, maxX: limit, minZ: limit, maxZ: limit + 1000 }
  ]) obstacles.push({ kind: 'boundary', id: `boundary:${obstacles.length}`, points: rectPoints(bounds) });
  let bounds = { ...base };
  const allowed = candidate => {
    const points = rectPoints(candidate);
    if (obstacles.some(o => polygonsOverlap(points, o.points))) return false;
    for (let x = candidate.minX; x <= candidate.maxX; x += 2) for (let z = candidate.minZ; z <= candidate.maxZ; z += 2) if (!dry({ x, z })) return false;
    return points.every(dry);
  };
  // Existing decorative props can sit beneath an old roof's eaves. Start with a
  // smaller safe rectangle rather than creating a draft whose plot cannot be applied.
  for (let pass = 0; pass < 12 && !allowed(bounds); pass++) {
    const collisions = obstacles.filter(o => polygonsOverlap(rectPoints(bounds), o.points));
    const candidates = [];
    for (const obstacle of collisions) {
      const xs = obstacle.points.map(p => p.x), zs = obstacle.points.map(p => p.z);
      candidates.push(
        { ...bounds, minX: Math.max(bounds.minX, Math.max(...xs) + .1) },
        { ...bounds, maxX: Math.min(bounds.maxX, Math.min(...xs) - .1) },
        { ...bounds, minZ: Math.max(bounds.minZ, Math.max(...zs) + .1) },
        { ...bounds, maxZ: Math.min(bounds.maxZ, Math.min(...zs) - .1) }
      );
    }
    const fit = candidates.filter(b => b.maxX - b.minX >= 4.6 && b.maxZ - b.minZ >= 4.8)
      .map(b => ({ b, hits: obstacles.filter(o => polygonsOverlap(rectPoints(b), o.points)).length, area: (b.maxX - b.minX) * (b.maxZ - b.minZ) }))
      .sort((a, b) => a.hits - b.hits || b.area - a.area)[0];
    if (!fit || fit.hits >= collisions.length) break;
    bounds = fit.b;
  }
  // Preserve a fitting shell on a narrow street, grow each side only into available space.
  for (const [key, direction, max] of [['minZ', -1, 10], ['minX', -1, 5], ['maxX', 1, 5], ['maxZ', 1, 3]]) {
    for (let growth = .5; growth <= max; growth += .5) {
      const next = { ...bounds, [key]: bounds[key] + direction * .5 };
      if (!allowed(next)) break;
      bounds = next;
    }
  }
  return { plot: rectPoints(bounds), obstacles, unavailable: !allowed(bounds) };
}
