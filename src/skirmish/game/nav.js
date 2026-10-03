import { GN, FREE } from './arena.js';

// Path finding on the arena's 1 m grid: how far a unit can get with its AP (Dijkstra in a
// window around it), and the path to a chosen cell. A clearance radius > 0 (the tank) needs
// that many free cells around each step.

const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

const clearCache = new WeakMap();
/** Grid where a cell is free only if every cell within `r` cells is free (memoised per arena and r). */
function clearGrid(arena, r) {
  if (r <= 0) return arena.grid;
  let byR = clearCache.get(arena);
  if (!byR) clearCache.set(arena, (byR = new Map()));
  if (byR.has(r)) return byR.get(r);
  const g = arena.grid;
  const out = new Uint8Array(GN * GN);
  for (let j = 0; j < GN; j++) {
    for (let i = 0; i < GN; i++) {
      let ok = g[j * GN + i] === FREE;
      for (let dj = -r; ok && dj <= r; dj++) {
        for (let di = -r; ok && di <= r; di++) {
          if (di * di + dj * dj > r * r) continue;
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= GN || jj >= GN || g[jj * GN + ii] !== FREE) ok = false;
        }
      }
      out[j * GN + i] = ok ? FREE : 1;
    }
  }
  byR.set(r, out);
  return out;
}

/** Small binary heap of [cost, index]. */
class Heap {
  constructor() {
    this.a = [];
  }
  push(c, i) {
    const a = this.a;
    a.push([c, i]);
    let k = a.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (a[p][0] <= a[k][0]) break;
      [a[p], a[k]] = [a[k], a[p]];
      k = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === k) break;
        [a[m], a[k]] = [a[k], a[m]];
        k = m;
      }
    }
    return top;
  }
  get size() {
    return this.a.length;
  }
}

/**
 * Cells reachable from (x, z) within `budget` metres, avoiding `occupied` cells (other units).
 * Returns { dist: Map(cell index -> metres), parent: Map, start }.
 */
export function reach(arena, x, z, budget, { clearance = 0, occupied = new Set() } = {}) {
  const g = clearGrid(arena, clearance);
  const [si, sj] = arena.cellOf(x, z);
  const start = sj * GN + si;
  const dist = new Map([[start, 0]]);
  const parent = new Map();
  const heap = new Heap();
  heap.push(0, start);
  while (heap.size) {
    const [c, k] = heap.pop();
    if (c > dist.get(k)) continue;
    const i = k % GN, j = (k - i) / GN;
    for (const [di, dj, w] of DIRS) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= GN || jj >= GN) continue;
      const n = jj * GN + ii;
      if (g[n] !== FREE || occupied.has(n)) continue;
      // no corner cutting past a blocked cell
      if (di && dj && (g[j * GN + ii] !== FREE || g[jj * GN + i] !== FREE)) continue;
      const nc = c + w;
      if (nc > budget || nc >= (dist.get(n) ?? Infinity)) continue;
      dist.set(n, nc);
      parent.set(n, k);
      heap.push(nc, n);
    }
  }
  return { dist, parent, start };
}

/** The path (world points, start excluded) to a cell from a reach() result, with straight runs merged. */
export function pathTo(arena, r, cell) {
  const cells = [];
  for (let k = cell; k !== undefined && k !== r.start; k = r.parent.get(k)) cells.push(k);
  cells.reverse();
  const pts = cells.map((k) => arena.cellCentre(k % GN, Math.floor(k / GN)));
  // drop points that sit on the line between their neighbours
  return pts.filter((p, i) => {
    if (i === 0 || i === pts.length - 1) return true;
    const [a, b] = [pts[i - 1], pts[i + 1]];
    return Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) > 1e-6;
  });
}

export function cellIndex(arena, x, z) {
  const [i, j] = arena.cellOf(x, z);
  return j * GN + i;
}
