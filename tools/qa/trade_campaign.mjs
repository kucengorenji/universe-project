import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { generateHexasphere } from '../../src/math/hexasphere.js';
import { MapGenerator } from '../../src/map/mapGenerator.js';
import { createCampaign, buildableTiles } from '../../src/trade/scenario.js';
import { command, tick, validateState, cashFlow, capacityLeft } from '../../src/trade/simulation.js';
import { nearby, isLand } from '../../src/trade/routing.js';
import { FACILITIES } from '../../src/trade/catalog.js';

export function playCampaign(seed = 123456) {
  const top = generateHexasphere(3), map = new MapGenerator(top).generate(seed);
  const c = createCampaign(map, top, { id: 'qa-campaign', worldId: 'qa-world', planet: 0, name: 'Headless playthrough' });
  const s = c.state, actions = [], samples = [], reached = new Map();
  const run = action => {
    try { command(s, c.graph, c.base.resourcePlan, action); actions.push({ time: s.time, ...action }); return true; }
    catch (e) { if (!/^trade.error\./.test(e.message)) throw e; return false; }
  };
  const facilities = (kind, cityId = 'city:0') => s.facilities.filter(f => f.kind === kind && f.cityId === cityId);
  const build = (kind, cityId = 'city:0') => {
    if (facilities(kind, cityId).length) return false;
    const tileId = buildableTiles(s, c.graph, c.base.resourcePlan, cityId, kind)[0];
    return tileId === undefined ? false : run({ type: 'build', kind, cityId, tileId });
  };
  for (let second = 0; second < 10800 && !s.milestones.includes('kingdom'); second++) {
    if (second % 15 === 0) {
      const home = s.cities[0];
      build('bakery');
      if (facilities('bakery').length && !s.routes.some(r => r.to === 'city:1')) run({ type: 'route', from: home.id, to: 'city:1', good: 'bread' });
      if (s.milestones.includes('trade') && !s.routes.some(r => r.to === 'city:2')) run({ type: 'route', from: home.id, to: 'city:2', good: 'bread' });
      for (const contract of s.contracts.filter(x => x.status === 'offer')) run({ type: 'contract', id: contract.id });
      const r = s.routes.find(r => r.to === 'city:1');
      if (r) {
        const back = home.stock.tools < 8 && s.cash > 25000 ? 'tools' : '';
        if (r.back !== back) run({ type: 'editRoute', id: r.id, good: r.good, back, reserve: 4 });
      }
      if (s.milestones.includes('network')) {
        build('logging'); build('quarry');
        if (capacityLeft(s, home) < 30) build('warehouse');
        const farm = facilities('farm')[0], bakery = facilities('bakery')[0];
        if (farm.level < 3 && s.cash > 15000) run({ type: 'upgradeFacility', id: farm.id });
        if (farm.level === 3 && bakery.level < 3 && s.cash > 30000) run({ type: 'upgradeFacility', id: bakery.id });
        if (s.cities.filter(x => x.owner === 'player').length < 3 && bakery.level === 3 && s.cash > 55000) {
          const tileId = [...nearby(c.graph, home.tileId, 20, true).keys()].find(id => isLand(c.graph.tiles[id]) &&
            !s.cities.some(x => nearby(c.graph, x.tileId, 3).has(id)) && !s.facilities.some(x => x.tileId === id) &&
            [...nearby(c.graph, id, 3, true).keys()].some(n => c.base.resourcePlan.sites[n].fertility > 0));
          if (tileId !== undefined) run({ type: 'city', cityId: home.id, tileId });
        }
        if (s.cities.filter(x => x.owner === 'player').length > 1) {
          build('depot');
          for (const city of s.cities.filter(x => x.owner === 'player' && x !== home && !x.founding)) {
            let feeder = s.routes.find(x => x.to === city.id);
            if (!feeder && facilities('depot').some(f => !f.construction)) {
              run({ type: 'route', from: home.id, to: city.id, good: 'wood', reserve: 8 }); feeder = s.routes.find(x => x.to === city.id);
            }
            if (feeder && !facilities('farm', city.id).length) {
              const cargo = city.stock.wood < 5 ? 'wood' : city.stock.stone < 2 ? 'stone' : 'wheat';
              if (feeder.good !== cargo) run({ type: 'editRoute', id: feeder.id, good: cargo, back: '', reserve: 4 });
              build('farm', city.id);
            } else if (feeder && facilities('farm', city.id).length && feeder.good !== 'wheat') run({ type: 'editRoute', id: feeder.id, good: 'wheat', back: '', reserve: 12 });
          }
        }
        if (s.cities.filter(x => x.owner === 'player').length >= 3) {
          build('mine'); if (facilities('mine').length) build('workshop');
          if (!facilities('mine').length && r && home.stock.ore < 5 && home.stock.tools >= 8) run({ type: 'editRoute', id: r.id, good: 'bread', back: 'ore', reserve: 4 });
          if (home.stock.ore >= 1) build('workshop');
        }
      }
    }
    const start = performance.now(); tick(s, c.graph, c.base.resourcePlan); samples.push(performance.now() - start);
    for (const m of s.milestones) if (!reached.has(m)) reached.set(m, s.time);
    assert.ok(s.cash >= 0 && s.cities.every(city => Object.values(city.stock).every(n => n >= 0)));
  }
  samples.sort((a, b) => a - b);
  const report = { seed, time: s.time, cash: s.cash / 100, milestones: Object.fromEntries(reached),
    cashFlow: cashFlow(s) / 100, cities: s.cities.filter(x => x.owner === 'player').map(x => ({ name: x.name, service: x.service, stable: x.stable, stock: x.stock })),
    facilities: s.facilities.map(x => ({ kind: x.kind, level: x.level })), produced: s.produced,
    tickAverageMs: samples.reduce((n, x) => n + x, 0) / samples.length, tickP95Ms: samples[Math.floor(samples.length * .95)], actions: actions.length };
  assert.ok(validateState(s, c.base, c.graph));
  return { report, state: s, base: c.base, actions };
}

if (process.argv[1]?.endsWith('trade_campaign.mjs')) {
  const { report } = playCampaign(Number(process.argv[2] || 123456));
  console.log(JSON.stringify(report, null, 2));
  assert.ok(report.milestones.kingdom, 'Campaign cannot reach final milestone');
}
