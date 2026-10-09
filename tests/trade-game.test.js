import test from 'node:test';
import assert from 'node:assert/strict';
import { generateHexasphere } from '../src/math/hexasphere.js';
import { MapGenerator, STORAGE_KEY } from '../src/map/mapGenerator.js';
import { createCampaign, prepareScenario, buildableTiles } from '../src/trade/scenario.js';
import { resourcePlan, fingerprint, siteAccess } from '../src/trade/resources.js';
import { command, tick, validateState, routePreview, capacityLeft, cashFlow } from '../src/trade/simulation.js';
import { TradeSession } from '../src/trade/session.js';
import { WorldStateStore } from '../src/world/stateStore.js';
import { nearby, findPath } from '../src/trade/routing.js';
import { GOODS, emptyStock, stockTotal } from '../src/trade/catalog.js';
import { parseRoute, formatRoute } from '../src/core/router.js';
import { playCampaign } from '../tools/qa/trade_campaign.mjs';

const topology = generateHexasphere(3, 10);
const generator = new MapGenerator(topology), map = generator.generate(123456);
const fresh = () => createCampaign(map, topology, { id: 'test-campaign', worldId: 'test-world', planet: 0, name: 'Trade test' });
const advance = (c, seconds) => { for (let i = 0; i < seconds; i++) tick(c.state, c.graph, c.base.resourcePlan); };
const run = (c, action) => command(c.state, c.graph, c.base.resourcePlan, action);
const build = (c, kind, cityId = 'city:0') => {
  const tileId = buildableTiles(c.state, c.graph, c.base.resourcePlan, cityId, kind)[0];
  assert.notEqual(tileId, undefined, `No site for ${kind}`); run(c, { type: 'build', kind, cityId, tileId }); return c.state.facilities.at(-1);
};
const route = (c, to = 'city:1', fields = {}) => { run(c, { type: 'route', from: 'city:0', to, good: 'bread', ...fields }); return c.state.routes.at(-1); };

test('resource stream and campaign are deterministic and leave the normal map untouched', () => {
  const before = structuredClone(map), a = fresh(), b = fresh();
  assert.deepEqual(a.state, b.state); assert.deepEqual(map, before);
  assert.deepEqual(resourcePlan({ ...map, resourcePlan: null }), map.resourcePlan);
  assert.ok(validateState(a.state, a.base, a.graph));
  assert.equal(fingerprint(a.base), fingerprint(map));
  const rounded = structuredClone(map); rounded.tilesData[0].elevation += .000001;
  assert.equal(fingerprint(rounded), fingerprint(map));
  rounded.tilesData[0].biome = 'forest'; assert.notEqual(fingerprint(rounded), fingerprint(map));
});

test('generator sweep 2–5 validates playable bootstrap and existing save metadata migration', () => {
  let playable = 0;
  for (const level of [2, 3, 4, 5]) {
    const top = generateHexasphere(level), gen = new MapGenerator(top);
    for (const seed of [123456, 654321, 222222, 424242]) {
      const terrain = gen.generate(seed), scenario = prepareScenario(terrain, top);
      if (!scenario.ok) { assert.equal(scenario.reason, 'terrain'); continue; }
      playable++;
      const c = createCampaign(terrain, top, { worldId: 'sweep', planet: 0, name: 'Sweep' });
      assert.ok(validateState(c.state, c.base, c.graph));
      build(c, 'bakery'); route(c); advance(c, 240);
      assert.ok(c.state.produced.bread > 0 && c.state.sold.bread > 0, `Failed ${level}/${seed}`);
    }
  }
  assert.ok(playable >= 12, `Only ${playable}/16 playable`);
  const data = new Map(), oldStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => data.get(key), setItem: (key, v) => data.set(key, v) };
  try {
    const legacy = structuredClone(map); delete legacy.resourcePlan;
    data.set(STORAGE_KEY, JSON.stringify(legacy));
    const loaded = generator.loadFromStorage();
    assert.deepEqual(loaded.tilesData, legacy.tilesData); assert.deepEqual(loaded.cities, legacy.cities);
    assert.deepEqual(loaded.resourcePlan, map.resourcePlan);
    assert.equal(fingerprint(generator.loadFromStorage()), fingerprint(map));
  } finally { if (oldStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = oldStorage; }
});

