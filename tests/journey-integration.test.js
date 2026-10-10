import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldStateStore } from '../src/world/stateStore.js';
import { Journey, createJourney } from '../src/core/journey.js';
import { TownJourney } from '../src/modes/town/journeyTown.js';
import { journeyTargets, markRows } from '../src/ui/journeyTargets.js';
import { pickAlert } from '../src/ui/objectiveHud.js';
import { Tips } from '../src/core/tips.js';
import { homeCityIndex } from '../src/world/starterHome.js';
import { listQuarantine } from '../src/world/savedRecords.js';
import { t } from '../src/i18n/index.js';

const memory = (name = 'w') => {
  const data = new Map();
  const storage = { getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k), failWrites: false };
  return { storage, data, open: () => new WorldStateStore(name, { storage, indexedDB: null }) };
};
const door = (id, x, z, asset = 'f_house') => ({ b: { id, asset, blueprint: { portalId: `${id}:entrance` } }, x, z, outYaw: 0 });
const DOORS = [door('near', 5, 0), door('far', 80, 0)];
const NETWORK = { portals: DOORS.map(d => ({ id: d.b.blueprint.portalId, reason: null })) };
const LAYOUT = { spawn: { x: 0, z: 0 } };

function fakeWaypoint() {
  const calls = { target: null, updates: [] };
  return { calls, setTarget: t => { calls.target = t; }, setNight: () => {}, metrics: () => ({}), update: (time, o) => calls.updates.push(o.active), dispose: () => { calls.disposed = true; } };
}
function bridge({ planet = 2, city = 1, journey, minimap = { pins: [], setPin(p) { this.pins.push(p); } } } = {}) {
  const m = memory();
  journey ||= new Journey({ state: m.open(), homePlanet: 2, homeCity: 1 });
  const waypoint = fakeWaypoint();
  const town = new TownJourney({ journey, planet, city, scene: {}, ui: {}, layout: LAYOUT, doors: DOORS, walkNetwork: NETWORK, groundAt: () => 1.5, minimap, makeWaypoint: () => waypoint });
  return { town, journey, waypoint, minimap, m };
}

test('the hometown picks the nearest safe house once; the choice is saved and the marker points at its door', () => {
  const { town, journey, waypoint } = bridge();
  assert.equal(journey.home.buildingId, 'near');
  assert.deepEqual(waypoint.calls.target, { x: 5, z: 0, outYaw: 0, buildingId: 'near' });
  assert.deepEqual(journey.debug().view.door, { x: 5, y: 1.5, z: 0, buildingId: 'near' }, 'QA can read where the door is');
  assert.equal(journey.view.inHomeTown, true);
  const again = bridge({ journey: new Journey({ state: journey.state, homePlanet: 2, homeCity: 1, session: 'later' }) });
  assert.equal(again.journey.home.buildingId, 'near');
  town.dispose();
  assert.equal(waypoint.calls.disposed, true);
});

test('another town gets no marker and does not choose a starter house', () => {
  const { journey, waypoint } = bridge({ planet: 2, city: 0 });
  assert.equal(journey.home, null);
  assert.equal(waypoint.calls.target, null);
  assert.equal(journey.view.inHomeTown, false);
});

test('walking up to the door completes J3 once the player is within 6 m; the diorama never does', () => {
  const { town, journey } = bridge();
  journey.town(2, 1);
  town.update(0, { pos: null, view: 'diorama', camera: null });
  assert.equal(journey.stage, 'j3');
  town.update(0.1, { pos: { x: -40, z: 0 }, view: 'walk', camera: null });
  assert.equal(journey.stage, 'j3');
  assert.equal(Math.round(journey.view.distance), 45);
  town.update(0.2, { pos: { x: 0, z: 0 }, view: 'walk', camera: null });
  assert.equal(journey.stage, 'j4', '5 m from the door');
});

