import { GOODS, PRICE, FACILITIES, LIMITS, MILESTONES, emptyStock, stockTotal } from './catalog.js';
import { buildableTiles } from './scenario.js';
import { findPath, nearby, isLand, connectionKey, tripSeconds } from './routing.js';
import { siteAccess } from './resources.js';

const cityById = (s, id) => s.cities.find(c => c.id === id);
const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
const fail = code => { throw new Error(`trade.error.${code}`); };
const id = (s, prefix) => { let value; do { value = `${prefix}:${s.nextId++}`; } while ([...s.cities, ...s.facilities, ...s.routes, ...s.shipments, ...s.contracts].some(e => e.id === value)); return value; };
export function ledger(s, amount, kind, details = {}) {
  s.ledger.push({ time: s.time, amount, kind, ...details });
  if (s.ledger.length > 500) s.ledger.splice(0, s.ledger.length - 500);
}
function spend(s, amount, kind, details) {
  if (s.cash < amount) fail('cash');
  s.cash -= amount; ledger(s, -amount, kind, details);
}
function materialsAvailable(city, items) { return Object.entries(items || {}).every(([g, n]) => city.stock[g] >= n); }
function takeMaterials(city, items) { for (const [g, n] of Object.entries(items || {})) city.stock[g] -= n; }
export function owned(s) { return s.cities.filter(c => c.owner === 'player'); }
export function capacityLeft(s, city) {
  const arriving = s.shipments.filter(sh => sh.to === city.id && !sh.arrived).reduce((n, sh) => n + sh.quantity, 0);
  return Math.max(0, city.capacity - stockTotal(city.stock) - arriving);
}
export function quote(s, city, good, buying = true) {
  const target = good === 'bread' ? 70 : good === 'wood' ? 60 : 45;
  const scarcity = Math.max(.75, Math.min(1.25, 1.15 - city.stock[good] / (target * 2)));
  const boom = s.event?.kind === 'demand' && s.event.cityId === city.id && good === 'bread' ? 1.3 : 1;
  return Math.round(PRICE[good] * scarcity * boom * (buying ? .95 : 1.05));
}
export function routePreview(s, graph, { from, to, mode = 'land', good = 'bread', back = '', vehicles = 1, reserve = 4, priority = 2, editing = null }) {
  const origin = cityById(s, from), dest = cityById(s, to);
  if (!origin || !dest || origin === dest || ![origin, dest].some(c => c.owner === 'player')) fail('cities');
  if (!['land', 'sea'].includes(mode) || !GOODS.includes(good) || (back && !GOODS.includes(back)) ||
    !integer(vehicles, 1, 8) || !integer(reserve, 0, 9999) || !integer(priority, 1, 3)) fail('route');
  if (mode === 'sea' && (!origin.port || !dest.port)) fail('ports');
  const path = findPath(graph, mode === 'sea' ? origin.portTileId ?? origin.tileId : origin.tileId, mode === 'sea' ? dest.portTileId ?? dest.tileId : dest.tileId, mode);
  if (!path) fail('path');
  const connectionExists = s.routes.some(r => r.mode === mode && connectionKey(r.from, r.to) === connectionKey(from, to));
  const connectionCost = connectionExists ? 0 : 3000 + path.length * (mode === 'sea' ? 100 : 150);
  const home = origin.owner === 'player' ? origin : dest;
  const assigned = s.routes.filter(r => r.id !== editing && (r.home === home.id || (!r.home && [r.from, r.to].includes(home.id)))).reduce((n, r) => n + r.vehicles, 0);
  const slots = 2 + s.facilities.filter(f => f.cityId === home.id && f.kind === 'depot' && !f.construction).reduce((n, f) => n + 4 * f.level, 0);
  if (assigned + vehicles > slots) fail('depot');
  const vehicleCost = Math.max(0, vehicles - (mode === 'land' ? s.freeVehicles || 0 : 0)) * (mode === 'sea' ? 16000 : 8000);
  const seconds = tripSeconds(path, mode);
  const buy = origin.owner === 'npc' ? quote(s, origin, good, false) : 0;
  const sell = dest.owner === 'npc' ? quote(s, dest, good, true) : 0;
  const backBuy = back && dest.owner === 'npc' ? quote(s, dest, back, false) : 0;
  const backSell = back && origin.owner === 'npc' ? quote(s, origin, back, true) : 0;
  return { path, seconds, connectionCost, vehicleCost, cost: connectionCost + vehicleCost,
    capacity: mode === 'sea' ? 24 : 8, buy, sell, backBuy, backSell, margin: sell - buy, vehicles, reserve };
}

