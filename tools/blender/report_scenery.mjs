// Inspect the shipped GLB, including node transforms; no browser or Blender needed.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Matrix4, Vector3, Quaternion, Box3 } from 'three';

const url = new URL('../../public/models/scenery.glb', import.meta.url);
const bytes = readFileSync(url);
const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
const local = node => node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(
  new Vector3().fromArray(node.translation || [0, 0, 0]),
  new Quaternion().fromArray(node.rotation || [0, 0, 0, 1]),
  new Vector3().fromArray(node.scale || [1, 1, 1])
);
function inspect(index, parent = new Matrix4()) {
  const node = doc.nodes[index], matrix = parent.clone().multiply(local(node));
  const box = new Box3(), materials = new Set();
  let triangles = 0, primitives = 0;
  for (const part of node.mesh === undefined ? [] : doc.meshes[node.mesh].primitives) {
    const position = doc.accessors[part.attributes.POSITION];
    box.union(new Box3(new Vector3().fromArray(position.min), new Vector3().fromArray(position.max)).applyMatrix4(matrix));
    triangles += doc.accessors[part.indices].count / 3;
    primitives++;
    materials.add(doc.materials[part.material].name);
  }
  for (const child of node.children || []) {
    const result = inspect(child, matrix);
    box.union(result.box); triangles += result.triangles; primitives += result.primitives;
    for (const name of result.materials) materials.add(name);
  }
  return { box, triangles, primitives, materials };
}
const assets = {};
for (let i = 0; i < doc.nodes.length; i++) {
  const match = /^(.*)_LOD([012])$/.exec(doc.nodes[i].name || '');
  if (!match) continue;
  const [, name, level] = match, data = inspect(i);
  const round = v => v.toArray().map(n => Math.round(n * 1000) / 1000);
  const family = name.startsWith('t_') ? 'tree' : name.includes('dock') ? 'harbor' : name.startsWith('b_') ? 'understory' : 'garden-prop';
  const asset = assets[name] ||= { family, units: 'metres', up: '+Y', lods: {} };
  asset.lods[level] = { triangles: data.triangles, primitives: data.primitives, bounds: { min: round(data.box.min), max: round(data.box.max) }, materials: [...data.materials] };
}
const manifest = {
  version: 2, file: 'scenery.glb', bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  source: 'tools/blender/build_scenery.py',
  textures: ['scenery_atlas.png (256x256, embedded)', 'flora_cards.png (512x512, embedded)'],
  placement: 'Bounds describe rendering geometry. Root/deck colliders and sockets are owned by townLayout/TownBuilder.',
  assets
};
writeFileSync(new URL('../../public/models/scenery.manifest.json', import.meta.url), JSON.stringify(manifest, null, 2) + '\n');
console.log(`${Object.keys(assets).length} assets; ${bytes.length} bytes; manifest verified against shipped GLB`);
