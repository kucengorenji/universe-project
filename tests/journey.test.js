import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldStateStore } from '../src/world/stateStore.js';
import { Journey, STAGES, NEAR_DOOR_M, JOURNEY_KEY, diffTrace, verifyTrace, describeObjective, newRecord, rank } from '../src/core/journey.js';
import { JOURNEY_SCHEMA_VERSION } from '../src/world/versions.js';
import { listQuarantine } from '../src/world/savedRecords.js';
import { t } from '../src/i18n/index.js';

function store(name = 'journey-test', { failWrites = false } = {}) {
  const data = new Map();
  const storage = {
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem(k, v) { if (storage.failWrites) throw new Error('quota'); data.set(k, v); },
    failWrites
  };
  const open = () => new WorldStateStore(name, { storage, indexedDB: null });
  return { storage, open, state: open() };
}

const HOME = { buildingId: 'town:1:building:f_house:100:200:0', portalId: 'town:1:building:f_house:100:200:0:entrance', asset: 'f_house', tier: 0 };
const lampOff = { schemaVersion: 1, holdingId: null, objects: { 'light:::1.000:2.000:0': { on: false, target: 0 }, 'item:it_apple:3.000:4.000:0': { on: false, target: 0, position: [3, 0.9, 4], x: 3, z: 4 } } };
const lampOn = { ...lampOff, objects: { ...lampOff.objects, 'light:::1.000:2.000:0': { on: true, target: 0 } } };
const itemMoved = { ...lampOff, objects: { ...lampOff.objects, 'item:it_apple:3.000:4.000:0': { on: false, target: 0, position: [5, 1.1, 6], x: 5, z: 6 } } };

function make(options = {}) {
  const s = options.store || store();
  const journey = new Journey({ state: s.state, homePlanet: 2, homeCity: 1, session: options.session || 'session-a' });
  const events = [];
  journey.subscribe(e => { if (e.type !== 'change') events.push(e.type === 'toast' ? e.key : e.type); });
  return { ...s, journey, events };
}
const reach = async (journey, to) => {
  if (rank(to) >= 1) journey.planet(2);
  if (rank(to) >= 2) { journey.town(2, 1); journey.setHome(HOME); }
  if (rank(to) >= 3) journey.near(3);
  if (rank(to) >= 4) journey.enterHome({ buildingId: HOME.buildingId, floors: {} });
  if (rank(to) >= 5) await journey.changed({ buildingId: HOME.buildingId, floor: 0, before: lampOff, after: lampOn });
};

// ---------------------------------------------------------------- the order of the journey

test('the journey goes J1 to done in order, with one toast per real step', async () => {
  const { journey, events } = make();
  assert.equal(journey.stage, 'j1');
  assert.equal(journey.planet(0), false, 'another planet does nothing');
  assert.equal(journey.planet(2), true);
  assert.equal(journey.stage, 'j2');
  assert.equal(journey.town(2, 0), false, 'a town on the home planet that is not the hometown does nothing');
  assert.equal(journey.town(2, 1), true);
  assert.equal(journey.stage, 'j3');
  journey.setHome(HOME);
  journey.near(NEAR_DOOR_M + 0.1);
  assert.equal(journey.stage, 'j3', 'six metres or more is not near');
  journey.near(NEAR_DOOR_M - 0.1);
  assert.equal(journey.stage, 'j4');
  assert.equal(journey.enterHome({ buildingId: 'town:1:building:m_shop:1:2:3', floors: {} }), false, 'another house does not count');
  journey.enterHome({ buildingId: HOME.buildingId, floors: {} });
  assert.equal(journey.stage, 'j5');
  assert.equal(await journey.changed({ buildingId: HOME.buildingId, floor: 0, before: lampOff, after: lampOn }), true);
  assert.equal(journey.stage, 'j6');
  assert.deepEqual(events, ['journey.toast.j1', 'journey.toast.j2', 'journey.toast.j3', 'journey.toast.j4', 'journey.toast.j5']);
  assert.deepEqual(STAGES, ['j1', 'j2', 'j3', 'j4', 'j5', 'j6']);
});

test('events are idempotent and the journey never moves backwards', async () => {
  const { journey, events } = make();
  await reach(journey, 'j5');
  assert.equal(journey.stage, 'j5');
  const before = JSON.stringify(journey.record);
  const toasts = events.length;
  journey.planet(2); journey.town(2, 1); journey.near(1); journey.enterHome({ buildingId: HOME.buildingId, floors: {} });
  journey.setHome({ ...HOME, buildingId: 'another-house' });
  assert.equal(JSON.stringify(journey.record), before, 'nothing changed');
  assert.equal(journey.home.buildingId, HOME.buildingId, 'the saved starter house is never replaced');
  assert.equal(events.length, toasts);
  assert.equal(journey.stage, 'j5');
});

