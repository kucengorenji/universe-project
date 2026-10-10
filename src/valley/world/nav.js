// Walking routes for the villagers (docs/FARM_PLAN.md §5.4): a graph from the paths (vertices
// every 3 m, joined along each path and wherever two paths meet), Dijkstra between the nodes
// nearest the start and the goal. Off the network the last stretch is a straight line. Pure.

const SPACING = 3;
const JOIN = 1.6; // nodes of different paths closer than this are connected

export function buildNav(paths) {
  const nodes = [], edges = [];
  const link = (a, b) => {
    const d = Math.hypot(nodes[a][0] - nodes[b][0], nodes[a][1] - nodes[b][1]);
    edges[a].push([b, d]);
    edges[b].push([a, d]);
  };
  const owner = [];
  paths.forEach((p, k) => {
    let prev = null;
    for (let i = 1; i < p.points.length; i++) {
      const [ax, az] = p.points[i - 1], [bx, bz] = p.points[i];
      const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(len / SPACING));
      for (let s = i === 1 ? 0 : 1; s <= n; s++) {
        nodes.push([ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n]);
        edges.push([]);
        owner.push(k);
        const id = nodes.length - 1;
        if (prev !== null) link(prev, id);
        prev = id;
      }
    }
  });
  for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
    if (owner[a] !== owner[b] && Math.hypot(nodes[a][0] - nodes[b][0], nodes[a][1] - nodes[b][1]) < JOIN) link(a, b);
  }
  return { nodes, edges };
}

function nearest(nav, [x, z]) {
  let best = 0, bd = Infinity;
  nav.nodes.forEach(([nx, nz], i) => {
    const d = Math.hypot(nx - x, nz - z);
    if (d < bd) { bd = d; best = i; }
  });
  return { i: best, d: bd };
}

/** Points from `from` to `to`: straight when close, otherwise on to the network and along it. */
export function route(nav, from, to) {
  const direct = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const a = nearest(nav, from), b = nearest(nav, to);
  if (direct < 8 || a.i === b.i || a.d + b.d > direct) return [to];
  const dist = new Array(nav.nodes.length).fill(Infinity), prev = new Array(nav.nodes.length).fill(-1), done = new Uint8Array(nav.nodes.length);
  dist[a.i] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < dist.length; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || u === b.i) break;
    done[u] = 1;
    for (const [v, w] of nav.edges[u]) if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; }
  }
  if (dist[b.i] === Infinity) return [to];
  const chain = [];
  for (let v = b.i; v >= 0; v = prev[v]) chain.unshift(nav.nodes[v]);
  return [...chain, to];
}
