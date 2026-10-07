import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ASSET_FILES } from '../src/render/assetManifest.js';

const read = p => readFileSync(new URL('../' + p, import.meta.url));
const catalog = JSON.parse(read('tools/blender/home/catalog.json'));
const wanted = ['sofa', 'chair', 'table', 'bed', 'wardrobe', 'shelf', 'kitchen', 'sink', 'toilet', 'bath',
  'lamp', 'rug', 'plant', 'picture', 'bench', 'planter', 'window', 'door', 'chimney', 'fence', 'vase'];

test('cozy home exports complete textured indexed LODs and a shared embedded atlas', () => {
  assert.equal(ASSET_FILES.homePack, 'models/home_cozy.glb');
  const bytes = read('public/' + ASSET_FILES.homePack);
  const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  const report = JSON.parse(read('tools/blender/home/qa/export.json'));
  assert.equal(report.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(report.status, 'PASS');
  assert.ok(bytes.length < 6500 * 1024);
  assert.equal(doc.images.length, 1);
  assert.ok(doc.images[0].bufferView !== undefined);
  for (const mesh of doc.meshes) for (const p of mesh.primitives) {
    assert.ok(p.attributes.NORMAL !== undefined && p.attributes.TEXCOORD_0 !== undefined);
    assert.ok(p.indices !== undefined, 'retain index buffers');
    assert.ok(doc.materials[p.material].pbrMetallicRoughness.baseColorTexture);
  }
  for (const name of wanted) {
    const asset = catalog.assets[name];
    assert.ok(asset, name);
    for (const l of [0, 1, 2]) {
      assert.ok(doc.nodes.some(n => n.name === `${name}_LOD${l}`));
      assert.ok(Math.abs(asset.lods[l].bounds.min[1]) < .002, `${name}/${l}: floor pivot`);
      assert.equal(asset.lods[l].zeroAreaTriangles, 0);
      assert.equal(asset.lods[l].mergedRuntimeDrawCalls, 1);
    }
    assert.ok(asset.lods[0].triangles > asset.lods[1].triangles && asset.lods[1].triangles > asset.lods[2].triangles);
    assert.ok(asset.collider.size.every(s => s > 0));
  }
});

test('the final cozy GLB round-trip retains all LOD meshes and surface sockets', () => {
  const report = JSON.parse(read('tools/blender/home/qa/roundtrip.json'));
  assert.equal(report.status, 'PASS');
  assert.equal(report.importedLODCount, wanted.length * 3);
  assert.equal(report.runtimeSha256, createHash('sha256').update(read('public/models/home_cozy.glb')).digest('hex'));
  for (const name of ['table', 'kitchen', 'sink', 'shelf', 'bench']) {
    const surface = catalog.assets[name].sockets.surface;
    assert.ok(surface.height > 0 && surface.height < catalog.assets[name].dimensions.height + .05);
  }
});