test('a later step completes the ones before it: reloading in the hometown, or walking straight into the house', async () => {
  const a = make();
  a.journey.town(2, 1);
  assert.equal(a.journey.stage, 'j3', 'landing in the hometown means the planet was reached too');
  const b = make();
  b.journey.setHome(HOME);
  b.journey.enterHome({ buildingId: HOME.buildingId, floors: {} });
  assert.equal(b.journey.stage, 'j5');
});

test('light off, a pick-up or a change in another house is not a trace', async () => {
  const { journey } = make();
  await reach(journey, 'j5');
  assert.equal(await journey.changed({ buildingId: 'other', floor: 0, before: lampOff, after: lampOn }), false);
  assert.equal(await journey.changed({ buildingId: HOME.buildingId, floor: 0, before: lampOn, after: lampOff }), false);
  assert.equal(await journey.changed({ buildingId: HOME.buildingId, floor: 0, before: lampOff, after: lampOff }), false);
  assert.equal(journey.stage, 'j5');
  assert.equal(await journey.changed({ buildingId: HOME.buildingId, floor: 0, before: lampOff, after: itemMoved }), true, 'an item put down elsewhere counts');
  assert.equal(journey.record.trace.kind, 'item');
});

// ---------------------------------------------------------------- saving gates J5

test('J5 is not reached until the room write succeeded, and a failed write keeps J5', async () => {
  const s = store('fail', { failWrites: true });
  const { journey } = make({ store: s });
  journey.setHome(HOME);
  journey.advance('j5');
  s.state.set('interior:x', { a: 1 }); // the room write the caller queues first (and the browser refuses)
  const saving = journey.changed({ buildingId: HOME.buildingId, floor: 0, before: lampOff, after: lampOn });
  assert.equal(journey.status.save, 'pending', 'the HUD can say "saving"');
  assert.equal(await saving, false);
  assert.equal(journey.stage, 'j5');
  assert.equal(journey.status.save, 'failed');
  assert.equal(journey.record.trace, null);
  s.storage.failWrites = false;
  s.state.set('interior:x', { a: 2 }); // storage works again
  assert.equal(await journey.changed({ buildingId: HOME.buildingId, floor: 0, before: lampOff, after: lampOn }), true, 'doing it again works');
  assert.equal(journey.stage, 'j6');
});

test('the room can be saved while the progress record is not: the HUD gets progressFailed, the stage still moves', async () => {
  const s = store('half');
  const { journey } = make({ store: s });
  journey.setHome(HOME);
  journey.advance('j5');
  const realSet = s.state.set.bind(s.state);
  s.state.set = (key, value) => { if (key === JOURNEY_KEY) { s.state.error = new Error('quota'); return Promise.resolve(); } return realSet(key, value); };
  assert.equal(await journey.changed({ buildingId: HOME.buildingId, floor: 0, before: lampOff, after: lampOn }), true);
  assert.equal(journey.stage, 'j6');
  assert.equal(journey.status.progressFailed, true);
});

// ---------------------------------------------------------------- J6 and the celebration

const floorsWith = snapshot => ({ 0: snapshot });

test('coming back in the same visit does not celebrate; leaving for space, or a reload, then coming back does', async () => {
  const a = make();
  await reach(a.journey, 'j6');
  assert.equal(a.journey.away, false);
  assert.equal(a.journey.enterHome({ buildingId: HOME.buildingId, floors: floorsWith(lampOn) }), false);
  assert.equal(a.journey.stage, 'j6');
  a.journey.space();
  assert.equal(a.journey.away, true);
  assert.equal(a.journey.enterHome({ buildingId: HOME.buildingId, floors: floorsWith(lampOn) }), true);
  assert.equal(a.journey.done, true);
  await a.state.serial;
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(a.events.filter(e => e === 'complete'), ['complete']);

  const b = make({ session: 'session-a' });
  await reach(b.journey, 'j6');
  const reloaded = new Journey({ state: b.open(), homePlanet: 2, homeCity: 1, session: 'session-b' });
  assert.equal(reloaded.stage, 'j6');
  assert.equal(reloaded.away, true, 'a new page load counts as having been away');
  assert.equal(reloaded.enterHome({ buildingId: HOME.buildingId, floors: floorsWith(lampOn) }), true);
  assert.equal(reloaded.done, true);
});

