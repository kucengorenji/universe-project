import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { generateHexasphere } from '../src/math/hexasphere.js';
import { MapGenerator, STORAGE_KEY } from '../src/map/mapGenerator.js';
import { generateTownLayout, townBaseSeed } from '../src/modes/town/layout/townLayout.js';
import { WorldStateStore } from '../src/world/stateStore.js';
import { GENERATOR_VERSIONS, buildingId } from '../src/world/identity.js';
import {
  TOWN_LAYOUT_VERSION, INTERIOR_SCHEMA_VERSION, INTERIOR_LEGACY_SCHEMA_VERSION, HOME_SCHEMA_VERSION,
  PLANET_MAP_VERSION, GENERATOR_VERSIONS as SOURCE_VERSIONS
} from '../src/world/versions.js';
import * as townGeneration from '../src/world/townGeneration.js';
import { townGenerationVersion } from '../src/world/townGeneration.js';
import { ensureHomeRecord, loadHomeRecord, listTownHomes, saveHomeDraft, homeKey } from '../src/world/homeState.js';
import {
  isSupportedHomeRecord, loadInteriorRecord, quarantineRecord, listQuarantine, quarantineCount, restoreQuarantined
} from '../src/world/savedRecords.js';
import { Director } from '../src/core/director.js';
import { t } from '../src/i18n/index.js';

function fixture(name = 'save-test') {
  const data = new Map();
  const opts = { storage: { getItem: k => data.get(k), setItem: (k, v) => data.set(k, v) }, indexedDB: null };
  return { state: new WorldStateStore(name, opts), reopen: () => new WorldStateStore(name, opts), data };
}
const plain = value => JSON.parse(JSON.stringify(value));

// ---------------------------------------------------------------- one source of versions

test('generator versions have one source and track the constants the code really uses', () => {
  assert.equal(SOURCE_VERSIONS, GENERATOR_VERSIONS, 'identity.js re-exports the same frozen object');
  assert.ok(Object.isFrozen(GENERATOR_VERSIONS));
  assert.equal(GENERATOR_VERSIONS.town, TOWN_LAYOUT_VERSION);
  assert.equal(GENERATOR_VERSIONS.interior, INTERIOR_SCHEMA_VERSION);
  assert.equal(GENERATOR_VERSIONS.planet, PLANET_MAP_VERSION);
  assert.equal(STORAGE_KEY, `planet_globe_map_v${PLANET_MAP_VERSION}`, 'the map storage key is derived from the planet version');
  assert.equal(townGeneration.TOWN_LAYOUT_VERSION, TOWN_LAYOUT_VERSION, 'townGeneration re-exports instead of redefining');
  assert.equal(INTERIOR_LEGACY_SCHEMA_VERSION, 1);
  assert.equal(HOME_SCHEMA_VERSION, 1);
  for (const [name, value] of Object.entries(GENERATOR_VERSIONS)) assert.ok(Number.isInteger(value) && value > 0, name);
});

test('the layout generator defaults to the current layout version', () => {
  const hexasphere = generateHexasphere(3, 10);
  const map = new MapGenerator(hexasphere).generate(17, { planetType: 'terran' });
  assert.equal(generateTownLayout({ map, hexasphere, cityIndex: 0 }).layoutVersion, TOWN_LAYOUT_VERSION);
});

test('no module defines its own copy of a version that versions.js owns', () => {
  const owned = /\b(TOWN_LAYOUT_VERSION|INTERIOR_SCHEMA_VERSION|HOME_SCHEMA_VERSION|JOURNEY_SCHEMA_VERSION|PLANET_MAP_VERSION|GENERATOR_VERSIONS)\s*=[^=]/;
  const root = new URL('../src/', import.meta.url);
  const walk = dir => readdirSync(dir).flatMap(name => {
    const url = new URL(name, dir);
    return statSync(url).isDirectory() ? walk(new URL(`${name}/`, dir)) : name.endsWith('.js') ? [url] : [];
  });
  const definers = walk(root).filter(url => owned.test(readFileSync(url, 'utf8'))).map(url => url.pathname.split('/src/')[1]);
  assert.deepEqual(definers, ['world/versions.js']);
});

// ---------------------------------------------------------------- interior records

const interiorKey = 'interior:1:town:55:building:f_house:1700:2200:15708';
const container = (floors = {}) => ({ schemaVersion: 2, layoutVersion: 2, floors });
const legacySnapshot = { schemaVersion: 1, holdingId: null, objects: { 'light::1.000:2.000:0': { on: true, target: 0 } } };

