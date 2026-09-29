import { voronoi, relax, area, centroid, insetConvex, subdivide, edgeFrame, fitAgainst, inConvex, pickWeighted, WARDS, BOUND, CUT } from './wards.js';

// District plan for fantasy towns (and the lot filling modern towns share).
// Project adaptation inspired by Watabou (not a copy of its generator):
//   1. sites -> Voronoi cells (dense in town, coarse in the countryside)
//   2. cell edges -> street graph; arteries from each gate to the market by A*
//   3. wards: market, landmark, docks, gate wards, parks, then merchants near
//      the market, slums at the edge, the rich next to parks, craftsmen elsewhere
//   4. blocks (cells inset by half a street) -> lots -> buildings fitted to lots
//   5. walls along the ward boundary, towers at its corners, gates on arteries

const TAU = Math.PI * 2;

/** Nominal sizes for assets without a measured footprint. */
const NOMINAL = {
  f_house_small: [6, 6], f_house: [8, 7], f_house_tall: [7, 8], f_townhouse: [6, 10], f_shop: [8, 8], f_tavern: [12, 9],
  f_temple: [16, 24], f_castle: [44, 44], f_tower: [8, 8], barn: [14, 10],
  m_house: [12, 10], m_apartment: [20, 16], m_office: [22, 22], m_shop: [14, 10], m_tower_a: [30, 30], m_tower_b: [30, 30], m_spire: [22, 22]
};

/** Distance from (x, z) to the nearest river centreline, minus its half width (< 0 = in the water). */
export function riverDistance(L, x, z) {
  let best = Infinity;
  for (const r of L.rivers || []) {
    const p = r.pts;
    for (let i = 0; i + 1 < p.length; i++) {
      const [ax, az] = p[i];
      const [bx, bz] = p[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t) - r.w / 2);
    }
  }
  return best;
}

/**
 * Rivers through the disc, from the planet tiles: every river tile flows to
 * its lowest neighbour. Chains of tile centres, smoothed.
 */
export function planRivers(L, byId, local, chaikin) {
  const rivers = [];
  const flowsIn = new Set();
  for (const t of local) if (t.river && t.riverTo !== undefined && t.riverTo !== null) flowsIn.add(t.riverTo);
  const used = new Set();
  const heads = local.filter((t) => t.river && !flowsIn.has(t.id));
  for (const head of heads) {
    const pts = [];
    let t = head;
    let steps = 0;
    while (t && steps++ < 80) {
      pts.push([t.x, t.z]);
      if (used.has(t.id) || !t.river) break;
      used.add(t.id);
      t = byId.get(t.riverTo);
    }
    if (pts.length < 2) continue;
    // Only the part near the disc matters (the horizon is painted, not carved)
    if (!pts.some(([x, z]) => Math.hypot(x, z) < L.dioramaR + 200)) continue;
    rivers.push({ pts: chaikin(chaikin(chaikin(pts))), w: L.modern ? 14 : 10 });
  }
  L.rivers = rivers;
}

/** Streets crossing a river get a bridge where they cross. */
export function planBridges(L) {
  L.bridges = [];
  for (const s of L.streets) {
    for (let i = 0; i + 1 < s.pts.length; i++) {
      const [ax, az] = s.pts[i];
      const [bx, bz] = s.pts[i + 1];
      for (const r of L.rivers || []) {
        for (let k = 0; k + 1 < r.pts.length; k++) {
          const [cx, cz] = r.pts[k];
          const [dx, dz] = r.pts[k + 1];
          const hit = segIntersect(ax, az, bx, bz, cx, cz, dx, dz);
          if (!hit) continue;
          if (L.bridges.some((b) => Math.hypot(b.x - hit.x, b.z - hit.z) < 14)) continue;
          if (Math.hypot(hit.x, hit.z) > L.dioramaR - 10) continue;
          // Long enough to clear the banks at the crossing angle
          const sa = Math.atan2(bz - az, bx - ax);
          const ra = Math.atan2(dz - cz, dx - cx);
          const sin = Math.max(0.35, Math.abs(Math.sin(sa - ra)));
          L.bridges.push({ x: hit.x, z: hit.z, yaw: sa, len: r.w / sin + 7, w: s.w + 1.2, kind: s.kind, modern: L.modern });
        }
      }
    }
  }
}

function segIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  const r1x = bx - ax;
  const r1z = bz - az;
  const r2x = dx - cx;
  const r2z = dz - cz;
  const den = r1x * r2z - r1z * r2x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * r2z - (cz - az) * r2x) / den;
  const u = ((cx - ax) * r1z - (cz - az) * r1x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: ax + r1x * t, z: az + r1z * t };
}