test('the marker is on for J3, J4 and the return, off inside and when done', async () => {
  const { town, journey, waypoint, minimap } = bridge();
  journey.town(2, 1);
  town.update(0, { pos: { x: -40, z: 0 }, view: 'walk', camera: {} });
  assert.equal(waypoint.calls.updates.at(-1), true);
  assert.deepEqual(minimap.pins.at(-1), { x: 5, z: 0, outYaw: 0, buildingId: 'near' });
  town.opened('near', {});
  assert.equal(journey.stage, 'j5');
  assert.equal(journey.view.mode, 'interior');
  assert.equal(waypoint.calls.updates.at(-1), false, 'quiet inside');
  assert.equal(minimap.pins.at(-1), null);
  town.closed();
  town.update(1, { pos: { x: 0, z: 0 }, view: 'walk', camera: {} });
  assert.equal(waypoint.calls.updates.at(-1), false, 'J5: nothing to find outside any more');
  assert.equal(town.active, false);
  journey.advance('j6');
  assert.equal(town.active, false, 'J6 before leaving: not yet');
  journey.record.away = true;
  assert.equal(town.active, true, 'back for the check');
  journey.record.stage = 'done';
  assert.equal(town.active, false);
});

test('a room change goes to the journey with the item the player is holding named', async () => {
  const { town, journey } = bridge();
  journey.town(2, 1); journey.near(1); journey.enterHome({ buildingId: 'near', floors: {} });
  const before = { objects: { 'light:::1.000:2.000:0': { on: false } } }, after = { objects: { 'light:::1.000:2.000:0': { on: true } } };
  assert.equal(await town.used({ buildingId: 'near', floor: 0, before, after, holding: { asset: 'it_apple' } }), true);
  assert.equal(journey.view.holding, t('interior.item.it_apple'));
  assert.equal(journey.stage, 'j6');
});

test('a saved starter house that is no longer in the town is reported, not replaced', () => {
  const m = memory();
  const journey = new Journey({ state: m.open(), homePlanet: 2, homeCity: 1 });
  journey.setHome({ buildingId: 'vanished', portalId: 'vanished:entrance', asset: 'f_house', tier: 0 });
  const { waypoint } = bridge({ journey });
  assert.equal(waypoint.calls.target, null);
  assert.equal(journey.status.homeUnavailable, true);
  assert.equal(journey.home.buildingId, 'vanished');
});

// ---------------------------------------------------------------- the world around the journey

test('createJourney follows the home world, and a new home world gets its own journey', async () => {
  const stores = { 'world:1': memory('world:1'), 'world:2': memory('world:2') };
  const listeners = new Set();
  const world = {
    worldId: 'world:1', homeIndex: 2, homeMap: { cities: [{ name: 'Alpha', owner: 'system' }, { name: 'Hearth', owner: 'player' }] }, state: stores['world:1'].open(),
    ready: Promise.resolve(), planet: i => ({ name: `Planet ${i}` }), subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  };
  const journey = createJourney(world);
  assert.deepEqual([journey.homePlanet, journey.homeCity, journey.names], [2, 1, { planet: 'Planet 2', city: 'Hearth' }]);
  journey.planet(2);
  assert.equal(journey.stage, 'j2');
  Object.assign(world, { worldId: 'world:2', homeIndex: 0, homeMap: { cities: [{ name: 'Zed', owner: 'player' }] }, state: stores['world:2'].open() });
  for (const fn of listeners) await fn('world');
  assert.deepEqual([journey.stage, journey.homePlanet, journey.homeCity, journey.names], ['j1', 0, 0, { planet: 'Planet 0', city: 'Zed' }]);
  assert.equal(homeCityIndex(world.homeMap), 0);
});

test('the highlight targets follow the stage: the planet while flying and coming back, the town while landing and coming back', () => {
  const m = memory();
  const journey = new Journey({ state: m.open(), homePlanet: 2, homeCity: 1 });
  assert.deepEqual(journeyTargets(journey), { planet: 2, city: null });
  journey.planet(2);
  assert.deepEqual(journeyTargets(journey), { planet: null, city: 1 });
  journey.town(2, 1);
  assert.deepEqual(journeyTargets(journey), { planet: null, city: null }, 'in the hometown the door is the target');
  journey.record.stage = 'j6';
  assert.deepEqual(journeyTargets(journey), { planet: null, city: null }, 'before leaving there is nothing to fly to');
  journey.record.away = true;
  assert.deepEqual(journeyTargets(journey), { planet: 2, city: 1 });
  journey.record.stage = 'done';
  assert.deepEqual(journeyTargets(journey), { planet: null, city: null });
  assert.deepEqual(journeyTargets(null), { planet: null, city: null });
});

