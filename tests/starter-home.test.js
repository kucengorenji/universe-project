import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateHexasphere } from '../src/math/hexasphere.js';
import { MapGenerator } from '../src/map/mapGenerator.js';
import { generateTownLayout } from '../src/modes/town/layout/townLayout.js';
import { createWalkNetwork, townWalkable } from '../src/modes/town/navigation/walkNetwork.js';
import { ENTERABLE } from '../src/modes/town/interior/interior.js';
import { findTownDoors } from '../src/modes/town/interior/doors.js';
import { chooseStarterHome, findStarterDoor, homeCityIndex, RESIDENTIAL } from '../src/world/starterHome.js';

// The hometown and the starter house are chosen from what the town builds: real building
// footprints from town.glb, the town's own walk network and door portals. Limits: the
// walk network here is flat (TownMode also samples terrain height), and the maps use
// subdivision 3 so the sweep stays quick; the game itself uses 5.

async function realFootprints() {
  globalThis.ProgressEvent ??= class ProgressEvent extends Event { constructor(type, init = {}) { super(type); Object.assign(this, init); } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    const url = typeof request === 'string' ? request : request.url;
    if (url.startsWith('http://assets.test/')) return new Response(readFileSync(new URL(`../public/models/${url.split('/').pop()}`, import.meta.url)));
    return realFetch(request);
  };
  try {
    const { loadAssetPack } = await import('../src/render/assetLibrary.js');
    const { packFootprints } = await import('../src/modes/town/render/townBuilder.js');
    return packFootprints(await loadAssetPack('http://assets.test/town.glb'));
  } finally { globalThis.fetch = realFetch; }
}

const hexasphere = generateHexasphere(3, 10);
const generator = new MapGenerator(hexasphere);
const SEEDS = [17, 427, 8191, 101, 202, 303, 404, 505, 606, 707, 808, 909];

function town(map, cityIndex, footprints) {
  generator.applyMapData(map);
  const layout = generateTownLayout({ map, hexasphere, cityIndex, footprints });
  const doors = findTownDoors(layout, footprints, { enterable: ENTERABLE });
  const portals = doors.filter(d => d.b.blueprint).map(d => ({
    id: d.b.blueprint.portalId, buildingId: d.b.id, x: d.x, z: d.z, facing: { x: Math.sin(d.outYaw), z: Math.cos(d.outYaw) }
  }));
  const walkNetwork = createWalkNetwork(layout.walkGraph, { walkable: townWalkable(layout, { margin: 0.3 }), portals });
  return { layout, doors, walkNetwork };
}

test('the hometown is the first city the player owns, else the first city', () => {
  assert.equal(homeCityIndex({ cities: [{ owner: 'system' }, { owner: 'player' }, { owner: 'player' }] }), 1);
  assert.equal(homeCityIndex({ cities: [{ owner: 'system' }, { owner: 'system' }] }), 0);
  assert.equal(homeCityIndex({ cities: [] }), null);
  assert.equal(homeCityIndex(null), null);
});

test('sweep: every seed gets a deterministic starter house with a safe door, nearest residential first', async () => {
  const footprints = await realFootprints();
  assert.ok(footprints.f_house, 'real footprints were measured from town.glb');
  const picked = [];
  for (const seed of SEEDS) {
    const map = generator.generate(seed, { planetType: 'terran' });
    const cityIndex = homeCityIndex(map);
    assert.ok(cityIndex !== null, `seed ${seed}: the planet has a city`);
    const { layout, doors, walkNetwork } = town(map, cityIndex, footprints);
    const home = chooseStarterHome({ doors, walkNetwork, spawn: layout.spawn });
    const where = `seed ${seed} city ${cityIndex} (${layout.style})`;
    assert.ok(home, `${where}: a starter house exists`);
    const portal = walkNetwork.portals.find(p => p.id === home.portalId);
    assert.equal(portal.reason, null, `${where}: its door is reachable by the walk network`);
    assert.ok(Number.isFinite(portal.node), `${where}: and attached to a street`);
    assert.ok(layout.buildings.some(b => b.id === home.buildingId && !b.homeRecord), where);
    assert.equal(RESIDENTIAL.has(home.asset), true, `${where}: a residential shell is chosen when the town has one with a safe door`);
    assert.equal(home.tier, 0, where);

    // the nearest residential door among the safe ones
    const safeResidential = doors.filter(d => RESIDENTIAL.has(d.b.asset) && walkNetwork.portals.find(p => p.id === d.b.blueprint.portalId)?.reason === null);
    const nearest = safeResidential.map(d => Math.hypot(d.x - layout.spawn.x, d.z - layout.spawn.z)).sort((a, b) => a - b)[0];
    assert.ok(Math.abs(Math.hypot(home.x - layout.spawn.x, home.z - layout.spawn.z) - nearest) < 1e-9, `${where}: nearest to the spawn`);

    // the same answer every time, whatever order the doors come in
    assert.deepEqual(chooseStarterHome({ doors: [...doors].reverse(), walkNetwork, spawn: layout.spawn }), home, `${where}: order independent`);
    // (building the town twice is the slow part, so only the first seeds do it)
    const again = picked.length < 2 ? town(map, cityIndex, footprints) : { doors, walkNetwork, layout };
    assert.deepEqual(chooseStarterHome({ doors: again.doors, walkNetwork: again.walkNetwork, spawn: again.layout.spawn }), home, `${where}: same town, same house`);

    // and found again from the saved choice
    const saved = { buildingId: home.buildingId, portalId: home.portalId };
    assert.equal(findStarterDoor(saved, again.doors, again.walkNetwork)?.b.id, home.buildingId, where);
    picked.push(home.buildingId);
  }
  assert.equal(new Set(picked).size, SEEDS.length, 'different worlds get different houses');
});

