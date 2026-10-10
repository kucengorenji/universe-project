const WATER = new Set(['ocean_deep', 'ocean', 'coast']);
export const isWater = tile => WATER.has(tile?.biome);
export const isLand = tile => !!tile && !isWater(tile) && tile.biome !== 'mountain';

export function graphFor(map, topology) {
  const neighbors = topology.tiles.map(tile => [...tile.neighbors]);
  return { tiles: map.tilesData, neighbors };
}

export function nearby(graph, start, steps = 3, landOnly = false) {
  const seen = new Map([[start, 0]]), queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head], depth = seen.get(id);
    if (depth >= steps) continue;
    for (const next of graph.neighbors[id] || []) {
      if (seen.has(next) || (landOnly && !isLand(graph.tiles[next]))) continue;
      seen.set(next, depth + 1); queue.push(next);
    }
  }
  return seen;
}

export function findPath(graph, start, end, mode = 'land') {
  if (!graph.tiles[start] || !graph.tiles[end] || start === end) return null;
  const queue = [start], previous = new Map([[start, null]]);
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    if (id === end) {
      const path = []; let at = end;
      while (at !== null) { path.push(at); at = previous.get(at); }
      return path.reverse();
    }
    for (const next of graph.neighbors[id] || []) {
      if (previous.has(next)) continue;
      const passable = mode === 'sea' ? isWater(graph.tiles[next]) || next === end : isLand(graph.tiles[next]);
      if (!passable) continue;
      // Ports must touch water; entering an inland endpoint is not a sea lane.
      if (mode === 'sea' && next === end && !isWater(graph.tiles[id])) continue;
      previous.set(next, id); queue.push(next);
    }
  }
  return null;
}

export function connectionKey(a, b) { return a < b ? `${a}:${b}` : `${b}:${a}`; }
export function tripSeconds(path, mode = 'land', level = 1) {
  return Math.max(20, Math.min(180, path.length * (mode === 'sea' ? 3 : 5))) / (1 + (level - 1) * .25);
}
