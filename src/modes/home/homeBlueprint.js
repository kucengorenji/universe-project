import { t as tr } from '../../i18n/index.js';
/** The editable, deterministic source of truth for a procedural home (metres, y-up). */
export const HOME_STYLES = {
  classic: { get label() { return tr('home.style.classic'); }, palette: { wall: '#d4ac82', trim: '#f4e5c9', roof: '#ab614e', wood: '#826044', floor: '#b99166', garden: '#769358' } },
  cottage: { get label() { return tr('home.style.cottage'); }, palette: { wall: '#dacdb0', trim: '#f5efd7', roof: '#77716c', wood: '#795b42', floor: '#bea17a', garden: '#718d5d' } },
  tropical: { get label() { return tr('home.style.tropical'); }, palette: { wall: '#ede0c5', trim: '#f7f0df', roof: '#63736d', wood: '#946b45', floor: '#d2bd96', garden: '#557f58' } },
};

/** Size order is width, height, depth. Support bounds intentionally stay simple. */
export const HOME_CATALOG = {
  sofa: { get label() { return tr('home.item.sofa'); }, size: [2.05, .95, .88], surface: 'floor' },
  chair: { get label() { return tr('home.item.chair'); }, size: [.48, .90, .50], surface: 'floor' },
  table: { get label() { return tr('home.item.table'); }, size: [1.40, .78, .85], surface: 'floor', supports: true },
  bed: { get label() { return tr('home.item.bed'); }, size: [1.60, .95, 2.15], surface: 'floor' },
  wardrobe: { get label() { return tr('home.item.wardrobe'); }, size: [1.05, 1.95, .58], surface: 'floor', supports: true },
  shelf: { get label() { return tr('home.item.shelf'); }, size: [.90, 1.70, .32], surface: 'floor', supports: true },
  kitchen: { get label() { return tr('home.item.kitchen'); }, size: [1.85, .95, .64], surface: 'floor', supports: true },
  sink: { get label() { return tr('home.item.sink'); }, size: [.64, .92, .50], surface: 'floor' },
  toilet: { get label() { return tr('home.item.toilet'); }, size: [.40, .82, .70], surface: 'floor' },
  bath: { get label() { return tr('home.item.bath'); }, size: [1.70, .64, .76], surface: 'floor' },
  lamp: { get label() { return tr('home.item.lamp'); }, size: [.45, 1.65, .45], surface: 'floor' },
  rug: { get label() { return tr('home.item.rug'); }, size: [1.90, .04, 1.40], surface: 'floor', collision: false },
  plant: { get label() { return tr('home.item.plant'); }, size: [.65, .95, .65], surface: 'floor' },
  picture: { get label() { return tr('home.item.picture'); }, size: [.70, .52, .08], surface: 'wall', collision: false },
  bench: { get label() { return tr('home.item.bench'); }, size: [1.40, .85, .52], surface: 'floor' },
  planter: { get label() { return tr('home.item.planter'); }, size: [.60, .75, .60], surface: 'floor', supports: true },
  vase: { get label() { return tr('home.item.vase'); }, size: [.18, .26, .18], surface: 'surface' },
};

const EPS = 1e-6;
const clone = value => JSON.parse(JSON.stringify(value));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = (v, grid = .1) => Math.round(v / grid) * grid;
const rect = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
const length = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
const cross = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
const signedArea = points => points.reduce((sum, a, i) => { const b = points[(i + 1) % points.length]; return sum + a.x * b.z - b.x * a.z; }, 0) / 2;
const hash = text => { let h = 2166136261; for (const c of String(text)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
function random(seed) { let h = hash(seed); return () => { h += 0x6D2B79F5; let n = h; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; }; }
function bounds(points) {
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
  const minZ = Math.min(...points.map(p => p.z)), maxZ = Math.max(...points.map(p => p.z));
  return { minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ, center: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 } };
}
function onSegment(p, a, b) { return Math.abs(cross(a, b, p)) < EPS && p.x >= Math.min(a.x, b.x) - EPS && p.x <= Math.max(a.x, b.x) + EPS && p.z >= Math.min(a.z, b.z) - EPS && p.z <= Math.max(a.z, b.z) + EPS; }
export function pointInPolygon(point, points) {
  if (!points?.length || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j], b = points[i];
    if (onSegment(point, a, b)) return true;
    if ((a.z > point.z) !== (b.z > point.z) && point.x < (b.x - a.x) * (point.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
function segmentsIntersect(a, b, c, d, proper = false) {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  if (((abC > EPS && abD < -EPS) || (abC < -EPS && abD > EPS)) && ((cdA > EPS && cdB < -EPS) || (cdA < -EPS && cdB > EPS))) return true;
  return !proper && (onSegment(c, a, b) || onSegment(d, a, b) || onSegment(a, c, d) || onSegment(b, c, d));
}
function selfIntersects(points) {
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
    if (segmentsIntersect(points[i], points[(i + 1) % points.length], points[j], points[(j + 1) % points.length])) return true;
  }
  return false;
}
function insidePolygon(points, container) {
  if (!points.every(p => pointInPolygon(p, container))) return false;
  // Corners alone are insufficient for concave plot/room boundaries.
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    for (const t of [.25, .5, .75]) if (!pointInPolygon({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, container)) return false;
    for (let j = 0; j < container.length; j++) if (segmentsIntersect(a, b, container[j], container[(j + 1) % container.length], true)) return false;
  }
  return true;
}
function polygonsOverlap(a, b) {
  if (a.some(p => pointInPolygon(p, b)) || b.some(p => pointInPolygon(p, a))) return true;
  return a.some((p, i) => b.some((q, j) => segmentsIntersect(p, a[(i + 1) % a.length], q, b[(j + 1) % b.length])));
}

/** Tessellate quadratic wall edges; all render/collision consumers use this outline. */
export function sampleRoom(room, curveSegments = 16) {
  const points = [];
  for (let i = 0; i < room.points.length; i++) {
    const a = room.points[i], b = room.points[(i + 1) % room.points.length], c = room.curves?.[i];
    points.push({ ...a });
    if (c) for (let n = 1; n < curveSegments; n++) { const t = n / curveSegments, u = 1 - t; points.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, z: u * u * a.z + 2 * u * t * c.z + t * t * b.z }); }
  }
  return points;
}

export function footprintBounds(bp) { return bounds(bp.floors[0].rooms.flatMap(room => sampleRoom(room))); }
export function roomAt(bp, x, z, floorId = bp.floors[0]?.id) { return bp.floors.find(f => f.id === floorId)?.rooms.find(room => pointInPolygon({ x, z }, sampleRoom(room))) || null; }

/** A silhouette extracted from the union of room boundaries. Internal shared edges cancel. */
export function deriveFloorOutline(floor) {
  const edges = new Map(), key = p => `${p.x.toFixed(5)},${p.z.toFixed(5)}`;
  for (const room of floor.rooms) { const pts = sampleRoom(room); if (signedArea(pts) < 0) pts.reverse(); for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], reverse = `${key(b)}|${key(a)}`, forward = `${key(a)}|${key(b)}`;
    if (edges.has(reverse)) edges.delete(reverse); else edges.set(forward, { a, b });
  } }
  if (!edges.size) return [];
  // Rooms may share a partial edge. Remove pieces covered by another room interior.
  for (const [k, edge] of edges) { const dx = edge.b.x - edge.a.x, dz = edge.b.z - edge.a.z, len = Math.hypot(dx, dz); const p = { x: (edge.a.x + edge.b.x) / 2 + dz / len * .001, z: (edge.a.z + edge.b.z) / 2 - dx / len * .001 }; if (floor.rooms.some(room => pointInPolygon(p, sampleRoom(room)))) edges.delete(k); }
  const unused = [...edges.values()], paths = [];
  while (unused.length) {
    const edge = unused.shift(), path = [edge.a], start = key(edge.a); let end = edge.b;
    for (let guard = 0; guard < 1000; guard++) { path.push(end); if (key(end) === start) break; const i = unused.findIndex(e => key(e.a) === key(end)); if (i === -1) break; end = unused.splice(i, 1)[0].b; }
    if (key(path[path.length - 1]) === start) path.pop(); paths.push(path);
  }
  return paths.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))[0] || [];
}