export function command(s, graph, plan, action) {
  if (!action || typeof action.type !== 'string') fail('command');
  if (action.type === 'build') {
    const spec = FACILITIES[action.kind], city = cityById(s, action.cityId);
    if (!spec || !city || !buildableTiles(s, graph, plan, action.cityId, action.kind).includes(action.tileId)) fail('tile');
    if (action.kind === 'workshop' && !s.milestones.includes('network')) fail('locked');
    if (action.kind === 'port' && !s.milestones.includes('network')) fail('locked');
    if (action.kind === 'port' && city.port) fail('tile');
    if (!materialsAvailable(city, spec.materials)) fail('materials');
    const connector = findPath(graph, action.tileId, city.tileId);
    if (!connector) fail('path');
    const cost = spec.cost + (connector.length - 1) * 250;
    spend(s, cost, 'build', { kindName: action.kind }); takeMaterials(city, spec.materials);
    s.facilities.push({ id: id(s, 'facility'), kind: action.kind, tileId: action.tileId, cityId: city.id,
      level: 1, active: true, construction: spec.seconds, progress: 0, buffer: emptyStock(), connector });
  } else if (action.type === 'route') {
    action = { mode: 'land', good: 'bread', vehicles: 1, reserve: 4, priority: 2, ...action };
    if (s.routes.length >= LIMITS.routes) fail('limit');
    const preview = routePreview(s, graph, action);
    if (s.routes.reduce((sum, r) => sum + r.vehicles, 0) + action.vehicles > LIMITS.vehicles) fail('limit');
    spend(s, preview.cost, 'route');
    if (action.mode !== 'sea') s.freeVehicles = Math.max(0, (s.freeVehicles || 0) - action.vehicles);
    s.routes.push({ id: id(s, 'route'), from: action.from, to: action.to, mode: action.mode || 'land', good: action.good,
      back: action.back || '', vehicles: action.vehicles, reserve: action.reserve ?? 4, path: preview.path, level: 1,
      home: cityById(s, action.from).owner === 'player' ? action.from : action.to,
      priority: action.priority, lastServed: 0,
      active: true, nextDeparture: 0, waiting: 'stock', delivered: 0, revenue: 0, expenses: preview.cost });
  } else if (action.type === 'editRoute') {
    const route = s.routes.find(r => r.id === action.id);
    if (!route || !GOODS.includes(action.good) || (action.back && !GOODS.includes(action.back)) || !integer(action.reserve, 0, 9999) || !integer(action.priority ?? route.priority ?? 2, 1, 3)) fail('route');
    route.good = action.good; route.back = action.back || ''; route.reserve = action.reserve;
    route.priority = action.priority ?? route.priority ?? 2;
  } else if (action.type === 'routeVehicles') {
    const route = s.routes.find(r => r.id === action.id);
    if (!route || route.vehicles >= 8 || s.routes.reduce((n, r) => n + r.vehicles, 0) >= LIMITS.vehicles) fail('limit');
    const home = route.home || (cityById(s, route.from).owner === 'player' ? route.from : route.to);
    const slots = 2 + s.facilities.filter(f => f.cityId === home && f.kind === 'depot' && !f.construction).reduce((n, f) => n + 4 * f.level, 0);
    if (s.routes.filter(r => r.home === home).reduce((n, r) => n + r.vehicles, 0) >= slots) fail('depot');
    spend(s, route.mode === 'sea' ? 16000 : 8000, 'vehicle'); route.vehicles++;
  } else if (action.type === 'upgradeRoute') {
    const route = s.routes.find(r => r.id === action.id);
    if (!route || route.level >= 3) fail('limit');
    spend(s, 12000 * route.level, 'upgrade'); route.level++;
  } else if (action.type === 'toggleRoute') {
    const route = s.routes.find(r => r.id === action.id); if (!route) fail('route'); route.active = !route.active;
  } else if (action.type === 'removeRoute') {
    const route = s.routes.find(r => r.id === action.id); if (!route) fail('route');
    if (s.shipments.some(sh => sh.routeId === route.id)) fail('transit');
    s.routes = s.routes.filter(r => r !== route);
    const refund = Math.round(route.vehicles * (route.mode === 'sea' ? 16000 : 8000) * .4);
    s.cash += refund; ledger(s, refund, 'refund');
  } else if (action.type === 'toggleFacility') {
    const f = s.facilities.find(f => f.id === action.id); if (!f) fail('tile'); f.active = !f.active;
  } else if (action.type === 'upgradeFacility') {
    const f = s.facilities.find(f => f.id === action.id);
    if (!f || f.level >= 3 || f.construction) fail('limit');
    const city = cityById(s, f.cityId), spec = FACILITIES[f.kind];
    if (!materialsAvailable(city, { wood: 4, stone: 3, tools: 1 })) fail('materials');
    spend(s, Math.round(spec.cost * .75 * f.level), 'upgrade'); takeMaterials(city, { wood: 4, stone: 3, tools: 1 }); f.level++;
    if (spec.capacity) city.capacity += spec.capacity;
  } else if (action.type === 'demolish') {
    const f = s.facilities.find(f => f.id === action.id); if (!f || f.id === 'starter-farm') fail('tile');
    const city = cityById(s, f.cityId), spec = FACILITIES[f.kind];
    if (spec.capacity && !f.construction && city.capacity - capacityLeft(s, city) > city.capacity - spec.capacity * f.level) fail('capacity');
    if (f.kind === 'depot' && s.routes.filter(r => r.home === city.id).reduce((n, r) => n + r.vehicles, 0) >
      2 + s.facilities.filter(other => other !== f && other.kind === 'depot' && other.cityId === city.id && !other.construction).reduce((n, other) => n + other.level * 4, 0)) fail('depot');
    if (f.kind === 'port' && s.routes.some(r => r.mode === 'sea' && [r.from, r.to].includes(city.id))) fail('transit');
    if (spec.capacity && !f.construction) city.capacity -= spec.capacity * f.level;
    if (f.kind === 'port') city.port = false;
    s.facilities = s.facilities.filter(item => item !== f);
    if (f.construction) for (const [g, n] of Object.entries(spec.materials)) {
      const unused = Math.floor(n * f.construction / spec.seconds), space = capacityLeft(s, city);
      city.stock[g] += Math.min(unused, space);
    }
    const refund = Math.round(spec.cost * (f.construction ? .75 : .4)); s.cash += refund; ledger(s, refund, 'refund');
  } else if (action.type === 'city') {
    if (!s.milestones.includes('network')) fail('locked');
    if (owned(s).length >= LIMITS.cities || !isLand(graph.tiles[action.tileId]) ||
      s.cities.some(c => nearby(graph, c.tileId, 3).has(action.tileId)) || s.facilities.some(f => f.tileId === action.tileId)) fail('tile');
    const source = cityById(s, action.cityId);
    if (!source || source.owner !== 'player' || !findPath(graph, source.tileId, action.tileId)) fail('path');
    if (!materialsAvailable(source, { wood: 12, stone: 10, tools: 3 })) fail('materials');
    spend(s, 45000, 'city'); takeMaterials(source, { wood: 12, stone: 10, tools: 3 });
    // Construction supplies are delivered along the previewed founding connection.
    const path = findPath(graph, source.tileId, action.tileId);
    const c = { id: id(s, 'city'), name: `Haven ${owned(s).length + 1}`, tileId: action.tileId, owner: 'player', tier: 1,
      capacity: 120, stock: { ...emptyStock(), wheat: 0, bread: 0 }, budget: 0, service: 0, stable: 0, port: false,
      founding: tripSeconds(path), foundingTotal: tripSeconds(path), foundingPath: path };
    s.cities.push(c);
  } else if (action.type === 'upgradeCity') {
    const city = cityById(s, action.id);
    if (!city || city.owner !== 'player' || city.tier >= 3 || city.service < .8) fail('growth');
    if (!materialsAvailable(city, { wood: 8, stone: 6, tools: 2 })) fail('materials');
    spend(s, 25000 * city.tier, 'upgrade'); takeMaterials(city, { wood: 8, stone: 6, tools: 2 }); city.tier++;
  } else if (action.type === 'contract') {
    const c = s.contracts.find(c => c.id === action.id && c.status === 'offer'); if (!c) fail('contract');
    c.status = 'active'; c.deadline = s.time + 300;
  } else if (action.type === 'decline') {
    const c = s.contracts.find(c => c.id === action.id && c.status === 'offer'); if (!c) fail('contract');
    c.status = 'declined'; s.contractNext = s.time + 120;
  } else if (action.type === 'help') {
    if (s.helpUsed || s.cash > 15000) fail('help');
    s.cash += 25000; s.helpUsed = true; ledger(s, 25000, 'help');
  } else fail('command');
  s.revision++;
  return s;
}