test('invalid, duplicate placement and insufficient funds consume nothing', () => {
  const c = fresh();
  for (const action of [{ type: 'build', kind: 'bakery', cityId: 'city:0', tileId: c.state.cities[0].tileId },
    { type: 'route', from: 'city:0', to: 'missing' }, { type: 'build', kind: 'workshop', cityId: 'city:0', tileId: buildableTiles(c.state, c.graph, c.base.resourcePlan, 'city:0', 'workshop')[0] }]) {
    const before = structuredClone(c.state); assert.throws(() => run(c, action)); assert.deepEqual(c.state, before);
  }
  const f = build(c, 'bakery'), after = structuredClone(c.state);
  assert.throws(() => run(c, { type: 'build', kind: 'bakery', cityId: 'city:0', tileId: f.tileId })); assert.deepEqual(c.state, after);
  c.state.cash = 0; const poor = structuredClone(c.state);
  assert.throws(() => build(c, 'warehouse'), /cash/); assert.deepEqual(c.state, poor);
});

test('two routes respect inventory reserve, demand capacity and buyer escrow', () => {
  const c = fresh(), s = c.state; s.cities[0].stock.bread = 18;
  route(c); route(c, 'city:2');
  const cash = s.cash, budget = s.cities[1].budget;
  advance(c, 1);
  assert.equal(s.cities[0].stock.bread, 4); assert.equal(s.shipments.reduce((n, sh) => n + sh.quantity, 0), 14);
  const escrow = s.shipments.filter(sh => sh.to === 'city:1').reduce((n, sh) => n + sh.sell, 0);
  assert.equal(s.cities[1].budget, budget - escrow); assert.equal(s.cash, cash - 120);
  assert.ok(capacityLeft(s, s.cities[1]) >= 0);
  const checkpoints = structuredClone(s); run(c, { type: 'toggleRoute', id: s.routes[0].id }); run(c, { type: 'toggleRoute', id: s.routes[1].id });
  advance(c, 200);
  assert.equal(s.sold.bread, 14); assert.ok(s.cash >= cash - 240 + s.shipments.reduce((n, sh) => n + sh.sell, 0));
  assert.ok(checkpoints.shipments.every(sh => !s.shipments.some(other => other.id === sh.id)));
  assert.equal(s.cash, 100000 + s.ledger.reduce((n, e) => n + e.amount, 0));
});

test('arrival and contract settle once across checkpoint resume; returns purchase real cargo', () => {
  const c = fresh(); build(c, 'bakery'); const r = route(c, 'city:1', { back: 'tools' });
  advance(c, 1); c.state.contracts.push({ id: 'contract-test', cityId: 'city:1', good: 'bread', quantity: 8, delivered: 0, reward: 15000, status: 'active', deadline: 300 });
  const copy = { ...c, state: structuredClone(c.state) };
  advance(c, 100); advance(copy, 100); assert.deepEqual(copy.state, c.state);
  assert.equal(c.state.contracts[0].status, 'complete');
  assert.equal(c.state.ledger.filter(e => e.kind === 'contract').length, 1);
  assert.ok(c.state.cities[0].stock.tools > 7); assert.ok(r.revenue > 0 && r.expenses > 0);
  assert.ok(validateState(c.state, c.base, c.graph));
});

test('full warehouses and empty NPC budgets cannot oversell or pay phantom revenue', () => {
  const c = fresh(), dest = c.state.cities[1]; route(c);
  dest.stock = { ...emptyStock(), ore: dest.capacity }; advance(c, 1);
  assert.equal(c.state.shipments.length, 0); assert.equal(c.state.routes[0].waiting, 'capacity');
  dest.stock = emptyStock(); dest.budget = 0; advance(c, 1);
  assert.equal(c.state.shipments.length, 0); assert.equal(c.state.routes[0].waiting, 'budget'); assert.equal(c.state.sold.bread, 0);
});