export function openingTransform(bp, opening) {
  const floor = bp.floors.find(f => f.id === opening.floorId), room = floor?.rooms.find(r => r.id === opening.roomId);
  if (!room) return null;
  const a = room.points[opening.edge], b = room.points[(opening.edge + 1) % room.points.length], c = room.curves?.[opening.edge], t = opening.t;
  if (!a || !b) return null;
  const x = c ? (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t * t * b.x : a.x + (b.x - a.x) * t;
  const z = c ? (1 - t) ** 2 * a.z + 2 * (1 - t) * t * c.z + t * t * b.z : a.z + (b.z - a.z) * t;
  const dx = c ? 2 * (1 - t) * (c.x - a.x) + 2 * t * (b.x - c.x) : b.x - a.x;
  const dz = c ? 2 * (1 - t) * (c.z - a.z) + 2 * t * (b.z - c.z) : b.z - a.z;
  const len = Math.hypot(dx, dz);
  const orientation = signedArea(sampleRoom(room)) < 0 ? -1 : 1;
  return { x, z, y: floor.elevation + opening.sill, dx: dx / len, dz: dz / len, normal: { x: -dz / len * orientation, z: dx / len * orientation }, floorId: floor.id };
}

function orientedRect(x, z, width, depth, rotation = 0) {
  const c = Math.cos(rotation), s = Math.sin(rotation);
  return [[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2]].map(([px, pz]) => ({ x: x + px * c + pz * s, z: z - px * s + pz * c }));
}
export function itemFootprint(item, clearance = 0) { const cat = HOME_CATALOG[item.type]; return orientedRect(item.position.x, item.position.z, cat.size[0] + clearance, cat.size[2] + clearance, item.rotation || 0); }
function rectanglesOverlap(a, b) {
  if (!a?.length || !b?.length) return false;
  // Separating-axis test; touching bounds are allowed.
  for (const pts of [a, b]) for (let i = 0; i < 2; i++) { const e = { x: pts[i + 1].x - pts[i].x, z: pts[i + 1].z - pts[i].z }, axis = { x: -e.z, z: e.x }; const project = p => p.x * axis.x + p.z * axis.z; const pa = a.map(project), pb = b.map(project); if (Math.max(...pa) <= Math.min(...pb) + EPS || Math.max(...pb) <= Math.min(...pa) + EPS) return false; }
  return true;
}
function doorClearance(bp, opening) { const t = openingTransform(bp, opening); return t && orientedRect(t.x + t.normal.x * .15, t.z + t.normal.z * .15, opening.width + .20, 1.50, Math.atan2(t.normal.x, t.normal.z)); }
function allItems(bp) { return [...bp.items, ...bp.yard.items]; }
function obstaclePolygon(obstacle) { if (Array.isArray(obstacle)) return obstacle; if (obstacle.points || obstacle.polygon) return obstacle.points || obstacle.polygon; if (Number.isFinite(obstacle.minX)) return rect(obstacle.minX, obstacle.minZ, obstacle.maxX, obstacle.maxZ); if (Number.isFinite(obstacle.width)) return orientedRect(obstacle.x ?? obstacle.center?.x ?? 0, obstacle.z ?? obstacle.center?.z ?? 0, obstacle.width, obstacle.depth, obstacle.rotation || 0); return null; }

function placementIssue(bp, item, options = {}) {
  const cat = HOME_CATALOG[item.type]; if (!cat) return tr('home.err.noType');
  if (!Object.values(item.position).every(Number.isFinite) || !Number.isFinite(item.rotation)) return tr('home.err.badPosition');
  const shape = itemFootprint(item), floor = bp.floors.find(f => f.id === item.floorId);
  if (item.floorId === 'yard') {
    if (!insidePolygon(shape, bp.plot)) return tr('home.err.crossesPlot');
    if (bp.floors[0].rooms.some(room => polygonsOverlap(shape, sampleRoom(room)))) return tr('home.err.yardThroughHouse');
    const entry = bp.openings.find(o => o.kind === 'door' && o.exterior);
    if (entry) { const t = openingTransform(bp, entry), approach = orientedRect(t.x - t.normal.x, t.z - t.normal.z, entry.width + .5, 2, Math.atan2(t.normal.x, t.normal.z)); if (rectanglesOverlap(shape, approach)) return tr('home.err.blocksEntrance'); }
  } else {
    if (!floor) return tr('home.err.noFloor');
    const room = floor.rooms.find(r => insidePolygon(shape, sampleRoom(r)));
    if (!room) return tr('home.err.outsideRoom');
    if (item.position.y < floor.elevation - EPS || item.position.y + cat.size[1] > floor.elevation + floor.height + EPS) return tr('home.err.tooTall');
    if (cat.surface === 'floor' && Math.abs(item.position.y - floor.elevation) > .01) return tr('home.err.needsFloor');
    if (cat.surface === 'surface') {
      const support = allItems(bp).find(i => i.id === item.anchor?.targetId);
      if (!support || !HOME_CATALOG[support.type]?.supports || !insidePolygon(shape, itemFootprint(support)) || Math.abs(item.position.y - support.position.y - HOME_CATALOG[support.type].size[1]) > .01) return tr('home.err.needsSurface');
    }
    if (cat.surface === 'wall' && item.anchor?.kind !== 'wall') return tr('home.err.needsWall');
    if (cat.collision !== false) {
      if (bp.openings.some(o => o.floorId === item.floorId && o.kind === 'door' && rectanglesOverlap(shape, doorClearance(bp, o)))) return tr('home.err.blocksDoor');
      if (bp.stairs.some(s => (s.fromFloorId === item.floorId || s.toFloorId === item.floorId) && rectanglesOverlap(shape, orientedRect(s.x, s.z, s.width + .15, s.depth + .5)))) return tr('home.err.blocksStairs');
    }
  }
  if (cat.collision !== false) for (const other of allItems(bp)) {
    if (other.id === item.id || other.floorId !== item.floorId || HOME_CATALOG[other.type]?.collision === false || other.id === item.anchor?.targetId) continue;
    const otherCat = HOME_CATALOG[other.type]; if (!otherCat) continue;
    if (item.position.y + cat.size[1] <= other.position.y + EPS || other.position.y + otherCat.size[1] <= item.position.y + EPS) continue;
    if (rectanglesOverlap(shape, itemFootprint(other))) return tr('home.err.collides');
  }
  for (const obstacle of options.obstacles || []) { const polygon = obstaclePolygon(obstacle); if (polygon && polygonsOverlap(shape, polygon)) return tr('home.err.takesRoad'); }
  return null;
}

function nearestWall(floor, position) {
  let best = null;
  for (const room of floor.rooms) { const pts = sampleRoom(room), orientation = signedArea(pts) < 0 ? -1 : 1; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz, t = clamp(((position.x - a.x) * dx + (position.z - a.z) * dz) / len2, .12, .88); const x = a.x + dx * t, z = a.z + dz * t, d = Math.hypot(position.x - x, position.z - z); if (!best || d < best.distance) best = { distance: d, x, z, normal: { x: -dz / Math.sqrt(len2) * orientation, z: dx / Math.sqrt(len2) * orientation }, roomId: room.id }; } }
  return best;
}

