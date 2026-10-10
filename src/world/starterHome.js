// The house the First Journey points at. Plain functions over data the town already has
// (layout, doors, walk network), so the choice is the same on every visit and can be
// checked without a browser. The choice is saved per world (core/journey.js); nothing
// here picks again once an id is stored.

/** Shells people live in. Anything else enterable is only used when no home has a safe door. */
export const RESIDENTIAL = new Set(['f_house_small', 'f_house', 'f_house_tall', 'f_townhouse', 'm_house']);

/** The hometown of the home planet: the first city the player owns, else the first city. */
export function homeCityIndex(map) {
  const cities = map?.cities || [];
  if (!cities.length) return null;
  const own = cities.findIndex(c => c.owner === 'player');
  return own >= 0 ? own : 0;
}

/**
 * Pick the starter house: the enterable residential building closest to the spawn whose door is
 * reachable by the walk network (portal `reason === null`). With none, an enterable non-residential
 * building with a safe door. With none either: null, and the journey says the destination is
 * unavailable instead of pointing at a door nobody can use.
 *
 *   doors        findTownDoors() result [{ b, x, z, outYaw }]
 *   walkNetwork  createWalkNetwork() result, or { portals }
 *   spawn        { x, z } where the player starts
 */
export function chooseStarterHome({ doors, walkNetwork, spawn, residential = RESIDENTIAL }) {
  const safe = new Map((walkNetwork?.portals || []).map(p => [p.id, p.reason === null || p.reason === undefined]));
  const candidates = [];
  for (const door of doors || []) {
    const b = door.b;
    const portalId = b?.blueprint?.portalId;
    if (!b?.id || !portalId || b.homeRecord) continue; // authored homes open the editor, not a room
    if (!safe.get(portalId)) continue;
    candidates.push({
      buildingId: b.id, portalId, x: door.x, z: door.z, outYaw: door.outYaw, asset: b.asset,
      tier: residential.has(b.asset) ? 0 : 1, distance: Math.hypot(door.x - (spawn?.x ?? 0), door.z - (spawn?.z ?? 0))
    });
  }
  candidates.sort((a, b) => a.tier - b.tier || a.distance - b.distance || (a.buildingId < b.buildingId ? -1 : a.buildingId > b.buildingId ? 1 : 0));
  const best = candidates[0];
  if (!best) return null;
  const { distance, ...home } = best;
  return home;
}

/** The saved choice, found again among this visit's doors; null when the building is gone or its door is unsafe. */
export function findStarterDoor(home, doors, walkNetwork = null) {
  if (!home?.buildingId) return null;
  const door = (doors || []).find(d => d.b?.id === home.buildingId && !d.b.homeRecord);
  if (!door) return null;
  const portal = (walkNetwork?.portals || []).find(p => p.id === door.b.blueprint?.portalId);
  if (portal && portal.reason) return null;
  return door;
}