// ---------------------------------------------------------------- lots -> buildings

/**
 * Fill one block with its ward's lots and buildings.
 *   frontKind(label) -> 'main' | 'lane' | 'water' | null for a block edge label
 */
export function fillBlock(L, block, wardName, K, { frontKind = () => 'lane', setback = 0.3, keep = null } = {}) {
  const { rng, fp, claim, free, buildable } = K;
  const ward = WARDS[wardName];
  if (!ward?.lots || block.length < 3) return;
  const lots = subdivide(block, ward.lots, rng);
  for (const lot of lots) {
    const poly = lot.poly;
    const c = centroid(poly);
    if (riverDistance(L, c.x, c.z) < 3) continue;
    if (keep && !keep(c.x, c.z)) continue;
    // Frontage: the longest edge on a street (main streets win)
    let fi = -1;
    let score = 0;
    for (let i = 0; i < poly.length; i++) {
      if (poly[i].e === CUT) continue;
      const kind = frontKind(poly[i].e);
      if (!kind || kind === 'water') continue;
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const s = Math.hypot(b.x - a.x, b.z - a.z) * (kind === 'main' ? 1.6 : 1);
      if (s > score) {
        score = s;
        fi = i;
      }
    }
    if (lot.empty || fi < 0) {
      // Yards and courtyards: a tree or two
      if (rng() < 0.55) yardTree(L, poly, c, K);
      continue;
    }
    const f = edgeFrame(poly, fi);
    // Walk along the frontage: each house takes what it needs, the next one
    // starts after it (a terrace on wide lots, one house on narrow ones)
    const yaw = Math.atan2(f.nx, -f.nz); // front (+Z) toward the street (-n); local X = (-nz, nx)
    const Xx = -f.nz;
    const Xz = f.nx;
    let cursor = 0.3;
    let built = 0;
    let deepest = 0;
    for (let guard = 0; guard < 8 && f.len - cursor > 3.5; guard++) {
      const room = f.len - cursor - 0.3;
      // The pool's picks that can fit this run, in weighted random order
      const order = [];
      const pool = ward.pool.slice();
      while (pool.length) {
        const a = pickWeighted(pool, rng);
        order.push(a);
        pool.splice(pool.findIndex(([p]) => p === a), 1);
      }
      let done = null;
      for (const asset of order) {
        const [nw, nd] = NOMINAL[asset] || [8, 8];
        const F = fp(asset, nw, nd);
        if (F.w * 0.84 > room) continue;
        // Stretch the model a little to fill the lot, never much out of proportion;
        // a narrow last gap is taken up by widening this one
        const fillAll = room - F.w * 1.22 < 6;
        let sx = Math.min(1.22, Math.max(0.84, (fillAll ? room : F.w) / F.w));
        let sz = Math.min(1.18, Math.max(0.86, ((f.depth - setback) * 0.92) / F.d));
        sx = Math.min(sx, sz * 1.35);
        sz = Math.min(sz, sx * 1.35);
        const w = F.w * sx;
        const rect = fitAgainst(poly, f, w, F.d * sz, { setback, maxShrink: 0.9, u: cursor + Math.min(w, room) / 2, room });
        if (!rect) continue;
        sx = rect.w / F.w;
        sz = rect.d / F.d;
        if (sx < 0.78 || sz < 0.8) continue;
        if (riverDistance(L, rect.cx, rect.cz) < Math.max(rect.w, rect.d) / 2 + 1) continue;
        const footprint = { x: rect.cx, z: rect.cz, yaw, hw: rect.w / 2, hd: rect.d / 2 };
        if (!free(footprint, 0.1) || !buildable(footprint)) continue;
        const x = rect.cx - Xx * F.cx * sx + f.nx * F.cz * sz;
        const z = rect.cz - Xz * F.cx * sx + f.nz * F.cz * sz;
        L.buildings.push({ asset, x, z, yaw, w: F.w * sx, d: F.d * sz, sx, sz, tint: 0.92 + rng() * 0.16, variant: Math.floor(rng() * 4), ward: wardName });
        claim({ x: rect.cx, z: rect.cz, yaw, hw: rect.w / 2, hd: rect.d / 2 });
        done = rect;
        break;
      }
      if (!done) break;
      built++;
      deepest = Math.max(deepest, done.d);
      cursor += done.w + (ward.gap ?? 0.4) + rng() * (ward.gapChaos ?? 0.6);
    }
    if (!built) {
      if (rng() < 0.5) yardTree(L, poly, c, K);
      continue;
    }
    // Garden behind the houses
    const behind = f.depth - setback - deepest;
    if (behind > 5 && rng() < ward.yard) {
      const u = f.len / 2 + (rng() - 0.5) * f.len * 0.4;
      const v = setback + deepest + behind * 0.55;
      const tx = f.ax + f.tx * u + f.nx * v;
      const tz = f.az + f.tz * u + f.nz * v;
      if (inConvex(poly, tx, tz, 1.4)) addTree(L, tx, tz, gardenTree(L, rng), K);
    }
  }
}

