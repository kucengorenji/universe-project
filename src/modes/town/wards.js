// Town plan from wards, after watabou's Medieval Fantasy City Generator:
// Voronoi cells over the town are its blocks, the edges between them its
// streets. Every block belongs to a ward (market, merchants, craftsmen, rich
// quarter, slum, docks, ...) whose parameters decide how it is cut into lots
// and what stands on them. Cutting convex blocks into convex lots keeps every
// house inside its own lot, so buildings never overlap by construction.
//
// Polygons are arrays of { x, z, e } in counter-clockwise order (x right,
// z up in 2D); `e` labels the edge from that vertex to the next one:
//   >= 0  the neighbouring cell's index (a street runs there)
//   BOUND the clipping square
//   CUT   a cut between two lots (a party wall)

export const BOUND = -1;
export const CUT = -2;

// ---------------------------------------------------------------- polygons

export function area(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

export function centroid(poly) {
  let cx = 0;
  let cz = 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const f = p.x * q.z - q.x * p.z;
    cx += (p.x + q.x) * f;
    cz += (p.z + q.z) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-9) return { x: poly[0].x, z: poly[0].z };
  return { x: cx / (3 * a), z: cz / (3 * a) };
}

/** Keep the part of a polygon where (p - o) . n <= 0; the new edge along the line gets `label`. */
export function clip(poly, ox, oz, nx, nz, label) {
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const da = (a.x - ox) * nx + (a.z - oz) * nz;
    const db = (b.x - ox) * nx + (b.z - oz) * nz;
    if (da <= 0) out.push({ x: a.x, z: a.z, e: a.e });
    if (da <= 0 !== db <= 0) {
      const t = da / (da - db);
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      out.push({ x, z, e: da <= 0 ? label : a.e });
    }
  }
  return out.length >= 3 ? out : [];
}

export function inConvex(poly, x, z, pad = 0) {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    // Left of every CCW edge (inside), by at least `pad`
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const len = Math.hypot(ex, ez) || 1;
    if ((ex * (z - a.z) - ez * (x - a.x)) / len < pad) return false;
  }
  return true;
}

/** Move every edge inward by inset(edge) metres (convex polygons only). */
export function insetConvex(poly, inset) {
  let out = poly;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const d = inset(a.e, a, b);
    if (!d) continue;
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const len = Math.hypot(ex, ez);
    if (len < 1e-6) continue;
    // Outward normal of a CCW edge, then the line moved inward by d
    const nx = ez / len;
    const nz = -ex / len;
    out = clip(out, a.x - nx * d, a.z - nz * d, nx, nz, a.e);
    if (!out.length) return [];
  }
  return out;
}

/** Split a convex polygon by the line through (px, pz) with normal (nx, nz), leaving a gap. */
export function splitConvex(poly, px, pz, nx, nz, gap = 0) {
  const g = gap / 2;
  const a = clip(poly, px - nx * g, pz - nz * g, nx, nz, CUT);
  const b = clip(poly, px + nx * g, pz + nz * g, -nx, -nz, CUT);
  return [a, b];
}

// ---------------------------------------------------------------- voronoi

/**
 * Voronoi cells of `sites` inside the square [-R, R]^2, by half-plane
 * clipping (a few hundred sites: plenty fast, and exact).
 */