test('supported interior records load untouched and are never quarantined', () => {
  const { state } = fixture();
  assert.deepEqual(loadInteriorRecord(state, interiorKey), { record: container(), legacy: null, quarantined: null }, 'a new room starts empty');
  state.set(interiorKey, legacySnapshot);
  const old = loadInteriorRecord(state, interiorKey);
  assert.deepEqual(old.legacy, legacySnapshot, 'a v1 room keeps its own generator and snapshot');
  assert.equal(old.quarantined, null);
  const saved = container({ 0: legacySnapshot });
  state.set(interiorKey, saved);
  const current = loadInteriorRecord(state, interiorKey);
  assert.deepEqual(current.record, saved);
  assert.equal(current.legacy, null);
  assert.equal(quarantineCount(state), 0);
});

test('unknown or malformed interior records are quarantined, not replaced by an empty record', () => {
  const cases = {
    'a future schema': { schemaVersion: 3, floors: { 0: legacySnapshot }, extra: 'from a newer game' },
    'schema 2 without floors': { schemaVersion: 2 },
    'schema 2 with floors as an array': { schemaVersion: 2, floors: [legacySnapshot] },
    'no schema at all': { objects: {} },
    'a string': 'garbage',
    'an array': [1, 2, 3],
    'a number': 7
  };
  for (const [name, original] of Object.entries(cases)) {
    const { state } = fixture();
    state.set(interiorKey, original);
    const loaded = loadInteriorRecord(state, interiorKey);
    assert.deepEqual(loaded.record, container(), `${name}: play continues on a clean record`);
    assert.equal(loaded.legacy, null, name);
    assert.ok(loaded.quarantined?.id, `${name}: reports the quarantine`);
    assert.deepEqual(state.get(interiorKey), original, `${name}: loading alone never rewrites the saved key`);
    const [entry] = listQuarantine(state);
    assert.equal(entry.key, interiorKey, name);
    assert.deepEqual(entry.record, original, `${name}: the original is kept verbatim`);
    assert.equal(quarantineCount(state), 1, name);
  }
});

test('quarantine survives the first save over the key, a reload and repeated visits', () => {
  const { state, reopen } = fixture();
  const original = { schemaVersion: 3, floors: { 0: legacySnapshot } };
  state.set(interiorKey, original);
  const first = loadInteriorRecord(state, interiorKey);
  loadInteriorRecord(state, interiorKey);
  assert.equal(quarantineCount(state), 1, 'visiting twice does not duplicate the entry');
  state.set(interiorKey, first.record); // what enterBuilding does with the clean record
  loadInteriorRecord(state, interiorKey);
  const afterReload = reopen();
  assert.equal(quarantineCount(afterReload), 1);
  assert.deepEqual(listQuarantine(afterReload)[0].record, original, 'the play record replaced the key, the original is still held');
  assert.deepEqual(loadInteriorRecord(afterReload, interiorKey).record, container(), 'the new record is a normal v2 container');
  afterReload.set(interiorKey, { schemaVersion: 4 });
  loadInteriorRecord(afterReload, interiorKey);
  assert.deepEqual(listQuarantine(afterReload).map(e => e.id), [`quarantine:${interiorKey}`, `quarantine:${interiorKey}#2`], 'a different bad record gets its own slot');
});

test('a quarantined record can be restored without losing what replaced it', () => {
  const { state } = fixture();
  const original = { schemaVersion: 3, floors: {} };
  state.set(interiorKey, original);
  state.set(interiorKey, loadInteriorRecord(state, interiorKey).record);
  const [entry] = listQuarantine(state);
  restoreQuarantined(state, entry.id);
  assert.deepEqual(state.get(interiorKey), original);
  const ids = listQuarantine(state);
  assert.equal(ids.length, 1, 'the clean record is now the one held aside');
  assert.deepEqual(ids[0].record, container());
  assert.throws(() => restoreQuarantined(state, 'quarantine:nothing'), /quarantine/i);
});

test('quarantine status is visible as text', () => {
  const { state } = fixture();
  assert.equal(quarantineCount(state), 0);
  quarantineRecord(state, 'home:1:2:x', { schemaVersion: 9 }, 'unknown-schema');
  quarantineRecord(state, 'home:1:2:x', { schemaVersion: 9 }, 'unknown-schema');
  assert.equal(quarantineCount(state), 1, 'the same record is held once');
  const text = t('pause.save.quarantine', { n: quarantineCount(state) });
  assert.match(text, /1/);
  assert.notEqual(text, 'pause.save.quarantine');
});

