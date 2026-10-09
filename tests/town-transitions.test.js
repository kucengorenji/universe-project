import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateHexasphere } from '../src/math/hexasphere.js';
import { MapGenerator } from '../src/map/mapGenerator.js';
import { generateTownLayout } from '../src/modes/town/layout/townLayout.js';
import TownMode from '../src/modes/town/TownMode.js';
import { ENTERABLE } from '../src/modes/town/interior/interior.js';
import { findTownDoors, nearestDoor } from '../src/modes/town/interior/doors.js';
import { TransitionGuard, interiorStateKey, openInteriorSession, storeInterior } from '../src/modes/town/interior/interiorSession.js';
import { optionalPack } from '../src/modes/town/render/packLoading.js';
import { WorldStateStore } from '../src/world/stateStore.js';
import { listQuarantine } from '../src/world/savedRecords.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const memoryState = () => {
  const data = new Map();
  return new WorldStateStore('town-test', { storage: { getItem: k => data.get(k), setItem: (k, v) => data.set(k, v) }, indexedDB: null });
};
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

// ---------------------------------------------------------------- the guard

test('only one transition runs at a time, and a ticket always ends', async () => {
  const guard = new TransitionGuard();
  const first = guard.begin();
  assert.ok(first.alive && guard.busy);
  assert.equal(guard.begin(), null, 'a second one is refused while the first runs');
  assert.equal(await guard.run(async () => 'x'), undefined, 'run() does nothing while busy');
  first.end();
  assert.equal(guard.busy, false);
  assert.equal(await guard.run(async () => 'done'), 'done');
  await assert.rejects(guard.run(async () => { throw new Error('boom'); }), /boom/);
  assert.equal(guard.busy, false, 'a task that throws does not leave the town stuck in "fading"');
});

test('cancel() kills tickets that are already out and does not disturb the next transition', () => {
  const guard = new TransitionGuard();
  const old = guard.begin();
  guard.cancel();
  assert.equal(old.alive, false);
  assert.equal(guard.busy, false);
  const next = guard.begin();
  old.end(); // a late end() from the dead ticket must not release the new one
  assert.equal(guard.busy, true);
  assert.ok(next.alive);
});

// ---------------------------------------------------------------- the race with exit()

function fakeTown(overrides = {}) {
  const log = [], covers = [];
  const overlay = {
    cover: () => { const gate = deferred(); covers.push(gate); return gate.promise; },
    reveal: async () => { log.push('reveal'); }
  };
  const town = {
    transitions: new TransitionGuard(), transition: TownMode.prototype.transition,
    transfer: null, interior: null, tween: {}, orbit: { enabled: true }, pixel: { setActive: () => log.push('pixel') },
    hud: { setPrompt: () => log.push('prompt') }, route: { planet: 1, city: 0 },
    showHomeMessage() {}, saveInterior: () => log.push('save'),
    ctx: {
      overlay, engine: { lastError: null, post: { configure() {} }, quality: { settings: { shadows: false } } },
      world: { ready: Promise.resolve(), state: memoryState() }
    },
    ...overrides
  };
  return { town, log, covers };
}
const door = { b: { id: 'town:1:building:f_house:0:0:0', blueprint: { floors: 1 }, homeRecord: null }, x: 0, z: 0, outYaw: 0 };

test('leaving the town while the door fade runs builds no room and does not lift the director\'s cover', async () => {
  const { town, log, covers } = fakeTown();
  const entering = TownMode.prototype.enterBuilding.call(town, door);
  await tick();
  assert.equal(town.transitions.busy, true);
  town.transitions.cancel(); // what exit() does first
  covers[0].resolve();
  await entering;
  assert.equal(town.interior, null, 'no orphaned Interior');
  assert.ok(!log.includes('reveal'), 'the cover now belongs to the director');
  assert.ok(!log.includes('pixel'), 'the disposed pixel renderer was not touched');
  assert.equal(town.ctx.world.state.get(interiorStateKey(1, door.b.id)), null, 'nothing was saved for a room that never opened');
});

test('leaving the town while the exit fade runs does not dispose the room twice or save over exit()', async () => {
  const disposed = [];
  const { town, log, covers } = fakeTown({ interior: { dispose: () => disposed.push('x') }, interiorDoor: door, interiorStateKey: 'k' });
  const leaving = TownMode.prototype.exitBuilding.call(town);
  await tick();
  town.transitions.cancel();
  covers[0].resolve();
  await leaving;
  assert.deepEqual(disposed, [], 'exit() owns the disposal');
  assert.ok(!log.includes('save') && !log.includes('reveal'));
});

test('a room that fails to build is reported and the cover is lifted, not left black', async () => {
  const { town, log, covers } = fakeTown();
  const entering = TownMode.prototype.enterBuilding.call(town, door); // no furniture pack: building the room throws
  await tick();
  covers[0].resolve();
  await entering;
  assert.ok(town.ctx.engine.lastError, 'QA can see the error');
  assert.equal(log.at(-1), 'reveal');
  assert.equal(town.transitions.busy, false);
  assert.equal(town.interior, null);
  const again = TownMode.prototype.enterBuilding.call(town, door);
  await tick();
  assert.ok(covers[1], 'the player can try again');
  town.transitions.cancel();
  covers[1].resolve();
  await again;
});

