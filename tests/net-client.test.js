import test from 'node:test';
import assert from 'node:assert/strict';
import { Telemetry } from '../src/net/telemetry.js';
import { Progress } from '../src/net/progress.js';
import { CloudSync, applySnapshot, buildSnapshot, contentHash, missionSummary } from '../src/net/cloudSave.js';
import { MemoryStorage, inspectEntries } from '../src/net/inspect.js';
import { unseen, markSeen, localized } from '../src/net/announcements.js';
import { KEYS } from '../src/net/config.js';
import { journalKey } from '../src/world/stateStore.js';

const WORLD = 'world:123:grid:5';

test('telemetry batches events and respects the opt-out', () => {
  const storage = new MemoryStorage();
  const sent = [];
  let clock = 1000;
  const tm = new Telemetry({ storage, send: (url, body) => sent.push({ url, body: JSON.parse(body) }), now: () => clock, context: () => ({ worldId: WORLD }) });
  assert.match(storage.getItem(KEYS.device), /^[0-9a-f-]{36}$/);
  tm.track('session_start');
  tm.track('mode', 'planet');
  tm.track('heartbeat', undefined, NaN); // non-finite values are dropped
  clock = 4000;
  assert.equal(tm.flush(), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, '/api/telemetry');
  const batch = sent[0].body;
  assert.equal(batch.deviceId, tm.deviceId);
  assert.equal(batch.sessionId, tm.sessionId);
  assert.equal(batch.sentAt, 4000);
  assert.equal(batch.worldId, WORLD);
  assert.deepEqual(batch.events, [{ t: 1000, type: 'session_start' }, { t: 1000, type: 'mode', name: 'planet' }, { t: 1000, type: 'heartbeat' }]);
  assert.equal(tm.flush(), false, 'nothing queued');

  // A full queue leaves at once, in batches of at most 100.
  for (let i = 0; i < 250; i++) tm.track('mode', 'space');
  assert.ok(sent.slice(1).every((s) => s.body.events.length <= 100));

  tm.setEnabled(false);
  assert.equal(storage.getItem(KEYS.telemetry), 'off');
  const before = sent.length;
  tm.track('mode', 'town');
  tm.flush();
  assert.equal(sent.length, before);
  tm.setEnabled(true);
  assert.equal(storage.getItem(KEYS.telemetry), null);
  // The device id survives: a second instance reuses it.
  assert.equal(new Telemetry({ storage, send: () => {} }).deviceId, tm.deviceId);
  // Inspect mode forces it off whatever the player chose.
  assert.equal(new Telemetry({ storage, send: () => {}, enabled: false }).enabled, false);
});

test('errors are reported once each, at most ten per session', () => {
  const sent = [];
  const tm = new Telemetry({ storage: new MemoryStorage(), send: (_, body) => sent.push(...JSON.parse(body).events) });
  tm.error('TypeError: boom', 'https://aethergate.cloud/assets/TownMode-abc.js?x=1', 12);
  tm.error('TypeError: boom', 'x', 1);
  for (let i = 0; i < 20; i++) tm.error(`Other ${i}`);
  tm.flush();
  assert.equal(sent.length, 10);
  assert.deepEqual(sent[0].data, { message: 'TypeError: boom', source: 'TownMode-abc.js', line: 12 });
});

test('progress counts each planet and town once and adds play time', () => {
  const p = new Progress(new MemoryStorage());
  p.visit(WORLD, { mode: 'space', planet: 2 });
  p.visit(WORLD, { mode: 'planet', planet: 2, city: 1 });
  p.visit(WORLD, { mode: 'town', planet: 2, city: 1 });
  p.visit(WORLD, { mode: 'town', planet: 2, city: 1 });
  p.visit(WORLD, { mode: 'home', planet: 3, city: 0, home: 'x' });
  p.addPlaytime(WORLD, 15);
  p.addPlaytime(WORLD, 15);
  assert.deepEqual(p.get(WORLD), { planets: ['2', '3'], towns: ['2:1', '3:0'], playtime: 30 });
  assert.deepEqual(p.get('world:other:grid:5'), { planets: [], towns: [], playtime: 0 });
});

