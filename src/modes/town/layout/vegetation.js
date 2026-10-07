import { riverDistance } from './townPlan.js';
import { containsField } from '../../../world/landUsePlan.js';
import { planFlowerDrifts } from './fieldEdges.js';

// Trees and rocks around the town, in groups rather than one by one:
// a clump has a dominant species with a few others mixed in, a bigger tree in
// the middle, and bushes around its edge; rocks come as one boulder with a few
// smaller stones, each tumbled, squashed and sunk a little so three rock
// models read as dozens.

const TAU = Math.PI * 2;

const POOLS = {
  green: {
    broadleaf: [['t_oak', 0, 4], ['t_oak', 1, 2], ['t_birch', 0, 2], ['t_fruit', 0, 1], ['t_pine', 0, 1]],
    conifer: [['t_pine', 0, 3], ['t_spruce', 0, 3], ['t_birch', 0, 1]],
    autumn: [['t_oak', 2, 3], ['t_birch', 1, 2], ['t_oak', 1, 1], ['t_oak', 0, 1]],
    open: [['t_oak', 0, 3], ['t_oak', 1, 1], ['t_fruit', 0, 1], ['t_fruit', 1, 1], ['t_birch', 0, 2], ['t_pine', 0, 1], ['t_cypress', 0, 1]],
    beach: [['t_palm', 0, 3], ['t_cypress', 0, 1]]
  },
  dry: {
    broadleaf: [['t_acacia', 0, 3], ['t_acacia', 1, 2], ['t_palm', 0, 1], ['t_cypress', 0, 1]],
    open: [['t_acacia', 0, 2], ['t_acacia', 1, 1], ['t_cypress', 0, 1]],
    beach: [['t_palm', 0, 2]]
  },
  snow: {
    broadleaf: [['t_pine', 1, 3], ['t_spruce', 1, 3]],
    conifer: [['t_pine', 1, 3], ['t_spruce', 1, 3]],
    open: [['t_spruce', 1, 2], ['t_pine', 1, 1]]
  }
};

function pickW(pool, rng) {
  let total = 0;
  for (const p of pool) total += p[2];
  let r = rng() * total;
  for (const p of pool) {
    r -= p[2];
    if (r <= 0) return p;
  }
  return pool[0];
}