export function voronoi(sites, R) {
  const square = [
    { x: -R, z: -R, e: BOUND },
    { x: R, z: -R, e: BOUND },
    { x: R, z: R, e: BOUND },
    { x: -R, z: R, e: BOUND }
  ];
  // Neighbour candidates from a coarse grid
  const cell = 90;
  const grid = new Map();
  const key = (i, j) => `${i},${j}`;
  sites.forEach((s, k) => {
    const g = key(Math.floor(s.x / cell), Math.floor(s.z / cell));
    if (!grid.has(g)) grid.set(g, []);
    grid.get(g).push(k);
  });
  return sites.map((s, i) => {
    let poly = square;
    // Grow the search ring until the cell is certainly closed
    for (let ring = 1; ring <= 8; ring++) {
      poly = square;
      const ci = Math.floor(s.x / cell);
      const cj = Math.floor(s.z / cell);
      for (let di = -ring; di <= ring; di++) {
        for (let dj = -ring; dj <= ring; dj++) {
          for (const j of grid.get(key(ci + di, cj + dj)) || []) {
            if (j === i) continue;
            const t = sites[j];
            poly = clip(poly, (s.x + t.x) / 2, (s.z + t.z) / 2, t.x - s.x, t.z - s.z, j);
            if (!poly.length) break;
          }
        }
      }
      // Closed if every vertex is nearer than the searched radius
      let far = 0;
      for (const p of poly) far = Math.max(far, Math.hypot(p.x - s.x, p.z - s.z));
      if (far * 2 < ring * cell || ring === 8) break;
    }
    return { i, site: s, poly };
  });
}

/** Lloyd relaxation: move the chosen sites to their cell centroids. */
export function relax(sites, R, iterations, movable) {
  for (let k = 0; k < iterations; k++) {
    const cells = voronoi(sites, R);
    cells.forEach((c) => {
      if (!movable(c.site) || !c.poly.length) return;
      const m = centroid(c.poly);
      c.site.x = m.x;
      c.site.z = m.z;
    });
  }
  return voronoi(sites, R);
}

// ---------------------------------------------------------------- lots

/**
 * Cut a block into lots, watabou-style but in metres and by frontage:
 * a piece is split across its longest street edge until that frontage is
 * short enough, and cut parallel to the street when it reaches too deep (the
 * back part becomes a yard or reaches the street on the other side). Every
 * cut across a street edge leaves both halves on the street, so lots keep
 * their frontage.
 *   maxFront   longest frontage a lot keeps (lots end up between half and all of it)
 *   maxDepth   deepest a lot reaches from its street
 *   gridChaos  0 = straight cuts in the middle, 1 = crooked and off-centre
 *   sizeChaos  spread of the stopping sizes
 *   emptyProb  chance a lot stays empty (a yard, a garden)
 *   alley      gap left on the first cuts of big blocks (a passage)
 */
export function subdivide(poly, P, rng) {
  const lots = [];
  const minSide = P.minSide || 4.5;
  const chaos = () => 1 + (rng() - 0.5) * 2 * P.sizeChaos * 0.5;
  const leaf = (p) => lots.push({ poly: p, empty: rng() < P.emptyProb });
  const rec = (p, level) => {
    if (!p.length) return;
    if (level > 16) return leaf(p);
    // Longest street edge
    let best = -1;
    let bl = 0;
    for (let i = 0; i < p.length; i++) {
      if (p[i].e === CUT) continue;
      const a = p[i];
      const b = p[(i + 1) % p.length];
      const l = Math.hypot(b.x - a.x, b.z - a.z);
      if (l > bl) {
        bl = l;
        best = i;
      }
    }
    if (best < 0) return leaf(p); // an inner piece: courtyard or garden
    const f = edgeFrame(p, best);
    // Too deep: keep the front strip, the rest is cut off behind it
    const maxD = P.maxDepth * chaos();
    if (f.depth > maxD * 1.35 && Math.abs(area(p)) > P.maxFront * P.maxDepth * 0.5) {
      const [front, back] = splitConvex(p, f.ax + f.nx * maxD, f.az + f.nz * maxD, f.nx, f.nz, 0);
      if (front.length && back.length && thinness(front) >= minSide) {
        rec(front, level + 1);
        rec(back, level + 1);
        return;
      }
    }
    if (bl < P.maxFront * chaos()) return leaf(p);
    // Across the street edge, near its middle, tilted a little when chaotic
    const t = 0.5 + (rng() - 0.5) * P.gridChaos * 0.5;
    const px = f.ax + f.tx * bl * t;
    const pz = f.az + f.tz * bl * t;
    const ang = Math.atan2(f.tz, f.tx) + (rng() - 0.5) * P.gridChaos * 0.3;
    const gap = P.alley && level < 2 && bl > P.maxFront * 3 ? P.alley : 0;
    const [l, r] = splitConvex(p, px, pz, Math.cos(ang), Math.sin(ang), gap);
    if (!l.length || !r.length || thinness(l) < minSide || thinness(r) < minSide) return leaf(p);
    rec(l, level + 1);
    rec(r, level + 1);
  };
  rec(poly, 0);
  return lots;
}

