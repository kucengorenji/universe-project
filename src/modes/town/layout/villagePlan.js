import { riverDistance } from './townPlan.js';
import { pickWeighted } from './wards.js';

// Street village (layout v3, fantasy settlements of one tile): the grammar of
// Watabou's Village Generator rather than a shrunken walled town.
//   1. the regional route runs through as the main street, bending with the land
//   2. a green with a well where the street crosses the middle
//   3. a few short dead-end lanes off the main street
//   4. houses in rows along both sides, a tavern on the green
//   5. crofts: long strips of field behind each row, then open-field furlongs
//      beyond them, all square to the street, so the land reads as the village's
// Project adaptation; no Watabou source is used.

const TAU = Math.PI * 2;
const SIZE = { f_house: [8, 7], f_house_small: [6, 6], f_house_tall: [7, 8], f_shop: [8, 8], f_tavern: [12, 9], barn: [14, 10] };
const HOMES = [['f_house', 5], ['f_house_small', 4], ['f_house_tall', 1], ['f_shop', 1]];
const MAIN_W = 6;
const LANE_W = 3.4;
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** Which fantasy towns grow as street villages. */
export const isVillage = (L) => !L.modern && !L.capital && L.size <= 1 && L.layoutVersion >= 3;

function chaikin(pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    out.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Walk a polyline at a fixed spacing: (x, z, dx, dz, distance from its start). */
function along(pts, every, start, fn) {
  let t = start;
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const len = Math.hypot(bx - ax, bz - az) || 1;
    while (t < walked + len) {
      const u = (t - walked) / len;
      fn(ax + (bx - ax) * u, az + (bz - az) * u, (bx - ax) / len, (bz - az) / len, t);
      t += typeof every === 'function' ? every() : every;
    }
    walked += len;
  }
}