test('portals that are blocked or isolated are never chosen; with none safe there is no starter house', async () => {
  const footprints = await realFootprints();
  const map = generator.generate(17, { planetType: 'terran' });
  const { layout, doors, walkNetwork } = town(map, homeCityIndex(map), footprints);
  const first = chooseStarterHome({ doors, walkNetwork, spawn: layout.spawn });
  const blocked = { portals: walkNetwork.portals.map(p => (p.id === first.portalId ? { ...p, reason: 'blocked-door' } : p)) };
  const second = chooseStarterHome({ doors, walkNetwork: blocked, spawn: layout.spawn });
  assert.notEqual(second.buildingId, first.buildingId, 'the unsafe door is skipped');
  assert.equal(findStarterDoor(first, doors, blocked), null, 'a saved choice whose door became unsafe is not used');
  const none = { portals: walkNetwork.portals.map(p => ({ ...p, reason: 'isolated-path' })) };
  assert.equal(chooseStarterHome({ doors, walkNetwork: none, spawn: layout.spawn }), null);
  assert.equal(chooseStarterHome({ doors: [], walkNetwork, spawn: layout.spawn }), null);
  assert.equal(chooseStarterHome({ doors, walkNetwork: { portals: [] }, spawn: layout.spawn }), null, 'doors without a known portal are not trusted');
  assert.equal(findStarterDoor({ buildingId: 'gone' }, doors, walkNetwork), null);
  assert.equal(findStarterDoor(null, doors, walkNetwork), null);
});

test('without a residential door a safe shop or tavern is the fallback, and houses always win ties', async () => {
  const footprints = await realFootprints();
  const map = generator.generate(427, { planetType: 'terran' });
  const { layout, doors, walkNetwork } = town(map, homeCityIndex(map), footprints);
  const onlyResidentialBlocked = { portals: walkNetwork.portals.map(p => (RESIDENTIAL.has(doors.find(d => d.b.blueprint.portalId === p.id)?.b.asset) ? { ...p, reason: 'blocked-door' } : p)) };
  const fallback = chooseStarterHome({ doors, walkNetwork: onlyResidentialBlocked, spawn: layout.spawn });
  if (doors.some(d => !RESIDENTIAL.has(d.b.asset) && walkNetwork.portals.find(p => p.id === d.b.blueprint.portalId)?.reason === null)) {
    assert.equal(fallback.tier, 1);
    assert.equal(RESIDENTIAL.has(fallback.asset), false);
  } else assert.equal(fallback, null);
  const house = { b: { id: 'b-house', asset: 'f_house', blueprint: { portalId: 'p1' } }, x: 50, z: 0, outYaw: 0 };
  const shop = { b: { id: 'b-shop', asset: 'f_shop', blueprint: { portalId: 'p2' } }, x: 1, z: 0, outYaw: 0 };
  const network = { portals: [{ id: 'p1', reason: null }, { id: 'p2', reason: null }] };
  assert.equal(chooseStarterHome({ doors: [shop, house], walkNetwork: network, spawn: { x: 0, z: 0 } }).buildingId, 'b-house', 'a distant house beats a near shop');
  const twin = { ...house, b: { ...house.b, id: 'a-house', blueprint: { portalId: 'p3' } } };
  const tied = { portals: [...network.portals, { id: 'p3', reason: null }] };
  assert.equal(chooseStarterHome({ doors: [house, twin], walkNetwork: tied, spawn: { x: 0, z: 0 } }).buildingId, 'a-house', 'equal distance: the smaller id');
  const authored = { ...house, b: { ...house.b, id: 'authored', homeRecord: { id: 'x' } }, x: 1 };
  assert.equal(chooseStarterHome({ doors: [authored, house], walkNetwork: network, spawn: { x: 0, z: 0 } }).buildingId, 'b-house', 'an authored home opens the editor, not a room');
});
