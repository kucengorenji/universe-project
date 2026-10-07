import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';

const root = new URL('../../../', import.meta.url);
const path = new URL('public/models/home_cozy.glb', root);
const bytes = readFileSync(path);
const jsonLength = bytes.readUInt32LE(12);
const doc = JSON.parse(bytes.subarray(20, 20 + jsonLength));
const binary = bytes.subarray(28 + jsonLength);
const source = JSON.parse(readFileSync(new URL('qa/authoring.json', import.meta.url)));
const errors = [];
const local = n => n.matrix ? new Matrix4().fromArray(n.matrix) : new Matrix4().compose(
  new Vector3().fromArray(n.translation || [0, 0, 0]),
  new Quaternion().fromArray(n.rotation || [0, 0, 0, 1]),
  new Vector3().fromArray(n.scale || [1, 1, 1])
);

function accessor(index) {
  const a = doc.accessors[index], view = doc.bufferViews[a.bufferView];
  const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const width = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
  const read = { 5121: 'readUInt8', 5123: 'readUInt16LE', 5125: 'readUInt32LE', 5126: 'readFloatLE' }[a.componentType];
  const start = (view.byteOffset || 0) + (a.byteOffset || 0), stride = view.byteStride || width * size;
  return Array.from({ length: a.count }, (_, i) => Array.from({ length: size }, (_, j) => binary[read](start + i * stride + j * width)));
}

function measure(index, parent = new Matrix4()) {
  const node = doc.nodes[index], matrix = parent.clone().multiply(local(node));
  const bounds = new Box3(), mats = new Set();
  let triangles = 0, vertices = 0, primitives = 0, zeroArea = 0;
  for (const p of node.mesh === undefined ? [] : doc.meshes[node.mesh].primitives) {
    primitives++;
    for (const key of ['POSITION', 'NORMAL', 'TEXCOORD_0']) if (p.attributes[key] === undefined) errors.push(`${node.name}: missing ${key}`);
    if (p.indices === undefined) errors.push(`${node.name}: missing index`);
    const pos = accessor(p.attributes.POSITION), norms = accessor(p.attributes.NORMAL), uvs = accessor(p.attributes.TEXCOORD_0);
    const ids = p.indices === undefined ? pos.map((_, i) => [i]) : accessor(p.indices);
    triangles += ids.length / 3;
    vertices += pos.length;
    mats.add(doc.materials[p.material].name);
    for (const v of pos) {
      if (v.some(n => !Number.isFinite(n))) errors.push(`${node.name}: non-finite position`);
      bounds.expandByPoint(new Vector3().fromArray(v).applyMatrix4(matrix));
    }
    if (norms.some(v => v.some(n => !Number.isFinite(n)) || Math.hypot(...v) < .98 || Math.hypot(...v) > 1.02)) errors.push(`${node.name}: invalid normal`);
    if (uvs.some(v => v.some(n => !Number.isFinite(n) || n < 0 || n > 1))) errors.push(`${node.name}: invalid atlas UV`);
    for (let i = 0; i < ids.length; i += 3) {
      const a = new Vector3().fromArray(pos[ids[i][0]]), b = new Vector3().fromArray(pos[ids[i + 1][0]]), c = new Vector3().fromArray(pos[ids[i + 2][0]]);
      if (b.sub(a).cross(c.sub(a)).length() < 1e-10) zeroArea++;
    }
  }
  for (const child of node.children || []) {
    const r = measure(child, matrix);
    bounds.union(r.bounds);
    triangles += r.triangles; vertices += r.vertices; primitives += r.primitives; zeroArea += r.zeroArea;
    r.mats.forEach(m => mats.add(m));
  }
  return { bounds, triangles, vertices, primitives, zeroArea, materials: [...mats] };
}

const assets = {};
for (let i = 0; i < doc.nodes.length; i++) {
  const match = /^(.*)_LOD([012])$/.exec(doc.nodes[i].name || '');
  if (!match) continue;
  const [, name, level] = match, s = measure(i), authored = source.assets[name]?.lods[level];
  if (!authored) errors.push(`unexpected ${name}/${level}`);
  if (authored && authored.triangles !== s.triangles) errors.push(`${name}/${level}: export triangle mismatch`);
  if (s.zeroArea) errors.push(`${name}/${level}: ${s.zeroArea} zero-area triangles`);
  if (Math.abs(s.bounds.min.y) > .002) errors.push(`${name}/${level}: pivot floats ${s.bounds.min.y}`);
  const min = s.bounds.min.toArray(), max = s.bounds.max.toArray(), size = s.bounds.getSize(new Vector3()).toArray();
  (assets[name] ||= { placement: source.assets[name].placement, sockets: source.assets[name].sockets, lods: {} }).lods[level] = {
    triangles: s.triangles, exportedVertices: s.vertices, authoredPrimitives: s.primitives,
    mergedRuntimeDrawCalls: 1, bounds: { min, max }, size, materials: s.materials, zeroAreaTriangles: s.zeroArea
  };
}
for (const [name, a] of Object.entries(assets)) {
  if (Object.keys(a.lods).length !== 3) errors.push(`${name}: missing LOD`);
  if (!(a.lods[0].triangles > a.lods[1].triangles && a.lods[1].triangles > a.lods[2].triangles)) errors.push(`${name}: LOD detail does not decrease`);
  const b = a.lods[0].bounds;
  a.collider = { type: 'box', min: b.min, max: b.max, center: b.min.map((v, i) => (v + b.max[i]) / 2), size: a.lods[0].size };
  a.dimensions = { width: a.lods[0].size[0], height: a.lods[0].size[1], depth: a.lods[0].size[2] };
}
const images = doc.images.map(im => ({ name: im.name, mimeType: im.mimeType, embedded: im.bufferView !== undefined,
  bytes: im.bufferView === undefined ? 0 : doc.bufferViews[im.bufferView].byteLength }));
if (images.length !== 1 || !images.every(i => i.embedded)) errors.push('expected one shared embedded atlas');
for (const m of doc.materials) if (!m.pbrMetallicRoughness?.baseColorTexture || !m.pbrMetallicRoughness?.baseColorFactor) errors.push(`${m.name}: missing textured tint`);
if (Object.keys(assets).length !== 21) errors.push('expected 21 assets');
if (bytes.length > 6500 * 1024) errors.push('pack exceeds 6.5 MiB budget');
const report = { version: 1, generatedAt: new Date().toISOString(), file: 'public/models/home_cozy.glb',
  bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), status: errors.length ? 'FAIL' : 'PASS',
  units: 'metres', up: '+Y', front: '+Z', pivot: 'floor at footprint centre',
  assetCount: Object.keys(assets).length, lodCount: 3, materials: doc.materials.length, images, assets,
  totals: Object.fromEntries([0, 1, 2].map(l => [l, Object.values(assets).reduce((n, a) => n + a.lods[l].triangles, 0)])), errors };
writeFileSync(new URL('qa/export.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
writeFileSync(new URL('catalog.json', import.meta.url), JSON.stringify({ version: 1, assets, texture: source.texture }, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, bytes: report.bytes, triangles: report.totals, errors }, null, 2));
if (errors.length) process.exitCode = 1;
