import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldStateStore } from '../src/world/stateStore.js';
import { homeKey, ensureHomeRecord, loadHomeRecord, saveHomeDraft, applyHomeDraft, listTownHomes, townHomeContext, polygonsOverlap } from '../src/world/homeState.js';
import { townGenerationVersion, townHasSavedHomes, saveTownPlanChoice, TOWN_LAYOUT_VERSION } from '../src/world/townGeneration.js';
import { buildingId } from '../src/world/identity.js';
import { parseRoute, formatRoute } from '../src/core/router.js';
import { Director } from '../src/core/director.js';
import TownMode from '../src/modes/town/TownMode.js';
import { createHomeBlueprint, footprintBounds } from '../src/modes/home/homeBlueprint.js';
import { townToLocal } from '../src/world/buildingBlueprint.js';

const rectangle = (minX, minZ, maxX, maxZ) => [{ x: minX, z: minZ }, { x: maxX, z: minZ }, { x: maxX, z: maxZ }, { x: minX, z: maxZ }];
function fixture() {
  const data = new Map();
  const opts = { storage: { getItem: k => data.get(k), setItem: (k, v) => data.set(k, v) }, indexedDB: null };
  return { state: new WorldStateStore('home-test', opts), opts };
}
const originalBuilding = { asset: 'f_house', x: 17, z: 22, yaw: Math.PI / 2, w: 7.6, d: 6.6 };
const makeRecord = (state, overrides = {}) => ensureHomeRecord(state, { planet: 1, city: 2, townSeed: 55, layoutSeed: 55, layoutVersion: 2, building: originalBuilding, plot: rectangle(-6, -10, 6, 6), ...overrides });

test('home drafts and applied homes are independent durable snapshots with immutable lot identity', async () => {
  const { state, opts } = fixture();
  const record = makeRecord(state);
  const route = { mode: 'home', planet: 1, city: 2, home: record.id };
  assert.equal(record.id, buildingId(55, originalBuilding));
  assert.equal(record.source.floors, 2);
  const bp = { id: record.id, plot: record.plot, floors: [{ id: 'floor:0', rooms: [] }], items: [{ id: 'sofa', x: 1, z: 2 }] };
  saveHomeDraft(state, route, bp);
  bp.items[0].x = 900;
  assert.equal(loadHomeRecord(state, route).draft.items[0].x, 1, 'caller mutation cannot change the saved draft');
  assert.equal(loadHomeRecord(state, route).applied, null, 'saving a draft does not change the city');
  applyHomeDraft(state, route);
  const changed = loadHomeRecord(state, route).draft;
  changed.items[0].x = 4;
  saveHomeDraft(state, route, changed);
  await state.serial;
  const reloaded = new WorldStateStore('home-test', opts);
  await reloaded.ready;
  const restored = loadHomeRecord(reloaded, route);
  assert.equal(restored.id, record.id);
  assert.equal(restored.draft.items[0].x, 4);
  assert.equal(restored.applied.items[0].x, 1);
  assert.deepEqual(restored.origin, record.origin);
  assert.equal(listTownHomes(reloaded, 1, 2).length, 1);
  assert.equal(listTownHomes(reloaded, 1, 3).length, 0);
  assert.deepEqual(ensureHomeRecord(reloaded, { ...restored, building: { ...originalBuilding, asset: 'f_house_small', id: record.id, x: 99 } }), restored, 'editing the shell cannot re-key or relocate its claim');
  assert.equal(reloaded.records.has(homeKey(1, 2, record.id)), true);
});

test('home claims protect generator versions and reject town rerolls that would orphan houses', async () => {
  const { state } = fixture();
  await state.set('town-layout:1:55', { version: 2, townSeed: 55, planet: 1, variant: 0, density: 1 });
  const home = makeRecord(state);
  assert.equal(townHasSavedHomes(state, 1, 55), true);
  assert.equal(townGenerationVersion(state, 1, 55), 2);
  assert.equal(townGenerationVersion(state, 1, 56), TOWN_LAYOUT_VERSION);
  assert.throws(() => saveTownPlanChoice(state, 1, 55, { variant: 12, density: 1 }), /dikunci/);
  await saveTownPlanChoice(state, 1, 55, { variant: 0, density: 1 });
  assert.deepEqual(state.get(homeKey(1, 2, home.id)), home);
  const other = fixture().state;
  makeRecord(other);
  assert.equal(townGenerationVersion(other, 1, 55), 2, 'record pins its source version even if layout metadata was lost');
});

test('applying an expanded plot rejects protected roads and current neighboring home claims', () => {
  const { state } = fixture();
  const record = makeRecord(state, { obstacles: [{ kind: 'road', points: rectangle(7, -20, 10, 20) }] });
  const route = { mode: 'home', planet: 1, city: 2, home: record.id };
  assert.throws(() => applyHomeDraft(state, route, { plot: rectangle(-6, -10, 8, 6) }), /jalan/);
  const neighbor = makeRecord(state, { building: { ...originalBuilding, id: 'neighbor', x: 17, z: 32 }, plot: rectangle(-3, -3, 3, 3) });
  assert.equal(neighbor.id, 'neighbor');
  assert.throws(() => applyHomeDraft(state, route, { plot: rectangle(-6, -10, 12, 6) }), /jalan|rumah lain/);
  // Remove the old obstacle snapshot: the live registry must still catch the other home's plot.
  state.set(homeKey(1, 2, record.id), { ...record, obstacles: [] });
  assert.throws(() => applyHomeDraft(state, route, { plot: rectangle(-6, -10, 12, 6) }), /rumah lain/);
  assert.equal(loadHomeRecord(state, route).applied, null);
});

