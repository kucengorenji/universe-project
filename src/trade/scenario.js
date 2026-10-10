import { emptyStock } from './catalog.js';
import { graphFor, nearby, findPath, isLand } from './routing.js';
import { resourcePlan, fingerprint, siteAccess, siteScore } from './resources.js';

export function prepareScenario(map, topology) {
  if (map.planetType !== 'terran') return { ok: false, reason: 'planet' };
  const plan = resourcePlan(map), graph = graphFor(map, topology);
  const candidates = map.tilesData.filter(isLand).map(t => t.id);
  const preferred = map.cities?.find(c => c.owner === 'player')?.tileId;
  const starts = [...new Set([preferred, ...candidates.filter(id => plan.sites[id].fertility > 0)])].filter(id => id !== undefined);
  // Bound scoring and prefer existing settlement context without touching the exploration map.
  for (const start of starts.slice(0, 800)) {
    if (siteScore(graph, plan, start) < 0) continue;
    const connected = nearby(graph, start, 80, true);
    const partners = [...connected].filter(([id, distance]) => distance >= 5 && distance <= 35 && plan.sites[id]?.fertility > 0);
    if (partners.length < 2) continue;
    const first = partners[Math.floor(partners.length * .2)][0];
    const second = partners.find(([id]) => !nearby(graph, first, 4, true).has(id))?.[0];
    if (second === undefined) continue;
    const area = [...nearby(graph, start, 3, true).keys()];
    const farm = area.find(id => id !== start && plan.sites[id].fertility > 0);
    if (farm === undefined || !area.some(id => id !== farm && id !== start && isLand(graph.tiles[id]))) continue;
    return { ok: true, plan, graph, sites: [start, first, second], farm,
      paths: [findPath(graph, start, first), findPath(graph, start, second)] };
  }
  return { ok: false, reason: 'terrain' };
}

export function createCampaign(map, topology, { id, planet, worldId, name, tutorial = true } = {}) {
  const scenario = prepareScenario(map, topology);
  if (!scenario.ok) throw new Error(`trade.error.${scenario.reason}`);
  const { plan, graph, sites, farm } = scenario;
  const base = structuredClone(map);
  base.resourcePlan = plan;
  base.cities = []; base.farms = []; base.landRoutes = []; base.seaRoutes = []; base.airRoutes = [];
  base.player = null; base.system = null;
  for (const tile of base.tilesData) {
    tile.owner = null; tile.cityIndex = null; tile.farmIndex = null; tile.isCapital = false; tile.capitalOf = null; tile.road = false;
  }
  const cities = sites.map((tileId, index) => ({ id: `city:${index}`, name: index === 0 ? 'Hearth' : index === 1 ? 'Ironvale' : 'Eastmere',
    tileId, owner: index === 0 ? 'player' : 'npc', profile: index === 1 ? 'industry' : 'agriculture', tier: 1,
    capacity: index === 0 ? 120 : 240, stock: { ...emptyStock(), ...(index === 0 ? { wheat: 20, bread: 20, wood: 30, stone: 20, tools: 8 } :
      index === 1 ? { wheat: 10, bread: 4, wood: 10, stone: 20, ore: 45, tools: 35 } : { wheat: 70, bread: 4, wood: 20, stone: 60, tools: 4 }) },
    budget: index === 0 ? 0 : 100000, service: 1, port: false, stable: 0 }));
  return { base, graph, state: { schema: 1, id: id || `campaign-${Date.now().toString(36)}`, worldId, planet, name,
    fingerprint: fingerprint(map), time: 0, speed: 1, paused: true, cash: 100000, freeVehicles: 1, nextId: 1, revision: 0,
    cities, facilities: [{ id: 'starter-farm', kind: 'farm', tileId: farm, cityId: 'city:0', level: 1, active: true,
      construction: 0, progress: 0, buffer: emptyStock(), connector: findPath(graph, farm, sites[0]) }],
    routes: [], shipments: [], ledger: [], milestones: [], contracts: [], contractNext: 0, event: null, eventNext: 450,
    produced: emptyStock(), sold: emptyStock(), deliveries: 0, helpUsed: false, tutorial,
    connections: {}, ui: { selection: { type: 'city', id: 'city:0' }, camera: null }, sessionSavedAt: null } };
}

export function buildableTiles(state, graph, plan, cityId, kind) {
  const city = state.cities.find(c => c.id === cityId && c.owner === 'player');
  if (!city) return [];
  const occupied = new Set([...state.cities.map(c => c.tileId), ...state.facilities.map(f => f.tileId)]);
  return [...nearby(graph, city.tileId, city.tier + 2, true).keys()].filter(id => {
    if (occupied.has(id)) return false;
    const site = siteAccess(graph, plan, id);
    return kind === 'farm' ? site.fertility > 0 : kind === 'logging' ? site.wood > 0 :
      kind === 'quarry' ? site.stone > 0 : kind === 'mine' ? site.ore > 0 : kind === 'port' ? site.coast : true;
  });
}