/** Returns a new blueprint on success; failures preserve the original object and transform. */
export function placeHomeItem(bp, itemId, transform, options = {}) {
  const original = allItems(bp).find(item => item.id === itemId); if (!original) return { ok: false, blueprint: bp, reason: tr('home.err.noItem') };
  const cat = HOME_CATALOG[original.type], floor = bp.floors.find(f => f.id === original.floorId);
  const position = { ...original.position, ...Object.fromEntries(['x', 'y', 'z'].filter(k => transform[k] !== undefined).map(k => [k, transform[k]])) };
  if (!Object.values(position).every(Number.isFinite)) return { ok: false, blueprint: bp, reason: tr('home.err.badPosition') };
  position.x = round(position.x, .05); position.z = round(position.z, .05);
  let rotation = round(transform.rotation ?? original.rotation ?? 0, Math.PI / 12), anchor;
  if (cat.surface === 'wall') {
    if (!floor) return { ok: false, blueprint: bp, reason: tr('home.err.decorNeedsRoom') };
    const wall = nearestWall(floor, position); if (!wall) return { ok: false, blueprint: bp, reason: tr('home.err.noWall') };
    position.x = wall.x + wall.normal.x * (cat.size[2] / 2 + .025); position.z = wall.z + wall.normal.z * (cat.size[2] / 2 + .025);
    position.y = clamp(position.y || floor.elevation + 1.4, floor.elevation + .35, floor.elevation + floor.height - cat.size[1] - .1);
    rotation = Math.atan2(wall.normal.x, wall.normal.z); anchor = { kind: 'wall', targetId: wall.roomId };
  } else if (cat.surface === 'surface') {
    const support = allItems(bp).filter(i => i.id !== original.id && i.floorId === original.floorId && HOME_CATALOG[i.type]?.supports && pointInPolygon(position, itemFootprint(i))).sort((a, b) => b.position.y + HOME_CATALOG[b.type].size[1] - a.position.y - HOME_CATALOG[a.type].size[1])[0];
    if (!support) return { ok: false, blueprint: bp, reason: tr('home.err.pickSurface') };
    position.y = support.position.y + HOME_CATALOG[support.type].size[1]; anchor = { kind: 'surface', targetId: support.id };
  } else { position.y = floor?.elevation || 0; anchor = { kind: 'floor', targetId: roomAt(bp, position.x, position.z, original.floorId)?.id || 'yard' }; }
  const item = { ...original, position, rotation, anchor, authored: options.authored !== false };
  const reason = placementIssue(bp, item, options); if (reason) return { ok: false, blueprint: bp, reason };
  const next = clone(bp), target = original.floorId === 'yard' ? next.yard.items : next.items; target[target.findIndex(i => i.id === itemId)] = item;
  return { ok: true, blueprint: next, reason: null };
}

function findPlacement(bp, item, room, rng = () => .5) {
  const b = room ? bounds(sampleRoom(room)) : bounds(bp.plot), dx = Math.max(.2, (b.width - .5) / 7), dz = Math.max(.2, (b.depth - .5) / 7);
  const candidates = [{ ...b.center, weight: rng() }];
  for (let ix = 0; ix < 8; ix++) for (let iz = 0; iz < 8; iz++) candidates.push({ x: b.minX + .25 + ix * dx, z: b.minZ + .25 + iz * dz, weight: rng() });
  // A nearly full-depth bed needs a centred z even when its x must move away
  // from the door; a centre-only candidate cannot handle that narrow-room case.
  for (let i = 0; i < 8; i++) { candidates.push({ x: b.minX + .25 + i * dx, z: b.center.z, weight: rng() }); candidates.push({ x: b.center.x, z: b.minZ + .25 + i * dz, weight: rng() }); }
  candidates.sort((a, b) => a.weight - b.weight);
  // Retry all quadrants with four orientations, so small rooms remain furnished.
  for (const point of candidates) for (const rotation of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const candidate = { ...item, position: { x: round(point.x, .05), z: round(point.z, .05), y: bp.floors.find(f => f.id === item.floorId)?.elevation || 0 }, rotation, anchor: { kind: 'floor', targetId: room?.id || 'yard' } };
    const shape = itemFootprint(candidate); if (room && !insidePolygon(shape, sampleRoom(room))) continue;
    if (!placementIssue(bp, candidate)) return candidate;
  }
  return null;
}