test('rows get the badge only for the target and lose it when the target moves', () => {
  const row = n => { const classes = new Set(); return { n, title: '', classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: c => classes.has(c) }, removeAttribute() { this.title = ''; }, classes }; };
  const rows = [row(0), row(1), row(2)];
  markRows(rows, r => r.n, 1, 'Home planet: Aegis');
  assert.deepEqual(rows.map(r => r.classes.has('is-journey')), [false, true, false]);
  assert.equal(rows[1].title, 'Home planet: Aegis');
  markRows(rows, r => r.n, 2, 'Home planet: Aegis');
  assert.deepEqual(rows.map(r => r.classes.has('is-journey')), [false, false, true]);
  assert.equal(rows[1].title, '');
  markRows(rows, r => r.n, null, '');
  assert.ok(rows.every(r => !r.classes.has('is-journey')));
});

// ---------------------------------------------------------------- the one message that matters

test('the objective bar shows the worst saving problem first, one message at a time', () => {
  const m = memory();
  const journey = new Journey({ state: m.open(), homePlanet: 2, homeCity: 1 });
  assert.equal(pickAlert({ journey, world: {} }), null);
  journey.status.quarantine = 'saved';
  assert.deepEqual(pickAlert({ journey, world: {} }), { key: 'journey.quarantined', menu: false, transient: true });
  journey.status.restoreFailed = true;
  assert.equal(pickAlert({ journey, world: {} }).key, 'journey.restore.failed');
  journey.status.progressFailed = true;
  assert.equal(pickAlert({ journey, world: {} }).key, 'journey.progress.failed');
  journey.status.quarantine = 'failed';
  assert.equal(pickAlert({ journey, world: {} }).key, 'journey.quarantine.failed');
  journey.status.save = 'failed';
  assert.equal(pickAlert({ journey, world: {} }).key, 'journey.save.failed');
  assert.deepEqual(pickAlert({ journey, world: { mapSaveError: new Error('x') } }), { key: 'pause.save.mapError', menu: true }, 'an unsaved world beats everything');
});

test('an unreadable journey record surfaces as quarantine through the store', async () => {
  const m = memory();
  const state = m.open();
  state.set('journey', { schemaVersion: 7, stage: 'j4' });
  const journey = new Journey({ state, homePlanet: 2, homeCity: 1 });
  await state.serial; await new Promise(r => setTimeout(r, 0));
  assert.equal(journey.stage, 'j1');
  assert.equal(pickAlert({ journey, world: {} }).key, 'journey.quarantined');
  assert.equal(listQuarantine(state).length, 1);
});

// ---------------------------------------------------------------- intro and tips

function fakeRoot() {
  const el = new Proxy({}, {
    get: (target, prop) => prop in target ? target[prop] : prop === 'querySelector' ? () => el : prop === 'classList' ? { add() {}, remove() {}, toggle() {} } : prop === 'dataset' ? {} : () => {},
    set: (target, prop, value) => { target[prop] = value; return true; }
  });
  return el;
}

test('the title card shows once per device, not once per world; the pause-menu reset brings it back', async () => {
  const m = memory();
  const saved = ['localStorage', 'window', 'document'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  const define = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  define('localStorage', m.storage); define('window', { addEventListener() {} }); define('document', { body: { dataset: {} } });
  try {
    const world = id => ({ worldId: id, subscribe() { return () => {}; } });
    const first = new Tips(fakeRoot(), world('world:1'));
    const shown = [];
    first.el.intro = { get hidden() { return this._h; }, set hidden(v) { this._h = v; if (!v) shown.push('closed'); } };
    first.el.intro.hidden = true; shown.length = 0;
    first.intro();
    assert.equal(first.el.intro.hidden, false, 'a new browser sees the card');
    first.closeIntro();
    const second = new Tips(fakeRoot(), world('world:2')); // another world, same browser
    second.el.intro = { hidden: true };
    await second.intro();
    assert.equal(second.el.intro.hidden, true, 'the card stays away');
    second.reset();
    const third = new Tips(fakeRoot(), world('world:3'));
    third.el.intro = { hidden: true };
    third.intro();
    assert.equal(third.el.intro.hidden, false, 'reset shows it again');
    assert.equal(document.body.dataset.overlay, 'intro');
  } finally { for (const [name, d] of saved) { if (d) Object.defineProperty(globalThis, name, d); else delete globalThis[name]; } }
});
