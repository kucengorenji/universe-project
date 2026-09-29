import { Colliders } from './colliders.js';
import { riverDistance } from './townPlan.js';

const EPS = 1e-6;
const clamp = v => Math.max(0, Math.min(1, v));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const mix = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
const cross = (a, b) => a.x * b.z - a.z * b.x;
const minus = (a, b) => ({ x: a.x - b.x, z: a.z - b.z });
const key = p => `${Math.round(p.x * 10000)},${Math.round(p.z * 10000)}`;
function project(p, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz));
  return { t, point: mix(a, b, t) };
}

// Independent of terrain mesh resolution and render quality. Bank clearance is
// conservative; an authored bridge is the only route across a river channel.
export function townWalkable(layout, { margin = 0, groundHeight = null, minHeight = 0 } = {}) {
  const colliders = new Colliders(layout.colliders);
  const bridges = (layout.bridges || []).map(b => ({ ...b, c: Math.cos(b.yaw), s: Math.sin(b.yaw) }));
  const field = {};
  return (x, z) => {
    if (Math.hypot(x, z) > layout.dioramaR - 1 - margin) return false;
    const p = colliders.resolve(x, z, .4 + margin);
    if (Math.hypot(p.x - x, p.z - z) > .001) return false;
    const onBridge = bridges.some(b => {
      const dx = x - b.x, dz = z - b.z;
      return Math.abs(dx * b.c + dz * b.s) <= b.len / 2 && Math.abs(-dx * b.s + dz * b.c) < b.w / 2 - .7 - margin;
    });
    return onBridge || (layout.fields.sample(x, z, field).land > .72 + margin * .05 && riverDistance(layout, x, z) > 4 + margin &&
      (!groundHeight || groundHeight(x, z) >= minHeight + margin));
  };
}

function clearSegment(a, b, walkable, spacing = .5) {
  const steps = Math.max(1, Math.ceil(distance(a, b) / spacing));
  for (let i = 0; i <= steps; i++) {
    const p = mix(a, b, i / steps);
    if (!walkable(p.x, p.z)) return false;
  }
  return true;
}