export function addHomeItem(bp, type, floorId = bp.floors[0].id) {
  if (!HOME_CATALOG[type] || (floorId !== 'yard' && !bp.floors.some(f => f.id === floorId))) return bp;
  const next = clone(bp), sequence = (bp.nextItemId || 0) + 1; next.nextItemId = sequence;
  const item = { id: `${bp.id}:manual:${sequence}`, type, floorId, position: { x: 0, y: 0, z: 0 }, rotation: 0, authored: true, anchor: { kind: 'floor' } };
  const rooms = floorId === 'yard' ? [null] : next.floors.find(f => f.id === floorId).rooms;
  let placed = null;
  if (HOME_CATALOG[type].surface === 'surface') {
    for (const support of allItems(next).filter(i => i.floorId === floorId && HOME_CATALOG[i.type]?.supports)) { const temp = clone(next); temp.items.push(item); const result = placeHomeItem(temp, item.id, support.position); if (result.ok) { placed = result.blueprint.items.find(i => i.id === item.id); break; } }
  } else if (HOME_CATALOG[type].surface === 'wall') {
    for (const room of rooms.filter(Boolean)) { const temp = clone(next); temp.items.push(item); const b = bounds(sampleRoom(room)); const result = placeHomeItem(temp, item.id, { x: b.center.x, z: b.minZ, y: next.floors.find(f => f.id === floorId).elevation + 1.4 }); if (result.ok) { placed = result.blueprint.items.find(i => i.id === item.id); break; } }
  } else for (const room of rooms) { placed = findPlacement(next, item, room); if (placed) break; }
  if (!placed) return bp;
  (floorId === 'yard' ? next.yard.items : next.items).push(placed); return next;
}

function makeRooms(id, floorIndex, params) {
  const { x0, x1, z0, z1, hall, split, shape } = params, cx = (x0 + x1) / 2, xl = cx - hall / 2, xr = cx + hall / 2;
  const types = floorIndex === 0 ? ['bedroom', 'bathroom', 'living', 'kitchen'] : ['bedroom', 'bathroom', 'bedroom', floorIndex > 2 ? 'loft' : 'study'];
  // A central corridor makes both wings unusably thin on row-house lots. A side
  // corridor keeps full-size furniture and four room functions inside a 5m plot.
  if (x1 - x0 < 6.2) {
    const hx = x1 - hall, breaks = [z0, z0 + (z1 - z0) / 4, (z0 + z1) / 2, z0 + (z1 - z0) * .75, z1];
    const narrow = ['back-left', 'back-right', 'front-left', 'front-right'].map((slot, i) => ({ slot, type: types[i], points: rect(x0, breaks[i], hx, breaks[i + 1]) }));
    if (shape === 'angled') narrow[0].points.splice(0, 1, { x: x0, z: z0 + .35 }, { x: x0 + .35, z: z0 });
    if (shape === 'curved') narrow[2].curves = { 3: { x: x0 - params.curveDepth, z: (breaks[2] + breaks[3]) / 2 } };
    narrow.push({ slot: 'hall', type: 'hall', points: [{ x: hx, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: hx, z: z1 }, ...breaks.slice(1, -1).reverse().map(z => ({ x: hx, z }))] });
    return narrow.map(r => ({ id: `${id}:floor:${floorIndex}:room:${r.slot}`, type: r.type, points: r.points, ...(r.curves ? { curves: r.curves } : {}), authored: false }));
  }
  const rooms = [
    { slot: 'back-left', type: types[0], points: rect(x0, z0, xl, split) },
    { slot: 'back-right', type: types[1], points: rect(xr, z0, x1, split) },
    { slot: 'front-left', type: types[2], points: rect(x0, split, xl, z1) },
    { slot: 'front-right', type: types[3], points: rect(xr, split, x1, z1) },
    // Split long hallway edges at the room divider to keep the outline union exact.
    { slot: 'hall', type: 'hall', points: [{ x: xl, z: z0 }, { x: xr, z: z0 }, { x: xr, z: split }, { x: xr, z: z1 }, { x: xl, z: z1 }, { x: xl, z: split }] },
  ];
  if (shape === 'angled') { const r = rooms[1]; r.points.splice(1, 1, { x: x1 - .65, z: z0 }, { x: x1, z: z0 + .65 }); }
  if (shape === 'curved') { const r = rooms[2]; r.curves = { 3: { x: x0 - params.curveDepth, z: (split + z1) / 2 } }; }
  return rooms.map(room => ({ id: `${id}:floor:${floorIndex}:room:${room.slot}`, type: room.type, points: room.points, ...(room.curves ? { curves: room.curves } : {}), authored: false }));
}

