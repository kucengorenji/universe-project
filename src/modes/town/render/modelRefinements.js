import * as THREE from 'three';

// build_town_space.py authors rectangular ridge caps on these gabled houses,
// and six tilted solar panels on m_house. Refine those actual faces only: the
// surrounding roof, windows, doors and collision footprint stay authored.
const SUPPORTED = /^(f_house_small|f_house|f_house_tall|m_house)(?:_v\d+)?$/;
const EPS = 0.0001;
const pointKey = p => `${Math.round(p.x / EPS)},${Math.round(p.y / EPS)},${Math.round(p.z / EPS)}`;
const edgeKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
const positionAt = (attribute, i) => new THREE.Vector3().fromBufferAttribute(attribute, i);

function authoredQuads(geometry, modern, bounds) {
  const { position, roof, emissive, surface } = geometry.attributes;
  const triangles = [];
  const edges = new Map();
  for (let i = 0; i < position.count; i += 3) {
    const a = positionAt(position, i), b = positionAt(position, i + 1), c = positionAt(position, i + 2);
    const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    const center = a.clone().add(b).add(c).multiplyScalar(1 / 3);
    if (normal.y < (modern ? 0.9 : 0.995)) continue;
    if (modern) {
      // Solar glass is above the upper floor; wall glazing never qualifies.
      if (!emissive || emissive.getX(i) < 0.5 || emissive.getX(i) > 0.9 ||
        center.y < bounds.min.y + (bounds.max.y - bounds.min.y) * 0.78) continue;
    } else if (!roof || roof.getX(i) < 1.5 || center.y < bounds.min.y + (bounds.max.y - bounds.min.y) * 0.55) continue;
    const points = [a, b, c], keys = points.map(pointKey);
    const triangle = { points, keys, normal, index: i, semantic: surface?.getZ(i) ?? 0 };
    triangles.push(triangle);
    for (let edge = 0; edge < 3; edge++) {
      const key = edgeKey(keys[edge], keys[(edge + 1) % 3]);
      if (!edges.has(key)) edges.set(key, []);
      edges.get(key).push(triangle);
    }
  }
  const used = new Set(), quads = [];
  for (const pair of edges.values()) {
    if (pair.length !== 2 || pair.some(t => used.has(t))) continue;
    const [a, b] = pair;
    if (a.normal.dot(b.normal) < 0.9999 || a.semantic !== b.semantic ||
      Math.abs(a.normal.dot(a.points[0].clone().sub(b.points[0]))) > EPS * 2) continue;
    const unique = new Map();
    for (const t of pair) t.points.forEach((p, i) => unique.set(t.keys[i], p));
    if (unique.size !== 4) continue;
    // The shared diagonal is longer than either rectangular face axis. Choose
    // the longest boundary edge as the ridge/panel axis instead.
    const boundary = new Map();
    for (const t of pair) for (let edge = 0; edge < 3; edge++) {
      const key = edgeKey(t.keys[edge], t.keys[(edge + 1) % 3]);
      if (boundary.has(key)) boundary.delete(key);
      else boundary.set(key, [t.points[edge], t.points[(edge + 1) % 3]]);
    }
    const longest = [...boundary.values()].sort((e, f) => f[0].distanceToSquared(f[1]) - e[0].distanceToSquared(e[1]))[0];
    const axis = longest[1].clone().sub(longest[0]).normalize();
    const across = a.normal.clone().cross(axis).normalize();
    const center = [...unique.values()].reduce((p, q) => p.add(q), new THREE.Vector3()).multiplyScalar(0.25);
    const along = [...unique.values()].map(p => p.clone().sub(center).dot(axis));
    const cross = [...unique.values()].map(p => p.clone().sub(center).dot(across));
    const length = Math.max(...along) - Math.min(...along), width = Math.max(...cross) - Math.min(...cross);
    // Reject bevel triangles or unexpected replacement models. The thin ridge
    // faces and 2 x 1.6 m panels match the authored source's dimensions.
    if (modern ? length < 1.7 || length > 2.2 || width < 1.3 || width > 1.8
      : length < 4 || width < 0.15 || width > 0.4) continue;
    used.add(a); used.add(b);
    quads.push({ center, axis, across, normal: a.normal, length, width, source: a.index });
  }
  return quads;
}

/** Close-only ridge tiles / solar cell dividers, inside the original AABB.
 * The caller caches and disposes the returned geometry with its TownBuilder.
 */
