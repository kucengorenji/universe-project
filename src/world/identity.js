// Geometry identity is independent of renderer order, quality and decoration.
export function seedFor(...parts) {
  let h = 2166136261;
  for (const c of JSON.stringify(parts)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function buildingId(townSeed, building) {
  return `town:${townSeed}:building:${building.asset}:${Math.round(building.x * 100)}:${Math.round(building.z * 100)}:${Math.round(building.yaw * 10000)}`;
}

// Versions live in versions.js; kept here because the world manifest imports them from identity.
export { GENERATOR_VERSIONS } from './versions.js';