export function regenerateOpenings(bp) {
  const openings = [];
  for (const floor of bp.floors) for (const room of floor.rooms) {
    if (room.type === 'hall') {
      const entryEdge = room.points.reduce((best, a, i) => { const b = room.points[(i + 1) % room.points.length], score = Math.abs(a.z - b.z) < EPS ? (a.z + b.z) / 2 : -Infinity; return !best || score > best.score ? { edge: i, score } : best; }, null).edge;
      if (floor.index === 0) openings.push({ id: `${room.id}:entry`, floorId: floor.id, roomId: room.id, edge: entryEdge, t: .5, width: Math.min(1.05, length(room.points[entryEdge], room.points[(entryEdge + 1) % room.points.length]) - .1), height: 2.15, sill: 0, kind: 'door', exterior: true });
      continue;
    }
    const center = bounds(room.points).center, hall = floor.rooms.find(r => r.type === 'hall'), hc = bounds(hall?.points || room.points).center;
    const doorEdge = room.points.reduce((best, a, i) => { const b = room.points[(i + 1) % room.points.length]; const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2; const score = Math.abs(mx - hc.x) + Math.abs(mz - center.z) * .05; return !best || score < best.score ? { edge: i, score } : best; }, null).edge;
    const windowEdge = room.points.reduce((best, a, i) => { const b = room.points[(i + 1) % room.points.length], score = Math.abs((a.x + b.x) / 2 - hc.x); return !best || score > best.score ? { edge: i, score } : best; }, null).edge;
    openings.push({ id: `${room.id}:door`, floorId: floor.id, roomId: room.id, edge: doorEdge, t: .5, width: .85, height: 2.05, sill: 0, kind: 'door', exterior: false });
    openings.push({ id: `${room.id}:window`, floorId: floor.id, roomId: room.id, edge: windowEdge, t: .5, width: Math.min(1.3, length(room.points[windowEdge], room.points[(windowEdge + 1) % room.points.length]) * .5), height: 1.25, sill: .9, kind: 'window', exterior: true });
  }
  // Add a front/back facade window only when the edge really borders outdoors.
  // Existing side windows stay stable, and ground-hall glazing never cuts into
  // the entry door. This also handles narrow houses with a side corridor.
  for (const floor of bp.floors) for (const room of floor.rooms) {
    const orientation = signedArea(sampleRoom(room)) < 0 ? -1 : 1;
    const candidates = room.points.map((a, edge) => {
      const b = room.points[(edge + 1) % room.points.length], control = room.curves?.[edge], dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
      if (len < 1.1 || Math.abs(dx) < Math.abs(dz) * .95) return null;
      if (openings.some(o => o.floorId === floor.id && o.roomId === room.id && o.edge === edge)) return null;
      const centre = control ? { x: (a.x + b.x) * .25 + control.x * .5, z: (a.z + b.z) * .25 + control.z * .5 } : { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      const outside = { x: centre.x + dz / len * .15 * orientation, z: centre.z - dx / len * .15 * orientation };
      if (floor.rooms.some(r => pointInPolygon(outside, sampleRoom(r)))) return null;
      return { edge, len, score: centre.z };
    }).filter(Boolean).sort((a, b) => b.score - a.score);
    if (candidates.length) { const edge = candidates[0]; openings.push({ id: `${room.id}:facade-window`, floorId: floor.id, roomId: room.id, edge: edge.edge, t: .5, width: Math.min(1.3, edge.len * .55), height: 1.15, sill: 1, kind: 'window', exterior: true }); }
  }
  return openings.filter(opening => {
    if (opening.kind !== 'window' || !opening.exterior || opening.authored) return true;
    const socket = openingTransform(bp, opening), floor = bp.floors.find(f => f.id === opening.floorId);
    if (!socket || !floor) return false;
    return [-.48, 0, .48].every(fraction => {
      const outside = { x: socket.x + socket.dx * opening.width * fraction - socket.normal.x * .15, z: socket.z + socket.dz * opening.width * fraction - socket.normal.z * .15 };
      return !floor.rooms.some(room => room.id !== opening.roomId && pointInPolygon(outside, sampleRoom(room)));
    });
  });
}

export function createHomeBlueprint({ id = 'home', seed = '1', style = 'classic', floors = 2, attic = true, plot = null, shape = null } = {}) {
  if (!HOME_STYLES[style]) style = 'classic';
  const rng = random(`${seed}:layout`), outline = clone(plot || rect(-8, -7, 8, 10)), pb = bounds(outline);
  const width = Math.max(2, Math.min(10.3 + rng() * .8, pb.width - .5)), depth = Math.max(2, Math.min(8.5 + rng() * .7, pb.depth - 1.2));
  let cx = clamp(0, pb.minX + width / 2 + .20, pb.maxX - width / 2 - .20), cz = clamp(0, pb.minZ + depth / 2 + .45, pb.maxZ - depth / 2 - .45);
  let fitScale = 1;
  // Find an actual usable region in a concave plot. Its bounding-box centre may
  // lie outside the plot, so shrinking at that point alone cannot produce a home.
  const centres = [{ x: cx, z: cz }, pb.center];
  for (let ix = 1; ix < 10; ix++) for (let iz = 1; iz < 10; iz++) centres.push({ x: pb.minX + pb.width * ix / 10, z: pb.minZ + pb.depth * iz / 10 });
  centres.sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz));
  let fitted = null;
  for (; fitScale >= .3 && !fitted; fitScale -= .05) {
    for (const centre of centres) if (insidePolygon(rect(centre.x - width * fitScale / 2 - .12, centre.z - depth * fitScale / 2 - .12, centre.x + width * fitScale / 2 + .12, centre.z + depth * fitScale / 2 + .12), outline)) { fitted = { ...centre, scale: fitScale }; break; }
  }
  if (fitted) { cx = fitted.x; cz = fitted.z; fitScale = fitted.scale; }
  else { cx = pb.center.x; cz = pb.center.z; fitScale = .3; }
  // A stacked staircase needs a real route around its side on every upper floor.
  // 1.6m corridors with 0.8m stairs retain two 0.4m bypass strips on row-house lots.
  const hw = width * fitScale / 2, hd = depth * fitScale / 2, hall = Math.min(2.8, Math.max(1.6, width * fitScale * .23));
  const layoutShape = shape || ['rectangle', 'angled', 'curved'][hash(`${seed}:shape`) % 3];
  const params = { x0: cx - hw, x1: cx + hw, z0: cz - hd, z1: cz + hd, hall, split: cz + (rng() - .5) * .7, shape: layoutShape, curveDepth: Math.min(.75, width * fitScale * .08, Math.max(0, 2 * (cx - hw - pb.minX - .04))) };
  const count = clamp(Math.round(Number(floors) || 1), 1, 3), floorList = [];
  for (let i = 0; i < count + (attic ? 1 : 0); i++) floorList.push({ id: `${id}:floor:${i}`, index: i, elevation: i * 2.85, height: i === count ? 2.5 : 2.85, isAttic: i === count, authored: false, rooms: makeRooms(id, i, params) });
  const bp = { schemaVersion: 1, generatorVersion: 1, id, seed: String(seed), style, layout: params, plot: outline, floors: floorList, roof: { rise: style === 'tropical' ? 1.2 : 2.5 + rng() * .5, overhang: .38, ridgeOffset: 0, authored: false }, openings: [], stairs: [], items: [], yard: { zones: [], items: [] }, nextItemId: 0, variation: 0 };
  bp.openings = regenerateOpenings(bp);
  const hallCenter = bounds(floorList[0].rooms.find(r => r.type === 'hall').points).center;
  for (let i = 0; i < floorList.length - 1; i++) bp.stairs.push({ id: `${id}:stairs:${i}`, fromFloorId: floorList[i].id, toFloorId: floorList[i + 1].id, x: hallCenter.x, z: cz - .4, width: hall < 1.8 ? .8 : 1, depth: Math.min(3.3, hd * 1.1) });
  const furnishing = { bedroom: ['bed', 'wardrobe', 'rug', 'lamp'], bathroom: ['bath', 'toilet', 'sink'], living: ['sofa', 'table', 'chair', 'rug', 'lamp', 'plant'], kitchen: ['kitchen', 'sink', 'table', 'chair'], study: ['table', 'chair', 'shelf', 'plant'], loft: ['shelf', 'chair', 'rug'] };
  for (const floor of floorList) for (const room of floor.rooms) {
    const types = furnishing[room.type] || [];
    for (let slot = 0; slot < types.length; slot++) { const type = types[slot], item = { id: `${room.id}:item:${slot}`, type, floorId: floor.id, position: { x: 0, y: floor.elevation, z: 0 }, rotation: 0, authored: false, anchor: { kind: 'floor', targetId: room.id } }; const placed = findPlacement(bp, item, room, random(`${seed}:${room.id}:${slot}`)); if (placed) bp.items.push(placed); }
  }
  const entry = openingTransform(bp, bp.openings.find(o => o.exterior && o.kind === 'door'));
  if (entry) { const endZ = Math.min(pb.maxZ - .3, entry.z + 3); const path = rect(entry.x - .65, entry.z + .1, entry.x + .65, endZ); if (insidePolygon(path, outline)) bp.yard.zones.push({ id: `${id}:yard:path`, type: 'path', points: path, authored: false }); }
  const garden = rect(pb.minX + .35, pb.maxZ - 2.5, pb.maxX - .35, pb.maxZ - .35); if (insidePolygon(garden, outline)) bp.yard.zones.push({ id: `${id}:yard:garden`, type: 'garden', points: garden, authored: false });
  for (const [slot, type] of ['bench', 'planter', 'plant', 'planter', 'plant', 'plant'].entries()) { const item = { id: `${id}:yard:item:${slot}`, type, floorId: 'yard', position: { x: 0, y: 0, z: 0 }, rotation: 0, authored: false, anchor: { kind: 'floor', targetId: 'yard' } }; const placed = findPlacement(bp, item, null, random(`${seed}:garden:${slot}`)); if (placed) bp.yard.items.push(placed); }
  return bp;
}

