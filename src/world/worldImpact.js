// What replacing the home world leaves behind, for the confirmation message.
// Everything is kept under the old world id; none of it is deleted.
export function worldImpact({ world, trade = null, missions = null }) {
  const count = (prefix) => [...world.state.records.keys()].filter((key) => key.startsWith(prefix) && world.state.get(key) !== null).length;
  return {
    seed: world.homeMap?.seed ?? null,
    rooms: count('interior:'),
    homes: count('home:'),
    campaigns: (trade?.items || []).filter((c) => c.worldId === world.worldId).length,
    missions: missions?.doneCount?.() ?? 0
  };
}
