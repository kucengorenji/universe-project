import * as THREE from 'three';
import { deriveFloorOutline, sampleRoom, pointInPolygon } from './homeBlueprint.js';

const EPS = 1e-7;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const finite = (n, fallback) => Number.isFinite(n) ? n : fallback;
const cross = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
const area = pts => pts.reduce((sum, a, i) => { const b = pts[(i + 1) % pts.length]; return sum + a.x * b.z - b.x * a.z; }, 0) / 2;
const bounds = pts => {
  const minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x)), minZ = Math.min(...pts.map(p => p.z)), maxZ = Math.max(...pts.map(p => p.z));
  return { minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ };
};
function clean(points) {
  const result = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.z)).map(p => ({ x: p.x, z: p.z })).filter((p, i, pts) => !i || Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) > EPS);
  if (result.length > 1 && Math.hypot(result[0].x - result.at(-1).x, result[0].z - result.at(-1).z) < EPS) result.pop();
  if (area(result) < 0) result.reverse();
  return result;
}
function intersection(a, b, c, d) {
  const ax = b.x - a.x, az = b.z - a.z, bx = d.x - c.x, bz = d.z - c.z, denominator = ax * bz - az * bx;
  if (Math.abs(denominator) < EPS) return null;
  const cx = c.x - a.x, cz = c.z - a.z, t = (cx * bz - cz * bx) / denominator, u = (cx * az - cz * ax) / denominator;
  return { x: a.x + t * ax, z: a.z + t * az, t, u };
}
function simple(points) {
  for (let i = 0; i < points.length; i++) for (let j = i + 2; j < points.length; j++) {
    if (!i && j === points.length - 1) continue;
    const hit = intersection(points[i], points[(i + 1) % points.length], points[j], points[(j + 1) % points.length]);
    if (hit && hit.t > EPS && hit.t < 1 - EPS && hit.u > EPS && hit.u < 1 - EPS) return false;
  }
  return true;
}
/** Mitered planar overhang preserves concave corners instead of scaling a centroid. */
function offset(points, distance) {
  if (distance < EPS) return points.map(p => ({ ...p }));
  let amount = distance;
  for (let attempt = 0; attempt < 7; attempt++, amount *= .65) {
    const edges = points.map((a, i) => { const b = points[(i + 1) % points.length], dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz), nx = dz / len, nz = -dx / len; return { a: { x: a.x + nx * amount, z: a.z + nz * amount }, b: { x: b.x + nx * amount, z: b.z + nz * amount } }; });
    const outline = points.map((p, i) => {
      const previous = edges[(i + points.length - 1) % points.length], next = edges[i], hit = intersection(previous.a, previous.b, next.a, next.b);
      const candidate = hit || { x: (previous.b.x + next.a.x) / 2, z: (previous.b.z + next.a.z) / 2 };
      const len = Math.hypot(candidate.x - p.x, candidate.z - p.z), max = amount * 5;
      return len <= max ? { x: candidate.x, z: candidate.z } : { x: p.x + (candidate.x - p.x) / len * max, z: p.z + (candidate.z - p.z) / len * max };
    });
    if (area(outline) > EPS && simple(outline) && points.every(p => pointInPolygon(p, outline))) return outline;
  }
  return points.map(p => ({ ...p }));
}
function verticalIntervals(points, x) {
  const values = [];
  for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; if ((a.x <= x && b.x > x) || (b.x <= x && a.x > x)) values.push(a.z + (b.z - a.z) * (x - a.x) / (b.x - a.x)); }
  values.sort((a, b) => a - b);
  const intervals = []; for (let i = 0; i < values.length - 1; i += 2) if (values[i + 1] - values[i] > EPS) intervals.push([values[i], values[i + 1]]);
  return intervals;
}
function boundaryDistance(p, points) {
  let result = Infinity;
  for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length], dx = b.x - a.x, dz = b.z - a.z, t = clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz), 0, 1); result = Math.min(result, Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t)); }
  return result;
}
function interiorPeak(points, ridgeOffset) {
  const b = bounds(points), x = clamp((b.minX + b.maxX) / 2 + ridgeOffset, b.minX + b.width * .06, b.maxX - b.width * .06), intervals = verticalIntervals(points, x);
  if (intervals.length) { const longest = intervals.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0]; return { x, z: (longest[0] + longest[1]) / 2 }; }
  let best = points[0], score = -Infinity;
  for (let ix = 1; ix < 24; ix++) for (let iz = 1; iz < 24; iz++) { const p = { x: b.minX + b.width * ix / 24, z: b.minZ + b.depth * iz / 24 }; if (!pointInPolygon(p, points)) continue; const candidate = boundaryDistance(p, points) - Math.abs(p.x - x) * .4; if (candidate > score) { score = candidate; best = p; } }
  return best;
}
function clip(triangle, x, left) {
  const out = [];
  for (let i = 0; i < triangle.length; i++) { const a = triangle[i], b = triangle[(i + 1) % triangle.length], insideA = left ? a.x <= x + EPS : a.x >= x - EPS, insideB = left ? b.x <= x + EPS : b.x >= x - EPS; if (insideA) out.push(a); if (insideA !== insideB) { const t = (x - a.x) / (b.x - a.x); out.push({ x, z: a.z + (b.z - a.z) * t }); } }
  return out;
}
function barycentric(p, tri) {
  const [a, b, c] = tri, denominator = cross(a, b, c); if (Math.abs(denominator) < EPS) return null;
  const wa = cross(p, b, c) / denominator, wb = cross(a, p, c) / denominator, wc = 1 - wa - wb;
  return wa >= -EPS && wb >= -EPS && wc >= -EPS ? [wa, wb, wc] : null;
}
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
function refine(triangles, rounds = 2) {
  for (let i = 0; i < rounds; i++) triangles = triangles.flatMap(([a, b, c]) => { const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a); return [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]; });
  return triangles;
}
function triangulate(points) { return THREE.ShapeUtils.triangulateShape(points.map(p => new THREE.Vector2(p.x, p.z)), []).map(indices => indices.map(i => points[i])); }
function convex(points) { return points.every((p, i) => cross(p, points[(i + 1) % points.length], points[(i + 2) % points.length]) >= -EPS); }
function halfPlane(points, a, b, inside) {
  const out = [], value = p => cross(a, b, p) * (inside ? 1 : -1);
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length], vp = value(p), vq = value(q), keepP = vp >= -EPS, keepQ = vq >= -EPS;
    if (keepP) out.push(p);
    if (keepP !== keepQ) { const t = vp / (vp - vq), point = { x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t }; if (p.y !== undefined) point.y = p.y + (q.y - p.y) * t; out.push(point); }
  }
  return out.filter((p, i, pts) => !i || Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z, (p.y || 0) - (pts[i - 1].y || 0)) > EPS);
}
/** Subtract convex mask triangles without ever fanning across a concave notch. */
function subtract(polygons, masks) {
  for (const triangle of masks) {
    const mask = cross(...triangle) > 0 ? triangle : [triangle[0], triangle[2], triangle[1]], result = [];
    for (const polygon of polygons) {
      let inside = polygon;
      for (let edge = 0; edge < 3 && inside.length; edge++) { const a = mask[edge], b = mask[(edge + 1) % 3], outside = halfPlane(inside, a, b, false); if (outside.length >= 3) result.push(outside); inside = halfPlane(inside, a, b, true); }
    }
    polygons = result;
  }
  return polygons;
}
const fan = points => { const triangles = []; for (let i = 1; i < points.length - 1; i++) triangles.push([points[0], points[i], points[i + 1]]); return triangles; };
function visibleArea(points, masks) { return subtract(triangulate(points), masks).reduce((sum, polygon) => sum + Math.abs(area(polygon)), 0); }
function trimOutsideMask(segments, masks) {
  for (const triangle of masks) {
    const mask = cross(...triangle) > 0 ? triangle : [triangle[0], triangle[2], triangle[1]], result = [];
    for (const segment of segments) {
      let entry = 0, exit = 1, misses = false;
      for (let edge = 0; edge < 3; edge++) { const a = mask[edge], b = mask[(edge + 1) % 3], da = cross(a, b, segment.a), db = cross(a, b, segment.b);
        if (da < -EPS && db < -EPS) { misses = true; break; }
        if (da < -EPS) entry = Math.max(entry, da / (da - db));
        else if (db < -EPS) exit = Math.min(exit, da / (da - db));
      }
      const at = t => ({ x: segment.a.x + (segment.b.x - segment.a.x) * t, y: segment.a.y + (segment.b.y - segment.a.y) * t, z: segment.a.z + (segment.b.z - segment.a.z) * t });
      if (misses || exit - entry < EPS) result.push(segment);
      else { if (entry > EPS) result.push({ a: segment.a, b: at(entry) }); if (exit < 1 - EPS) result.push({ a: at(exit), b: segment.b }); }
    }
    segments = result;
  }
  return segments.filter(s => Math.hypot(s.a.x - s.b.x, s.a.y - s.b.y, s.a.z - s.b.z) > EPS);
}
function builder() {
  const positions = [], uv = [];
  return {
    triangle(a, b, c, coords = null, top = false) {
      if (new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z).cross(new THREE.Vector3(c.x - a.x, c.y - a.y, c.z - a.z)).lengthSq() < EPS * EPS) return;
      let vertices = [a, b, c], tex = coords || vertices.map(p => [p.x * .75, p.z * .75]);
      if (top && cross(a, b, c) > 0) { vertices = [a, c, b]; tex = [tex[0], tex[2], tex[1]]; }
      vertices.forEach((p, i) => { positions.push(p.x, p.y, p.z); uv.push(...tex[i]); });
    },
    geometry() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); g.computeBoundingBox(); return g; },
  };
}