function fakeWorld(storage) {
  return {
    worldId: WORLD, homeMap: { seed: 123 }, subdivision: 5,
    state: { records: new Map([['manifest', { worldId: WORLD }], ['home:0:1:abc', { id: 'abc' }]]), serial: Promise.resolve() },
    storage
  };
}

function seedStorage() {
  const storage = new MemoryStorage();
  storage.setItem('planet_globe_map_v5', '{"seed":123}');
  storage.setItem('planet_globe_missions', JSON.stringify({ 'home.enter': { done: true }, 'home.sit': { done: true } }));
  storage.setItem('planet_globe_clock_offset', '42');
  storage.setItem('planet_globe_quality', 'low'); // a device preference: never synced
  return storage;
}

test('a snapshot carries the world and its summary, and its hash ignores play time', () => {
  const storage = seedStorage();
  const progress = new Progress(storage);
  progress.visit(WORLD, { mode: 'town', planet: 0, city: 1 });
  const world = fakeWorld(storage);
  const a = buildSnapshot({ storage, worldId: WORLD, seed: 123, subdivision: 5, records: world.state.records, progress, now: 5 });
  assert.deepEqual(Object.keys(a.snapshot.storage).sort(), ['planet_globe_clock_offset', 'planet_globe_map_v5', 'planet_globe_missions', 'planet_globe_progress']);
  assert.equal(a.meta.homes, 1);
  assert.equal(a.meta.planetsLanded, 1);
  assert.equal(a.meta.townsVisited, 1);
  assert.deepEqual(a.meta.missionsDone, []);
  assert.equal(a.meta.missionItems.done, 2);
  progress.addPlaytime(WORLD, 60);
  const b = buildSnapshot({ storage, worldId: WORLD, seed: 123, subdivision: 5, records: world.state.records, progress, now: 9 });
  assert.equal(b.hash, a.hash, 'play time and save time do not count as changes');
  assert.equal(b.meta.playtimeSec, 60);
  world.state.records.set('home:0:1:def', { id: 'def' });
  assert.notEqual(buildSnapshot({ storage, worldId: WORLD, seed: 123, subdivision: 5, records: world.state.records, progress }).hash, a.hash);
  // Record order does not matter.
  const reversed = new Map([...world.state.records].reverse());
  assert.equal(buildSnapshot({ storage, worldId: WORLD, seed: 123, subdivision: 5, records: reversed, progress }).hash,
    buildSnapshot({ storage, worldId: WORLD, seed: 123, subdivision: 5, records: world.state.records, progress }).hash);
  assert.deepEqual(missionSummary('not json'), { missionsDone: [], missionItems: { done: 0, total: missionSummary('{}').missionItems.total } });
});

test('applying a snapshot replaces the world and records the cloud revision', async () => {
  const source = seedStorage();
  const progress = new Progress(source);
  progress.visit(WORLD, { mode: 'planet', planet: 4 });
  const { snapshot } = buildSnapshot({ storage: source, worldId: WORLD, seed: 123, subdivision: 5, records: fakeWorld().state.records, progress });

  const target = new MemoryStorage();
  target.setItem('planet_globe_map_v5', '{"seed":999}');
  target.setItem('planet_globe_quality', 'high');
  target.setItem(KEYS.progress, JSON.stringify({ 'world:999:grid:5': { planets: ['1'], towns: [], playtime: 5 } }));
  await applySnapshot(snapshot, { storage: target, indexedDB: null, rev: 7, now: 100 });
  assert.equal(target.getItem('planet_globe_map_v5'), '{"seed":123}');
  assert.equal(target.getItem('planet_globe_quality'), 'high', 'device preferences stay');
  assert.deepEqual(JSON.parse(target.getItem(journalKey(WORLD))), snapshot.entities, 'without IndexedDB the journal holds the records');
  const prog = JSON.parse(target.getItem(KEYS.progress));
  assert.deepEqual(prog[WORLD].planets, ['4']);
  assert.deepEqual(prog['world:999:grid:5'].planets, ['1'], 'other worlds keep their progress');
  assert.deepEqual(JSON.parse(target.getItem(KEYS.sync))[WORLD], { rev: 7, hash: contentHash(snapshot), at: 100 });
  await assert.rejects(applySnapshot({ schemaVersion: 1, worldId: WORLD, storage: {}, entities: {} }, { storage: target, indexedDB: null }));
});

