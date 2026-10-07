import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { generateHexasphere } from '../src/math/hexasphere.js';
import { MapGenerator } from '../src/map/mapGenerator.js';
import { generateTownLayout } from '../src/modes/town/layout/townLayout.js';
import { seedFor } from '../src/world/identity.js';
import { TOWN_LAYOUT_VERSION, townGenerationVersion, townPlanChoice, townPlanVersion } from '../src/world/townGeneration.js';
import { buildingApproach } from '../src/world/buildingBlueprint.js';
import { createWalkNetwork, townWalkable } from '../src/modes/town/navigation/walkNetwork.js';

const keys = ['seed', 'baseSeed', 'variant', 'options', 'layoutVersion', 'cityR', 'dioramaR', 'relief', 'streets', 'buildings', 'props', 'trees', 'parks', 'paths', 'walls', 'fields2', 'docks', 'colliders', 'walkGraph', 'driveGraph', 'morphology', 'rivers', 'bridges', 'spawn', 'exits'];
const fingerprint = layout => createHash('sha256').update(JSON.stringify(Object.fromEntries(keys.map(key => [key, layout[key]])))).digest('hex');
const trunks = layout => layout.trees.filter(tree => tree.asset.startsWith('t_'));
const pointKey = ({ x, z }) => `${x}:${z}`;
const hexasphere = generateHexasphere(3, 10);
const generator = new MapGenerator(hexasphere);

test('v5 halves settlement area and removes canonical trunks and their collision cost', () => {
  for (const seed of [17, 427, 8191]) {
    const map = generator.generate(seed, { planetType: 'terran' });
    for (const cityIndex of [0, 1]) {
      const args = { map, hexasphere, cityIndex };
      const old = generateTownLayout({ ...args, layoutVersion: 4 });
      const compact = generateTownLayout(args);
      const where = `seed ${seed} ${compact.style}`;
      assert.equal(compact.layoutVersion, 5);
      assert.ok(Math.abs((compact.cityR / old.cityR) ** 2 - 0.5) < 1e-9, where);
      assert.ok(Math.abs((compact.dioramaR / old.dioramaR) ** 2 - 0.5) < 0.003, where);
      assert.ok(compact.buildings.length > 10 && compact.buildings.length < old.buildings.length * 0.6, where);
      assert.ok(compact.morphology.blocks < old.morphology.blocks, where);
      assert.ok(trunks(compact).length < trunks(old).length * 0.35, where);
      assert.ok(trunks(compact).length > trunks(old).length * 0.2, `${where}: woodland remains`);
      const circles = new Set(compact.colliders.filter(c => c.type === 'circle').map(pointKey));
      assert.ok(trunks(compact).every(tree => circles.has(pointKey(tree))), `${where}: canonical trunks retain collision`);
      assert.ok(compact.colliders.length < old.colliders.length * 0.5, where);
      assert.ok(compact.walkGraph.length && compact.driveGraph.length, `${where}: walk and drive networks remain`);
      // Assets and lanes keep their metre scale; this is fewer lots, rather than a miniature town.
      const roadWidths = new Set(old.streets.map(s => `${s.kind}:${s.w}`));
      assert.ok(compact.streets.every(s => roadWidths.has(`${s.kind}:${s.w}`)), `${where}: street widths`);
      for (const building of compact.buildings.filter(b => b.sx && b.sz && b.ward !== 'landmark')) {
        assert.ok(building.sx >= 0.84 && building.sz >= 0.84, `${where}: human-scale buildings`);
      }
    }
  }
});

test('saved v1–v4 layouts retain coordinate IDs, original and rerolled geometry and navigation', () => {
  // Captured before introducing v5; these cover the data which interiors and home lots depend on.
  const hashes = [
    [17, 0, 1, 0, '0c9ad77a4013cf4146694c18981d7b330fd827624ceeb1775423588fe46ec783'],
    [17, 1, 2, 0, '498a3721e0adcb6fb48afe7981df4a1046db6b62ee398ea5d52b0693439dc9e2'],
    [427, 0, 3, 0, 'd9cb4cb4356470ef7d61c752089d726fc51e43c3f1e295289e15788208ea2d05'],
    [427, 1, 4, 7, '40ce79bb2fb3649b7667b7567f892e5358dbb8236da883e2c3f50bbc5f5365d9'],
    [17, 0, 4, 7, 'ee4a8d0f8023810299e65bd9bbb006533acce0db043b93ab62c07167653a1adc'],
    [427, 1, 1, 0, '4391549c2f4c505f9f88d24ffd3ebcdf2fcf68f31785a8f2376405a6b61cd706']
  ];
  for (const [seed, cityIndex, layoutVersion, variant, expected] of hashes) {
    const map = generator.generate(seed, { planetType: 'terran' });
    const layout = generateTownLayout({ map, hexasphere, cityIndex, layoutVersion, variant });
    assert.equal(fingerprint(layout), expected, `seed ${seed} city ${cityIndex} version ${layoutVersion} variant ${variant}`);
  }
});

