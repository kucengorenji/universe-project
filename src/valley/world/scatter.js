import { mulberry32 } from '../../math/random.js';
import { padDistance, polylineDistance } from './valleyGround.js';

// Rule-based scatter (docs/FARM_PLAN.md §6 rule 4): nothing is sprayed uniformly. Trees ring the
// valley (pines up the hills, oaks lower down), rocks gather along the river banks and at the
// foot of the slopes, bushes tuck into building corners. Deterministic from the layout seed.

/** Wall footprints (m) of the buildings in the kit; the rest are small round props. */
export const FOOTPRINTS = {
  house_player: [6, 5], house_villager_a: [5, 4.4], house_villager_b: [5.4, 4.6], shop: [7, 5], barn: [8, 6], coop: [3, 2.4]
};
/** Ridge heights (m) of the buildings, for the camera's occlusion test. */
export const HEIGHTS = { house_player: 6.2, house_villager_a: 5.4, house_villager_b: 5.6, shop: 6, barn: 6.9, coop: 3.3 };
const PROP_RADIUS = {
  well: 0.95, woodpile: 0.75, hay_bale: 0.55, milk_pail: 0.25, bucket: 0.25, wheelbarrow: 0.55, shipping_bin: 0.75, crate: 0.45, barrel: 0.4, bench: 0.6, signpost: 0.2, mailbox: 0.2,
  tree_oak: 0.5, tree_apple: 0.4, tree_sakura: 0.4, tree_pine: 0.35, rock_a: 0.8, rock_b: 0.5
};

/** Solid things a walker bumps into: rectangles for buildings, circles for props and trunks. */
export function solidsOf(objects) {
  const out = [];
  for (const o of objects) {
    const s = o.s || 1;
    if (FOOTPRINTS[o.kit]) {
      const [w, d] = FOOTPRINTS[o.kit];
      // padDistance turns local +x towards (cos rot, sin rot); three.js rotation.y turns it the other way
      out.push({ kind: 'rect', x: o.x, z: o.z, w: w + 0.3, d: d + 0.3, rot: -(o.rot || 0), kit: o.kit, h: HEIGHTS[o.kit] });
    } else if (PROP_RADIUS[o.kit]) out.push({ kind: 'circle', x: o.x, z: o.z, r: PROP_RADIUS[o.kit] * s, kit: o.kit });
  }
  return out;
}

export function insideSolid(solids, x, z, pad = 0) {
  for (const s of solids) {
    if (s.kind === 'rect' ? padDistance(s, x, z) < pad : Math.hypot(x - s.x, z - s.z) < s.r + pad) return s;
  }
  return null;
}

export function scatterRules(ground, layout, objects) {
  const rng = mulberry32(layout.seed + 401);
  const out = [];
  const pads = [...ground.pads.values()];
  const solids = solidsOf(objects);
  const nearPath = (x, z, m) => ground.paths.some((p) => polylineDistance(p.points, x, z) < p.width / 2 + m);
  const nearPad = (x, z, m) => pads.some((p) => padDistance(p, x, z) < m);
  const clearOf = (x, z, r, list) => list.every((o) => Math.hypot(o.x - x, o.z - z) > r);
  const inside = (x, z, m = 2) => Math.abs(x) < ground.half - m && Math.abs(z) < ground.half - m;

  // Forest ring: pines on the slopes, oaks on the lower ground, at least 4.5 m apart
  const trees = objects.filter((o) => o.kit.startsWith('tree_'));
  for (let tries = 0; tries < 900 && out.filter((o) => o.kit.startsWith('tree_')).length < 70; tries++) {
    const a = rng() * Math.PI * 2, r = 40 + rng() * 32;
    const x = Math.cos(a) * r, z = -6 + Math.sin(a) * r * 0.9;
    if (!inside(x, z, 4) || ground.riverDistance(x, z) < layout.river.width / 2 + 4 || nearPath(x, z, 3) || nearPad(x, z, 4)) continue;
    if (!clearOf(x, z, 4.5, trees)) continue;
    const h = ground.heightAt(x, z);
    const kit = h > 4 || rng() < 0.35 ? 'tree_pine' : 'tree_oak';
    const t = { kit, x, z, s: 0.9 + rng() * 0.55, rot: rng() * 360, scatter: 'forest' };
    trees.push(t);
    out.push(t);
  }

  // Rocks along both banks of the river, away from the bridge abutments
  const river = layout.river.points;
  for (let i = 1; i < river.length; i++) {
    const [ax, az] = river[i - 1], [bx, bz] = river[i], len = Math.hypot(bx - ax, bz - az);
    for (let d = 0; d < len; d += 2.6) {
      if (rng() > 0.42) continue;
      const side = rng() < 0.5 ? -1 : 1, off = layout.river.width / 2 + 0.6 + rng() * 2;
      const x = ax + ((bx - ax) * d) / len - ((bz - az) / len) * off * side, z = az + ((bz - az) * d) / len + ((bx - ax) / len) * off * side;
      if (!inside(x, z) || nearPad(x, z, 1.5) || nearPath(x, z, 0.8)) continue;
      out.push({ kit: rng() < 0.5 ? 'rock_a' : 'rock_b', x, z, s: 0.45 + rng() * 0.7, rot: rng() * 360, scatter: 'bank' });
    }
  }

  // Rocks at the foot of the slopes: where the ground starts to rise
  for (let tries = 0, n = 0; tries < 2000 && n < 28; tries++) {
    const x = (rng() * 2 - 1) * 60, z = (rng() * 2 - 1) * 60;
    const h = ground.heightAt(x, z);
    const slope = Math.hypot(ground.heightAt(x + 1, z) - ground.heightAt(x - 1, z), ground.heightAt(x, z + 1) - ground.heightAt(x, z - 1)) / 2;
    if (h < 1 || h > 7 || slope < 0.18 || slope > 0.6 || nearPath(x, z, 1) || nearPad(x, z, 2) || !clearOf(x, z, 3, trees)) continue;
    out.push({ kit: rng() < 0.6 ? 'rock_a' : 'rock_b', x, z, s: 0.6 + rng() * 0.9, rot: rng() * 360, scatter: 'foot' });
    n++;
  }

  // Bushes in two corners of each building, outside the walls, never in front of the door
  for (const s of solids.filter((o) => o.kind === 'rect')) {
    const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]].sort(() => rng() - 0.5).slice(0, 2);
    const a = (s.rot * Math.PI) / 180;
    for (const [cx, cz] of corners) {
      const lx = cx * (s.w / 2 + 0.55), lz = cz * (s.d / 2 + 0.55);
      if (lz > 0 && cz > 0 && s.kit !== 'barn') continue; // front (+z local) corners stay clear for the doorway
      const x = s.x + lx * Math.cos(a) - lz * Math.sin(a), z = s.z + lx * Math.sin(a) + lz * Math.cos(a);
      if (nearPath(x, z, 0.4) || insideSolid(solids, x, z, 0.1)) continue;
      out.push({ kit: rng() < 0.3 ? 'bush_flower' : 'bush', x, z, s: 0.75 + rng() * 0.4, rot: rng() * 360, scatter: 'corner' });
    }
  }
  return out;
}