function sectionRoof(points, parameters, y, id, roomId, topBuilder, gableBuilder, trimSegments, masks = [], floorId = null) {
  points = clean(points); if (points.length < 3 || Math.abs(area(points)) < EPS) return null;
  const roof = { rise: clamp(finite(parameters.rise, 2.5), .2, 8), overhang: clamp(finite(parameters.overhang, .3), 0, 1.5), ridgeOffset: finite(parameters.ridgeOffset, 0), type: ['gable', 'hip', 'cone'].includes(parameters.type) ? parameters.type : 'gable' };
  const outline = offset(points, roof.overhang), b = bounds(outline), peak = interiorPeak(points, roof.ridgeOffset), ridgeX = peak.x;
  let triangles = triangulate(outline), height;
  if (roof.type === 'gable') {
    height = p => y + roof.rise * clamp(p.x <= ridgeX ? (p.x - b.minX) / Math.max(EPS, ridgeX - b.minX) : (b.maxX - p.x) / Math.max(EPS, b.maxX - ridgeX), 0, 1);
    triangles = triangles.flatMap(tri => [true, false].flatMap(left => { const polygon = clip(tri, ridgeX, left), result = []; for (let i = 1; i < polygon.length - 1; i++) result.push([polygon[0], polygon[i], polygon[i + 1]]); return result; }));
  } else if (roof.type === 'cone' && convex(outline)) {
    // A fan is safe only for convex outlines; a concave roof keeps its triangulation.
    triangles = outline.map((p, i) => [p, outline[(i + 1) % outline.length], peak]);
    height = p => Math.hypot(p.x - peak.x, p.z - peak.z) < EPS ? y + roof.rise : y;
  } else {
    // Inserting the peak into every containing triangle also handles a peak on a
    // shared diagonal without leaving an unmatched edge or a crack in the roof.
    triangles = triangles.flatMap(tri => barycentric(peak, tri) ? [[tri[0], tri[1], peak], [tri[1], tri[2], peak], [tri[2], tri[0], peak]].filter(t => Math.abs(cross(...t)) > EPS) : [tri]);
    triangles = refine(triangles, 3);
    height = p => { const edge = boundaryDistance(p, outline), distance = Math.hypot(p.x - peak.x, p.z - peak.z); return y + roof.rise * edge / Math.max(EPS, edge + distance); };
  }
  const surface = triangles.filter(tri => Math.abs(cross(...tri)) > EPS).map(tri => tri.map(p => ({ ...p, y: height(p) })));
  const visible = masks.length ? subtract(surface, masks).flatMap(fan).filter(tri => Math.abs(cross(...tri)) > EPS) : surface;
  if (!visible.length) return null;
  for (const tri of visible) topBuilder.triangle(...tri, null, true);
  const actualHeight = p => { for (const triangle of surface) { const weights = barycentric(p, triangle); if (weights) return weights.reduce((sum, weight, i) => sum + weight * triangle[i].y, 0); } return y; };
  const splitEdge = (a, b, allTriangleEdges) => {
    const cuts = [0, 1];
    if (roof.type === 'gable' && (a.x - ridgeX) * (b.x - ridgeX) < -EPS) cuts.push((ridgeX - a.x) / (b.x - a.x));
    if (allTriangleEdges) for (const triangle of surface) for (let i = 0; i < 3; i++) { const hit = intersection(a, b, triangle[i], triangle[(i + 1) % 3]); if (hit && hit.t > EPS && hit.t < 1 - EPS && hit.u >= -EPS && hit.u <= 1 + EPS) cuts.push(hit.t); }
    const values = [...new Set(cuts.map(t => Math.round(t * 1e8) / 1e8))].sort((a, b) => a - b);
    return values.map(t => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }));
  };
  // Close the building at its wall perimeter; the overhang stays outside the wall.
  const localTrim = [], addGable = (tri, coords) => {
    if (!masks.length) { gableBuilder.triangle(...tri, coords); return; }
    // Vertical infill can also cross a higher floor; clip it in projection and
    // keep its interpolated y so the roof joins the upper wall cleanly.
    for (const polygon of subtract([tri], masks)) for (const piece of fan(polygon)) gableBuilder.triangle(...piece, piece.map(p => [p.x * .75 + p.z * .75, (p.y - y) * .75]));
  };
  let run = 0;
  for (let i = 0; i < points.length; i++) {
    const edge = splitEdge(points[i], points[(i + 1) % points.length], roof.type !== 'gable');
    for (let j = 0; j < edge.length - 1; j++) { const a = edge[j], b = edge[j + 1], aTop = { ...a, y: actualHeight(a) }, bTop = { ...b, y: actualHeight(b) }, aBase = { ...a, y }, bBase = { ...b, y }, len = Math.hypot(b.x - a.x, b.z - a.z), u = run * .75, v = (run + len) * .75;
      addGable([aBase, aTop, bTop], [[u, 0], [u, (aTop.y - y) * .75], [v, (bTop.y - y) * .75]]);
      addGable([aBase, bTop, bBase], [[u, 0], [v, (bTop.y - y) * .75], [v, 0]]); run += len;
    }
  }
  for (let i = 0; i < outline.length; i++) { const edge = splitEdge(outline[i], outline[(i + 1) % outline.length], false); for (let j = 0; j < edge.length - 1; j++) localTrim.push({ a: { ...edge[j], y: actualHeight(edge[j]) }, b: { ...edge[j + 1], y: actualHeight(edge[j + 1]) } }); }
  if (roof.type === 'gable') for (const [z0, z1] of verticalIntervals(outline, ridgeX)) localTrim.push({ a: { x: ridgeX, y: y + roof.rise, z: z0 }, b: { x: ridgeX, y: y + roof.rise, z: z1 } });
  trimSegments.push(...(masks.length ? trimOutsideMask(localTrim, masks) : localTrim));
  let ridge = { x: peak.x, y: y + roof.rise, z: peak.z };
  if (masks.length) {
    const edges = new Map(), key = p => `${p.x.toFixed(6)},${p.y.toFixed(6)},${p.z.toFixed(6)}`;
    for (const tri of visible) for (let i = 0; i < 3; i++) { const a = tri[i], b = tri[(i + 1) % 3], id = [key(a), key(b)].sort().join('|'); const edge = edges.get(id); if (edge) edge.count++; else edges.set(id, { a, b, count: 1 }); }
    for (const edge of edges.values()) if (edge.count === 1) trimSegments.push({ a: edge.a, b: edge.b });
    ridge = visible.flat().reduce((best, p) => p.y > best.y ? p : best, visible[0][0]);
  }
  return { id, ...(roomId ? { roomId } : {}), ...(floorId ? { floorId } : {}), elevation: y, exposed: masks.length > 0, type: roof.type, bounds: masks.length ? bounds(visible.flat()) : b, ridge, rise: roof.rise, overhang: roof.overhang, ridgeOffset: ridgeX - (bounds(points).minX + bounds(points).maxX) / 2 };
}