export function planVillage(L, K, fillFronts) {
  const { rng, noise, at, inCity, addStreet, streetClear, place, claim, fp } = K;
  const S = {};
  const dry = (x, z) => at(x, z, S).land > 0.72 && riverDistance(L, x, z) > 4;
  // Streets may cross a river (planBridges spans it later), never the sea
  const solid = (x, z) => at(x, z, S).land > 0.72;
  const reach = Math.max(80, L.cityR * 1.2);
  /** Grow a street from the middle toward a heading, bending with the noise, until the land or the village ends. */
  const grow = (heading, max = reach, from = [0, 0]) => {
    const pts = [from];
    let h = heading;
    for (let d = 0; d < max; d += 8) {
      const [x, z] = pts[pts.length - 1];
      h += noise.noise(x * 0.012, z * 0.012, 41) * 0.16 + Math.atan2(Math.sin(heading - h), Math.cos(heading - h)) * 0.12;
      const q = [x + Math.cos(h) * 8, z + Math.sin(h) * 8];
      if (!solid(q[0], q[1]) || !inCity(q[0], q[1], 0.1)) break;
      pts.push(q);
    }
    return pts;
  };

  // 1. Main street: the two routes out that are most opposite, joined through the middle
  const dirs = L.exits.map((e) => ({ angle: e.angle, exit: e }));
  const open = Array.from({ length: 16 }, (_, i) => ({ angle: (i / 16) * TAU })).map((d) => ({ ...d, len: grow(d.angle).length }));
  open.sort((a, b) => b.len - a.len);
  if (!dirs.length) dirs.push(open[0]);
  if (dirs.length === 1) dirs.push(open.find((d) => angDiff(d.angle, dirs[0].angle) > 2.2) || { angle: dirs[0].angle + Math.PI });
  let pair = [0, 1];
  for (let i = 0; i < dirs.length; i++) for (let j = i + 1; j < dirs.length; j++) if (angDiff(dirs[i].angle, dirs[j].angle) > angDiff(dirs[pair[0]].angle, dirs[pair[1]].angle)) pair = [i, j];
  const a = grow(dirs[pair[0]].angle);
  const b = grow(dirs[pair[1]].angle);
  const spine = chaikin([...b.slice().reverse(), ...a.slice(1)]);
  // No room for a street through the middle: the ward plan takes over
  if (spine.length < 6) return false;
  const streets = [addStreet(spine, MAIN_W, 'main')];
  for (const [d, arm] of [[dirs[pair[0]], a], [dirs[pair[1]], b]]) if (d.exit && arm.length > 1) d.exit.gate = { x: arm[arm.length - 1][0], z: arm[arm.length - 1][1] };
  // Any other route out branches off the middle
  dirs.forEach((d, i) => {
    if (pair.includes(i)) return;
    const arm = grow(d.angle);
    if (arm.length > 2) streets.push(addStreet(chaikin(arm), MAIN_W - 1, 'main'));
    if (d.exit && arm.length > 1) d.exit.gate = { x: arm[arm.length - 1][0], z: arm[arm.length - 1][1] };
  });

  // 2. The green, the well beside the street
  const plazaR = 10;
  L.plaza = { x: 0, z: 0, r: plazaR };
  claim({ x: 0, z: 0, hw: plazaR * 0.72, hd: plazaR * 0.72, yaw: 0 }, false);
  // Heading of the main street where it crosses the green
  const t0 = a.length > 1 ? Math.atan2(a[1][1] - a[0][1], a[1][0] - a[0][0]) : dirs[pair[0]].angle;
  const well = [Math.cos(t0 + Math.PI / 2) * 5.5, Math.sin(t0 + Math.PI / 2) * 5.5];
  L.props.push({ asset: 'f_well', x: well[0], z: well[1], yaw: rng() * TAU, w: 3.2, d: 3.2 });
  L.colliders.push({ type: 'circle', x: well[0], z: well[1], r: 1.8 });

  // 3. Dead-end lanes off the main street
  const lanes = [];
  const maxLanes = 2 + Math.round(L.cityR / 45);
  for (const s of streets) {
    along(s.pts, () => 30 + rng() * 26, 18, (x, z, dx, dz) => {
      if (lanes.length >= maxLanes || Math.hypot(x, z) < plazaR + 12 || rng() > 0.6) return;
      const side = rng() < 0.5 ? -1 : 1;
      const heading = Math.atan2(dz, dx) + side * (Math.PI / 2 + (rng() - 0.5) * 0.6);
      const pts = [[x, z]];
      let h = heading;
      for (let d = 0, len = 25 + rng() * 40; d < len; d += 6) {
        const [px, pz] = pts[pts.length - 1];
        h += noise.noise(px * 0.02, pz * 0.02, 43) * 0.12;
        const q = [px + Math.cos(h) * 6, pz + Math.sin(h) * 6];
        if (!dry(q[0], q[1]) || !inCity(q[0], q[1], 0.1) || (d > 12 && streetClear(q[0], q[1], 16) < 6)) break;
        pts.push(q);
      }
      if (pts.length >= 4) lanes.push(addStreet(pts, LANE_W, 'lane'));
    });
  }

  // 4. The tavern on the green, then rows of houses along every street
  for (const side of [-1, 1]) {
    if (L.landmark) break;
    const [w0, d0] = SIZE.f_tavern;
    const F = fp('f_tavern', w0, d0);
    const off = MAIN_W / 2 + 1.1 + F.front;
    const t = plazaR + 3 + F.w / 2;
    const x = Math.cos(t0) * t - Math.sin(t0) * off * side;
    const z = Math.sin(t0) * t + Math.cos(t0) * off * side;
    const yaw = Math.atan2(-Math.sin(t0) * side, -Math.cos(t0) * side);
    if (place(L.buildings, 'f_tavern', x, z, yaw, F.w, F.d, { pad: 0.4, tint: 1 })) L.landmark = { asset: 'f_tavern', x, z, yaw, w: F.w, d: F.d };
  }
  const typeAt = () => {
    const asset = pickWeighted(HOMES, rng);
    return [asset, ...SIZE[asset]];
  };
  fillFronts(L, { ...K, typeAt, cityTh: 0.1, list: L.buildings, kinds: ['main', 'lane'] });

  // 5. Crofts behind the rows, open-field furlongs beyond them
  L.crofts = [];
  const crop = () => (rng() < 0.45 ? 'wheat' : rng() < 0.65 ? 'crop' : 'plowed');
  for (const s of streets) {
    for (const side of [-1, 1]) {
      let furlong = null;
      along(s.pts, () => 11 + rng() * 5, 6, (x, z, dx, dz) => {
        if (Math.hypot(x, z) < plazaR + 16) return;
        const nx = -dz * side;
        const nz = dx * side;
        const back = s.w / 2 + 1.1 + 10 + 3; // pavement, a house depth, a yard
        const len = 26 + rng() * 26;
        const width = 9 + rng() * 3;
        const cx = x + nx * (back + len / 2);
        const cz = z + nz * (back + len / 2);
        // Long axis (w) runs away from the street, so crop rows run down the strip
        L.crofts.push({ x: cx, z: cz, w: len, d: width, yaw: Math.atan2(nz, nx), crop: crop(), croft: true });
        if (rng() < 0.08) {
          const bx = x + nx * (back + len + 9);
          const bz = z + nz * (back + len + 9);
          place(L.buildings, 'barn', bx, bz, Math.atan2(dz, dx), ...SIZE.barn);
        }
        // Furlongs: a block of strips past the crofts, every few crofts
        if (!furlong || Math.hypot(x - furlong[0], z - furlong[1]) > 44) {
          furlong = [x, z];
          const depth = 40 + rng() * 30;
          const out = back + 58 + 8 + depth / 2;
          const strips = 2 + Math.floor(rng() * 3);
          const each = (36 + rng() * 12) / strips;
          for (let k = 0; k < strips; k++) {
            const along2 = (k - (strips - 1) / 2) * (each + 1);
            L.crofts.push({ x: x + nx * out + dx * along2, z: z + nz * out + dz * along2, w: depth, d: each, yaw: Math.atan2(nz, nx), crop: crop() });
          }
        }
      });
    }
  }
  L.farmCells = []; // the village lays out its own fields; no Voronoi countryside plots

  L.spawn = { x: Math.cos(t0) * (plazaR * 0.6), z: Math.sin(t0) * (plazaR * 0.6), yaw: t0 + Math.PI / 2 };
  L.morphology = { version: 3, kind: 'street-village', streets: streets.length, lanes: lanes.length };
  return true;
}
