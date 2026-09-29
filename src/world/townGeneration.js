import { seedFor } from './identity.js';

// 3: practical street widths, hedgerows on field edges, flowers in drifts.
export const TOWN_LAYOUT_VERSION = 3;

const keyOf = (planet, townSeed) => `town-layout:${planet}:${townSeed}`;

// Existing interiors refer to coordinate-based building IDs. Keep that town's
// original parcel generator; a visual refresh must not silently orphan rooms.
export function townGenerationVersion(state, planet, townSeed) {
  const key=keyOf(planet,townSeed);
  const saved=state.get(key);
  const hasRooms=townHasSavedRooms(state,planet,townSeed);
  if(saved?.version===1||saved?.version===TOWN_LAYOUT_VERSION)return saved.version;
  if(saved?.version){
    // Visited under an older generator: keep it only while saved rooms depend on it
    const layoutSeed=saved.variant?seedFor(townSeed,'town-variant',saved.variant):townSeed;
    if(townHasSavedRooms(state,planet,layoutSeed))return saved.version;
    const originalVersion=saved.variant&&hasRooms?saved.originalVersion??saved.version:TOWN_LAYOUT_VERSION;
    state.set(key,{...saved,version:TOWN_LAYOUT_VERSION,originalVersion});
    return TOWN_LAYOUT_VERSION;
  }
  const version=hasRooms?1:TOWN_LAYOUT_VERSION;
  state.set(key,{version,townSeed,planet});
  return version;
}

/** The plan the player approved for this town: variant 0 / density 1 is the original. */
export function townPlanChoice(state, planet, townSeed) {
  const saved = state.get(keyOf(planet, townSeed)) || {};
  return { variant: saved.variant ?? 0, density: saved.density ?? 1 };
}

/** Rooms the player changed in the town built from layoutSeed (building IDs carry that seed). */
export function townHasSavedRooms(state, planet, layoutSeed) {
  const prefix = `interior:${planet}:town:${layoutSeed}:`;
  return [...state.records.keys()].some(id => id.startsWith(prefix));
}

/** Generator version for a plan: a replan uses the current one, the original keeps its own. */
export function townPlanVersion(state, planet, townSeed, { variant, density }) {
  const saved = state.get(keyOf(planet, townSeed)) || {};
  const original = saved.originalVersion ?? saved.version ?? TOWN_LAYOUT_VERSION;
  return variant === 0 && density === 1 ? original : TOWN_LAYOUT_VERSION;
}

/** Approve a plan from the 2D planner. Going back to the original restores its rooms. */
export function saveTownPlanChoice(state, planet, townSeed, { variant, density }) {
  const saved = state.get(keyOf(planet, townSeed)) || {};
  const originalVersion = saved.originalVersion ?? saved.version ?? TOWN_LAYOUT_VERSION;
  const version = townPlanVersion(state, planet, townSeed, { variant, density });
  return state.set(keyOf(planet, townSeed), { version, originalVersion, townSeed, planet, variant, density });
}