/** Rough smallest width of a convex polygon (area over longest chord). */
function thinness(p) {
  let far = 0;
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) far = Math.max(far, Math.hypot(p[i].x - p[j].x, p[i].z - p[j].z));
  return (Math.abs(area(p)) / Math.max(far, 1e-6)) * 1.3;
}

/**
 * The frame of a lot seen from one of its edges: origin at the edge start,
 * t along the edge, n pointing into the lot; width = the edge's usable run,
 * depth = how far the lot reaches behind it.
 */
export function edgeFrame(poly, i) {
  const a = poly[i];
  const b = poly[(i + 1) % poly.length];
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const tx = (b.x - a.x) / len;
  const tz = (b.z - a.z) / len;
  const nx = -tz; // inward for a CCW polygon
  const nz = tx;
  let depth = 0;
  for (const p of poly) depth = Math.max(depth, (p.x - a.x) * nx + (p.z - a.z) * nz);
  return { ax: a.x, az: a.z, tx, tz, nx, nz, len, depth, label: a.e };
}

/**
 * Fit a building rectangle (w across, d deep) against a lot's frontage edge:
 * centred on the edge, pulled back `setback` metres, shrunk until all four
 * corners are inside the lot. Returns the rectangle or null.
 */
export function fitAgainst(poly, f, w, d, { setback = 0, maxShrink = 0.72, u = f.len / 2, room = f.len * 0.96 } = {}) {
  for (let k = 1; k >= maxShrink; k -= 0.04) {
    const ww = Math.min(w, room) * (k < 1 ? k : 1);
    const dd = Math.min(d, f.depth - setback) * (k < 1 ? k : 1);
    if (ww < w * maxShrink || dd < d * maxShrink) return null;
    const corners = [
      [u - ww / 2, setback],
      [u + ww / 2, setback],
      [u + ww / 2, setback + dd],
      [u - ww / 2, setback + dd]
    ];
    if (corners.every(([cu, cv]) => inConvex(poly, f.ax + f.tx * cu + f.nx * cv, f.az + f.tz * cu + f.nz * cv, -0.05))) {
      return { w: ww, d: dd, cx: f.ax + f.tx * u + f.nx * (setback + dd / 2), cz: f.az + f.tz * u + f.nz * (setback + dd / 2) };
    }
  }
  return null;
}

// ---------------------------------------------------------------- wards

/**
 * Lot parameters and what stands on the lots, per ward. Pools are
 * [asset, weight]; `yard` is the chance of a garden tree behind a house.
 */