test('town home plot grows into dry vacant land while preserving neighbors, pavement and public parks', () => {
  const building = { id: 'selected', asset: 'f_house_small', x: 0, z: 0, yaw: 0, w: 6, d: 6 };
  const neighbor = { ...building, id: 'neighbor', x: 9 };
  const layout = { modern: false, layoutVersion: 4, buildings: [building, neighbor], streets: [{ w: 4, pts: [[-30, 8], [30, 8]] }], parks: [{ poly: rectangle(-15, -20, -10, 20) }], rivers: [], fields2: [], trees: [], props: [], walls: [], docks: [], fields: { sample: (x, z) => ({ land: z < -20 ? 0 : 1 }) } };
  const context = townHomeContext(layout, building);
  assert.ok(Math.min(...context.plot.map(p => p.z)) < -3, 'rear yard uses vacant land');
  assert.ok(context.obstacles.some(o => o.kind === 'neighbor-plot'));
  assert.ok(context.obstacles.some(o => o.kind === 'water'));
  for (const obstacle of context.obstacles) assert.equal(polygonsOverlap(context.plot, obstacle.points), false, `initial plot avoids ${obstacle.kind}`);
});

test('claim overlap detects collinear strips while allowing a shared boundary', () => {
  assert.equal(polygonsOverlap(rectangle(0, 0, 10, 1), rectangle(9, 0, 20, 1)), true);
  assert.equal(polygonsOverlap(rectangle(0, 0, 10, 1), rectangle(10, 0, 20, 1)), false);
  assert.equal(polygonsOverlap(rectangle(0, 0, 10, 1), rectangle(0, 1, 10, 2)), false);
});

test('home routes roundtrip identities and reject malformed or unsafe IDs without affecting old routes', () => {
  const route = { mode: 'home', planet: 1, city: 2, home: buildingId(55, originalBuilding) };
  assert.deepEqual(parseRoute(formatRoute(route)), route);
  for (const hash of ['#/home/1/2/%2Fsecret', '#/home/1/2/%00bad', '#/home/1/2/%', '#/home/1/2/../extra', '#/home/1/x/id']) assert.equal(parseRoute(hash), null);
  assert.deepEqual(parseRoute('#/town/1/2'), { mode: 'town', planet: 1, city: 2 });
  const world = { planet: () => ({ landable: true }), mapFor: () => ({ cities: [{}, {}, {}] }), state: { get: key => key === `home:1:2:${route.home}` ? { id: route.home } : null } };
  assert.deepEqual(Director.prototype.sanitize.call({ world }, route), route);
  assert.deepEqual(Director.prototype.sanitize.call({ world }, { ...route, home: '../bad' }), { mode: 'town', planet: 1, city: 2 });
  assert.deepEqual(Director.prototype.sanitize.call({ world }, { ...route, home: 'missing_home' }), { mode: 'town', planet: 1, city: 2 });
  assert.deepEqual(Director.prototype.sanitize.call({ world }, { ...route, city: 30 }), { mode: 'planet', planet: 1, city: null });
});

test('applied structure replaces its town collider and door while untouched houses retain their interiors', async () => {
  const { state } = fixture();
  const record = makeRecord(state);
  const route = { mode: 'home', planet: 1, city: 2, home: record.id };
  const bp = createHomeBlueprint({ id: record.id, seed: 'town-authored', plot: record.plot, floors: 2, attic: true, shape: 'curved' });
  applyHomeDraft(state, route, bp);
  const building = { ...originalBuilding, id: record.id };
  const untouched = { ...building, id: 'old-house', x: 50 };
  const visits = [];
  const mode = new TownMode({ world: { state }, director: { go: destination => visits.push(destination) } }, { mode: 'town', planet: 1, city: 2 });
  mode.footprints = { f_house: { minX: -3.8, maxX: 3.8, minZ: -3.3, maxZ: 3.3, maxY: 10 } };
  mode.layout = { seed: 55, buildings: [building, untouched], trees: [{ x: building.x, z: building.z }], colliders: [{ type: 'box', x: building.x, z: building.z, hw: 3.8, hd: 3.3, yaw: building.yaw }, { type: 'circle', x: building.x, z: building.z, r: .6 } ] };
  mode.furniture = {};
  mode.prepareAuthoredHomes();
  assert.equal(mode.layout.colliders.length, 1, 'old shell and trees inside the edited plot are removed');
  assert.equal(mode.layout.colliders[0], building.homeCollider);
  assert.deepEqual(building.homeBounds, footprintBounds(bp));
  assert.equal(untouched.homeRecord, undefined);
  const doors = mode.findDoors();
  assert.equal(doors.length, 2);
  const editedDoor = doors.find(door => door.b.id === record.id);
  assert.ok(townToLocal(record.origin, editedDoor).z > building.homeBounds.maxZ, 'authored entrance lies outside its new footprint');
  assert.equal(editedDoor.b.blueprint.portalId, `${record.id}:entrance`);
  await mode.enterBuilding(editedDoor);
  assert.deepEqual(visits, [route], 'walking through an authored door opens the authored home instead of a stock rectangular interior');
  assert.ok(doors.find(door => door.b.id === 'old-house').b.blueprint.interior, 'stock interiors retain the old blueprint adapter');
});