export function planVegetation(L, { rng, noise, at, place, streetClear, fields, flora, detail }) {
  if (flora === 'none') return planRocks(L, { rng, at, streetClear, detail, flora, place, fields });
  const S = {};
  const R = L.dioramaR;
  // This is a generation budget, not a graphics tier: trunks and colliders
  // remain identical across render quality. Older saved layouts stay exact.
  const k = L.layoutVersion >= 5 ? 0.27 : 1;
  const pools = POOLS[flora] || POOLS.green;
  const inField = (x, z) => fields.some(f => containsField(f, x, z, 2.5));
  const ok = (x, z, s) => s.land >= 0.76 && s.city <= 0.3 && s.otherCity <= 0.3 && streetClear(x, z, 20) >= 3 && !inField(x, z) && riverDistance(L, x, z) > 2.5;

  /** What grows here: a species pool, how likely a clump is, how big. */
  const standAt = (x, z, s) => {
    const stand = noise.noise(x * 0.008, z * 0.008, 9);
    const autumn = noise.noise(x * 0.004, z * 0.004, 13) > 0.45;
    const dens = noise.noise(x * 0.006, z * 0.006, 3) * 0.5 + 0.5;
    // Moist banks have a different community; noise leaves meadow clearings
    // through forest masses instead of making one uniformly dense scatter.
    if(flora==='green'&&riverDistance(L,x,z)<15)return {pool:[['t_birch',0,4],['t_oak',0,1],['t_fruit',0,1]],p:.75,n:[2,5],r:7,mix:.3};
    if(s.forest>.35&&noise.noise(x*.018,z*.018,17)>.45)return null;
    if (s.mountain > 0.5) return { pool: pools.conifer || pools.open, p: 0.4, n: [2, 5], r: 8, mix: 0.25, snowy: s.mountain > 0.8 };
    if (s.forest > 0.45) {
      const pool = Math.abs(stand) > 0.25 && pools.conifer ? pools.conifer : autumn && pools.autumn ? pools.autumn : pools.broadleaf;
      return { pool, p: 0.75 + dens * 0.25, n: [5, 11], r: 11 + dens * 7, mix: 0.3 };
    }
    if (s.desert > 0.5) return null;
    if (s.tundra > 0.5) return { pool: POOLS.snow.open, p: 0.1, n: [1, 3], r: 6, mix: 0.2 };
    if (s.beach > 0.5) return pools.beach ? { pool: pools.beach, p: 0.07, n: [1, 3], r: 5, mix: 0.2 } : null;
    return { pool: pools.open, p: 0.1 + dens * 0.16, n: [1, 4], r: 5 + dens * 5, mix: 0.45 };
  };

  const clumps = Math.round(950 * k);
  let made = 0;
  for (let i = 0; i < clumps * 8 && made < clumps; i++) {
    const a = rng() * TAU;
    const r = Math.sqrt(rng()) * R;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const s = at(cx, cz, S);
    if (!ok(cx, cz, s)) continue;
    const st = standAt(cx, cz, s);
    if (!st || rng() > st.p) continue;
    made++;
    const main = pickW(st.pool, rng);
    const n = st.n[0] + Math.floor(rng() * (st.n[1] - st.n[0] + 1));
    for (let t = 0; t < n; t++) {
      const ta = rng() * TAU;
      const tr = t === 0 ? 0 : Math.sqrt(rng()) * st.r;
      const x = cx + Math.cos(ta) * tr;
      const z = cz + Math.sin(ta) * tr;
      const s2 = at(x, z, S);
      if (!ok(x, z, s2)) continue;
      const [asset, v0] = rng() < st.mix ? pickW(st.pool, rng) : main;
      const variant = st.snowy && (asset === 't_pine' || asset === 't_spruce') ? 1 : v0;
      // The middle one stands tallest; the rest vary, so a clump has a silhouette
      const size = (asset === 't_palm' ? 5 : 4.6) * (0.72 + rng() * 0.5) * (t === 0 ? 1.18 : 1);
      const tint = [0.88 + rng() * 0.16, 0.9 + rng() * 0.14, 0.86 + rng() * 0.14];
      if (place(L.trees, asset, x, z, rng() * TAU, size * 0.7, size * 0.7, { collide: false, pad: 0.05, variant, tint, ...(L.layoutVersion >= 5 ? { habitat: 'woodland' } : {}) })) {
        L.colliders.push({ type: 'circle', x, z, r: Math.min(1.1, size * 0.14) });
      }
    }
    // Undergrowth around the edge
    if (flora === 'green' && rng() < 0.65) {
      const nb = 1 + Math.floor(rng() * 3);
      for (let b = 0; b < nb; b++) {
        const ba = rng() * TAU;
        const x = cx + Math.cos(ba) * st.r * (0.9 + rng() * 0.4);
        const z = cz + Math.sin(ba) * st.r * (0.9 + rng() * 0.4);
        if (ok(x, z, at(x, z, S))) place(L.trees, 'b_bush', x, z, rng() * TAU, 1.3 + rng() * 0.6, 1.3 + rng() * 0.6, { collide: false, pad: -0.3, variant: Math.floor(rng() * 2), tint: 0.85 + rng() * 0.2 });
      }
    }
  }

  // Flowers: v3 grows them in a few meadow drifts; older layouts keep their patches
  if (L.layoutVersion >= 3 && flora === 'green') planFlowerDrifts(L, { rng, noise, at, place, ok });
  const patches = L.layoutVersion >= 3 ? 0 : Math.round(260 * k);
  for (let i = 0, made2 = 0; i < patches * 6 && made2 < patches; i++) {
    const a = rng() * TAU;
    const r = Math.sqrt(rng()) * R;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const s = at(cx, cz, S);
    if (!ok(cx, cz, s) || s.forest > 0.3 || s.mountain > 0.3 || s.desert > 0.4 || flora !== 'green') continue;
    made2++;
    const flowers = rng() < 0.6;
    const n = flowers ? 3 + Math.floor(rng() * 5) : 1 + Math.floor(rng() * 2);
    const variant = Math.floor(rng() * 3);
    for (let t = 0; t < n; t++) {
      const x = cx + (rng() - 0.5) * 7;
      const z = cz + (rng() - 0.5) * 7;
      if (!ok(x, z, at(x, z, S))) continue;
      place(L.trees, flowers ? 'b_flowers' : 'b_bush', x, z, rng() * TAU, 1.2 + rng() * 0.6, 1.2 + rng() * 0.6, { collide: false, pad: -0.4, variant: flowers ? variant : Math.floor(rng() * 2), tint: 0.9 + rng() * 0.15 });
    }
  }

  // Desert: cacti in twos and threes, mesas
  if (flora === 'dry') {
    for (let i = 0; i < 900 * k; i++) {
      const a = rng() * TAU;
      const r = Math.sqrt(rng()) * R;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const s = at(x, z, S);
      if (s.desert < 0.5 || !ok(x, z, s) || rng() > 0.08) continue;
      if (rng() < 0.25) place(L.trees, 'rock_mesa', x, z, rng() * TAU, 8 + rng() * 8, 8 + rng() * 8, { collide: false, pad: 0.2 });
      else for (let c = 0; c < 1 + Math.floor(rng() * 3); c++) place(L.trees, 'cactus', x + (rng() - 0.5) * 5, z + (rng() - 0.5) * 5, rng() * TAU, 2.1, 2.1, { collide: false, pad: 0 });
    }
  }
  planRocks(L, { rng, at, streetClear, detail, flora, place, fields });
}