/** Shared roof solver: one automatic union roof, or explicitly authored room sections. */
export function buildHomeRoof(bp, { lod = 0 } = {}) {
  void lod; // Boundary tessellation and geometric silhouette are invariant across LODs.
  const geometry = builder(), gables = builder(), trimSegments = [], sections = [], top = bp.floors.at(-1);
  if (top) {
    const base = bp.roof || {}, y = top.elevation + top.height, perRoom = top.rooms.some(room => base.sections?.[room.id]);
    const volumes = perRoom ? top.rooms.map(room => ({ id: room.id, roomId: room.id, points: sampleRoom(room), roof: { ...base, ...base.sections[room.id] } })) : [{ id: `${bp.id}:roof:auto`, points: deriveFloorOutline(top), roof: base }];
    for (const volume of volumes) { const result = sectionRoof(volume.points, volume.roof, y, volume.id, volume.roomId, geometry, gables, trimSegments, [], top.id); if (result) sections.push(result); }
    // Lower-storey wings and porches also need roofs. Clip their surfaces against
    // every higher floor so a partial extension never gets a roof through the
    // upper building, and a fully covered lower room creates no redundant roof.
    for (let index = 0; index < bp.floors.length - 1; index++) {
      const floor = bp.floors[index], masks = bp.floors.slice(index + 1).flatMap(f => f.rooms.flatMap(room => triangulate(clean(sampleRoom(room)))));
      for (const room of floor.rooms) { const points = clean(sampleRoom(room)); if (points.length < 3 || visibleArea(points, masks) < .015) continue;
        const result = sectionRoof(points, { ...base, ...base.sections?.[room.id] }, floor.elevation + floor.height, room.id, room.id, geometry, gables, trimSegments, masks, floor.id);
        if (result) sections.push(result);
      }
    }
  }
  return { geometry: geometry.geometry(), gables: gables.geometry(), trimSegments, sections };
}
