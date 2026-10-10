import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/world.js';
import { STORAGE_KEY } from '../src/map/mapGenerator.js';
import { ScopedProgress, scopedKey } from '../src/world/scopedProgress.js';
import { Missions } from '../src/core/missions.js';
import { Tips } from '../src/core/tips.js';
import { saveStatus } from '../src/world/saveStatus.js';
import { worldImpact } from '../src/world/worldImpact.js';
import { quarantineRecord } from '../src/world/savedRecords.js';
import { TwoStepConfirm } from '../src/ui/twoStep.js';
import { WorldStateStore } from '../src/world/stateStore.js';
import { t } from '../src/i18n/index.js';

function memoryStorage({ failWrites = false } = {}) {
  const data = new Map();
  const storage = {
    data, failWrites,
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem(key, value) { if (storage.failWrites) throw new DOMException('The quota has been exceeded', 'QuotaExceededError'); data.set(key, String(value)); },
    removeItem: key => data.delete(key)
  };
  return storage;
}

/** Run with a browser-like localStorage/window, whatever the test environment has. */
async function withBrowser(storage, run) {
  const saved = ['localStorage', 'window'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'window', { value: { addEventListener() {} }, configurable: true, writable: true });
  try { return await run(); } finally {
    for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  }
}

const fakeElement = () => {
  const el = new Proxy({}, {
    get: (target, prop) => prop in target ? target[prop] : prop === 'querySelector' ? () => el : prop === 'classList' ? { add() {}, remove() {}, toggle() {} } : prop === 'dataset' ? {} : () => {},
    set: (target, prop, value) => { target[prop] = value; return true; }
  });
  return el;
};
const fakeWorld = worldId => {
  const listeners = new Set();
  return { worldId, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); }, emit(event) { listeners.forEach(fn => fn(event)); } };
};
const quietMissions = (...args) => Object.assign(new Missions(fakeElement(), null, ...args), { toast() {} });

// ---------------------------------------------------------------- scoped progress

test('progress is stored per world and two worlds never share it', () => {
  const storage = memoryStorage();
  const a = new ScopedProgress('planet_globe_missions', { storage }), b = new ScopedProgress('planet_globe_missions', { storage });
  assert.equal(scopedKey('planet_globe_missions', 'world:1:grid:5'), 'planet_globe_missions:world:1:grid:5');
  assert.equal(a.save('world:1:grid:5', { 'home.enter': { done: true } }), true);
  assert.deepEqual(b.load('world:2:grid:5', {}), {}, 'another seed starts clean');
  assert.deepEqual(b.load('world:1:grid:5', {}), { 'home.enter': { done: true } });
  assert.equal(storage.getItem('planet_globe_missions'), null, 'the bare global key is never written');
});

test('the old global key is adopted once, by the first world that opens, and left in place', () => {
  const storage = memoryStorage();
  storage.setItem('planet_globe_tips', JSON.stringify(['intro', 'town']));
  const progress = new ScopedProgress('planet_globe_tips', { storage });
  assert.deepEqual(progress.load('world:7:grid:5', []), ['intro', 'town']);
  assert.equal(storage.getItem('planet_globe_tips:world:7:grid:5'), JSON.stringify(['intro', 'town']));
  assert.equal(storage.getItem('planet_globe_tips:migrated'), 'world:7:grid:5');
  assert.deepEqual(progress.load('world:8:grid:5', []), [], 'a later world does not inherit it');
  assert.equal(storage.getItem('planet_globe_tips'), JSON.stringify(['intro', 'town']), 'older builds still find their key');
  progress.save('world:7:grid:5', ['intro']);
  assert.deepEqual(progress.load('world:7:grid:5', []), ['intro'], 'the world keeps its own value after migration');
});

test('migration never overwrites a world that already has progress, and retries after a failed write', () => {
  const storage = memoryStorage();
  storage.setItem('planet_globe_missions', JSON.stringify({ 'home.sit': { done: true } }));
  storage.setItem('planet_globe_missions:world:1:grid:5', JSON.stringify({ 'home.enter': { done: true } }));
  const progress = new ScopedProgress('planet_globe_missions', { storage });
  assert.deepEqual(progress.load('world:1:grid:5', {}), { 'home.enter': { done: true } });
  assert.equal(storage.getItem('planet_globe_missions:migrated'), null);

  const blocked = memoryStorage({ failWrites: true });
  blocked.data.set('planet_globe_missions', JSON.stringify({ 'home.sit': { done: true } }));
  const retry = new ScopedProgress('planet_globe_missions', { storage: blocked });
  assert.deepEqual(retry.load('world:2:grid:5', {}), { 'home.sit': { done: true } }, 'adopted in memory');
  assert.ok(retry.error, 'the failed write is kept');
  assert.equal(blocked.getItem('planet_globe_missions:migrated'), null, 'not marked as migrated');
  blocked.failWrites = false;
  retry.load('world:2:grid:5', {});
  assert.equal(blocked.getItem('planet_globe_missions:migrated'), 'world:2:grid:5', 'the next load completes the migration');
});