// ---------------------------------------------------------------- home records

const building = { asset: 'f_house', x: 17, z: 22, yaw: Math.PI / 2, w: 7.6, d: 6.6 };
const plot = [{ x: -6, z: -10 }, { x: 6, z: -10 }, { x: 6, z: 6 }, { x: -6, z: 6 }];
const makeHome = (state, overrides = {}) => ensureHomeRecord(state, { planet: 1, city: 2, townSeed: 55, layoutSeed: 55, layoutVersion: 3, building, plot, ...overrides });

test('a home record with an unknown schema is quarantined and never edited in place', () => {
  const { state } = fixture();
  const good = makeHome(state);
  const route = { mode: 'home', planet: 1, city: 2, home: good.id };
  assert.equal(good.schemaVersion, HOME_SCHEMA_VERSION);
  assert.ok(isSupportedHomeRecord(state.get(homeKey(1, 2, good.id))));
  const foreign = { ...plain(good), schemaVersion: 9, applied: { futureShape: true } };
  state.set(homeKey(1, 2, good.id), foreign);
  assert.equal(isSupportedHomeRecord(foreign), false);
  assert.equal(loadHomeRecord(state, route), null, 'the game does not pretend to understand it');
  assert.deepEqual(listTownHomes(state, 1, 2), [], 'it is not built into the town');
  assert.throws(() => saveHomeDraft(state, route, { id: good.id, plot }), 'editing it is refused');
  assert.deepEqual(state.get(homeKey(1, 2, good.id)), foreign, 'the saved key is untouched until the player claims the lot again');
  assert.deepEqual(listQuarantine(state).map(e => [e.key, e.reason, e.record]), [[homeKey(1, 2, good.id), 'unknown-schema', foreign]]);
  const claimed = makeHome(state);
  assert.equal(claimed.schemaVersion, HOME_SCHEMA_VERSION);
  assert.equal(claimed.applied, null, 'a new claim starts clean');
  assert.deepEqual(listQuarantine(state)[0].record, foreign, 'the foreign record is still held');
  assert.equal(quarantineCount(state), 1);
});

test('an unknown home still pins the town layout so its owner can come back', () => {
  const { state } = fixture();
  state.set('town-layout:1:55', { version: 3, townSeed: 55, planet: 1 });
  state.set(homeKey(1, 2, 'x'), { schemaVersion: 9, id: 'x', townSeed: 55, layoutSeed: 55, layoutVersion: 3 });
  assert.equal(townGenerationVersion(state, 1, 55), 3, 'not silently upgraded to the current layout');
});

test('Director only routes to homes this build can read', () => {
  const route = { mode: 'home', planet: 1, city: 2, home: 'house_a' };
  const world = record => ({ planet: () => ({ landable: true }), mapFor: () => ({ cities: [{}, {}, {}] }), state: { get: () => record } });
  assert.deepEqual(Director.prototype.sanitize.call({ world: world({ schemaVersion: 1, id: 'house_a' }) }, route), route);
  assert.deepEqual(Director.prototype.sanitize.call({ world: world({ schemaVersion: 9, id: 'house_a' }) }, route), { mode: 'town', planet: 1, city: 2 });
});

// ---------------------------------------------------------------- saves across layout versions, subdivision 5