test('the celebration needs the saved room to match: a light that came back off is a restore failure, not a win', async () => {
  const { journey, events } = make();
  await reach(journey, 'j6');
  journey.space();
  assert.equal(journey.enterHome({ buildingId: HOME.buildingId, floors: floorsWith(lampOff) }), false);
  assert.equal(journey.done, false);
  assert.equal(journey.status.restoreFailed, true);
  assert.ok(!events.includes('complete'));
  assert.equal(journey.enterHome({ buildingId: HOME.buildingId, floors: {} }), false, 'a floor that is missing is also a mismatch');
  assert.equal(journey.enterHome({ buildingId: HOME.buildingId, floors: floorsWith(lampOn) }), true, 'and a later correct restore still finishes');
  assert.equal(journey.status.restoreFailed, false);
});

test('after done nothing celebrates again, not an event, not a reload', async () => {
  const s = store();
  const first = make({ store: s });
  await reach(first.journey, 'j6');
  first.journey.space();
  first.journey.enterHome({ buildingId: HOME.buildingId, floors: floorsWith(lampOn) });
  await s.state.serial;
  const again = make({ store: { ...s, state: s.open() }, session: 'later' });
  assert.equal(again.journey.done, true);
  assert.equal(again.journey.enterHome({ buildingId: HOME.buildingId, floors: floorsWith(lampOn) }), false);
  again.journey.planet(2); again.journey.town(2, 1); again.journey.space();
  assert.ok(!again.events.includes('complete'));
  assert.equal(again.journey.objective(), null, 'no objective line once finished');
});

// ---------------------------------------------------------------- persist, restore, schema

test('progress, the starter house and the trace survive a reload', async () => {
  const { journey, open, state } = make();
  await reach(journey, 'j6');
  await state.serial;
  const stored = open().get(JOURNEY_KEY);
  assert.equal(stored.schemaVersion, JOURNEY_SCHEMA_VERSION);
  const reloaded = new Journey({ state: open(), homePlanet: 2, homeCity: 1, session: 'next' });
  assert.equal(reloaded.stage, 'j6');
  assert.equal(reloaded.home.buildingId, HOME.buildingId);
  assert.deepEqual(reloaded.record.trace.expected, { on: true });
  assert.equal(reloaded.record.trace.session, 'session-a');
});

test('a journey record this build cannot read is quarantined and the journey starts fresh', async () => {
  for (const bad of [{ schemaVersion: 9, stage: 'j3' }, { schemaVersion: 1, stage: 'nowhere' }, { stage: 'j2' }, 'garbage']) {
    const s = store();
    s.state.set(JOURNEY_KEY, bad);
    const journey = new Journey({ state: s.state, homePlanet: 2, homeCity: 1 });
    assert.equal(journey.stage, 'j1', JSON.stringify(bad));
    assert.equal(journey.status.quarantine, 'pending');
    await s.state.serial;
    await new Promise(r => setTimeout(r, 0));
    assert.equal(journey.status.quarantine, 'saved');
    assert.deepEqual(s.state.get(JOURNEY_KEY), bad, 'the unreadable record was not overwritten by loading');
    assert.deepEqual(listQuarantine(s.state).map(e => e.record), [bad]);
  }
});

test('a failed quarantine copy is reported, not claimed as saved', async () => {
  const s = store('q', { failWrites: true });
  s.state.records.set(JOURNEY_KEY, { schemaVersion: 9 });
  const journey = new Journey({ state: s.state, homePlanet: 2, homeCity: 1 });
  await s.state.serial;
  await new Promise(r => setTimeout(r, 0));
  assert.equal(journey.status.quarantine, 'failed');
});

test('a new home world gets its own journey', async () => {
  const { journey } = make();
  await reach(journey, 'j4');
  const other = store('another-world');
  journey.rebind({ state: other.state, homePlanet: 0, homeCity: 0 });
  assert.equal(journey.stage, 'j1');
  assert.equal(journey.home, null);
});

test('no starter house: the journey says so and does not pick another house later', () => {
  const { journey } = make();
  journey.town(2, 1);
  assert.equal(journey.setHome(null), null);
  assert.equal(journey.status.homeUnavailable, true);
  assert.equal(describeObjective(journey.snapshot(), journey.view, {}).hint[0], 'journey.home.unavailable');
  journey.setHome(HOME);
  assert.equal(journey.status.homeUnavailable, false);
});

test('the director tells the journey where the player is', () => {
  const { journey } = make();
  journey.modeEntered({ mode: 'space', planet: null });
  journey.modeEntered({ mode: 'planet', planet: 2 });
  assert.equal(journey.stage, 'j2');
  journey.modeEntered({ mode: 'town', planet: 2, city: 1 });
  assert.equal(journey.stage, 'j3');
  assert.equal(journey.view.mode, 'town');
  journey.modeEntered({ mode: 'trade', planet: 2 });
  assert.equal(journey.view.inHomeTown, false);
});