test('priority protects frequent service while an older low-priority route still receives cargo', () => {
  const c = fresh(), bakery = build(c, 'bakery'); advance(c, 16);
  for (const f of [c.state.facilities[0], bakery]) { run(c, { type: 'upgradeFacility', id: f.id }); run(c, { type: 'upgradeFacility', id: f.id }); }
  const high = route(c, 'city:1', { priority: 3 }), low = route(c, 'city:1', { priority: 1 });
  advance(c, 1200); assert.ok(high.delivered > 0 && low.delivered > 0);
  const before = structuredClone(c.state);
  assert.throws(() => run(c, { type: 'editRoute', id: high.id, good: 'bread', back: '', reserve: 4, priority: 99 }), /route/);
  assert.deepEqual(c.state, before);
});

test('depot limits and editing existing route stay consistent', () => {
  const c = fresh(), r = route(c); route(c, 'city:2');
  assert.doesNotThrow(() => routePreview(c.state, c.graph, { ...r, editing: r.id }));
  assert.throws(() => route(c), /depot/);
  assert.throws(() => run(c, { type: 'routeVehicles', id: r.id }), /depot/);
  build(c, 'depot'); advance(c, 25); run(c, { type: 'routeVehicles', id: r.id });
  const d = c.state.facilities.find(f => f.kind === 'depot');
  assert.throws(() => run(c, { type: 'demolish', id: d.id }), /depot/);
});

test('ports choose connected NPC water access; ships carry cargo with shared capacity and budget rules', () => {
  const result = playCampaign(), c = { ...result, graph: { tiles: result.base.tilesData, neighbors: topology.tiles.map(t => t.neighbors) } };
  run(c, { type: 'build', kind: 'port', cityId: 'city:0', tileId: 306 }); advance(c, 35);
  assert.ok(c.state.cities[1].port); assert.ok(findPath(c.graph, 306, c.state.cities[1].portTileId, 'sea'));
  route(c, 'city:1', { mode: 'sea' }); advance(c, 90);
  assert.ok(c.state.routes.at(-1).delivered > 0); assert.ok(validateState(c.state, c.base, c.graph));
});

test('player transfers never create sales; recovery is single-use and incomplete builds refund unused material', () => {
  const c = fresh(); c.state.milestones = ['production', 'trade', 'network'];
  const tileId = [...nearby(c.graph, c.state.cities[0].tileId, 15, true).keys()].find(id => !c.state.cities.some(city => nearby(c.graph, city.tileId, 3).has(id)) && !c.state.facilities.some(f => f.tileId === id));
  run(c, { type: 'city', cityId: 'city:0', tileId }); const city = c.state.cities.at(-1);
  route(c, city.id, { good: 'wheat' }); advance(c, 180);
  assert.ok(city.stock.wheat > 0); assert.equal(c.state.ledger.filter(e => e.kind === 'sale').length, 0); assert.equal(c.state.sold.wheat, 0);
  c.state.cash = 10000; run(c, { type: 'help' }); assert.equal(c.state.cash, 35000);
  c.state.cash = 10000; assert.throws(() => run(c, { type: 'help' }), /help/);
  c.state.cash = 20000; const wood = c.state.cities[0].stock.wood, f = build(c, 'logging');
  run(c, { type: 'demolish', id: f.id }); assert.equal(c.state.cities[0].stock.wood, wood);
});

test('corrupt checkpoint fields and paths reject safely without throwing', () => {
  const c = fresh(); route(c); advance(c, 1);
  for (const change of [s => { delete s.produced; }, s => { s.cash = -1; }, s => { s.cities[0].stock.tools = NaN; },
    s => { s.routes[0].path = [0, 100]; }, s => { s.shipments[0].sell = -10; }, s => { s.ledger[0].time = Infinity; },
    s => { s.ui.camera = { position: [1], up: [0, 1, 0], target: [0, 0, 0] }; }]) {
    const bad = structuredClone(c.state); change(bad); assert.equal(validateState(bad, c.base, c.graph), false);
  }
  assert.equal(validateState(c.state, {}), false); assert.equal(validateState(null, c.base), false);
});