function syncHarness({ remote = null, dialogAnswer = 'later' } = {}) {
  const storage = seedStorage();
  const world = fakeWorld(storage);
  const calls = [];
  let cloud = remote; // { rev, updatedAt, meta, snapshot }
  const api = async (path, { method = 'GET', body } = {}) => {
    calls.push({ path, method, baseRev: body?.baseRev });
    if (path === '/me/worlds') return { ok: true, status: 200, data: { items: cloud ? [{ worldId: WORLD, rev: cloud.rev, updatedAt: cloud.updatedAt, meta: cloud.meta }] : [] } };
    if (method === 'GET') return cloud ? { ok: true, status: 200, data: { ...cloud, worldId: WORLD } } : { ok: false, status: 404, data: null };
    if (method === 'PUT') {
      const current = cloud?.rev ?? 0;
      if (body.baseRev !== current) return { ok: false, status: 409, data: { error: 'conflict', rev: current, updatedAt: cloud?.updatedAt ?? null, meta: cloud?.meta ?? null } };
      cloud = { rev: current + 1, updatedAt: 1000 + current, meta: body.meta, snapshot: body.snapshot };
      return { ok: true, status: 200, data: { rev: cloud.rev, updatedAt: cloud.updatedAt } };
    }
  };
  const dialogs = [];
  const reloads = [];
  const sync = new CloudSync({
    world, storage, auth: { user: { uid: 'u1' }, token: async () => 'tok' }, progress: new Progress(storage), deviceId: 'd1',
    dialog: async (opts) => { dialogs.push(opts); return typeof dialogAnswer === 'function' ? dialogAnswer(opts) : dialogAnswer; },
    t: (k) => k, api, reload: (url) => reloads.push(url)
  });
  return { sync, storage, world, calls, dialogs, reloads, cloud: () => cloud, setCloud: (c) => { cloud = c; } };
}

test('first sync uploads, then only changes upload', async () => {
  const h = syncHarness();
  await h.sync.check();
  assert.equal(h.sync.status.state, 'synced');
  assert.equal(h.cloud().rev, 1);
  assert.deepEqual(h.calls.map((c) => `${c.method} ${c.baseRev ?? ''}`), ['GET ', 'PUT 0']);
  await h.sync.tick();
  assert.equal(h.calls.length, 2, 'nothing changed: no upload');
  h.storage.setItem('planet_globe_missions', '{"home.light":{"done":true}}');
  await h.sync.tick();
  assert.equal(h.cloud().rev, 2);
  assert.equal(h.calls.at(-1).baseRev, 1);
  await h.sync.check();
  assert.equal(h.calls.at(-1).method, 'GET', 'in step with the cloud: check only lists');
});