function dispatch(s, route, slot, reverse = false) {
  const origin = cityById(s, reverse ? route.to : route.from), dest = cityById(s, reverse ? route.from : route.to);
  const good = reverse ? route.back : route.good;
  const reserve = origin.owner === 'player' ? route.reserve : 2;
  const space = capacityLeft(s, dest), available = good ? Math.max(0, origin.stock[good] - reserve) : 0;
  const buy = origin.owner === 'npc' && good ? quote(s, origin, good, false) : 0;
  const sell = dest.owner === 'npc' && good ? quote(s, dest, good, true) : 0;
  const travelCost = route.mode === 'sea' ? 120 : 60;
  const affordable = buy ? Math.floor(Math.max(0, s.cash - travelCost) / buy) : Infinity;
  const buyerAffordable = sell ? Math.floor(dest.budget / sell) : Infinity;
  const target = { wheat: 40, bread: dest.owner === 'player' ? 20 * dest.tier : 70, wood: 50, stone: 40, ore: 40, tools: dest.owner === 'player' ? 16 : 40 };
  const incoming = good ? s.shipments.filter(sh => sh.to === dest.id && sh.good === good && !sh.arrived).reduce((n, sh) => n + sh.quantity, 0) : 0;
  const demand = good ? Math.max(0, target[good] - dest.stock[good] - incoming) : 0;
  const quantity = good ? Math.max(0, Math.min(route.mode === 'sea' ? 24 : 8, available, space, demand, affordable, buyerAffordable)) : 0;
  if (!quantity && !reverse) {
    route.waiting = s.cash < travelCost ? 'cash' : !available ? 'stock' : !space ? 'capacity' : !demand ? 'demand' : !affordable ? 'cash' : 'budget'; return false;
  }
  if (s.cash < travelCost) { route.waiting = 'cash'; return false; }
  const key = connectionKey(origin.tileId, dest.tileId);
  const loadingKey = route.mode === 'sea' ? `port:${origin.id}` : null;
  if ((!reverse && (s.connections[key] || 0) > s.time) || loadingKey && (s.connections[loadingKey] || 0) > s.time) { route.waiting = 'queue'; return false; }
  if (quantity) {
    origin.stock[good] -= quantity;
    if (buy) { s.cash -= buy * quantity; origin.budget += buy * quantity; ledger(s, -buy * quantity, 'purchase', { good, quantity }); }
    if (sell) dest.budget -= sell * quantity;
  }
  s.cash -= travelCost; ledger(s, -travelCost, 'transport'); route.expenses += travelCost + buy * quantity;
  const slowdown = s.event?.kind === 'maintenance' && s.event.routeId === route.id ? 1.5 : 1;
  const seconds = tripSeconds(route.path, route.mode, route.level) * slowdown;
  s.shipments.push({ id: id(s, 'shipment'), routeId: route.id, slot, from: origin.id, to: dest.id,
    good: good || '', quantity, sell: sell * quantity, elapsed: 0, seconds, reverse, arrived: false });
  s.connections[key] = s.time + 10 / route.level;
  if (!reverse) route.lastServed = s.time;
  if (loadingKey) { const port = s.facilities.find(f => f.kind === 'port' && f.cityId === origin.id); s.connections[loadingKey] = s.time + 10 / (port?.level || 1); }
  route.waiting = ''; return true;
}