/** Split real crossings, T junctions and overlapping lines; never link by proximity alone. */
export function createWalkNetwork(lines, { portals = [], walkable = () => true } = {}) {
  const segments = [];
  for (let l = 0; l < lines.length; l++) {
    const line = lines[l];
    for (let i = 1; i < line.pts.length; i++) {
      const a = line.pts[i - 1], b = line.pts[i];
      if (!Number.isFinite(a.x + a.z + b.x + b.z) || distance(a, b) < .001) continue;
      segments.push({ a, b, w: line.w, kind: line.kind || 'street', source: line.id || `street:${l}`, cuts: [0, 1] });
    }
  }
  // Each portal is an explicit door identity. Rejected entrances stay in the
  // diagnostics instead of being silently attached through an occupied parcel.
  const entrances = portals.map(p => ({ ...p, node: null, reason: 'no-safe-access' }));
  const streets = [...segments];
  for (const portal of entrances) {
    if (!walkable(portal.x, portal.z)) { portal.reason = 'blocked-door'; continue; }
    const candidates = streets.map(s => ({ s, ...project(portal, s.a, s.b) }))
      .map(c => ({ ...c, distance: distance(portal, c.point) }))
      .filter(c => c.distance <= 24 && (!portal.facing ||
        (c.point.x - portal.x) * portal.facing.x + (c.point.z - portal.z) * portal.facing.z >= -.3))
      .sort((a, b) => a.distance - b.distance);
    const hit = candidates.find(c => clearSegment(portal, c.point, walkable));
    if (!hit) continue;
    hit.s.cuts.push(hit.t);
    portal.reason = null;
    if (hit.distance > .001) segments.push({ a: portal, b: hit.point, w: 1.2, kind: 'entrance', source: portal.id, cuts: [0, 1] });
  }

  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
    const a = segments[i], b = segments[j];
    if (Math.max(a.a.x, a.b.x) + EPS < Math.min(b.a.x, b.b.x) || Math.max(b.a.x, b.b.x) + EPS < Math.min(a.a.x, a.b.x) ||
        Math.max(a.a.z, a.b.z) + EPS < Math.min(b.a.z, b.b.z) || Math.max(b.a.z, b.b.z) + EPS < Math.min(a.a.z, a.b.z)) continue;
    const u = minus(a.b, a.a), v = minus(b.b, b.a), q = minus(b.a, a.a), det = cross(u, v);
    if (Math.abs(det) > EPS) {
      const t = cross(q, v) / det, s = cross(q, u) / det;
      if (t >= -EPS && t <= 1 + EPS && s >= -EPS && s <= 1 + EPS) { a.cuts.push(clamp(t)); b.cuts.push(clamp(s)); }
    } else if (Math.abs(cross(q, u)) < EPS) {
      for (const [s, p] of [[a, b.a], [a, b.b], [b, a.a], [b, a.b]]) {
        const hit = project(p, s.a, s.b);
        if (distance(hit.point, p) < EPS) s.cuts.push(hit.t);
      }
    }
  }

  const nodes = [], edges = [], nodeMap = new Map(), edgeMap = new Map();
  const node = p => {
    const k = key(p);
    if (!nodeMap.has(k)) { nodeMap.set(k, nodes.length); nodes.push({ id: k, x: p.x, z: p.z, edges: [], portals: [], component: -1 }); }
    return nodeMap.get(k);
  };
  const add = (a, b, segment) => {
    if (distance(a, b) < .05) return;
    const from = node(a), to = node(b);
    if (from === to) return;
    const id = from < to ? `${from}:${to}` : `${to}:${from}`;
    if (edgeMap.has(id)) return;
    const edge = { id: edges.length, a: from, b: to, length: distance(a, b), w: segment.w, kind: segment.kind, source: segment.source, lanes: [0, 0] };
    edges.push(edge); edgeMap.set(id, edge.id); nodes[from].edges.push(edge.id); nodes[to].edges.push(edge.id);
  };
  for (const s of segments) {
    const cuts = [...new Set(s.cuts)].sort((a, b) => a - b);
    for (let i = 1; i < cuts.length; i++) {
      const a = mix(s.a, s.b, cuts[i - 1]), b = mix(s.a, s.b, cuts[i]);
      const steps = Math.max(1, Math.ceil(distance(a, b) / .5));
      let start = null, previous = a;
      for (let k = 0; k <= steps; k++) {
        const p = mix(a, b, k / steps);
        if (walkable(p.x, p.z)) { if (!start) start = p; }
        else if (start) { add(start, previous, s); start = null; }
        previous = p;
      }
      if (start) add(start, b, s);
    }
  }
  const graph = { version: 1, nodes, edges, portals: entrances, components: [] };
  for (const edge of edges) {
    // A fixed lane for the entire edge prevents sideways snapping near props.
    // Both sides taper to the shared junction, so changing roads is continuous.
    const target = edge.kind === 'street' ? Math.min(3.5, Math.max(0, edge.w / 2 - .9)) : Math.min(.22, Math.max(0, edge.w / 2 - .5));
    for (let side = 0; side < 2; side++) {
      const sign = side ? 1 : -1;
      for (let lane = target; lane >= .2; lane -= .35) {
        let safe = true;
        const count = Math.ceil(edge.length / .5);
        for (let k = 0; k <= count; k++) {
          const p = edgePoint(graph, edge, edge.a, edge.length * k / count, sign * lane);
          if (!walkable(p.x, p.z)) { safe = false; break; }
        }
        if (safe) { edge.lanes[side] = lane; break; }
      }
    }
  }
  for (let i = 0; i < nodes.length; i++) if (nodes[i].component < 0) {
    const component = { id: graph.components.length, nodes: [], length: 0, hasStreet: false }, pending = [i];
    nodes[i].component = component.id;
    while (pending.length) {
      const index = pending.pop(); component.nodes.push(index);
      for (const e of nodes[index].edges) {
        const edge = edges[e], next = edge.a === index ? edge.b : edge.a;
        component.length += edge.length / 2;
        if (edge.kind === 'street') component.hasStreet = true;
        if (nodes[next].component < 0) { nodes[next].component = component.id; pending.push(next); }
      }
    }
    graph.components.push(component);
  }
  for (const p of entrances) if (!p.reason) {
    p.node = nodeMap.get(key(p)) ?? null;
    if (p.node !== null && !graph.components[nodes[p.node].component].hasStreet) { p.node = null; p.reason = 'isolated-path'; }
    else if (p.node === null) p.reason = 'no-safe-access';
    else nodes[p.node].portals.push(p.id);
  }
  return graph;
}

export function edgePoint(graph, edge, from, progress, lane = 0) {
  const a = graph.nodes[from], b = graph.nodes[edge.a === from ? edge.b : edge.a];
  const d = Math.max(0, Math.min(edge.length, progress)), p = mix(a, b, d / edge.length);
  const taper = Math.min(1, d / 3, (edge.length - d) / 3);
  const offset = lane * taper * taper * (3 - 2 * taper);
  return { x: p.x - (b.z - a.z) / edge.length * offset, z: p.z + (b.x - a.x) / edge.length * offset,
    yaw: Math.atan2(b.x - a.x, b.z - a.z) };
}

/** Shortest pedestrian route in metres. Null means disconnected, never teleport. */
export function walkRoute(graph, start, end) {
  if (!graph.nodes[start] || !graph.nodes[end] || graph.nodes[start].component !== graph.nodes[end].component) return null;
  const cost = new Map([[start, 0]]), previous = new Map(), open = new Set([start]);
  while (open.size) {
    let current;
    for (const id of open) if (current === undefined || cost.get(id) < cost.get(current)) current = id;
    open.delete(current);
    if (current === end) {
      const nodes = [end], edges = [];
      while (previous.has(nodes[0])) { const p = previous.get(nodes[0]); nodes.unshift(p.node); edges.unshift(p.edge); }
      return { nodes, edges, length: cost.get(end) };
    }
    for (const id of graph.nodes[current].edges) {
      const e = graph.edges[id], next = e.a === current ? e.b : e.a, candidate = cost.get(current) + e.length;
      if (candidate < (cost.get(next) ?? Infinity)) { cost.set(next, candidate); previous.set(next, { node: current, edge: id }); open.add(next); }
    }
  }
  return null;
}
