import { riverDistance } from './townPlan.js';

// Layout v3 dressing that makes the countryside read as owned land, the way
// Watabou's village maps do: fields are bounded by hedgerows (or post-and-rail
// fences close to town), with a gate gap and the odd hedgerow oak; flowers grow
// in a few long drifts in the meadows instead of a sprinkle over every lawn.

const TAU = Math.PI * 2;

function fieldCorners(f) {
  const c = Math.cos(f.yaw);
  const s = Math.sin(f.yaw);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [f.x + (u * f.w * c - v * f.d * s) / 2, f.z + (u * f.w * s + v * f.d * c) / 2]);
}

/**
 * Hedges and fences on field edges. Adjacent strips share an edge, and the
 * occupancy grid keeps the second one from doubling it. Every boundary is
 * recorded in L.hedges so the ground cover can grow its tall grass along it.
 */
export function planHedgerows(L, { rng, place, at, streetClear, flora }) {
  L.hedges = [];
  if (!['green', 'dry', 'snow'].includes(flora)) return;
  const S = {};
  const clear = (x, z) => at(x, z, S).land > 0.76 && streetClear(x, z, 12) > 1.6 && riverDistance(L, x, z) > 2.5;
  for (const f of L.fields2 || []) {
    const pts = fieldCorners(f);
    // Near the houses a field is fenced; out in the country it is hedged
    const fenced = flora !== 'green' || (Math.hypot(f.x, f.z) < L.cityR + 90 && rng() < 0.6);
    for (let e = 0; e < 4; e++) {
      if (rng() < 0.3) continue; // some sides stay open: a field is not a box
      const [ax, az] = pts[e];
      const [bx, bz] = pts[(e + 1) % 4];
      const len = Math.hypot(bx - ax, bz - az);
      const dx = (bx - ax) / len;
      const dz = (bz - az) / len;
      // Outward normal, 1.4 m off the crop edge
      let nx = dz;
      let nz = -dx;
      if (nx * ((ax + bx) / 2 - f.x) + nz * ((az + bz) / 2 - f.z) < 0) { nx = -nx; nz = -nz; }
      const ox = nx * 1.4;
      const oz = nz * 1.4;
      const gate = len * (0.2 + rng() * 0.5);
      const inGate = (t) => t > gate && t < gate + 4.5;
      let run = null;
      const flush = () => { if (run && run.n > 1) L.hedges.push({ kind: run.kind, ax: run.ax, az: run.az, bx: run.bx, bz: run.bz }); run = null; };
      if (fenced) {
        for (let t = 1; t < len - 1; t += 2) {
          const x = ax + dx * t + ox;
          const z = az + dz * t + oz;
          if (inGate(t) || !clear(x, z) || !place(L.props, 'f_fence', x, z, Math.atan2(dz, dx), 2, 0.3, { pad: -0.25, tint: 0.88 + rng() * 0.16, variant: 0 })) { flush(); continue; }
          if (!run) run = { kind: 'fence', ax: x - dx, az: z - dz, n: 0 };
          Object.assign(run, { bx: x + dx, bz: z + dz, n: run.n + 1 });
        }
      } else {
        let nextTree = 8 + rng() * 14;
        for (let t = 1; t < len - 1; t += 1.9 + rng() * 0.6) {
          const x = ax + dx * t + ox + (rng() - 0.5) * 0.5;
          const z = az + dz * t + oz + (rng() - 0.5) * 0.5;
          if (inGate(t) || !clear(x, z)) { flush(); continue; }
          // A hedgerow oak now and then, standing proud of the hedge line
          if (t > nextTree) {
            nextTree = t + 14 + rng() * 14;
            const size = 3.4 + rng() * 1.4;
            if (rng() < 0.55 && place(L.trees, 't_oak', x + nx * 0.8, z + nz * 0.8, rng() * TAU, size, size, { collide: false, pad: -0.6, variant: rng() < 0.2 ? 1 : 0, tint: 1, habitat: 'hedge' })) {
              L.colliders.push({ type: 'circle', x: x + nx * 0.8, z: z + nz * 0.8, r: 0.5 });
            }
          }
          const w = 1.3 + rng() * 0.5;
          if (!place(L.trees, 'b_bush', x, z, rng() * TAU, w, w, { collide: false, pad: -0.55, variant: Math.floor(rng() * 2), tint: 0.8 + rng() * 0.2, habitat: 'hedge' })) { flush(); continue; }
          if (!run) run = { kind: 'hedge', ax: x, az: z, n: 0 };
          Object.assign(run, { bx: x, bz: z, n: run.n + 1 });
        }
      }
      flush();
    }
  }
}

/**
 * Wildflowers in drifts: a few long, soft-edged patches where the meadow noise
 * is high, one colour per drift, sometimes ending in a bush. `ok` is the
 * vegetation module's open-land test.
 */
export function planFlowerDrifts(L, { rng, noise, at, place, ok }) {
  const S = {};
  const R = L.dioramaR;
  const target = Math.round(26 + Math.min(24, L.cityR / 12));
  const gauss = () => (rng() + rng() + rng() - 1.5) / 1.5;
  for (let i = 0, made = 0; i < target * 40 && made < target; i++) {
    const a = rng() * TAU;
    const r = Math.sqrt(rng()) * R;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const s = at(cx, cz, S);
    if (!ok(cx, cz, s) || s.forest > 0.3 || s.mountain > 0.3 || s.desert > 0.4) continue;
    // Drifts gather in the meadows the noise favours, so whole areas stay plain grass
    if (noise.noise(cx * 0.006, cz * 0.006, 31) < 0.15) continue;
    made++;
    const heading = noise.noise(cx * 0.01, cz * 0.01, 33) * Math.PI;
    const length = 10 + rng() * 22;
    const width = 3 + rng() * 5;
    const variant = Math.floor(rng() * 3);
    const n = Math.round(Math.min(22, Math.max(5, (length * width) / 9)));
    const ca = Math.cos(heading);
    const sa = Math.sin(heading);
    for (let t = 0; t < n; t++) {
      const u = gauss() * length * 0.5;
      const v = gauss() * width * 0.5 * (1 - Math.abs(u) / length); // taper to the ends
      const x = cx + u * ca - v * sa;
      const z = cz + u * sa + v * ca;
      if (!ok(x, z, at(x, z, S))) continue;
      const w = 1.1 + rng() * 0.6;
      place(L.trees, 'b_flowers', x, z, rng() * TAU, w, w, { collide: false, pad: -0.45, variant, tint: 0.9 + rng() * 0.15, habitat: 'drift' });
    }
    if (rng() < 0.3) {
      const end = (rng() < 0.5 ? -1 : 1) * length * 0.55;
      const x = cx + end * ca;
      const z = cz + end * sa;
      if (ok(x, z, at(x, z, S))) place(L.trees, 'b_bush', x, z, rng() * TAU, 1.4, 1.4, { collide: false, pad: -0.3, variant: Math.floor(rng() * 2), tint: 0.85 + rng() * 0.2 });
    }
  }
}