function advanceShipments(s) {
  for (const sh of [...s.shipments]) {
    sh.elapsed++;
    if (sh.elapsed < sh.seconds) continue;
    const route = s.routes.find(r => r.id === sh.routeId), dest = cityById(s, sh.to);
    if (!sh.arrived) {
      if (sh.quantity) {
        dest.stock[sh.good] += sh.quantity; s.deliveries++; route.delivered += sh.quantity;
        if (sh.sell) {
          s.cash += sh.sell; route.revenue += sh.sell; s.sold[sh.good] += sh.quantity;
          ledger(s, sh.sell, 'sale', { good: sh.good, quantity: sh.quantity, cityId: dest.id });
          for (const contract of s.contracts) if (contract.status === 'active' && contract.cityId === dest.id && contract.good === sh.good)
            contract.delivered = Math.min(contract.quantity, contract.delivered + sh.quantity);
        }
      }
      sh.arrived = true;
    }
    if (!sh.reverse) {
      // A return leg is still a physical trip, including an empty return.
      if (!dispatch(s, route, sh.slot, true)) {
        if (route.waiting === 'queue') continue;
        s.shipments.push({ ...sh, from: sh.to, to: sh.from, reverse: true, quantity: 0, good: '', sell: 0, elapsed: 0, arrived: true });
      }
    }
    s.shipments = s.shipments.filter(item => item !== sh);
  }
}