export function varyHomeBlueprint(bp) {
  const variation = (bp.variation || 0) + 1, baseSeed = bp.baseSeed ?? bp.seed;
  const next = createHomeBlueprint({ id: bp.id, seed: `${baseSeed}:v${variation}`, style: bp.style, floors: bp.floors.filter(f => !f.isAttic).length, attic: bp.floors.some(f => f.isAttic), plot: bp.plot, shape: bp.layout?.shape });
  next.baseSeed = baseSeed; next.variation = variation; next.nextItemId = bp.nextItemId || 0;
  // Fixed manual anchors constrain their structural dependencies. Changing the envelope
  // beneath a hand-placed sofa would preserve its transform but still destroy the edit.
  const protectedLayout = bp.floors.some(f => f.authored || f.rooms.some(r => r.authored)) || allItems(bp).some(i => i.authored) || bp.yard.zones.some(z => z.authored);
  if (protectedLayout) { next.floors = clone(bp.floors); next.layout = clone(bp.layout); next.stairs = clone(bp.stairs); }
  if (bp.roof.authored) next.roof = clone(bp.roof);
  next.openings = regenerateOpenings(next);
  for (const opening of bp.openings.filter(o => o.authored)) { const i = next.openings.findIndex(o => o.id === opening.id); if (i >= 0) next.openings[i] = clone(opening); else next.openings.push(clone(opening)); }
  for (const item of bp.items.filter(i => i.authored)) { const i = next.items.findIndex(v => v.id === item.id); if (i >= 0) next.items[i] = clone(item); else next.items.push(clone(item)); }
  for (const item of bp.yard.items.filter(i => i.authored)) { const i = next.yard.items.findIndex(v => v.id === item.id); if (i >= 0) next.yard.items[i] = clone(item); else next.yard.items.push(clone(item)); }
  for (const zone of bp.yard.zones.filter(z => z.authored)) { const i = next.yard.zones.findIndex(v => v.id === zone.id); if (i >= 0) next.yard.zones[i] = clone(zone); else next.yard.zones.push(clone(zone)); }
  // Auto furniture adapts around preserved furniture; authored objects are never moved silently.
  next.deletedItemIds = [...(bp.deletedItemIds || [])];
  const generatedItems = next.items.filter(i => !i.authored && !next.deletedItemIds.includes(i.id)), generatedIds = new Set(generatedItems.map(i => i.id));
  // New authored rooms have generated furnishing slots outside the seed layout.
  // Keep those slots, then vary their positions along with other automatic items.
  if (protectedLayout) for (const item of bp.items) if (!item.authored && !generatedIds.has(item.id) && !next.deletedItemIds.includes(item.id) && next.floors.some(f => f.id === item.floorId && f.rooms.some(r => r.id === item.anchor?.targetId))) { generatedItems.push(clone(item)); generatedIds.add(item.id); }
  next.items = next.items.filter(i => i.authored);
  for (const item of generatedItems) { const room = next.floors.find(f => f.id === item.floorId)?.rooms.find(r => r.id === item.anchor?.targetId); if (!room) continue; const placed = findPlacement(next, item, room, random(`${next.seed}:${item.id}`)); if (placed) next.items.push(placed); }
  const generatedYard = next.yard.items.filter(i => !i.authored && !next.deletedItemIds.includes(i.id)); next.yard.items = next.yard.items.filter(i => i.authored);
  for (const item of generatedYard) { const placed = findPlacement(next, item, null, random(`${next.seed}:${item.id}`)); if (placed) next.yard.items.push(placed); }
  return next;
}

