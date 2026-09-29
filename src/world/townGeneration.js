export const TOWN_LAYOUT_VERSION = 3;

// Existing interiors refer to coordinate-based building IDs. Keep that town's
// original parcel generator; a visual refresh must not silently orphan rooms.
// A town remembered at an older version with no saved rooms has nothing to
// orphan, so it moves up to the current planner.
export function townGenerationVersion(state, planet, townSeed) {
  const key=`town-layout:${planet}:${townSeed}`;
  const saved=state.get(key);
  const prefix=`interior:${planet}:town:${townSeed}:building:`;
  const hasRooms=()=>[...state.records.keys()].some(id=>id.startsWith(prefix));
  if(saved?.version===TOWN_LAYOUT_VERSION)return saved.version;
  if((saved?.version===1||saved?.version===2)&&hasRooms())return saved.version;
  const version=!saved&&hasRooms()?1:TOWN_LAYOUT_VERSION;
  state.set(key,{version,townSeed,planet});
  return version;
}