function progression(s) {
  const conditions = { production: s.produced.bread > 0, trade: s.produced.bread > 0 && s.sold.bread > 0,
    network: s.routes.filter(r => r.delivered > 0).length >= 2,
    city: owned(s).filter(c => !c.founding).length >= 2,
    kingdom: owned(s).length >= 3 && owned(s).every(c => c.stable >= 120) && s.produced.tools > 0 && cashFlow(s) > 0 };
  for (const name of MILESTONES) {
    if (s.milestones.includes(name)) continue;
    if (!conditions[name]) break;
    s.milestones.push(name);
    const reward = name === 'trade' ? 12000 : name === 'network' ? 25000 : name === 'city' ? 20000 : name === 'kingdom' ? 50000 : 0;
    if (reward) { s.cash += reward; ledger(s, reward, 'milestone', { milestone: name }); }
  }
  for (const c of s.contracts) {
    if (c.status !== 'active') continue;
    if (c.delivered >= c.quantity) { c.status = 'complete'; s.cash += c.reward; ledger(s, c.reward, 'contract'); s.contractNext = s.time + 180; }
    else if (s.time >= c.deadline) { c.status = 'expired'; s.contractNext = s.time + 120; }
  }
  if (s.milestones.includes('trade') && s.time >= s.contractNext && !s.contracts.some(c => ['offer', 'active'].includes(c.status))) {
    const buyer = s.cities.find(c => c.owner === 'npc');
    s.contracts.push({ id: id(s, 'contract'), cityId: buyer.id, good: 'bread', quantity: 8, delivered: 0, reward: 15000, status: 'offer', deadline: 0 });
    if (s.contracts.length > 20) s.contracts.shift();
  }
  if (s.event && s.time >= s.event.until) { s.event = null; s.eventNext = s.time + 240; }
  if (!s.event && s.milestones.includes('trade') && s.time >= s.eventNext) {
    const choices = ['demand', 'harvest', 'maintenance'];
    const kind = choices[Math.floor(s.time / 150) % choices.length];
    s.event = { kind, until: s.time + 90, cityId: s.cities.find(c => c.owner === 'npc').id, routeId: s.routes[0]?.id };
  }
}