export function validateHomeBlueprint(bp, { obstacles = [] } = {}) {
  const issues = [], report = (code, message, elementId = null) => issues.push({ code, message, elementId });
  if (!bp || !Array.isArray(bp.plot) || !Array.isArray(bp.floors)) return { ok: false, valid: false, issues: [{ code: 'schema', message: tr('home.err.badBlueprint'), elementId: null }], errors: [tr('home.err.badBlueprint')] };
  if (bp.plot.length < 3 || Math.abs(signedArea(bp.plot)) < 1 || selfIntersects(bp.plot)) report('plot', tr('home.err.badPlot'));
  const ids = new Set();
  for (const element of [...bp.floors, ...bp.floors.flatMap(f => f.rooms), ...bp.openings, ...bp.stairs, ...allItems(bp), ...bp.yard.zones]) { if (ids.has(element.id)) report('id', tr('home.err.dupId'), element.id); ids.add(element.id); }
  for (const floor of bp.floors) {
    if (!Number.isFinite(floor.elevation) || !Number.isFinite(floor.height) || floor.height < 2) report('height', tr('home.err.floorHeight'), floor.id);
    for (const room of floor.rooms) { const pts = sampleRoom(room); if (pts.length < 3 || pts.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.z)) || Math.abs(signedArea(pts)) < .8 || selfIntersects(pts)) report('room-shape', tr('home.err.roomShape'), room.id); if (!insidePolygon(pts, bp.plot)) report('plot-boundary', tr('home.err.buildingCrossesPlot'), room.id); for (const obstacle of obstacles) { const p = obstaclePolygon(obstacle); if (p && polygonsOverlap(pts, p)) report('obstacle', tr('home.err.buildingTakesRoad'), room.id); } }
    for (let i = 0; i < floor.rooms.length; i++) for (let j = i + 1; j < floor.rooms.length; j++) { const a = sampleRoom(floor.rooms[i]), b = sampleRoom(floor.rooms[j]); if (a.some((p, k) => b.some((q, n) => segmentsIntersect(p, a[(k + 1) % a.length], q, b[(n + 1) % b.length], true))) || a.some(p => pointInPolygon(p, b) && !b.some((q, k) => onSegment(p, q, b[(k + 1) % b.length]))) || b.some(p => pointInPolygon(p, a) && !a.some((q, k) => onSegment(p, q, a[(k + 1) % a.length])))) report('room-overlap', tr('home.err.roomsOverlap'), floor.rooms[j].id); }
    const connections = new Map(floor.rooms.map(r => [r.id, new Set()]));
    for (const opening of bp.openings.filter(o => o.floorId === floor.id && o.kind === 'door' && !o.exterior)) { const t = openingTransform(bp, opening); if (!t) continue; const interior = roomAt(bp, t.x + t.normal.x * .1, t.z + t.normal.z * .1, floor.id), adjacent = roomAt(bp, t.x - t.normal.x * .1, t.z - t.normal.z * .1, floor.id); if (interior && adjacent && interior.id !== adjacent.id) { connections.get(interior.id)?.add(adjacent.id); connections.get(adjacent.id)?.add(interior.id); } else report('door-access', tr('home.err.doorConnects'), opening.id); }
    const rootRoom = floor.rooms.find(r => r.type === 'hall') || floor.rooms[0], reached = new Set(rootRoom ? [rootRoom.id] : []), queue = [...reached];
    while (queue.length) for (const id of connections.get(queue.shift()) || []) if (!reached.has(id)) { reached.add(id); queue.push(id); }
    for (const room of floor.rooms) if (!reached.has(room.id)) report('room-access', tr('home.err.roomAccess'), room.id);
  }
  for (const opening of bp.openings) { const floor = bp.floors.find(f => f.id === opening.floorId), room = floor?.rooms.find(r => r.id === opening.roomId), a = room?.points[opening.edge], b = room?.points[(opening.edge + 1) % room?.points.length]; if (!a || !b || opening.t < 0 || opening.t > 1 || opening.width <= 0 || opening.width > length(a, b) || opening.sill < 0 || opening.sill + opening.height > floor.height + EPS) report('opening', tr('home.err.openingFit'), opening.id); }
  for (let i = 1; i < bp.floors.length; i++) { const floor = bp.floors[i], previous = bp.floors[i - 1], stair = bp.stairs.find(s => s.fromFloorId === previous.id && s.toFloorId === floor.id); if (!stair) report('stairs', tr('home.err.needsStairs'), floor.id); else { const fp = orientedRect(stair.x, stair.z, stair.width, stair.depth); if (!previous.rooms.some(r => insidePolygon(fp, sampleRoom(r))) || !floor.rooms.some(r => insidePolygon(fp, sampleRoom(r)))) report('stairs', tr('home.err.stairsOutside'), stair.id); } if (Math.abs(floor.elevation - previous.elevation - previous.height) > .05) report('floor-gap', tr('home.err.elevation'), floor.id); }
  if (!bp.openings.some(o => o.kind === 'door' && o.exterior && o.floorId === bp.floors[0]?.id)) report('entry', tr('home.err.needsEntry'));
  if (![bp.roof.rise, bp.roof.overhang, bp.roof.ridgeOffset].every(Number.isFinite) || bp.roof.rise < .2 || bp.roof.overhang < 0 || bp.roof.overhang > 1.5 || Math.abs(bp.roof.ridgeOffset) >= footprintBounds(bp).width / 2) report('roof', tr('home.err.badRoof'));
  for (const item of allItems(bp)) { const reason = placementIssue(bp, item, { obstacles }); if (reason) report('placement', reason, item.id); }
  for (const zone of bp.yard.zones) if (zone.points.length < 3 || selfIntersects(zone.points) || !insidePolygon(zone.points, bp.plot)) report('yard', tr('home.err.badYardZone'), zone.id);
  return { ok: issues.length === 0, valid: issues.length === 0, issues, errors: issues.map(i => i.message) };
}

/** Structural edits retain affected furniture so validation can mark what needs repair. */
export function editHomeRoom(bp, roomId, changes) {
  const next = clone(bp), floor = next.floors.find(f => f.rooms.some(r => r.id === roomId)); if (!floor) return bp;
  const room = floor.rooms.find(r => r.id === roomId); Object.assign(room, clone(changes), { id: room.id, authored: true }); next.openings = regenerateOpenings(next); return next;
}
export function editHomeRoof(bp, changes) { const next = clone(bp); Object.assign(next.roof, changes, { authored: true }); return next; }
export function editHomeFloorHeight(bp, floorId, height) { const next = clone(bp), floor = next.floors.find(f => f.id === floorId); if (!floor) return bp; const delta = height - floor.height; floor.height = height; floor.authored = true; for (const f of next.floors.filter(f => f.index > floor.index)) { f.elevation += delta; for (const item of next.items.filter(i => i.floorId === f.id)) item.position.y += delta; } return next; }
export function removeHomeItem(bp, itemId) { const next = clone(bp), ids = allItems(bp).filter(i => i.id === itemId || i.anchor?.targetId === itemId).map(i => i.id); next.deletedItemIds = [...new Set([...(bp.deletedItemIds || []), ...ids])]; next.items = next.items.filter(i => !ids.includes(i.id)); next.yard.items = next.yard.items.filter(i => !ids.includes(i.id)); return next; }

