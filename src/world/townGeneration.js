export const TOWN_LAYOUT_VERSION = 2;

// Existing interiors refer to coordinate-based building IDs. Keep that town's
// original parcel generator; a visual refresh must not silently orphan rooms.
export function townGenerationVersion(state, planet, townSeed) {
  const key=`town-layout:${planet}:${townSeed}`;
  const saved=state.get(key);
  if(saved?.version===1||saved?.version===2)return saved.version;
  const prefix=`interior:${planet}:town:${townSeed}:building:`;
  const hasRooms=[...state.records.keys()].some(id=>id.startsWith(prefix));
  const version=hasRooms?1:TOWN_LAYOUT_VERSION;
  state.set(key,{version,townSeed,planet});
  return version;
}
