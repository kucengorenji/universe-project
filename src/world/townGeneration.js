import { seedFor } from './identity.js';
import { TOWN_LAYOUT_VERSION } from './versions.js';
import { t } from '../i18n/index.js';

export { TOWN_LAYOUT_VERSION };

const keyOf = (planet, townSeed) => `town-layout:${planet}:${townSeed}`;

// Existing interiors refer to coordinate-based building IDs. Keep that town's
// original parcel generator; a visual refresh must not silently orphan rooms.
export function townGenerationVersion(state, planet, townSeed) {
  const key=keyOf(planet,townSeed);
  const saved=state.get(key);
  const hasRooms=townHasSavedRooms(state,planet,townSeed);
  const homes = townHomeRecords(state, planet).filter(home => home.townSeed === townSeed);
  if(saved?.version===TOWN_LAYOUT_VERSION)return saved.version;
  if(saved?.version){
    // Saved rooms and authored homes pin the active original or variant layout.
    const layoutSeed=saved.variant?seedFor(townSeed,'town-variant',saved.variant):townSeed;
    if(townHasSavedRooms(state,planet,layoutSeed) || homes.some(home => home.layoutSeed === layoutSeed))return saved.version;
    const originalHome=homes.find(home => home.layoutSeed === townSeed);
    const originalVersion=saved.variant&&(hasRooms||originalHome)?saved.originalVersion??originalHome?.layoutVersion??saved.version:TOWN_LAYOUT_VERSION;
    state.set(key,{...saved,version:TOWN_LAYOUT_VERSION,originalVersion});
    return TOWN_LAYOUT_VERSION;
  }
  const version=hasRooms?1:(homes.find(home => home.layoutSeed === townSeed)?.layoutVersion ?? TOWN_LAYOUT_VERSION);
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

function townHomeRecords(state, planet) {
  return [...state.records.keys()].filter(id => id.startsWith(`home:${planet}:`)).map(id => state.get(id)).filter(Boolean);
}

export function townHasSavedHomes(state, planet, townSeed) {
  return townHomeRecords(state, planet).some(home => home.townSeed === townSeed);
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
  if (townHasSavedHomes(state, planet, townSeed) && ((saved.variant ?? 0) !== variant || (saved.density ?? 1) !== density)) {
    throw new Error(t('town.layoutLocked'));
  }
  const originalVersion = saved.originalVersion ?? saved.version ?? TOWN_LAYOUT_VERSION;
  const version = townPlanVersion(state, planet, townSeed, { variant, density });
  return state.set(keyOf(planet, townSeed), { version, originalVersion, townSeed, planet, variant, density });
}