export function refineTownModel(name, geometry, lod = 0) {
  if (lod !== 0 || !SUPPORTED.test(name) || !geometry?.attributes.position ||
    geometry.index || geometry.userData.townRefinement || geometry.userData.townAssetRevision) return geometry;
  const modern = /^m_house/.test(name);
  const bounds = geometry.boundingBox?.clone() || new THREE.Box3().setFromBufferAttribute(geometry.attributes.position);
  const quads = authoredQuads(geometry, modern, bounds);
  if (!quads.length) return geometry;
  const attrs = geometry.attributes;
  const appended = Object.fromEntries(Object.keys(attrs).map(key => [key, []]));
  const sourceTriangles = attrs.position.count / 3;
  const budget = Math.floor(sourceTriangles * 0.15);
  let added = 0, details = 0;
  const point = (q, x, z, height = 0) => q.center.clone().addScaledVector(q.axis, x)
    .addScaledVector(q.across, z).addScaledVector(q.normal, height);
  const triangle = (q, a, b, c) => {
    const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    for (const p of [a, b, c]) for (const [key, attr] of Object.entries(attrs)) {
      const out = appended[key];
      if (key === 'position') out.push(p.x, p.y, p.z);
      else if (key === 'normal') out.push(normal.x, normal.y, normal.z);
      else if (key === 'surface') {
        const n = normal.clone().set(Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z));
        const u = n.x > n.z && n.x > n.y ? p.z : p.x;
        const v = n.y > n.x && n.y > n.z ? p.z : p.y;
        out.push(u * 0.5, v * 0.5, modern ? 7 : attr.getZ(q.source));
      } else if (modern && ['emissive', 'paint', 'roof'].includes(key)) {
        for (let k = 0; k < attr.itemSize; k++) out.push(0);
      } else if (modern && key === 'color') {
        // Dark aluminium fingers; glass underneath retains its night shader.
        out.push(0.16, 0.2, 0.25);
      } else {
        for (let k = 0; k < attr.itemSize; k++) out.push(attr.array[q.source * attr.itemSize + k]);
      }
    }
    added++;
  };
  const addFaces = (q, faces) => {
    const count = faces.reduce((sum, face) => sum + face.length - 2, 0);
    if (added + count > budget || faces.some(face => face.some(p => !bounds.containsPoint(p)))) return false;
    for (const face of faces) for (let k = 1; k + 1 < face.length; k++) triangle(q, face[0], face[k], face[k + 1]);
    details++;
    return true;
  };
  for (const q of quads) {
    if (modern) {
      // Thin strips sit on the measured tilted panel face. Insets keep every
      // new point below the old panel's furthest corners and model bounds.
      const inset = 0.075, halfL = q.length / 2 - inset, halfW = q.width / 2 - inset;
      const line = (x0, x1, z0, z1) => addFaces(q, [[point(q, x0, z0, 0.007), point(q, x1, z0, 0.007),
        point(q, x1, z1, 0.007), point(q, x0, z1, 0.007)]]);
      for (let i = 1; i < 6; i++) {
        const x = -halfL + (2 * halfL * i) / 6;
        line(x - 0.009, x + 0.009, -halfW, halfW);
      }
      for (let i = 1; i < 4; i++) {
        const z = -halfW + (2 * halfW * i) / 4;
        line(-halfL, halfL, z - 0.009, z + 0.009);
      }
    } else {
      const count = Math.floor((q.length - 0.16) / 0.48);
      const span = (q.length - 0.16) / count;
      const halfWidth = Math.min(0.12, q.width * 0.44);
      for (let tile = 0; tile < count; tile++) {
        const x0 = -q.length / 2 + 0.08 + tile * span + 0.014, x1 = x0 + span - 0.028;
        const profile = [-1, -0.7, 0, 0.7, 1].map(t => [halfWidth * t, 0.002 + 0.065 * Math.sqrt(1 - t * t)]);
        const a = profile.map(([z, y]) => point(q, x0, z, y));
        const b = profile.map(([z, y]) => point(q, x1, z, y));
        const faces = [a, b.slice().reverse()];
        for (let k = 0; k < profile.length - 1; k++) faces.push([a[k], b[k], b[k + 1], a[k + 1]]);
        if (!addFaces(q, faces)) break;
      }
    }
  }
  if (!added) return geometry;
  const refined = new THREE.BufferGeometry();
  for (const [key, attr] of Object.entries(attrs)) {
    const array = new attr.array.constructor(attr.array.length + appended[key].length);
    array.set(attr.array); array.set(appended[key], attr.array.length);
    refined.setAttribute(key, new THREE.BufferAttribute(array, attr.itemSize, attr.normalized));
  }
  refined.name = `${geometry.name || name}-town-close`;
  refined.boundingBox = bounds;
  refined.computeBoundingSphere();
  refined.userData.townRefinement = { name, sourceTriangles, addedTriangles: added, details,
    kind: modern ? 'solar-cell-dividers' : 'rounded-ridge-tiles' };
  return refined;
}