// Captured from the generator at commit d53f54a (the last one before layout v5) and
// re-checked against the current generator: every pinned version must reproduce exactly.
// Fingerprint keys match tests/town-compact-generation.test.js.
const KEYS = ['seed', 'baseSeed', 'variant', 'options', 'layoutVersion', 'cityR', 'dioramaR', 'relief', 'streets', 'buildings', 'props', 'trees', 'parks', 'paths', 'walls', 'fields2', 'docks', 'colliders', 'walkGraph', 'driveGraph', 'morphology', 'rivers', 'bridges', 'spawn', 'exits'];
const fingerprint = layout => createHash('sha256').update(JSON.stringify(Object.fromEntries(KEYS.map(key => [key, layout[key]])))).digest('hex');
const FIXTURES = [
  // seed, city, saved version, variant, saved thing, expected fingerprint, building count
  [17, 0, 1, 0, 'room', 'ddf9a40f366ce041c9f661fe2aac391ef5373290eb254fe0468f981e5788db22', 276],
  [427, 1, 1, 0, 'room', '9c26864c2395308f4ef4ca8430073c40b3944f81d71c85718cd405c60e206e4c', 56],
  [427, 1, 2, 0, 'home', '19725902557c8382f7f0e2bb2b06d93573446a8be95ba9b2762faaa8667a81b1', 79],
  [17, 1, 3, 0, 'room', 'aba8b774de78927f1f35715cbc31429bfd088783bb0778d6572ddd8d371567ac', 74],
  [427, 0, 3, 7, 'room', '875eb24343314173986a5066d21519991bb8e04804a766515cd18af9ae95f9c9', 487],
  [17, 0, 4, 7, 'home', 'c5b3d4ca86d49604ef2a55e64884874956278a30f5f5633ebb6d3b772f283435', 573],
  [427, 1, 4, 0, 'home', '1280ac409e264f36bca47b3bd4632514c4e4ab88a1113afb4a70d65398a70b98', 95]
];

test('saved towns v1–v4 stay pinned and reproduce their layout and saved rooms/homes at subdivision 5', () => {
  const hexasphere = generateHexasphere(5, 10);
  const generator = new MapGenerator(hexasphere);
  const maps = new Map();
  for (const [seed, cityIndex, version, variant, kind, expected, count] of FIXTURES) {
    if (!maps.has(seed)) maps.set(seed, generator.generate(seed, { planetType: 'terran' }));
    const map = maps.get(seed), planet = 1;
    generator.applyMapData(map); // the hexasphere is shared: put this seed's tiles back, as World.activate does
    const townSeed = townBaseSeed(map, cityIndex);
    const where = `seed ${seed} city ${cityIndex} v${version} variant ${variant}`;
    const layout = generateTownLayout({ map, hexasphere, cityIndex, layoutVersion: version, variant });
    assert.equal(layout.layoutVersion, version, where);
    assert.equal(layout.buildings.length, count, where);
    assert.equal(fingerprint(layout), expected, `${where}: pinned layout drifted`);

    // The player's save as an older build wrote it.
    const { state, reopen } = fixture(`world-${seed}-${cityIndex}`);
    const target = layout.buildings.find(b => b.asset === 'f_house' || b.asset === 'm_house') || layout.buildings[0];
    const id = buildingId(layout.seed, target);
    if (version > 1) state.set(`town-layout:${planet}:${townSeed}`, { version, townSeed, planet, ...(variant ? { variant, density: 1 } : {}) });
    if (kind === 'room') state.set(`interior:${planet}:${id}`, container({ 0: legacySnapshot }));
    else ensureHomeRecord(state, { planet, city: cityIndex, townSeed, layoutSeed: layout.seed, layoutVersion: version, building: target, plot });

    const reloaded = reopen();
    assert.equal(townGenerationVersion(reloaded, planet, townSeed), version, `${where}: the save keeps its generator`);
    assert.ok(layout.buildings.some(b => buildingId(layout.seed, b) === id), `${where}: the saved building still exists`);
    if (kind === 'room') {
      const room = loadInteriorRecord(reloaded, `interior:${planet}:${id}`);
      assert.deepEqual(room.record.floors[0], legacySnapshot, `${where}: room restored`);
    } else {
      const home = loadHomeRecord(reloaded, { planet, city: cityIndex, home: id });
      assert.equal(home.layoutVersion, version, where);
      assert.equal(home.buildingId, id, where);
    }
    assert.equal(quarantineCount(reloaded), 0, `${where}: known versions are never quarantined`);
  }
});

test('interior snapshots of every supported schema survive a reload next to an unknown one', () => {
  const { state, reopen } = fixture();
  const legacy = 'interior:1:town:1:building:a:0:0:0', current = 'interior:1:town:1:building:b:0:0:0', unknown = 'interior:1:town:1:building:c:0:0:0';
  state.set(legacy, legacySnapshot);
  state.set(current, container({ 1: legacySnapshot }));
  state.set(unknown, { schemaVersion: 'beta' });
  const r = reopen();
  assert.equal(loadInteriorRecord(r, legacy).legacy.schemaVersion, 1);
  assert.deepEqual(loadInteriorRecord(r, current).record.floors[1], legacySnapshot);
  assert.ok(loadInteriorRecord(r, unknown).quarantined);
  assert.equal(quarantineCount(r), 1, 'only the unknown one is held aside');
});
