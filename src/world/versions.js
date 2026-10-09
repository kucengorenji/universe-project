// The one place that owns every generator and save-format version. Other modules
// import from here (or re-export), so the numbers cannot drift apart again;
// tests/save-versions.test.js fails when one is redefined elsewhere.

// Town layout generator. Saved towns keep the version they were built with
// (world/townGeneration.js); a bump needs a golden fixture for the old one.
// 3: practical street widths, hedgerows on field edges, flowers in drifts.
// 4: towns and cities planned by bisecting blocks (layout/blockPlan.js, docs/TOWN_PLAN_V3.md).
// 5: half-area settlements and a smaller canonical woodland/tree budget.
export const TOWN_LAYOUT_VERSION = 5;

// Interior saves: 1 is one snapshot per room (kept for rooms saved before floors),
// 2 is a container with one snapshot per floor.
export const INTERIOR_LEGACY_SCHEMA_VERSION = 1;
export const INTERIOR_SCHEMA_VERSION = 2;

// Authored home records (world/homeState.js).
export const HOME_SCHEMA_VERSION = 1;

// Home planet map as stored in localStorage (map/mapGenerator.js derives its key from this).
export const PLANET_MAP_VERSION = 5;

export const GENERATOR_VERSIONS = Object.freeze({
  planet: PLANET_MAP_VERSION,
  town: TOWN_LAYOUT_VERSION,
  interior: INTERIOR_SCHEMA_VERSION,
  identity: 1
});