test('a failed or unavailable write is reported, and unreadable values start clean', () => {
  const storage = memoryStorage({ failWrites: true });
  const progress = new ScopedProgress('planet_globe_missions', { storage });
  assert.equal(progress.save('w', { a: 1 }), false);
  assert.match(progress.error.message, /quota/i);
  storage.failWrites = false;
  assert.equal(progress.save('w', { a: 1 }), true);
  assert.equal(progress.error, null);
  storage.data.set('planet_globe_missions:w', '{not json');
  assert.deepEqual(progress.load('w', { fresh: true }), { fresh: true });
  assert.equal(new ScopedProgress('x', { storage: null }).save('w', 1), false, 'no storage at all');
});

// ---------------------------------------------------------------- missions and tips per world

test('missions: two worlds keep separate checklists, reset only touches the current one', async () => {
  await withBrowser(memoryStorage(), () => {
    const first = fakeWorld('world:11:grid:5');
    const missions = quietMissions(first);
    missions.emit('enter_house');
    missions.emit('land', 'a');
    assert.equal(missions.doneCount(), 1);
    const second = quietMissions(fakeWorld('world:22:grid:5'));
    assert.equal(second.doneCount(), 0, 'a different seed does not see the progress');
    assert.equal(quietMissions(first).doneCount(), 1, 'the first world still has it after a reload');

    // The home world is replaced while the game runs: the log follows the new world
    first.worldId = 'world:33:grid:5';
    first.emit('world');
    assert.equal(missions.doneCount(), 0);
    missions.emit('sit');
    first.worldId = 'world:11:grid:5';
    first.emit('world');
    assert.equal(missions.doneCount(), 1, 'coming back to the old seed brings its progress back');
    missions.reset();
    assert.equal(missions.doneCount(), 0);
    assert.equal(quietMissions(fakeWorld('world:33:grid:5')).doneCount(), 1, 'reset did not touch another world');
  });
});

test('missions and tips adopt the old global progress once, into the world that is active', async () => {
  const storage = memoryStorage();
  storage.setItem('planet_globe_missions', JSON.stringify({ 'home.enter': { done: true, n: 0, seen: [] }, 'gone.item': { done: true } }));
  storage.setItem('planet_globe_tips', JSON.stringify(['intro', 'planet']));
  await withBrowser(storage, () => {
    const missions = quietMissions(fakeWorld('world:5:grid:5'));
    assert.equal(missions.doneCount(), 1, 'the finished item came along');
    assert.equal(missions.state['gone.item'], undefined, 'items that no longer exist are still dropped');
    assert.equal(quietMissions(fakeWorld('world:6:grid:5')).doneCount(), 0);
    const tips = new Tips(fakeElement(), fakeWorld('world:5:grid:5'));
    assert.deepEqual([...tips.seen], ['intro', 'planet']);
    assert.deepEqual([...new Tips(fakeElement(), fakeWorld('world:6:grid:5')).seen], []);
  });
});

test('missions and tips report a failed save', async () => {
  await withBrowser(memoryStorage({ failWrites: true }), () => {
    const missions = quietMissions(fakeWorld('world:1:grid:5'));
    assert.equal(missions.saveError, null);
    missions.emit('enter_house');
    assert.ok(missions.saveError, 'the checklist could not be stored and says so');
    assert.equal(missions.doneCount(), 1, 'the session still works from memory');
    const tips = new Tips(fakeElement(), fakeWorld('world:1:grid:5'));
    tips.seen.add('town');
    assert.equal(tips.save(), false);
    assert.ok(tips.saveError);
  });
});

// ---------------------------------------------------------------- the world map

