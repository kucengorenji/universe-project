import { WEAPONS, CAPTURE_RADIUS, DIFFICULTY, falloff } from './rules.js';
import { reach, pathTo } from './nav.js';
import { GN } from './arena.js';

// Enemy turn AI: picks the next unit to spend CP on, where it moves (within its AP) and whom it
// shoots. Utility scoring over a lattice of reachable cells: expected damage from there, the
// cover there, how many player guns can see it, and progress toward the player's base.

// sample every 3rd cell of the reach, every 4th for long-legged units (the work grows with AP squared)
const latticeFor = (ap) => (ap > 40 ? 4 : 3);

/** Expected damage of a full attack from `from` on target t (rough: falloff and a hit chance by distance). */
function expected(W, d, t, crouched) {
  if (d > W.range * 1.15) return 0;
  const p = Math.max(0.15, 1 - d / (W.range * 1.6)) * (t.stance === 'crouch' ? 0.7 : 1) * (crouched ? 1.1 : 1);
  if (t.kind !== 'infantry') return W.vsArmor * W.shots * p;
  return W.damage * W.shots * falloff(W, d) * p;
}

/** Is there low or high cover within reach between (x, z) and the threat at (tx, tz)? */
function coverToward(arena, x, z, tx, tz) {
  const dx = tx - x, dz = tz - z, L = Math.hypot(dx, dz) || 1;
  const px = x + (dx / L) * 1.1, pz = z + (dz / L) * 1.1;
  for (const b of arena.near(px, pz, 1.2)) {
    if (!b.bullet) continue;
    if (Math.hypot(b.x - px, b.z - pz) < b.reach + 0.6) return b.tag === 'high' || b.tag === 'house' || b.tag === 'tree' ? 'high' : 'low';
  }
  return null;
}

/**
 * Plan one action for the side whose turn it is. Returns null when no action is worth its CP,
 * else { unit, path: [[x, z], ...], to: [x, z], stance, target: unit | null, score }.
 */
export function planAction(battle, arena) {
  const side = battle.side;
  const foes = battle.alive(side === 'imp' ? 'fed' : 'imp');
  const D = DIFFICULTY[battle.difficulty];
  const home = battle.camps.find((c) => c.id === (side === 'imp' ? 'player' : 'enemy'));
  let best = null;
  for (const u of battle.alive(side)) {
    if (!battle.canSelect(u)) continue;
    // a unit already used this turn moves less: only worth it if nothing else is
    const ap = u.apMax * Math.max(0.3, 0.75 ** u.picks);
    const plan = planFor(battle, arena, u, ap, foes, home);
    if (!plan) continue;
    plan.score -= u.picks * 25 + (u.cost - 1) * 15;
    if (!best || plan.score > best.score) best = plan;
  }
  if (!best || best.score < 12 * (2 - D.accuracy)) return null;
  return best;
}

function planFor(battle, arena, u, ap, foes, home) {
  const W = WEAPONS[u.weapon];
  const tank = u.kind === 'tank';
  const occupied = new Set(battle.units.filter((o) => o !== u && o.state !== 'dead' && o.state !== 'evac').map((o) => {
    const [i, j] = arena.cellOf(o.x, o.z);
    return j * GN + i;
  }));
  const r = reach(arena, u.x, u.z, ap, { clearance: tank ? 2 : 0, occupied });
  const homeD0 = Math.hypot(u.x - home.x, u.z - home.z);
  const lattice = latticeFor(ap);
  let best = null;
  for (const [cell, used] of r.dist) {
    const i = cell % GN, j = (cell - i) / GN;
    if (cell !== r.start && (i % lattice || j % lattice)) continue;
    const [x, z] = arena.cellCentre(i, j);
    const probe = { ...u, x, z, stance: 'stand' };
    // nearest foe, for cover direction
    let near = null;
    for (const f of foes) {
      const d = Math.hypot(f.x - x, f.z - z);
      if (!near || d < near.d) near = { f, d };
    }
    const cover = near ? coverToward(arena, x, z, near.f.x, near.f.z) : null;
    const stance = !tank && cover === 'low' ? 'crouch' : 'stand';
    probe.stance = stance;
    // attack value: the best target in sight from here
    let target = null, value = 0;
    if (u.ammo > 0 && W) {
      for (const f of foes) {
        const d = Math.hypot(f.x - x, f.z - z);
        if (d > W.range * 1.15 || !arena.sees(probe, f)) continue;
        let v = expected(W, d, f, stance === 'crouch');
        if (v >= f.hp) v += 80; // a kill (or a downed soldier)
        if (v > value) [value, target] = [v, f];
      }
    }
    // threat: player guns that would see this spot
    let threat = 0;
    for (const f of foes) {
      const FW = WEAPONS[f.intercept || f.weapon];
      if (!FW) continue;
      const d = Math.hypot(f.x - x, f.z - z);
      if (d < FW.range && arena.sees(f, probe)) threat += tank ? 0.3 : 1;
    }
    let score = value - threat * 18 + (cover === 'high' ? 14 : cover === 'low' ? 20 : 0);
    // pressure toward the enemy base, and a capture when in reach
    const homeD = Math.hypot(x - home.x, z - home.z);
    score += (homeD0 - homeD) * 0.6;
    if (homeD < CAPTURE_RADIUS - 0.5 && !tank) score += 1000;
    for (const c of battle.camps) if (c.owner !== u.side && c.id === 'village' && Math.hypot(x - c.x, z - c.z) < CAPTURE_RADIUS - 0.5 && !tank) score += 60;
    score -= used * 0.05; // ties go to shorter walks
    if (!best || score > best.score) best = { unit: u, cell, to: [x, z], stance, target, score };
  }
  if (!best) return null;
  best.path = pathTo(arena, r, best.cell);
  return best;
}