test('when another device moved on, the player chooses', async () => {
  const h = syncHarness({ dialogAnswer: 'local' });
  await h.sync.check();
  // Another device uploads rev 2, and this device changes too.
  h.setCloud({ ...h.cloud(), rev: 2, updatedAt: 5000 });
  h.storage.setItem('planet_globe_clock_offset', '99');
  await h.sync.tick();
  assert.equal(h.dialogs.length, 1);
  assert.equal(h.dialogs[0].title, 'net.conflict.title');
  assert.equal(h.cloud().rev, 3, '"keep this device" writes on top of the cloud revision');

  // Cloud newer, nothing changed here: offer to load it; "later" pauses automatic uploads.
  const later = syncHarness({ dialogAnswer: 'later' });
  await later.sync.check();
  later.setCloud({ ...later.cloud(), rev: 5, updatedAt: 9000 });
  await later.sync.check();
  assert.equal(later.dialogs[0].title, 'net.newer.title');
  assert.equal(later.sync.paused, true);
  later.storage.setItem('planet_globe_clock_offset', '1');
  await later.sync.tick();
  assert.equal(later.cloud().rev, 5, 'no upload while the conflict waits');
});

test('loading the cloud copy applies it and reloads', async () => {
  const h = syncHarness({ dialogAnswer: 'cloud' });
  await h.sync.check();
  const other = seedStorage();
  other.setItem('planet_globe_map_v5', '{"seed":123,"from":"other"}');
  const { snapshot } = buildSnapshot({ storage: other, worldId: WORLD, seed: 123, subdivision: 5, records: new Map([['manifest', {}]]), progress: new Progress(other) });
  h.setCloud({ rev: 4, updatedAt: 7000, meta: {}, snapshot });
  await h.sync.check();
  assert.equal(h.storage.getItem('planet_globe_map_v5'), '{"seed":123,"from":"other"}');
  assert.deepEqual(h.reloads, ['/play/#/space']);
  assert.equal(JSON.parse(h.storage.getItem(KEYS.sync))[WORLD].rev, 4);
});

test('a world deleted from the dashboard is not uploaded again unless asked', async () => {
  const h = syncHarness();
  await h.sync.check();
  h.setCloud(null);
  await h.sync.check();
  assert.equal(h.sync.status.state, 'deleted');
  h.storage.setItem('planet_globe_clock_offset', '7');
  await h.sync.tick();
  await h.sync.check();
  assert.equal(h.cloud(), null);
  await h.sync.check({ force: true });
  assert.equal(h.cloud().rev, 1);
  assert.equal(h.sync.status.state, 'synced');
});

test('inspect mode boots from the snapshot with the admin\'s preferences only', () => {
  const real = new MemoryStorage([['planet_globe_quality', 'low'], ['planet_globe_map_v5', 'ADMIN MAP'], ['planet_globe_tips', '["space"]']]);
  const snapshot = { worldId: WORLD, storage: { planet_globe_map_v5: 'PLAYER MAP' }, entities: { manifest: { a: 1 } } };
  const mem = new MemoryStorage(inspectEntries(snapshot, real));
  assert.equal(mem.getItem('planet_globe_map_v5'), 'PLAYER MAP');
  assert.equal(mem.getItem('planet_globe_quality'), 'low');
  assert.deepEqual(JSON.parse(mem.getItem('planet_globe_tips')).sort(), ['intro', 'space']);
  assert.deepEqual(JSON.parse(mem.getItem(journalKey(WORLD))), { manifest: { a: 1 } });
  mem.setItem('x', 1);
  assert.equal(real.getItem('x'), null, 'writes stay in memory');
});

test('announcements show once and fall back to the other language', () => {
  const storage = new MemoryStorage();
  const items = [{ id: 'a', title: { id: '', en: 'Update' }, body: { id: 'Isi', en: '' } }, { id: 'b', title: { id: 'B', en: 'B' }, body: { id: '', en: '' } }];
  markSeen('a', storage);
  assert.deepEqual(unseen(items, storage).map((a) => a.id), ['b']);
  assert.deepEqual(localized(items[0], 'id'), { title: 'Update', body: 'Isi' });
  assert.deepEqual(localized(items[0], 'en'), { title: 'Update', body: 'Isi' });
});