function exposedLowerRoofRooms(bp) {
  const result = [];
  for (let i = 0; i < bp.floors.length - 1; i++) {
    const above = bp.floors.slice(i + 1).flatMap(f => f.rooms.map(room => sampleRoom(room)));
    for (const room of bp.floors[i].rooms) {
      const pts = sampleRoom(room), sign = signedArea(pts) < 0 ? -1 : 1, probes = [];
      for (let edge = 0; edge < pts.length; edge++) { const a = pts[edge], b = pts[(edge + 1) % pts.length], len = length(a, b); if (len < EPS) continue; for (const t of [.01, .5, .99]) probes.push({ x: a.x + (b.x - a.x) * t - (b.z - a.z) / len * .005 * sign, z: a.z + (b.z - a.z) * t + (b.x - a.x) / len * .005 * sign }); }
      if (probes.some(p => pointInPolygon(p, pts) && !above.some(poly => pointInPolygon(p, poly)))) result.push(room);
    }
  }
  return result;
}
function remapRoofSections(next, previous = next) {
  if (!next.roof.sections) return;
  const oldSections = previous.roof.sections || {}, oldRooms = previous.floors.flatMap(f => f.rooms), used = new Set(), previousTopIds = new Set(previous.floors.at(-1).rooms.map(r => r.id));
  const top = next.floors.at(-1), splitTop = Object.keys(oldSections).some(id => previousTopIds.has(id));
  const targets = [...(splitTop ? top.rooms : []), ...exposedLowerRoofRooms(next)], topIds = new Set(top.rooms.map(r => r.id));
  const semanticSlot = id => id.match(/:floor:\d+:room:(.+)$/)?.[1] || null;
  const sourceKeys = Object.keys(oldSections).sort((a, b) => Number(previousTopIds.has(b)) - Number(previousTopIds.has(a)));
  next.roof.sections = Object.fromEntries(targets.map(room => {
    let source = Object.keys(oldSections).find(id => id === room.id);
    if (!source && topIds.has(room.id)) source = sourceKeys.find(id => !used.has(id) && previousTopIds.has(id) && semanticSlot(id) && semanticSlot(id) === semanticSlot(room.id));
    if (!source && topIds.has(room.id)) source = sourceKeys.find(id => !used.has(id) && previousTopIds.has(id) && oldRooms.find(r => r.id === id)?.type === room.type);
    if (source) { used.add(source); return [room.id, clone(oldSections[source])]; }
    return [room.id, { rise: next.roof.rise, overhang: next.roof.overhang, ridgeOffset: 0, type: next.roof.type || 'gable', authored: false }];
  }));
}

/** Reconcile dependent data after a semantic edit without discarding manual work. */
export function reconcileHomeBlueprint(bp) {
  const next = clone(bp);
  remapRoofSections(next, bp);
  for (let i = 0; i < next.floors.length; i++) {
    const floor = next.floors[i], expected = i ? next.floors[i - 1].elevation + next.floors[i - 1].height : floor.elevation;
    const delta = expected - floor.elevation; floor.elevation = expected;
    if (Math.abs(delta) > EPS) for (const item of next.items.filter(item => item.floorId === floor.id)) item.position.y += delta;
  }
  const authoredOpenings = next.openings.filter(o => o.authored);
  next.openings = regenerateOpenings(next);
  for (const opening of authoredOpenings) { const i = next.openings.findIndex(o => o.id === opening.id); if (i >= 0) next.openings[i] = opening; else if (next.floors.some(f => f.id === opening.floorId && f.rooms.some(r => r.id === opening.roomId))) next.openings.push(opening); }
  next.stairs = next.stairs.filter(s => next.floors.some(f => f.id === s.fromFloorId) && next.floors.some(f => f.id === s.toFloorId));
  for (let i = 0; i < next.floors.length - 1; i++) {
    const from = next.floors[i], to = next.floors[i + 1], hall = from.rooms.find(r => r.type === 'hall') || from.rooms[0];
    if (!hall) continue;
    const b = bounds(sampleRoom(hall)), previous = next.stairs.find(s => s.fromFloorId === from.id && s.toFloorId === to.id);
    if (!previous) next.stairs.push({ id: `${bp.id}:stairs:${i}`, fromFloorId: from.id, toFloorId: to.id, x: b.center.x, z: b.center.z - .4, width: b.width < 1.8 ? .8 : 1, depth: Math.min(3.3, b.depth * .55) });
  }
  const b = footprintBounds(next); next.layout = { ...next.layout, x0: b.minX, x1: b.maxX, z0: b.minZ, z1: b.maxZ };
  return next;
}

/** Level count is an explicit transaction: remaining floor IDs, edits and furniture survive. */
export function editHomeLevels(bp, { floors = bp.floors.filter(f => !f.isAttic).length, attic = bp.floors.some(f => f.isAttic) } = {}) {
  const count = clamp(Math.round(Number(floors) || 1), 1, 3), fresh = createHomeBlueprint({ id: bp.id, seed: bp.seed, style: bp.style, floors: count, attic, plot: bp.plot, shape: bp.layout?.shape });
  const next = clone(bp), oldFloorIds = new Set(bp.floors.map(f => f.id));
  next.floors = fresh.floors.map(floor => {
    const old = bp.floors.find(f => f.id === floor.id); if (!old) return floor;
    const preserved = clone(old); preserved.isAttic = floor.isAttic;
    if (!preserved.authored && preserved.isAttic !== old.isAttic) preserved.height = floor.height;
    return preserved;
  });
  const ids = new Set(next.floors.map(f => f.id));
  next.items = next.items.filter(i => ids.has(i.floorId));
  next.items.push(...fresh.items.filter(i => !oldFloorIds.has(i.floorId)));
  remapRoofSections(next, bp);
  return reconcileHomeBlueprint(next);
}