export function tick(s, graph, plan) {
  s.time++;
  for (const city of s.cities) {
    if (city.founding > 0) { city.founding--; continue; }
    if (s.time % 30 === 0) {
      const need = city.owner === 'player' ? city.tier : 2;
      const bread = Math.min(need, city.stock.bread); city.stock.bread -= bread;
      const wheat = Math.min((need - bread) * 2, city.stock.wheat); city.stock.wheat -= wheat;
      city.service = Math.min(1, (bread + wheat / 2) / need);
      if (city.owner === 'player') { const income = Math.round(150 * city.tier * city.service); s.cash += income; ledger(s, income, 'tax'); }
      else {
        const output = city.profile === 'industry' ? { tools: 3, ore: 4 } : { wheat: 6, stone: 3 };
        const supplyTarget = { wheat: 70, stone: 60, ore: 45, tools: 40 };
        for (const [g, amount] of Object.entries(output)) city.stock[g] += Math.min(amount, capacityLeft(s, city), Math.max(0, supplyTarget[g] - city.stock[g]));
        for (const g of ['wood', 'stone']) city.stock[g] = Math.max(0, city.stock[g] - 2);
        if (s.time % 60 === 0) city.stock.tools = Math.max(0, city.stock.tools - 1);
      }
    }
    city.stable = city.service >= .8 ? city.stable + 1 : 0;
    if (city.owner === 'npc' && s.time % 60 === 0) city.budget = Math.min(200000, city.budget + 30000);
  }
  for (const f of s.facilities) {
    const spec = FACILITIES[f.kind], city = cityById(s, f.cityId);
    if (f.construction > 0) {
      f.construction--;
      if (!f.construction) {
        if (spec.capacity) city.capacity += spec.capacity;
        if (f.kind === 'port') {
          city.port = true; city.portTileId = f.tileId;
          for (const npc of s.cities.filter(c => c.owner === 'npc' && !c.port)) {
            const ports = [...nearby(graph, npc.tileId, 3, true).keys()].filter(tile => siteAccess(graph, plan, tile).coast);
            const port = ports.find(tile => findPath(graph, f.tileId, tile, 'sea'));
            if (port !== undefined) { npc.port = true; npc.portTileId = port; }
          }
        }
      }
      continue;
    }
    if (!f.active || city.founding) continue;
    if (s.time % 60 === 0) { const upkeep = spec.upkeep * f.level; f.unpaid = s.cash < upkeep; if (!f.unpaid) { s.cash -= upkeep; ledger(s, -upkeep, 'upkeep'); } }
    if (f.unpaid) continue;
    if (s.time % 5 === 0) for (const g of GOODS) { const amount = Math.min(f.buffer[g], capacityLeft(s, city), 4); city.stock[g] += amount; f.buffer[g] -= amount; }
    if (!spec.output) continue;
    const yieldRate = f.kind === 'farm' ? siteAccess(graph, plan, f.tileId).fertility * (s.event?.kind === 'harvest' ? .65 : 1) : 1;
    f.progress += f.level * yieldRate;
    if (f.progress < spec.cycle) continue;
    if (!materialsAvailable(city, spec.input) || stockTotal(f.buffer) >= 12) { f.progress = spec.cycle; continue; }
    takeMaterials(city, spec.input);
    for (const [g, n] of Object.entries(spec.output)) { f.buffer[g] += n; s.produced[g] += n; }
    f.progress -= spec.cycle;
  }
  advanceShipments(s);
  // Rotate scheduling to give shared connections fair access.
  const routes = [...s.routes]; if (routes.length) { const offset = s.time % routes.length; routes.push(...routes.splice(0, offset)); }
  routes.sort((a, b) => (s.time - (b.lastServed || 0)) * (b.priority || 2) - (s.time - (a.lastServed || 0)) * (a.priority || 2));
  for (const route of routes) {
    if (!route.active) continue;
    for (let slot = 0; slot < route.vehicles; slot++) {
      if (s.shipments.some(sh => sh.routeId === route.id && sh.slot === slot)) continue;
      dispatch(s, route, slot);
    }
  }
  progression(s); s.revision++;
}

export function cashFlow(s) {
  return s.ledger.filter(entry => entry.time > s.time - 120 && !['build', 'route', 'upgrade', 'vehicle', 'city', 'milestone', 'contract', 'help', 'refund'].includes(entry.kind))
    .reduce((sum, entry) => sum + entry.amount, 0) / Math.max(1, Math.min(120, s.time)) * 60;
}
export function facilityStatus(s, f) {
  if (f.construction) return 'construction';
  if (!f.active) return 'paused';
  if (f.unpaid) return 'cash';
  if (stockTotal(f.buffer) >= 12) return 'capacity';
  if (!materialsAvailable(cityById(s, f.cityId), FACILITIES[f.kind].input)) return 'input';
  return 'running';
}
export function alerts(s) {
  return [
    ...owned(s).filter(c => !c.founding && c.service < .8).map(c => ({ type: 'city', id: c.id, reason: 'food' })),
    ...s.facilities.filter(f => ['input', 'capacity', 'cash'].includes(facilityStatus(s, f))).map(f => ({ type: 'facility', id: f.id, reason: facilityStatus(s, f) })),
    ...s.routes.filter(r => r.active && r.waiting && r.waiting !== 'queue').map(r => ({ type: 'route', id: r.id, reason: r.waiting }))
  ];
}