test('land and sea graphs distinguish impassable terrain and require water endpoints', () => {
  const graph = { tiles: [{ biome: 'plains' }, { biome: 'coast' }, { biome: 'ocean' }, { biome: 'plains' }, { biome: 'mountain' }], neighbors: [[1, 4], [0, 2], [1, 3], [2, 4], [0, 3]] };
  assert.equal(findPath(graph, 0, 3, 'land'), null); assert.deepEqual(findPath(graph, 0, 3, 'sea'), [0, 1, 2, 3]);
  assert.equal(findPath(graph, 0, 4, 'sea'), null);
});

test('session clock handles speed, pause, hold, delayed timers and no offline advancement', async () => {
  const data = new Map(), storage = { getItem: k => data.get(k), setItem: (k, v) => data.set(k, v) };
  let now = 10;
  const world = { worldId: 'test-world', subdivision: 3, hexasphere: topology, planet: () => ({ name: 'Test' }), mapFor: () => map };
  const options = { time: () => now, storeFactory: k => new WorldStateStore(k, { storage, indexedDB: null }), coordination: false };
  const session = new TradeSession(world, options), campaign = await session.create(0, map);
  session.setPaused(false); now += 10; session.pump(); assert.equal(session.state.time, 10);
  session.setSpeed(4); now += 10; session.pump(); assert.equal(session.state.time, 50);
  session.setAppPaused(true); now += 90; session.pump(); session.setAppPaused(false); assert.equal(session.state.time, 50);
  const release = session.hold(); now += 30; session.pump(); release(); release(); assert.equal(session.holds, 0); assert.equal(session.state.time, 50);
  now += 100; session.pump(); while (session.accumulator >= 1) session.pump(); assert.equal(session.state.time, 450);
  session.setPaused(true); now += 50; session.pump(); assert.equal(session.state.time, 450);
  await session.save(); await session.stop(); now += 100000;
  const loaded = new TradeSession(world, options); await loaded.resume(campaign); assert.equal(loaded.state.time, 450); assert.equal(loaded.state.paused, true);
  const exported = loaded.export(); await loaded.import(exported); assert.notEqual(loaded.state.id, campaign); assert.equal(loaded.state.time, 450);
  await assert.rejects(loaded.import('null'), /save/); await assert.rejects(loaded.import('[]'), /save/);
  const bad = JSON.parse(exported); bad.base.tilesData[0].biome = 'desert'; await assert.rejects(loaded.import(JSON.stringify(bad)), /save/);
  world.worldId = 'changed'; loaded.setPaused(false); now += 2; loaded.pump(); assert.equal(loaded.state.paused, true);
  await loaded.destroy(); await session.destroy();
});

test('trade routes roundtrip while legacy planet/town/home routes retain their identity', () => {
  for (const r of [{ mode: 'trade', planet: 2, campaign: 'campaign-valid' }, { mode: 'planet', planet: 2, city: 3 },
    { mode: 'town', planet: 2, city: 3 }, { mode: 'home', planet: 2, city: 3, home: 'house:abc' }]) assert.deepEqual(parseRoute(formatRoute(r)), r);
  assert.equal(parseRoute('#/trade/1/../bad'), null); assert.equal(parseRoute('#/trade/1/x/extra'), null);
});

test('three supplied cities, all six goods and positive operations reach the final goal without grants or cheats', () => {
  const { report, actions } = playCampaign();
  assert.ok(report.milestones.kingdom && report.time < 2400);
  assert.ok(report.cashFlow > 0 && report.cities.every(c => c.stable >= 120));
  assert.ok(GOODS.every(g => report.produced[g] > 0));
  assert.ok(!actions.some(a => a.type === 'help'));
});
