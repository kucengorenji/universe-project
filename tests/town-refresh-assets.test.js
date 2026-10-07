import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { packFootprints, TownBuilder } from '../src/modes/town/render/townBuilder.js';

const bytes = readFileSync(new URL('../public/models/town.glb', import.meta.url));
const pack = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), '');
const baseline = JSON.parse(readFileSync(new URL('../tools/blender/town/legacy_layout_bounds.json', import.meta.url)));
const families = ['f_house_small', 'f_house', 'f_house_tall', 'f_townhouse', 'f_tavern', 'f_shop', 'f_temple', 'f_castle', 'f_tower',
  'm_house', 'm_shop', 'm_apartment', 'm_office', 'm_tower_a', 'm_tower_b', 'm_spire'];

function geometry(holder, level) {
  const root = holder.children.find(node => node.name.endsWith(`_LOD${level}`));
  assert.ok(root, `${holder.name}: LOD${level}`);
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert(), parts = [];
  root.traverse(node => {
    if (!node.isMesh) return;
    let g = node.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, node.matrixWorld));
    if (g.index) g = g.toNonIndexed();
    for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
    parts.push(g);
  });
  const g = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  g.computeBoundingBox();
  g.userData = { ...holder.userData };
  return g;
}

test('the complete modern and fantasy building catalogue is rebuilt with progressively lighter models', () => {
  const buildings = pack.scene.children.filter(holder => families.includes(holder.name.replace(/_v\d+$/, '')));
  assert.equal(buildings.length, 28);
  assert.equal(new Set(buildings.map(holder => holder.name.replace(/_v\d+$/, ''))).size, 16);
  for (const holder of buildings) {
    assert.equal(holder.userData.townAssetRevision, 1, holder.name);
    assert.deepEqual(holder.userData.layoutFootprint, baseline.variants[holder.name], `${holder.name}: saved parcel contract`);
    const lods = [0, 1, 2].map(level => geometry(holder, level));
    const counts = lods.map(g => g.attributes.position.count / 3);
    assert.ok(counts[1] < counts[0] && counts[2] < counts[1], `${holder.name}: ${counts.join('/')}`);
    assert.ok(counts[2] <= counts[0] * 0.35, `${holder.name}: distant geometry budget`);
    const f = baseline.variants[holder.name];
    for (const g of lods) {
      const b = g.boundingBox, epsilon = 0.002;
      assert.ok(b.min.x >= f.minX - epsilon && b.max.x <= f.maxX + epsilon && b.min.z >= f.minZ - epsilon && b.max.z <= f.maxZ + epsilon,
        `${holder.name}: details stay inside the parcel`);
      assert.ok(Number.isFinite(b.max.y) && b.min.y >= -epsilon && b.max.y <= f.maxY + epsilon, `${holder.name}: grounded height`);
      g.dispose();
    }
  }
});

test('new visual meshes keep the original runtime footprint measurements exactly', () => {
  const library = {};
  for (const holder of pack.scene.children) library[holder.name] = { 0: geometry(holder, 0) };
  const actual = packFootprints(library);
  assert.deepEqual(actual, baseline.families, 'new proxy replacements do not add parcel measurements to saved generators');
  for (const lods of Object.values(library)) lods[0].dispose();
});

test('the runtime selects refreshed support models ahead of older scenery and environment fallbacks', () => {
  const bench = geometry(pack.scene.children.find(node => node.name === 'm_bench'), 0);
  const fence = geometry(pack.scene.children.find(node => node.name === 'f_fence'), 0);
  const builder = Object.create(TownBuilder.prototype);
  Object.assign(builder, { townPack: { m_bench: { 0: bench, 1: bench, 2: bench }, f_fence: { 0: fence, 1: fence, 2: fence } },
    sceneryPack: { m_bench: { 0: [{ geometry: new THREE.BoxGeometry(1, 1, 1) }] } },
    environmentPack: {}, fitCache: new Map(), track: g => g });
  assert.equal(builder.resolve('m_bench').lods[0], bench, 'new bench is actually displayed');
  assert.equal(builder.resolveEnvironment({ asset: 'f_fence', variant: 0 }), null, 'new fence bypasses the old environment substitution');
  assert.equal(builder.resolve('f_fence').lods[0], fence);
  builder.sceneryPack.m_bench[0][0].geometry.dispose(); bench.dispose(); fence.dispose();
});

test('streetscape props replace the old shared proxy geometry with authored LODs', () => {
  for (const name of ['g_cafe_a', 'g_cafe_b', 'g_fountain', 'g_kiosk', 'g_bus_stop', 'g_hydrant', 'g_bin', 'f_well', 'm_bench']) {
    const holder = pack.scene.children.find(node => node.name === name);
    assert.ok(holder, name);
    assert.equal(holder.userData.townAssetRevision, 1, name);
    const lods = [0, 1, 2].map(level => geometry(holder, level));
    assert.ok(lods[0].attributes.position.count > lods[2].attributes.position.count, `${name}: real distant LOD`);
    for (const g of lods) g.dispose();
  }
});
