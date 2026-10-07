import test from 'node:test';
import assert from 'node:assert/strict';
import { generateHexasphere } from '../src/math/hexasphere.js';
import { MapGenerator } from '../src/map/mapGenerator.js';
import { generateTownLayout, townBaseSeed } from '../src/modes/town/layout/townLayout.js';
import { ROOF_PALETTES, ROOF_CLASS } from '../src/art/palette.js';
import { WorldStateStore } from '../src/world/stateStore.js';
import { TOWN_LAYOUT_VERSION, townGenerationVersion, townPlanChoice, townPlanVersion, saveTownPlanChoice, townHasSavedRooms } from '../src/world/townGeneration.js';

const hexasphere = generateHexasphere(3, 10);
const map = new MapGenerator(hexasphere).generate(427, { planetType: 'terran' });
const fantasy = map.cities.findIndex(c => c.style !== 'modern');
const town = (extra = {}) => generateTownLayout({ map, hexasphere, cityIndex: fantasy, ...extra });

test('roofs come from the town palette, deterministically, only on palette roofs', () => {
  const a = town(), b = town();
  const pal = ROOF_PALETTES.terran;
  const allowed = new Set([...pal.main, ...pal.second, ...pal.third]);
  let homes = 0;
  for (const item of [...a.buildings, ...a.props]) {
    const kind = ROOF_CLASS[item.asset];
    if (!kind) assert.equal(item.roof, undefined, `${item.asset} keeps its authored roof`);
    else if (kind === 'fort') assert.equal(item.roof, pal.fort);
    else { assert.ok(allowed.has(item.roof), `${item.asset} roof ${item.roof}`); homes++; }
  }
  assert.ok(homes > 50);
  assert.deepEqual(a.buildings.map(x => x.roof), b.buildings.map(x => x.roof));
  const share = a.buildings.filter(x => pal.main.includes(x.roof)).length / homes;
  assert.ok(share > 0.5, `one dominant roof family (${share.toFixed(2)})`);
});

test('a reroll replans the settlement but keeps the ground it stands on', () => {
  const original = town(), explicit = town({ variant: 0, options: { density: 1 } }), reroll = town({ variant: 99 });
  assert.deepEqual(explicit.buildings, original.buildings, 'variant 0 is the original town');
  assert.notDeepEqual(reroll.buildings.map(b => [b.x, b.z]), original.buildings.map(b => [b.x, b.z]));
  assert.deepEqual(reroll.relief, original.relief, 'hills do not move');
  assert.deepEqual(reroll.rivers, original.rivers, 'rivers come from the planet');
  assert.equal(reroll.baseSeed, townBaseSeed(map, fantasy));
  assert.notEqual(reroll.seed, original.seed, 'building IDs get their own namespace');
});

test('the density option thins or packs the town', () => {
  const sparse = town({ variant: 7, options: { density: 0.75 } });
  const normal = town({ variant: 7 });
  const dense = town({ variant: 7, options: { density: 1.3 } });
  assert.ok(sparse.buildings.length < normal.buildings.length * 0.9, `${sparse.buildings.length} vs ${normal.buildings.length}`);
  assert.ok(dense.buildings.length >= normal.buildings.length * 0.97, `${dense.buildings.length} vs ${normal.buildings.length}`);
  // Quays adapt to the occupied harbor parcels; the planned town network stays fixed.
  assert.deepEqual(dense.streets.filter(s => !s.quay), normal.streets.filter(s => !s.quay), 'density never moves the planned streets');
});

test('an approved plan persists; going back to the original restores its generator', async () => {
  const data = new Map();
  const state = new WorldStateStore('planner', { storage: { getItem: k => data.get(k), setItem: (k, v) => data.set(k, v) }, indexedDB: null });
  await state.ready;
  // An old town with changed rooms stays on generator 1 until the player replans it
  await state.set('interior:0:town:55:building:x', { light: true });
  assert.equal(townGenerationVersion(state, 0, 55), 1);
  assert.deepEqual(townPlanChoice(state, 0, 55), { variant: 0, density: 1 });
  assert.equal(townHasSavedRooms(state, 0, 55), true);
  await saveTownPlanChoice(state, 0, 55, { variant: 12, density: 1.3 });
  assert.equal(townGenerationVersion(state, 0, 55), TOWN_LAYOUT_VERSION);
  assert.deepEqual(townPlanChoice(state, 0, 55), { variant: 12, density: 1.3 });
  assert.equal(townPlanVersion(state, 0, 55, { variant: 0, density: 1 }), 1);
  await saveTownPlanChoice(state, 0, 55, { variant: 0, density: 1 });
  assert.equal(townGenerationVersion(state, 0, 55), 1, 'the original rooms line up again');
});