// ---------------------------------------------------------------- trace and wording

test('a trace is a lamp switched on or an item put down; verifying compares saved values, not pictures', () => {
  assert.deepEqual(diffTrace(lampOff, lampOn), { kind: 'light', id: 'light:::1.000:2.000:0', expected: { on: true } });
  assert.deepEqual(diffTrace(lampOff, itemMoved), { kind: 'item', id: 'item:it_apple:3.000:4.000:0', expected: { position: [5, 1.1, 6], x: 5, z: 6 } });
  assert.equal(diffTrace(lampOn, lampOff), null);
  assert.equal(diffTrace(null, lampOn), null);
  const light = diffTrace(lampOff, lampOn), item = diffTrace(lampOff, itemMoved);
  assert.equal(verifyTrace(light, lampOn).ok, true);
  assert.equal(verifyTrace(light, lampOff).reason, 'light-off');
  assert.equal(verifyTrace(item, itemMoved).ok, true);
  assert.equal(verifyTrace(item, { ...itemMoved, objects: { ...itemMoved.objects, [item.id]: { ...itemMoved.objects[item.id], position: [5.5, 1.1, 6] } } }).reason, 'item-moved');
  assert.equal(verifyTrace(item, { ...itemMoved, holdingId: item.id }).reason, 'item-held');
  assert.equal(verifyTrace(light, { objects: {} }).reason, 'object-missing');
  assert.equal(verifyTrace(light, undefined).reason, 'missing');
});

test('the objective line follows the stage and the place, and every key exists in both languages', () => {
  const names = { planet: 'Aegis', city: 'Hearth' };
  const line = (stage, view = {}, extra = {}) => describeObjective({ stage, ...extra }, view, names);
  assert.deepEqual(line('j1').line, ['journey.j1', { planet: 'Aegis' }]);
  assert.deepEqual(line('j2').line, ['journey.j2', { city: 'Hearth' }]);
  assert.deepEqual(line('j3', { view: 'diorama' }).hint, ['journey.j3.diorama']);
  assert.deepEqual(line('j3', { view: 'walk', inHomeTown: true, distance: 12.4 }), { step: 3, total: 6, line: ['journey.j3'], distance: 12, hint: ['journey.j3.hint'] });
  assert.equal(line('j3', { view: 'walk', inHomeTown: false, distance: 12.4 }).distance, null, 'no town metres outside the hometown');
  assert.deepEqual(line('j4', { view: 'drive' }).hint, ['journey.j4.drive']);
  assert.deepEqual(line('j5', { holding: 'apple' }).hint, ['journey.j5.carry', { item: 'apple' }]);
  assert.deepEqual(line('j6', {}, { away: false }).hint, ['journey.j6.leave']);
  assert.deepEqual(line('j6', { inHomeTown: false }, { away: true }).hint, ['journey.j6.return', { city: 'Hearth', planet: 'Aegis' }]);
  assert.deepEqual(line('j6', { inHomeTown: true, distance: 20 }, { away: true }).hint, ['journey.j6.door']);
  assert.deepEqual(line('j6', { inHomeTown: true }, { away: true, verifying: true }).hint, ['journey.j6.verify']);
  assert.equal(line('done'), null);
  for (const key of ['journey.title', 'journey.objective', 'journey.progress', 'journey.distance', 'journey.j1', 'journey.j2', 'journey.j3', 'journey.j3.hint', 'journey.j3.diorama', 'journey.j4', 'journey.j4.hint', 'journey.j4.drive',
    'journey.j5', 'journey.j5.hint', 'journey.j5.carry', 'journey.j6', 'journey.j6.leave', 'journey.j6.return', 'journey.j6.door', 'journey.j6.verify', 'journey.save.pending', 'journey.save.failed',
    'journey.progress.failed', 'journey.restore.failed', 'journey.quarantined', 'journey.quarantine.failed', 'journey.home.unavailable', 'journey.complete.title', 'journey.marker.home',
    'journey.marker.planet', 'journey.marker.city', 'journey.marker.offscreen', 'tips.home.title', 'tips.home.text']) {
    assert.notEqual(t(key, { step: 1, total: 6, planet: 'P', city: 'C', item: 'I', distance: 3 }), key, key);
  }
  assert.deepEqual(newRecord(5), { schemaVersion: 1, stage: 'j1', home: null, trace: null, away: false, celebrated: false, startedAt: 5 });
});