export const WARDS = {
  market: { label: 'Pasar' },
  landmark: { label: 'Landmark' },
  park: { label: 'Taman' },
  merchant: {
    label: 'Pedagang',
    lots: { maxFront: 15, maxDepth: 16, gridChaos: 0.35, sizeChaos: 0.5, emptyProb: 0.03, alley: 0 },
    pool: [['f_house_tall', 4], ['f_townhouse', 5], ['f_shop', 3], ['f_tavern', 1]],
    yard: 0.15,
    gap: 0.15,
    gapChaos: 0.3
  },
  craftsmen: {
    label: 'Pengrajin',
    lots: { maxFront: 17, maxDepth: 16, gridChaos: 0.55, sizeChaos: 0.7, emptyProb: 0.04, alley: 2.2 },
    pool: [['f_house', 5], ['f_house_tall', 2], ['f_shop', 2], ['f_house_small', 2]],
    yard: 0.35
  },
  patriciate: {
    label: 'Bangsawan',
    lots: { maxFront: 30, maxDepth: 30, gridChaos: 0.5, sizeChaos: 0.5, emptyProb: 0.08, alley: 0 },
    pool: [['f_house', 4], ['f_house_tall', 3], ['f_townhouse', 1]],
    yard: 0.9
  },
  slum: {
    label: 'Kampung',
    lots: { maxFront: 15, maxDepth: 12, gridChaos: 0.85, sizeChaos: 0.6, emptyProb: 0.03, alley: 1.8, minSide: 6 },
    pool: [['f_house_small', 6], ['f_house', 1]],
    yard: 0.1,
    gap: 0.25,
    gapChaos: 0.5
  },
  gate: {
    label: 'Gerbang',
    lots: { maxFront: 20, maxDepth: 16, gridChaos: 0.45, sizeChaos: 0.6, emptyProb: 0.06, alley: 0 },
    pool: [['f_tavern', 3], ['f_shop', 3], ['f_house', 2], ['barn', 1]],
    yard: 0.2
  },
  docks: {
    label: 'Dermaga',
    lots: { maxFront: 26, maxDepth: 18, gridChaos: 0.4, sizeChaos: 0.6, emptyProb: 0.1, alley: 2.4 },
    pool: [['barn', 3], ['f_shop', 2], ['f_house', 2], ['f_tavern', 1]],
    yard: 0.05
  },
  military: {
    label: 'Barak',
    lots: { maxFront: 22, maxDepth: 18, gridChaos: 0.25, sizeChaos: 0.4, emptyProb: 0.12, alley: 0 },
    pool: [['f_house_tall', 3], ['f_tower', 1], ['barn', 1]],
    yard: 0.05
  },
  // Modern
  cbd: {
    label: 'Pusat kota',
    lots: { maxFront: 34, maxDepth: 26, gridChaos: 0, sizeChaos: 0.3, emptyProb: 0.03, alley: 0, minSide: 14 },
    pool: [['m_office', 5], ['m_apartment', 2], ['m_shop', 1]],
    yard: 0
  },
  commercial: {
    label: 'Komersial',
    lots: { maxFront: 44, maxDepth: 24, gridChaos: 0, sizeChaos: 0.5, emptyProb: 0.04, alley: 0, minSide: 9 },
    pool: [['m_office', 3], ['m_apartment', 3], ['m_shop', 4]],
    yard: 0.05
  },
  residential: {
    label: 'Perumahan',
    lots: { maxFront: 30, maxDepth: 20, gridChaos: 0, sizeChaos: 0.5, emptyProb: 0.06, alley: 0, minSide: 9 },
    pool: [['m_apartment', 3], ['m_house', 4], ['m_shop', 1]],
    yard: 0.35
  },
  suburb: {
    label: 'Pinggiran',
    lots: { maxFront: 28, maxDepth: 24, gridChaos: 0.05, sizeChaos: 0.5, emptyProb: 0.08, alley: 0, minSide: 10 },
    pool: [['m_house', 6], ['m_shop', 1]],
    yard: 0.8
  },
  industrial: {
    label: 'Industri',
    lots: { maxFront: 52, maxDepth: 32, gridChaos: 0, sizeChaos: 0.4, emptyProb: 0.12, alley: 0, minSide: 14 },
    pool: [['m_shop', 3], ['m_office', 1], ['m_apartment', 1]],
    yard: 0
  }
};

/** Weighted pick from a pool of [asset, weight]. */
export function pickWeighted(pool, rng) {
  let total = 0;
  for (const [, w] of pool) total += w;
  let r = rng() * total;
  for (const [a, w] of pool) {
    r -= w;
    if (r <= 0) return a;
  }
  return pool[pool.length - 1][0];
}
