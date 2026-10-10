import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { generateHexasphere } from '../src/math/hexasphere.js';
import { MapGenerator } from '../src/map/mapGenerator.js';
import { generateTownLayout } from '../src/modes/town/layout/townLayout.js';
import { ENVIRONMENT } from '../src/modes/town/render/environmentKit.js';
import { buildTemplate, makeNpc, dressNpc, animateNpc } from '../src/modes/town/people/chunkyPeople.js';
import { townGenerationVersion, TOWN_LAYOUT_VERSION } from '../src/world/townGeneration.js';

const glbJson = (path) => {
  const bytes = readFileSync(new URL(`../public/${path}`, import.meta.url));
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
};
const parse = async (path) => {
  const bytes = readFileSync(new URL(`../public/${path}`, import.meta.url));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), '');
};

const hexasphere = generateHexasphere(3, 10);
const map = new MapGenerator(hexasphere).generate(427, { planetType: 'terran' });
const modern = map.cities.findIndex((c) => c.style === 'modern');
const fantasy = map.cities.findIndex((c) => c.style !== 'modern');
const town = (cityIndex, layoutVersion) => generateTownLayout({ map, hexasphere, cityIndex, layoutVersion });

test('the environment pack has every model the builder maps, in three LODs', () => {
  const names = new Set(glbJson('models/environment.glb').nodes.map((n) => n.name));
  for (const [asset, env] of Object.entries(ENVIRONMENT)) {
    for (const model of env.models) for (const l of [0, 1, 2]) assert.ok(names.has(`${model}_LOD${l}`), `${asset}: ${model}_LOD${l}`);
  }
});

test('the NPC merges into one rigidly skinned mesh and walks with opposed legs', async () => {
  const bytes = readFileSync(new URL('../tools/blender/legacy/npc.glb', import.meta.url)); // no longer shipped: only this test and the shared template read it
  const template = buildTemplate(await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), ''));
  assert.ok(template, 'pivots found');
  const meshes = [];
  template.root.traverse((o) => o.isMesh && meshes.push(o));
  assert.equal(meshes.length, 1, 'one draw call per person');
  assert.ok(meshes[0].isSkinnedMesh);
  assert.equal(meshes[0].skeleton.bones.length, 23);
  const box = new THREE.Box3().setFromObject(template.root);
  assert.ok(Math.abs(box.max.y - 1.76) < 0.05, `stands ~1.76 m (${box.max.y.toFixed(2)})`);

  const p = makeNpc(template, { shadows: false });
  dressNpc(p, 42);
  const look = p.material.userData.uniforms.uPalette.value.map((c) => c.getHex());
  dressNpc(p, 42);
  assert.deepEqual(p.material.userData.uniforms.uPalette.value.map((c) => c.getHex()), look, 'same identity, same look');
  const rest = p.bones.hip_L.rest.clone();
  for (let i = 0; i < 30; i++) animateNpc(p, 1 / 30, 1.4);
  const left = p.bones.hip_L.node.quaternion;
  const right = p.bones.hip_R.node.quaternion;
  assert.ok(left.angleTo(rest) > 0.05, 'the leg swings');
  const swingL = new THREE.Euler().setFromQuaternion(rest.clone().invert().multiply(left)).x;
  const swingR = new THREE.Euler().setFromQuaternion(p.bones.hip_R.rest.clone().invert().multiply(right)).x;
  assert.ok(swingL * swingR < 0, 'legs swing in opposition');
});

test('v3 streets are sized for the town, and cars still have roads', () => {
  const v2 = town(modern, 2);
  const v3 = town(modern, 3);
  const widest = (L, kind) => Math.max(...L.streets.filter((s) => s.kind === kind).map((s) => s.w));
  assert.ok(widest(v3, 'main') <= 10 && widest(v3, 'main') < widest(v2, 'main'));
  assert.ok(widest(v3, 'residential') <= 6);
  assert.ok(v3.driveGraph.length >= v2.driveGraph.length, 'collectors join the drive graph');
  const asphalt = (L) => L.streets.filter((s) => s.kind !== 'road').reduce((a, s) => a + s.pts.slice(1).reduce((b, q, i) => b + Math.hypot(q[0] - s.pts[i][0], q[1] - s.pts[i][1]), 0) * s.w, 0) / L.buildings.length;
  assert.ok(asphalt(v3) < asphalt(v2) * 0.8, `paved area per building ${asphalt(v3).toFixed(0)} vs ${asphalt(v2).toFixed(0)}`);
});

test('v3 grows flowers in drifts and bounds fields with hedges or fences', () => {
  const L = town(fantasy, 3);
  const flowers = L.trees.filter((t) => t.asset === 'b_flowers');
  const loose = flowers.filter((t) => !['drift', 'garden', 'park'].includes(t.habitat));
  assert.ok(loose.length < flowers.length * 0.1, `${loose.length} of ${flowers.length} flowers outside drifts and gardens`);
  assert.ok(L.fields2.length === 0 || L.hedges.length > 0, 'fields get boundaries');
  const fences = L.props.filter((p) => p.asset === 'f_fence');
  for (const f of fences) assert.ok(L.colliders.some((c) => c.type === 'box' && Math.hypot(c.x - f.x, c.z - f.z) < 0.01), 'a fence blocks walkers');
  assert.deepEqual(town(fantasy, 3).hedges, L.hedges, 'deterministic');
});

test('a town visited under v2 upgrades unless saved rooms depend on it', () => {
  const records = new Map([['town-layout:1:7', { version: 2, townSeed: 7, planet: 1 }], ['town-layout:1:8', { version: 2, townSeed: 8, planet: 1 }], ['interior:1:town:8:building:x', { light: true }]]);
  const state = { records, get: (k) => records.get(k), set: (k, v) => records.set(k, v) };
  assert.equal(townGenerationVersion(state, 1, 7), TOWN_LAYOUT_VERSION);
  assert.equal(townGenerationVersion(state, 1, 8), 2, 'rooms keep their parcels');
  assert.equal(townGenerationVersion(state, 1, 7), TOWN_LAYOUT_VERSION, 'stable after the upgrade');
});

test('v3 grows one-tile fantasy towns as street villages with fields behind the rows', () => {
  let villages = 0;
  for (const seed of [427, 91]) {
    const m = new MapGenerator(hexasphere).generate(seed, { planetType: 'terran' });
    m.cities.forEach((c, cityIndex) => {
      if (c.style === 'modern' || c.type === 'capital' || (c.tiles || [c.tileId]).length > 1) return;
      const L = generateTownLayout({ map: m, hexasphere, cityIndex, layoutVersion: 3 });
      if (L.morphology.kind !== 'street-village') return; // no room for a street: the ward plan took over
      villages++;
      assert.ok(L.streets.filter((s) => s.kind === 'main').length >= 1);
      assert.ok(L.streets.filter((s) => s.kind === 'lane').length <= 2 + Math.round(L.cityR / 45), 'a few lanes, not a web');
      assert.ok(L.buildings.length >= 8, `${L.name}: ${L.buildings.length} buildings`);
      const crofts = L.fields2.filter((f) => f.croft);
      assert.ok(crofts.length >= 3, `${L.name}: crofts behind the houses`);
      const v2 = generateTownLayout({ map: m, hexasphere, cityIndex, layoutVersion: 2 });
      assert.notEqual(v2.morphology?.kind, 'street-village', 'saved v2 towns keep their ward plan');
    });
  }
  assert.ok(villages >= 2, `${villages} villages`);
});