/** Rock groups: a boulder and a few stones, each tumbled, squashed and sunk. */
function planRocks(L, { rng, at, streetClear, detail, flora, place, fields=[] }) {
  const S = {};
  const R = L.dioramaR;
  const groups = flora === 'none' ? 520 : 240;
  for (let i = 0, made = 0; i < groups * 8 && made < groups; i++) {
    const a = rng() * TAU;
    const r = Math.sqrt(rng()) * R;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const s = at(cx, cz, S);
    if (s.land < 0.55 || s.city > 0.3 || s.otherCity > 0.3 || streetClear(cx, cz, 20) < 4 || riverDistance(L, cx, cz) < 2) continue;
    const p = flora === 'none' ? 0.5 : s.mountain > 0.4 ? 0.45 : s.desert > 0.5 ? 0.1 : s.beach > 0.5 ? 0.08 : s.tundra > 0.5 ? 0.12 : 0.035;
    if (rng() > p) continue;
    made++;
    const big = (s.mountain > 0.4 || flora === 'none' ? 3 : 2) + rng() * (s.mountain > 0.4 ? 4 : 2.5);
    const n = 1 + Math.floor(rng() * 4);
    for (let t = 0; t <= n; t++) {
      const main = t === 0;
      const size = main ? big : big * (0.22 + rng() * 0.3);
      const ta = rng() * TAU;
      const tr = main ? 0 : big * (0.55 + rng() * 0.6);
      const x = cx + Math.cos(ta) * tr;
      const z = cz + Math.sin(ta) * tr;
      const sample=at(x,z,S);
      if(sample.land<.76||sample.city>.3||streetClear(x,z,20)<3||riverDistance(L,x,z)<3||fields.some(f=>containsField(f,x,z,size*.5+1)))continue;
      const tilt = main ? 0.35 : 0.8;
      const grey = 0.84 + rng() * 0.22;
      const placed=place(L.trees,'r_rock',x,z,rng()*TAU,size*.7,size*.7,{
        collide:false,pad:.1,
        variant: Math.floor(rng() * 3),
        tint: [grey, grey * (0.97 + rng() * 0.04), grey * (0.93 + rng() * 0.06)],
        tiltX: (rng() - 0.5) * tilt,
        tiltZ: (rng() - 0.5) * tilt,
        sx: 0.75 + rng() * 0.6,
        sy: 0.6 + rng() * 0.6,
        sz: 0.75 + rng() * 0.6,
        sink: size * (0.08 + rng() * 0.12)
      });
      if (placed && main && size > 2.2) L.colliders.push({ type: 'circle', x, z, r: size * 0.32 });
      // v3: grass tufts gather at the foot of a stone, where the mower never reaches
      if (placed && L.layoutVersion >= 3 && flora === 'green') {
        for (let g = 0; g < 2 + Math.floor(rng() * 3); g++) {
          const ga = rng() * TAU;
          const gr = size * 0.4 + 0.3 + rng() * 0.6;
          place(L.trees, 'g_tuft', x + Math.cos(ga) * gr, z + Math.sin(ga) * gr, rng() * TAU, 0.45 + rng() * 0.3, 0.45, { collide: false, pad: -0.3, variant: Math.floor(rng() * 3), tint: 0.9 + rng() * 0.15 });
        }
      }
    }
  }
}