test('the sleep fade is a transition too: no second fade while it runs', async () => {
  const { town, covers } = fakeTown();
  const first = town.transition(async ticket => { await town.ctx.overlay.cover('fade'); return ticket.alive; });
  await tick();
  assert.equal(town.transitions.busy, true);
  assert.equal(await town.transition(async () => 'second'), undefined);
  covers[0].resolve();
  assert.equal(await first, true);
  assert.equal(town.transitions.busy, false);
});

// ---------------------------------------------------------------- opening and storing the room

test('opening a room picks the floor, keeps legacy rooms on one floor and passes quarantine along', () => {
  const state = memoryState();
  const tall = { b: { id: 'tall', blueprint: { floors: 3 } } };
  const key = interiorStateKey(1, 'tall');
  assert.equal(key, 'interior:1:tall');
  assert.equal(openInteriorSession(state, 1, tall, 2).floor, 2);
  for (const bad of [-1, 3, 1.5, 'x', null, undefined]) assert.equal(openInteriorSession(state, 1, tall, bad).floor, 0, `floor ${bad}`);
  state.set(key, { schemaVersion: 1, objects: {} });
  const legacy = openInteriorSession(state, 1, tall, 2);
  assert.deepEqual([legacy.floor, legacy.snapshot], [0, { schemaVersion: 1, objects: {} }]);
  state.set(key, { schemaVersion: 7 });
  const foreign = openInteriorSession(state, 1, tall, 1);
  assert.ok(foreign.quarantined);
  assert.equal(foreign.snapshot, undefined, 'the room starts empty');
  assert.equal(listQuarantine(state).length, 1);
});

test('storing a room writes the floor snapshot into its container, or the legacy snapshot as before', () => {
  const state = memoryState();
  const key = 'interior:1:b';
  const record = { schemaVersion: 2, layoutVersion: 2, floors: {} };
  storeInterior(state, { key, record }, { layoutVersion: 2, floor: 1, snapshot: () => ({ schemaVersion: 1, objects: { a: 1 } }) });
  assert.deepEqual(state.get(key).floors, { 1: { schemaVersion: 1, objects: { a: 1 } } });
  storeInterior(state, { key, record }, { layoutVersion: 2, floor: 0, snapshot: () => ({ schemaVersion: 1, objects: {} }) });
  assert.deepEqual(Object.keys(state.get(key).floors), ['0', '1'], 'floors accumulate');
  storeInterior(state, { key: 'interior:1:old', record }, { layoutVersion: 1, floor: 0, snapshot: () => ({ schemaVersion: 1, objects: { lamp: true } }) });
  assert.deepEqual(state.get('interior:1:old'), { schemaVersion: 1, objects: { lamp: true } });
});

// ---------------------------------------------------------------- doors (portals)

test('every enterable building has one door with a stable portal id; nothing opens without interiors', () => {
  const hexasphere = generateHexasphere(3, 10);
  const map = new MapGenerator(hexasphere).generate(17, { planetType: 'terran' });
  const layout = generateTownLayout({ map, hexasphere, cityIndex: 0 });
  const doors = findTownDoors(layout, {}, { enterable: ENTERABLE });
  const enterable = layout.buildings.filter(b => ENTERABLE[b.asset]);
  assert.ok(doors.length > 5);
  assert.ok(doors.length <= enterable.length);
  assert.equal(new Set(doors.map(d => d.b.blueprint.portalId)).size, doors.length, 'portal ids are unique');
  for (const d of doors) {
    assert.equal(d.b.blueprint.portalId, `${d.b.id}:entrance`);
    assert.ok(Number.isFinite(d.x + d.z + d.outYaw));
  }
  assert.deepEqual(findTownDoors(layout, {}, { enterable: ENTERABLE, hasInteriors: false }), []);
  const target = doors[0];
  assert.equal(nearestDoor(doors, target.x + 0.5, target.z, 2.4), target);
  assert.equal(nearestDoor(doors, target.x + 500, target.z + 500), null, 'nothing within reach');
  assert.equal(nearestDoor([], 0, 0), null);
});

// ---------------------------------------------------------------- optional packs

test('an optional pack that fails to load is dropped, not fatal, and the town asks for the planet pack that way', async () => {
  const warn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    assert.equal(await optionalPack(Promise.reject(new Error('404')), 'planet pack'), null);
    const pack = { ok: 1 };
    assert.equal(await optionalPack(Promise.resolve(pack)), pack, 'a pack that loads is passed through');
  } finally { console.warn = warn; }
  assert.equal(warnings.length, 1);
  const source = readFileSync(new URL('../src/modes/town/TownMode.js', import.meta.url), 'utf8');
  assert.match(source, /optionalPack\(loadAssetPack\(ASSETS\.planetPack\)/, 'the planet pack is optional in TownMode.packs()');
  assert.doesNotMatch(source, /^\s*loadAssetPack\(ASSETS\.planetPack\),/m);
});