function gardenTree(L, rng) {
  if (L.modern) return [['t_birch', 0], ['t_oak', 0], ['t_cypress', 0], ['b_bush', 0]][Math.floor(rng() * 4)];
  return [['t_fruit', 0], ['t_fruit', 1], ['t_oak', 0], ['t_birch', 0], ['b_bush', 1]][Math.floor(rng() * 5)];
}

function yardTree(L, poly, c, K) {
  if (!inConvex(poly, c.x, c.z, 1.6)) return;
  addTree(L, c.x, c.z, gardenTree(L, K.rng), K);
}

function addTree(L, x, z, [asset, variant], K) {
  const small = asset.startsWith('b_');
  const size = small ? 2 : 3.4 + K.rng() * 1.4;
  L.trees.push({ asset, x, z, yaw: K.rng() * TAU, w: size * 0.7, d: size * 0.7, variant, tint: 0.92 + K.rng() * 0.16 });
  if (!small) L.colliders.push({ type: 'circle', x, z, r: 0.6 });
}

// ---------------------------------------------------------------- fantasy wards

export function planWards(L, K, fillFronts) {
  const { rng, at, inCity, addStreet, claim } = K;
  const R = L.dioramaR;
  const big = L.capital || L.size >= 5;
  const S = {};

  // 1. Sites: one at the centre (the market), dense in town, coarse outside
  const spacing = L.capital ? 36 : L.size >= 4 ? 33 : 30; // block size: medieval blocks are small and dense
  const sites = [{ x: 0, z: 0, city: true }];
  const grid = new Map();
  const gk = (x, z) => `${Math.floor(x / 60)},${Math.floor(z / 60)}`;
  const tooClose = (x, z, min) => {
    const ci = Math.floor(x / 60);
    const cj = Math.floor(z / 60);
    for (let i = ci - 2; i <= ci + 2; i++) for (let j = cj - 2; j <= cj + 2; j++) for (const s of grid.get(`${i},${j}`) || []) if (Math.hypot(s.x - x, s.z - z) < min) return true;
    return false;
  };
  const add = (s) => {
    sites.push(s);
    const k = gk(s.x, s.z);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(s);
  };
  add(sites.shift());
  for (let i = 0; i < 5000; i++) {
    const a = rng() * TAU;
    const r = Math.sqrt(rng()) * (L.cityR + 40);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (!inCity(x, z, 0.3) || at(x, z, S).land < 0.5) continue;
    if (riverDistance(L, x, z) < 8) continue;
    // Dense old streets near the market, larger estates at the edge, and
    // neighbourhood-scale variation. Uniform Poisson + Lloyd made honeycombs.
    const district = .75 + .28 * Math.sin(x*.012+L.seed) * Math.cos(z*.009);
    const min = L.layoutVersion===1 ? spacing*(.8+rng()*.35) : spacing * (.52 + rng() * .7) * district * (.85 + r / Math.max(80,L.cityR) * .35);
    if (!tooClose(x, z, min)) add({ x, z, city: true });
  }
  for (let i = 0; i < 3000; i++) {
    const a = rng() * TAU;
    const r = Math.sqrt(rng()) * (R + 60);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (inCity(x, z, 0.3)) continue;
    if (!tooClose(x, z, 100 + rng() * 50)) add({ x, z, city: false });
  }
  const cells = L.layoutVersion===1 ? relax(sites,R+80,2,s=>s.city) : voronoi(sites, R + 80);

  // Classify
  for (const c of cells) {
    const m = centroid(c.poly);
    const s = at(m.x, m.z, S);
    c.cx = m.x;
    c.cz = m.z;
    c.area = Math.abs(area(c.poly));
    c.water = s.land < 0.5 || riverDistance(L, m.x, m.z) < 4;
    c.city = !c.water && c.site.city && s.city > 0.35 && c.poly.every((v) => Math.hypot(v.x, v.z) < R - 25);
    c.ward = null;
  }
  const byIndex = cells;

  // 2. Street graph over city cells: vertices merged within 0.4 m
  const verts = [];
  const vgrid = new Map();
  const vid = (x, z) => {
    const ci = Math.floor(x / 4);
    const cj = Math.floor(z / 4);
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) for (const v of vgrid.get(`${i},${j}`) || []) if (Math.hypot(v.x - x, v.z - z) < 0.4) return v.id;
    const v = { id: verts.length, x, z, edges: [] };
    verts.push(v);
    const k = `${ci},${cj}`;
    if (!vgrid.has(k)) vgrid.set(k, []);
    vgrid.get(k).push(v);
    return v.id;
  };
  const edges = new Map();
  const ekey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const c of cells) {
    if (!c.city) continue;
    c.vids = c.poly.map((p) => vid(p.x, p.z));
    c.poly.forEach((p, k) => {
      const a = c.vids[k];
      const b = c.vids[(k + 1) % c.poly.length];
      if (a === b) return;
      const key = ekey(a, b);
      if (!edges.has(key)) {
        const e = { a, b, key, cells: [], kind: null, other: p.e };
        edges.set(key, e);
        verts[a].edges.push(e);
        verts[b].edges.push(e);
      }
      edges.get(key).cells.push(c.i);
    });
  }
  for (const e of edges.values()) {
    const other = e.other >= 0 ? byIndex[e.other] : null;
    e.boundary = e.cells.length < 2;
    e.water = e.boundary && (!other || other.water);
    e.len = Math.hypot(verts[e.a].x - verts[e.b].x, verts[e.a].z - verts[e.b].z);
  }

  // Market: the centre cell
  const cityCells = cells.filter((c) => c.city);
  if (!cityCells.length) return false;
  const market = cityCells.reduce((m, c) => (Math.hypot(c.cx, c.cz) < Math.hypot(m.cx, m.cz) ? c : m), cityCells[0]);
  market.ward = 'market';

  // Gates: boundary vertices toward each road out of town
  const boundaryVerts = new Set();
  for (const e of edges.values()) if (e.boundary && !e.water) boundaryVerts.add(e.a).add(e.b);
  const bv = [...boundaryVerts].map((id) => verts[id]);
  const gates = [];
  const angDiff = (p, q) => Math.abs(Math.atan2(Math.sin(p - q), Math.cos(p - q)));
  for (const ex of L.exits) {
    let best = null;
    let bd = Infinity;
    for (const v of bv) {
      const d = angDiff(Math.atan2(v.z, v.x), ex.angle);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    if (best && !gates.includes(best)) {
      gates.push(best);
      ex.gate = { x: best.x, z: best.z };
    }
  }
  // A walled town needs at least two ways in
  while (gates.length < 2 && bv.length > 4) {
    let best = null;
    let bs = -1;
    for (const v of bv) {
      const sep = gates.length ? Math.min(...gates.map((g) => angDiff(Math.atan2(v.z, v.x), Math.atan2(g.z, g.x)))) : rng() * 3;
      if (sep > bs) {
        bs = sep;
        best = v;
      }
    }
    gates.push(best);
  }

  // Arteries: gate -> nearest market corner, Dijkstra over the street graph
  const marketVerts = new Set(market.vids);
  const path = (from) => {
    const dist = new Map([[from.id, 0]]);
    const prev = new Map();
    const open = [[0, from.id]];
    while (open.length) {
      open.sort((p, q) => p[0] - q[0]);
      const [d, u] = open.shift();
      if (d > (dist.get(u) ?? Infinity)) continue;
      if (marketVerts.has(u)) {
        const out = [u];
        let k = u;
        while (prev.has(k)) {
          k = prev.get(k);
          out.push(k);
        }
        return out.reverse();
      }
      for (const e of verts[u].edges) {
        const w = e.a === u ? e.b : e.a;
        // Stay off the wall line and the waterfront
        const cost = e.len * (e.boundary ? 3 : 1) * (e.kind === 'main' ? 0.7 : 1);
        const nd = d + cost;
        if (nd < (dist.get(w) ?? Infinity)) {
          dist.set(w, nd);
          prev.set(w, u);
          open.push([nd, w]);
        }
      }
    }
    return null;
  };
  const arteries = [];
  for (const g of gates) {
    const p = path(g);
    if (!p || p.length < 2) continue;
    for (let i = 0; i + 1 < p.length; i++) edges.get(ekey(p[i], p[i + 1])).kind = 'main';
    arteries.push(p);
  }
  for (const e of edges.values()) if (!e.kind) e.kind = e.water ? 'water' : 'lane';

  // Keep a connected skeleton, then only some of its redundant loops. Treating
  // every Voronoi edge as a road made the cell construction visible as hexagons.
  if (L.layoutVersion >= 2) {
    const parent=verts.map(v=>v.id), root=i=>parent[i]===i?i:(parent[i]=root(parent[i]));
    const join=e=>{const a=root(e.a),b=root(e.b);if(a===b)return false;parent[a]=b;return true;};
    for(const e of edges.values())if(e.kind==='main'||e.boundary||e.cells.includes(market.i))join(e);
    const candidates=[...edges.values()].filter(e=>e.kind==='lane'&&!e.boundary&&!e.cells.includes(market.i));
    const ranked=candidates.map(e=>({e,rank:rng()})).sort((a,b)=>a.rank-b.rank);
    for(const {e} of ranked)if(!join(e)&&rng()>.18)e.kind='yard';
    L.morphology={version:2,kind:'grown-wards',retiredLanes:candidates.filter(e=>e.kind==='yard').length};
  }
  const streetPoints = ids => {
    if(L.layoutVersion===1)return ids.map(id=>[verts[id].x,verts[id].z]);
    const out=[];
    for(let i=1;i<ids.length;i++){
      const a=verts[ids[i-1]],b=verts[ids[i]],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz)||1;
      const bend=Math.sin((a.x+b.x)*.035+(a.z+b.z)*.027)*Math.min(1.6,len*.04);
      const n=Math.max(1,Math.ceil(len/6));
      for(let k=0;k<n;k++){const t=k/n,off=Math.sin(t*Math.PI)*bend;out.push([a.x+dx*t-dz/len*off,a.z+dz*t+dx/len*off]);}
    }
    const end=verts[ids.at(-1)];out.push([end.x,end.z]);return out;
  };
  // Street widths are hierarchy-specific, not uniform cell outlines.
  const W = { main: 7, lane: L.layoutVersion>=2?3.2:4.2 };
  for (const p of arteries) addStreet(streetPoints(p), W.main, 'main');
  // Lanes: chain the rest into long strokes (straightest continuation at junctions)
  const laneEdges = [...edges.values()].filter((e) => e.kind === 'lane');
  const usedE = new Set();
  const dirOf = (from, to) => Math.atan2(verts[to].z - verts[from].z, verts[to].x - verts[from].x);
  for (const e0 of laneEdges) {
    if (usedE.has(e0)) continue;
    usedE.add(e0);
    const chain = [e0.a, e0.b];
    for (const end of [0, 1]) {
      for (let guard = 0; guard < 40; guard++) {
        const tip = end ? chain[chain.length - 1] : chain[0];
        const prevV = end ? chain[chain.length - 2] : chain[1];
        const heading = dirOf(prevV, tip);
        let best = null;
        let bestTurn = 0.75;
        for (const e of verts[tip].edges) {
          if (e.kind !== 'lane' || usedE.has(e)) continue;
          const nxt = e.a === tip ? e.b : e.a;
          const turn = angDiff(dirOf(tip, nxt), heading);
          if (turn < bestTurn) {
            bestTurn = turn;
            best = e;
          }
        }
        if (!best) break;
        usedE.add(best);
        const nxt = best.a === tip ? best.b : best.a;
        if (end) chain.push(nxt);
        else chain.unshift(nxt);
      }
    }
    addStreet(streetPoints(chain), W.lane, 'lane');
  }
  const kindBetween = (cellIdx, label) => {
    const c = byIndex[cellIdx];
    if (label === BOUND) return 'lane';
    if (label < 0) return null;
    const other = byIndex[label];
    if (!other?.city) return other?.water ? 'water' : 'lane';
    // Find the shared edge's kind
    for (let k = 0; k < c.poly.length; k++) {
      if (c.poly[k].e !== label) continue;
      const e = edges.get(ekey(c.vids[k], c.vids[(k + 1) % c.poly.length]));
      if (e) return e.kind;
    }
    return 'lane';
  };

  // 3. Wards
  const adj = (c) => {
    const out = new Set();
    for (const p of c.poly) if (p.e >= 0 && byIndex[p.e]?.city) out.add(byIndex[p.e]);
    return [...out];
  };
  const free = () => cityCells.filter((c) => !c.ward);
  const nearMarket = new Set(adj(market));
  // Landmarks: a castle (capital) at the town's edge on the largest block; a temple beside the market
  const landmarks = [];
  if (L.capital) {
    const edgeCells = free().filter((c) => !nearMarket.has(c) && c.poly.some((p) => p.e >= 0 && !byIndex[p.e]?.city && !byIndex[p.e]?.water));
    const castle = edgeCells.sort((p, q) => q.area - p.area)[0];
    if (castle && castle.area > 1400) {
      castle.ward = 'landmark';
      landmarks.push([castle, 'f_castle']);
    }
  }
  if (L.size >= 3) {
    const temple = [...nearMarket].filter((c) => !c.ward).sort((p, q) => q.area - p.area)[0];
    if (temple) {
      temple.ward = 'landmark';
      landmarks.push([temple, 'f_temple']);
    }
  } else {
    const t = [...nearMarket].find((c) => !c.ward);
    if (t) {
      t.ward = 'landmark';
      landmarks.push([t, 'f_tower']);
    }
  }
  // Waterfront and gates
  for (const c of free()) if (L.isCoastal !== false && c.poly.some((p) => p.e >= 0 && byIndex[p.e]?.water)) c.ward = 'docks';
  for (const g of gates) for (const c of free()) if (c.vids.includes(g.id) && rng() < 0.85) c.ward = 'gate';
  // Parks
  const nParks = Math.floor(cityCells.length / 14);
  for (let i = 0; i < nParks; i++) {
    const cands = free().filter((c) => !nearMarket.has(c));
    if (!cands.length) break;
    cands[Math.floor(rng() * cands.length)].ward = 'park';
  }
  // Merchants closest to the market, slums farthest out, the rich next to parks
  const rest = free().sort((p, q) => Math.hypot(p.cx, p.cz) - Math.hypot(q.cx, q.cz));
  const nMerchant = Math.round(rest.length * 0.25);
  rest.slice(0, nMerchant).forEach((c) => (c.ward = 'merchant'));
  if (L.size >= 3) rest.slice(-Math.round(rest.length * 0.18)).forEach((c) => !c.ward && (c.ward = 'slum'));
  const rich = free()
    .map((c) => [adj(c).filter((o) => o.ward === 'park').length - adj(c).filter((o) => o.ward === 'slum').length + rng() * 0.5, c])
    .sort((p, q) => q[0] - p[0]);
  rich.slice(0, Math.round(rest.length * 0.15)).forEach(([, c]) => (c.ward = 'patriciate'));
  if (big) {
    const mil = free().filter((c) => landmarks.some(([l]) => adj(l).includes(c)));
    if (mil[0]) mil[0].ward = 'military';
  }
  for (const c of free()) c.ward = 'craftsmen';
  L.wards = cityCells.map((c) => ({ ward: c.ward, poly: c.poly.map((p) => [p.x, p.z]), x: c.cx, z: c.cz }));

  // 4. Blocks
  const pavement = 1.0;
  const blockOf = (c, extra = 0) =>
    insetConvex(c.poly, (label) => {
      const kind = kindBetween(c.i, label);
      if (kind === 'water') return 3 + extra;
      return (W[kind] || W.lane) / 2 + pavement + extra;
    });
  // Market square
  const plaza = blockOf(market, -pavement);
  const pc = centroid(plaza.length ? plaza : market.poly);
  let inR = Infinity;
  for (let i = 0; i < plaza.length; i++) {
    const p = plaza[i];
    const q = plaza[(i + 1) % plaza.length];
    const ex = q.x - p.x;
    const ez = q.z - p.z;
    inR = Math.min(inR, Math.abs(ex * (pc.z - p.z) - ez * (pc.x - p.x)) / (Math.hypot(ex, ez) || 1));
  }
  L.plaza = { x: pc.x, z: pc.z, r: Math.max(8, inR), poly: plaza.map((p) => [p.x, p.z]) };
  claim({ x: pc.x, z: pc.z, hw: inR * 0.7, hd: inR * 0.7, yaw: 0 }, false);
  L.props.push({ asset: 'f_well', x: pc.x, z: pc.z, yaw: rng() * 6, w: 3.2, d: 3.2 });
  L.colliders.push({ type: 'circle', x: pc.x, z: pc.z, r: 1.8 });
  const stalls = L.capital ? 8 : L.size >= 3 ? 6 : 3;
  const stallAt = [];
  for (let i = 0; i < 80 && stallAt.length < stalls; i++) {
    const a = rng() * TAU;
    const r = inR * (0.35 + rng() * 0.45);
    const x = pc.x + Math.cos(a) * r;
    const z = pc.z + Math.sin(a) * r;
    if (!inConvex(plaza, x, z, 3) || stallAt.some((s) => Math.hypot(s[0] - x, s[1] - z) < 6)) continue;
    stallAt.push([x, z]);
    const yaw = a + Math.PI / 2;
    L.props.push({ asset: 'f_market_stall', x, z, yaw, w: 3.6, d: 2.6, tint: 0.9 + rng() * 0.2, variant: stallAt.length % 3 });
    L.colliders.push({ type: 'box', x, z, hw: 1.8, hd: 1.3, yaw });
  }

  // Landmarks, facing the market (or their best street)
  for (const [c, asset] of landmarks) {
    const block = blockOf(c);
    if (block.length < 3) continue;
    const [nw, nd] = NOMINAL[asset];
    const F = K.fp(asset, nw, nd);
    let best = null;
    for (let i = 0; i < block.length; i++) {
      if (block[i].e === CUT) continue;
      const f = edgeFrame(block, i);
      const toMarket = Math.hypot(f.ax + f.tx * f.len * 0.5 - pc.x, f.az + f.tz * f.len * 0.5 - pc.z);
      for (const s of [1, 0.9, 0.8, 0.7]) {
        const rect = fitAgainst(block, f, F.w * s, F.d * s, { setback: 1.5, maxShrink: 0.98 });
        if (rect) {
          const footprint={x:rect.cx,z:rect.cz,yaw:Math.atan2(f.nx,-f.nz),hw:rect.w/2,hd:rect.d/2};
          if(!K.free(footprint,0.1)||!K.buildable(footprint))continue;
          const score = s * 100 - toMarket * 0.2;
          if (!best || score > best.score) best = { f, rect, s, score };
          break;
        }
      }
    }
    if (!best) {
      c.ward = 'park';
      continue;
    }
    const { f, rect, s } = best;
    const yaw = Math.atan2(f.nx, -f.nz);
    const Xx = -f.nz;
    const Xz = f.nx;
    const x = rect.cx - Xx * F.cx * s + f.nx * F.cz * s;
    const z = rect.cz - Xz * F.cx * s + f.nz * F.cz * s;
    L.buildings.push({ asset, x, z, yaw, w: F.w * s, d: F.d * s, sx: s, sz: s, sy: s, tint: 1, variant: 0, ward: 'landmark' });
    claim({ x: rect.cx, z: rect.cz, yaw, hw: rect.w / 2, hd: rect.d / 2 });
    L.landmark ||= { asset, x, z, yaw, w: F.w * s, d: F.d * s };
    // A few trees in the grounds
    for (let t = 0; t < 6; t++) {
      const tx = c.cx + (rng() - 0.5) * Math.sqrt(c.area) * 0.8;
      const tz = c.cz + (rng() - 0.5) * Math.sqrt(c.area) * 0.8;
      if (!inConvex(block, tx, tz, 2)) continue;
      const lx = (tx - rect.cx) * -Xx + (tz - rect.cz) * -Xz;
      const lz = (tx - rect.cx) * f.nx + (tz - rect.cz) * f.nz;
      if (Math.abs(lx) < rect.w / 2 + 2 && Math.abs(lz) < rect.d / 2 + 2) continue;
      addTree(L, tx, tz, [['t_cypress', 0], ['t_oak', 0], ['t_birch', 0]][t % 3], K);
    }
  }

  // Parks: trees and flower beds
  for (const c of cityCells.filter((c) => c.ward === 'park')) {
    const block = blockOf(c);
    L.parks.push({x:c.cx,z:c.cz,poly:block,style:'garden'});
  }

  // Legacy parcels remain available for towns with saved interiors. New towns
  // grow frontage continuously along the connected roads, across cell seams.
  if(L.layoutVersion>=2&&fillFronts){
    const typeAt=(r,x,z)=>{
      let near=null,d=Infinity;
      for(const c of cityCells){const q=(c.cx-x)**2+(c.cz-z)**2;if(q<d){d=q;near=c;}}
      const pool=WARDS[near?.ward]?.pool||WARDS.craftsmen.pool,asset=pickWeighted(pool,rng);
      return [asset,...(NOMINAL[asset]||[8,8])];
    };
    fillFronts(L,{...K,typeAt,cityTh:.42,list:L.buildings,kinds:['main','lane']});
  }else for (const c of cityCells) {
    if (['market', 'landmark', 'park'].includes(c.ward)) continue;
    fillBlock(L, blockOf(c), c.ward, K, { frontKind: (label) => kindBetween(c.i, label) });
  }

  // 5. Walls along the ward boundary (open to the water), towers at the corners
  const wallKind = big ? 'f_wall' : L.size >= 2 ? 'f_palisade' : null;
  if (wallKind) {
    const off = W.lane / 2 + 2.4;
    const towers = new Set();
    for (const e of edges.values()) {
      if (!e.boundary || e.water) continue;
      const c = byIndex[e.cells[0]];
      // Edge direction as the cell walks it (CCW), outward normal to its right
      const k = c.vids.findIndex((id, i) => ekey(id, c.vids[(i + 1) % c.vids.length]) === e.key);
      if (k < 0) continue;
      const pa = verts[c.vids[k]];
      const pb = verts[c.vids[(k + 1) % c.vids.length]];
      const ex = pb.x - pa.x;
      const ez = pb.z - pa.z;
      const len = Math.hypot(ex, ez);
      if (len < 1) continue;
      const nx = ez / len;
      const nz = -ex / len;
      const pieces = Math.max(1, Math.round(len / 9));
      for (let s = 0; s < pieces; s++) {
        const t0 = s / pieces;
        const t1 = (s + 1) / pieces;
        const mx = pa.x + ex * ((t0 + t1) / 2) + nx * off;
        const mz = pa.z + ez * ((t0 + t1) / 2) + nz * off;
        if (gates.some((g) => Math.hypot(g.x + nx * off - mx, g.z + nz * off - mz) < (big ? 10 : 6))) continue;
        if (riverDistance(L, mx, mz) < 3 || at(mx, mz, S).land < 0.55) continue;
        const pl = (len / pieces) * 1.02;
        const yaw = Math.atan2(ez, ex);
        L.walls.push({ asset: wallKind, x: mx, z: mz, yaw, len: pl });
        L.colliders.push({ type: 'box', x: mx, z: mz, hw: pl / 2, hd: big ? 1.4 : 0.5, yaw });
      }
      if (big) {
        for (const v of [pa, pb]) {
          if (towers.has(v.id) || gates.includes(v)) continue;
          towers.add(v.id);
          const tx = v.x + nx * off;
          const tz = v.z + nz * off;
          if (at(tx, tz, S).land < 0.55 || riverDistance(L, tx, tz) < 3) continue;
          L.props.push({ asset: 'f_wall_tower', x: tx, z: tz, yaw: Math.atan2(nz, nx), w: 6, d: 6 });
          L.colliders.push({ type: 'circle', x: tx, z: tz, r: 3 });
        }
      }
    }
    if (big) {
      for (const g of gates) {
        // Gate across the artery that leaves here
        const e = g.edges.find((ed) => ed.kind === 'main') || g.edges[0];
        const o = e.a === g.id ? verts[e.b] : verts[e.a];
        const yaw = Math.atan2(o.z - g.z, o.x - g.x) + Math.PI / 2;
        L.props.push({ asset: 'f_gate', x: g.x, z: g.z, yaw, w: 12, d: 6 });
      }
    }
  }
  L.walls.gates = gates.map((g) => ({ x: g.x, z: g.z }));

  // Farm cells for the countryside
  L.farmCells = cells.filter((c) => !c.city && !c.water && c.poly.every((v) => Math.hypot(v.x, v.z) < R - 30)).map((c) => ({ poly: c.poly, x: c.cx, z: c.cz, area: c.area, nearTown: adj(c).length > 0 || c.poly.some((p) => p.e >= 0 && byIndex[p.e]?.city) }));

  // Street lamps along the arteries
  L.spawn = { x: pc.x + inR * 0.5, z: pc.z, yaw: Math.PI };
  return true;
}