test('compact modern and fantasy towns keep usable sparse, normal and dense plans', () => {
  for (const seed of [17, 427, 8191]) {
    const map = generator.generate(seed, { planetType: 'terran' });
    for (const cityIndex of [0, 1]) {
      const plans = [0.75, 1, 1.3].map(density => generateTownLayout({ map, hexasphere, cityIndex, variant: 7, options: { density } }));
      const [sparse, normal, dense] = plans;
      const where = `seed ${seed} ${normal.style}`;
      assert.ok(sparse.buildings.length > 0 && sparse.buildings.length < normal.buildings.length, where);
      assert.ok(dense.buildings.length >= normal.buildings.length * 0.97, where);
      for (const plan of plans) {
        assert.ok(plan.walkGraph.length && plan.driveGraph.length, where);
        assert.deepEqual(plan.streets.filter(s => !s.quay), normal.streets.filter(s => !s.quay), `${where}: density keeps the planned street network`);
        assert.equal(plan.cityR, normal.cityR);
      }
    }
  }
});

test('v5 decoration clears actual model door approaches at the NPC safety radius without moving buildings or roads', () => {
  const footprints = JSON.parse(readFileSync(new URL('../tools/blender/town/legacy_layout_bounds.json', import.meta.url))).families;
  const fixtures = [
    [17, 1, 'town:3204:building:m_shop:913:6174:18110', 'a1e4645d7e383baf7a12d87cbd26d663b74785486023952ef477af2be0d92795'],
    [427, 0, 'town:55937:building:f_house_tall:3816:-623:2924', 'dd3a6d5c25acf83511c3ea4aafd880648a8aca6b51b4350a1128275de11ad881']
  ];
  for (const [seed, cityIndex, buildingId, geometryHash] of fixtures) {
    const map = generator.generate(seed, { planetType: 'terran' });
    const layout = generateTownLayout({ map, hexasphere, cityIndex, footprints });
    const actualHash = createHash('sha256').update(JSON.stringify({ buildings: layout.buildings, streets: layout.streets })).digest('hex');
    assert.equal(actualHash, geometryHash, 'decor removal must not move coordinate IDs, buildings or streets');
    const building = layout.buildings.find(b => b.id === buildingId);
    assert.ok(building, buildingId);
    const approach = buildingApproach(building, footprints[building.asset]);
    const walkable = townWalkable(layout, { margin: 0.3 });
    assert.ok(walkable(approach.x, approach.z), `${buildingId}: NPC approach`);
    const graph = createWalkNetwork(layout.walkGraph, { walkable, portals: [{ id: buildingId, ...approach, facing: { x: -Math.sin(building.yaw), z: Math.cos(building.yaw) } }] });
    assert.notEqual(graph.portals[0].node, null, `${buildingId}: connected to a safe street`);
  }
});

function stateWith(entries) {
  const records = new Map(entries);
  return { records, get: key => structuredClone(records.get(key) ?? null), set: (key, value) => records.set(key, structuredClone(value)) };
}
const layoutKey = 'town-layout:0:55';
const variantSeed = seedFor(55, 'town-variant', 7);

test('unlocked visited originals and variants migrate without resetting approved density', () => {
  for (const version of [1, 2, 3, 4]) for (const variant of [0, 7]) {
    const state = stateWith([[layoutKey, { version, originalVersion: version, townSeed: 55, planet: 0, variant, density: 0.75 }]]);
    assert.equal(townGenerationVersion(state, 0, 55), TOWN_LAYOUT_VERSION);
    assert.deepEqual(townPlanChoice(state, 0, 55), { variant, density: 0.75 });
    assert.equal(townPlanVersion(state, 0, 55, { variant: 0, density: 1 }), TOWN_LAYOUT_VERSION, 'unlocked original does not keep stale metadata');
  }
});

test('saved original and variant rooms or homes pin their exact generator and never mutate authored data', () => {
  for (const variant of [0, 7]) for (const kind of ['interior', 'home']) {
    const layoutSeed = variant ? variantSeed : 55;
    const key = kind === 'interior' ? `interior:0:town:${layoutSeed}:building:42` : 'home:0:2:building:42';
    const authored = { townSeed: 55, layoutSeed, layoutVersion: 4, buildingId: 'building:42', origin: { x: 27, z: -31, yaw: 0.4 }, applied: { floors: 3 }, plot: [{ x: -4, z: -8 }] };
    const state = stateWith([[layoutKey, { version: 4, originalVersion: 3, variant, density: 1.3 }], [key, authored]]);
    assert.equal(townGenerationVersion(state, 0, 55), 4, `${kind} variant ${variant}`);
    assert.deepEqual(state.get(key), authored);
    assert.equal(state.get(layoutKey).version, 4);
  }
});

test('an unlocked active variant can migrate while its original rooms or home keep their source version', () => {
  for (const kind of ['interior', 'home']) {
    const key = kind === 'interior' ? 'interior:0:town:55:building:42' : 'home:0:2:building:42';
    const authored = { townSeed: 55, layoutSeed: 55, layoutVersion: 3, origin: { x: 27, z: -31 } };
    const state = stateWith([[layoutKey, { version: 4, originalVersion: 3, variant: 7, density: 1 }], [key, authored]]);
    assert.equal(townGenerationVersion(state, 0, 55), TOWN_LAYOUT_VERSION);
    assert.equal(townPlanVersion(state, 0, 55, { variant: 0, density: 1 }), 3);
    assert.deepEqual(state.get(key), authored);
  }
});