export function validateState(s, base, graph = null) {
  try { return validState(s, base, graph); } catch { return false; }
}
function validState(s, base, graph) {
  if (!base || !integer(base.subdivision, 2, 5) || !Array.isArray(base.tilesData) ||
    base.tilesData.length !== 10 * 4 ** base.subdivision + 2 || base.planetType !== 'terran' ||
    base.resourcePlan?.version !== 1 || !base.resourcePlan.sites) return false;
  const validPath = path => Array.isArray(path) && path.length > 1 && path.length <= base.tilesData.length &&
    path.every((tile, i) => integer(tile, 0, base.tilesData.length - 1) && (!graph || !i || graph.neighbors[path[i - 1]].includes(tile)));
  for (const [i, tile] of base.tilesData.entries()) {
    const site = base.resourcePlan.sites[i];
    if (tile.id !== i || typeof tile.biome !== 'string' || !Number.isFinite(tile.elevation) || !Number.isFinite(tile.moisture) ||
      !site || ['fertility', 'wood', 'stone', 'ore'].some(k => !Number.isFinite(site[k]) || site[k] < 0 || site[k] > 2)) return false;
  }
  if (!s || s.schema !== 1 || typeof s.id !== 'string' || !/^[a-zA-Z0-9:_-]{1,100}$/.test(s.id) ||
    !Number.isFinite(s.cash) || s.cash < 0 || !Number.isInteger(s.cash) || !Number.isInteger(s.time) || s.time < 0 ||
    ![1, 2, 4].includes(s.speed) || typeof s.paused !== 'boolean' || !Array.isArray(s.cities) ||
    s.cities.length < 3 || s.cities.length > LIMITS.cities + 2 || !Array.isArray(s.facilities) || s.facilities.length > 2000 ||
    !Array.isArray(s.routes) || s.routes.length > LIMITS.routes || !Array.isArray(s.shipments) || s.shipments.length > LIMITS.vehicles ||
    !Array.isArray(s.ledger) || s.ledger.length > 500 || !Array.isArray(s.contracts) || s.contracts.length > 20 ||
    !Array.isArray(s.milestones) || s.milestones.some(m => !MILESTONES.includes(m)) || !integer(s.nextId, 1, 1e12) ||
    !integer(s.revision, 0, 1e12) || !integer(s.planet, 0, 1000) || typeof s.worldId !== 'string' || typeof s.name !== 'string' || s.name.length > 300 ||
    typeof s.fingerprint !== 'string' || !s.ui || !s.connections || typeof s.connections !== 'object' ||
    !integer(s.deliveries, 0, 1e12) || !Number.isFinite(s.contractNext) || !Number.isFinite(s.eventNext) ||
    GOODS.some(g => !integer(s.produced?.[g], 0, 1e12) || !integer(s.sold?.[g], 0, 1e12))) return false;
  const ids = new Set();
  for (const entity of [...s.cities, ...s.facilities, ...s.routes, ...s.shipments]) {
    if (typeof entity.id !== 'string' || !/^[a-zA-Z0-9:_-]{1,100}$/.test(entity.id) || ids.has(entity.id)) return false; ids.add(entity.id);
  }
  const occupied = new Set();
  for (const entity of [...s.cities, ...s.facilities]) { if (occupied.has(entity.tileId)) return false; occupied.add(entity.tileId); }
  for (const city of s.cities) if (!isLand(base.tilesData[city.tileId]) || !['player', 'npc'].includes(city.owner) || !integer(city.capacity, 1, 100000) ||
    !integer(city.budget, 0, 1e12) || !integer(city.tier, 1, 3) || typeof city.name !== 'string' || city.name.length > 300 ||
    !Number.isFinite(city.service) || city.service < 0 || city.service > 1 || !integer(city.stable, 0, 1e12) || typeof city.port !== 'boolean' ||
    (city.port && !isLand(base.tilesData[city.portTileId])) || (city.founding && (!validPath(city.foundingPath) || !Number.isFinite(city.foundingTotal))) ||
    GOODS.some(g => !integer(city.stock?.[g], 0, 1e9))) return false;
  if (s.cities.filter(c => c.owner === 'npc').length !== 2 || !owned(s).length) return false;
  for (const f of s.facilities) if (!FACILITIES[f.kind] || cityById(s, f.cityId)?.owner !== 'player' || !isLand(base.tilesData[f.tileId]) || !integer(f.level, 1, 3) ||
    typeof f.active !== 'boolean' || !integer(f.construction, 0, 10000) || !validPath(f.connector) ||
    f.connector[0] !== f.tileId || f.connector.at(-1) !== cityById(s, f.cityId).tileId ||
    !Number.isFinite(f.progress) || f.progress < 0 || GOODS.some(g => !integer(f.buffer?.[g], 0, 1e9))) return false;
  for (const route of s.routes) if (!cityById(s, route.from) || !cityById(s, route.to) || route.from === route.to || !['land', 'sea'].includes(route.mode) ||
    !GOODS.includes(route.good) || (route.back && !GOODS.includes(route.back)) || !integer(route.vehicles, 1, 8) ||
    !validPath(route.path) || !integer(route.reserve, 0, 9999) || !integer(route.level, 1, 3) || typeof route.active !== 'boolean' ||
    !integer(route.delivered, 0, 1e12) || !integer(route.revenue, 0, 1e12) || !integer(route.expenses, 0, 1e12) ||
    !integer(route.priority ?? 2, 1, 3) || !integer(route.lastServed ?? 0, 0, s.time)) return false;
  for (const r of s.routes) {
    const from = cityById(s, r.from), to = cityById(s, r.to);
    if (![from, to].some(c => c.owner === 'player') || cityById(s, r.home)?.owner !== 'player' ||
      r.path[0] !== (r.mode === 'sea' ? from.portTileId : from.tileId) || r.path.at(-1) !== (r.mode === 'sea' ? to.portTileId : to.tileId) ||
      (r.mode === 'sea' ? !from.port || !to.port || r.path.slice(1, -1).some(i => isLand(base.tilesData[i])) : r.path.some(i => !isLand(base.tilesData[i])))) return false;
  }
  if (s.routes.reduce((n, r) => n + r.vehicles, 0) > LIMITS.vehicles) return false;
  for (const sh of s.shipments) if (!s.routes.some(r => r.id === sh.routeId) || !cityById(s, sh.to) || !cityById(s, sh.from) ||
    !integer(sh.quantity, 0, 24) || (sh.quantity > 0 && !GOODS.includes(sh.good)) || !integer(sh.sell, 0, 1e12) ||
    !Number.isFinite(sh.elapsed) || !Number.isFinite(sh.seconds) || sh.elapsed < 0 || sh.seconds <= 0 ||
    !integer(sh.slot, 0, s.routes.find(r => r.id === sh.routeId).vehicles - 1) || sh.seconds > 270 || typeof sh.reverse !== 'boolean' || typeof sh.arrived !== 'boolean') return false;
  for (const e of s.ledger) if (!integer(e.time, 0, s.time) || !Number.isSafeInteger(e.amount) || typeof e.kind !== 'string') return false;
  for (const c of s.contracts) if (typeof c.id !== 'string' || !/^[a-zA-Z0-9:_-]{1,100}$/.test(c.id) || !cityById(s, c.cityId) || !GOODS.includes(c.good) || !integer(c.quantity, 1, 10000) ||
    !integer(c.delivered, 0, c.quantity) || !integer(c.reward, 0, 1e12) || !integer(c.deadline, 0, 1e12) ||
    !['offer', 'active', 'declined', 'expired', 'complete'].includes(c.status)) return false;
  if (s.event && (!['demand', 'harvest', 'maintenance'].includes(s.event.kind) || !Number.isFinite(s.event.until))) return false;
  if (s.ui.camera && ['position', 'target', 'up'].some(k => !Array.isArray(s.ui.camera[k]) || s.ui.camera[k].length !== 3 || s.ui.camera[k].some(n => !Number.isFinite(n)))) return false;
  return true;
}