test('a failed map save is kept on the world and announced, success clears it', async () => {
  const storage = memoryStorage({ failWrites: true });
  await withBrowser(storage, () => {
    const world = new World({ subdivision: 3 });
    assert.ok(world.mapSaveError, 'the first world could not be written');
    assert.match(world.mapSaveError.message, /quota/i, 'with the browser reason');
    assert.equal(storage.getItem(STORAGE_KEY), null);
    const events = [];
    world.subscribe(event => events.push(event));
    storage.failWrites = false;
    const id = world.worldId;
    world.regenerateHome(4242, { subdivision: 3 });
    assert.equal(world.mapSaveError, null, 'a later write clears it');
    assert.notEqual(world.worldId, id);
    assert.deepEqual(events, ['storage', 'world']);
    assert.ok(storage.getItem(STORAGE_KEY));
    storage.failWrites = true;
    events.length = 0;
    assert.equal(world.saveHomeMap(), false);
    assert.deepEqual(events, ['storage']);
    world.saveHomeMap();
    assert.deepEqual(events, ['storage'], 'announced when it changes, not on every attempt');
  });
});

test('the save status names the worst problem first and every level has text', async () => {
  const state = (error = null) => ({ error, records: new Map(), get: () => null });
  const world = (extra = {}) => ({ mapSaveError: null, state: state(), ...extra });
  assert.equal(saveStatus({ world: world() }).level, 'ok');
  assert.equal(saveStatus({}).level, 'ok');
  assert.deepEqual(saveStatus({ world: world({ mapSaveError: new Error('x'), state: state(new Error('y')) }) }), { level: 'error', key: 'pause.save.mapError' });
  assert.equal(saveStatus({ world: world({ state: state(new Error('y')) }) }).key, 'pause.save.error');
  assert.equal(saveStatus({ world: world(), missions: { saveError: new Error('z') } }).key, 'pause.save.error');
  assert.equal(saveStatus({ world: world(), tips: { saveError: new Error('z') } }).level, 'error');
  const real = new WorldStateStore('status', { storage: memoryStorage(), indexedDB: null });
  quarantineRecord(real, 'home:1:1:a', { schemaVersion: 9 }, 'unknown-schema');
  const notice = saveStatus({ world: { mapSaveError: null, state: real } });
  assert.deepEqual([notice.level, notice.key, notice.params], ['notice', 'pause.save.quarantine', { n: 1 }]);
  for (const key of ['pause.save.ok', 'pause.save.error', 'pause.save.mapError', 'pause.save.alert', 'planet.regen.confirm', 'planet.regen.confirmBtn']) {
    assert.notEqual(t(key, { seed: 1, rooms: 0, homes: 0, campaigns: 0, missions: 0, n: 1 }), key, key);
  }
});

// ---------------------------------------------------------------- replacing the world

test('the regenerate warning counts what stays behind under the old seed', () => {
  const state = new WorldStateStore('world:9:grid:5', { storage: memoryStorage(), indexedDB: null });
  state.set('interior:1:town:1:building:a', { schemaVersion: 2, floors: {} });
  state.set('interior:1:town:1:building:b', { schemaVersion: 2, floors: {} });
  state.set('interior:1:town:1:building:c', null);
  state.set('home:1:0:x', { schemaVersion: 1 });
  state.set('town-layout:1:5', { version: 5 });
  const world = { worldId: 'world:9:grid:5', homeMap: { seed: 9 }, state };
  const trade = { items: [{ worldId: 'world:9:grid:5' }, { worldId: 'world:9:grid:5' }, { worldId: 'world:other' }] };
  assert.deepEqual(worldImpact({ world, trade, missions: { doneCount: () => 3 } }), { seed: 9, rooms: 2, homes: 1, campaigns: 2, missions: 3 });
  assert.deepEqual(worldImpact({ world }), { seed: 9, rooms: 2, homes: 1, campaigns: 0, missions: 0 });
});

test('replacing the world needs a second press on the same button within the time limit', () => {
  let clock = 0;
  const gate = new TwoStepConfirm({ ms: 1000, now: () => clock });
  assert.equal(gate.press('rebuild'), false, 'first press only arms');
  assert.equal(gate.armed, 'rebuild');
  assert.equal(gate.press('shuffle'), false, 'another button starts over');
  assert.equal(gate.press('rebuild'), false);
  clock += 1001;
  assert.equal(gate.armed, null);
  assert.equal(gate.press('rebuild'), false, 'too late: it arms again');
  clock += 500;
  assert.equal(gate.press('rebuild'), true, 'second press in time confirms');
  assert.equal(gate.press('rebuild'), false, 'a confirmation is used up');
  gate.cancel();
  assert.equal(gate.armed, null);
});
