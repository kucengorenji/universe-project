import { seedFor } from '../world/identity.js';
import { nearby, isLand, isWater } from './routing.js';

export const RESOURCE_VERSION = 1;
export function resourcePlan(map) {
  if (map.resourcePlan?.version === RESOURCE_VERSION) return map.resourcePlan;
  const sites = {};
  for (const tile of map.tilesData) {
    const variation = (seedFor(map.seed, 'trade-resource', tile.id) % 100) / 100;
    sites[tile.id] = {
      fertility: tile.biome === 'plains' ? .8 + variation * .4 : tile.hasRiver && isLand(tile) ? .65 : 0,
      wood: tile.biome === 'forest' ? 1 : 0,
      stone: tile.biome === 'mountain' ? 1 : isLand(tile) && variation > .75 ? 1 : 0,
      ore: tile.biome === 'mountain' ? .8 + variation * .4 : 0
    };
  }
  return { version: RESOURCE_VERSION, sites };
}

export function fingerprint(map) {
  return String(seedFor(map.seed, map.subdivision, map.planetType, map.options,
    map.tilesData.map(t => [t.biome, Math.round(t.elevation * 10000), Math.round(t.moisture * 10000), !!t.hasRiver])));
}

export function siteAccess(graph, plan, tileId) {
  const tile = graph.tiles[tileId], site = plan.sites[tileId];
  if (!tile || !site || !isLand(tile)) return { fertility: 0, wood: 0, stone: 0, ore: 0, coast: false };
  const neighbors = graph.neighbors[tileId] || [];
  return { ...site,
    stone: Math.max(site.stone, ...neighbors.map(n => plan.sites[n]?.stone || 0)),
    ore: Math.max(site.ore, ...neighbors.map(n => plan.sites[n]?.ore || 0)),
    coast: neighbors.some(n => isWater(graph.tiles[n]))
  };
}

export function siteScore(graph, plan, id) {
  if (!isLand(graph.tiles[id])) return -1;
  const area = [...nearby(graph, id, 3, true).keys()];
  let farms = 0, wood = 0, stone = 0, ore = 0;
  for (const tile of area) {
    const a = siteAccess(graph, plan, tile);
    farms += a.fertility > 0 ? 1 : 0; wood += a.wood; stone += a.stone; ore += a.ore;
  }
  return farms >= 2 && wood >= 1 && area.length >= 8 ? farms + wood * 2 + Math.min(stone, 3) + Math.min(ore, 3) : -1;
}