/** Fields in a countryside cell: parallel strips along its longest side. */
export function farmStrips(cell, rng) {
  const block = insetConvex(cell.poly, () => 4);
  if (block.length < 3) return [];
  let bi = 0;
  let bl = 0;
  for (let i = 0; i < block.length; i++) {
    const a = block[i];
    const b = block[(i + 1) % block.length];
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    if (l > bl) {
      bl = l;
      bi = i;
    }
  }
  const f = edgeFrame(block, bi);
  const strips = [];
  const n = 2 + Math.floor(rng() * 3);
  const depthEach = (f.depth - 2) / n;
  for (let s = 0; s < n; s++) {
    const f2 = { ...f, ax: f.ax + f.nx * s * (depthEach + 1), az: f.az + f.nz * s * (depthEach + 1), depth: f.depth - s * (depthEach + 1) };
    const rect = fitAgainst(block, f2, f.len, depthEach, { setback: 0, maxShrink: 0.45 });
    if (!rect || rect.w < 14 || rect.d < 8) continue;
    const crop = rng() < 0.55 ? 'wheat' : rng() < 0.6 ? 'crop' : 'plowed';
    strips.push({ x: rect.cx, z: rect.cz, w: rect.w, d: rect.d, yaw: Math.atan2(f.tz, f.tx), crop });
  }
  return strips;
}
