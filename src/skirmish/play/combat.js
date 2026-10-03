import * as THREE from 'three';
import { WEAPONS, INTERCEPT } from '../game/rules.js';

// Firing for both sides: bursts of physical rounds (raycasts in a cone round the aim), their
// hits on the battle state, tracers and impacts; and interception fire, which opens up on a
// moving enemy from every soldier, bunker and tank that sees it in range.

const _d = new THREE.Vector3();
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();

/** A direction inside a cone of half-angle `deg` round unit vector d (uniform over the disc). */
export function coneDir(d, deg, rand = Math.random) {
  const t = Math.tan(THREE.MathUtils.degToRad(deg)) * Math.sqrt(rand());
  const a = rand() * Math.PI * 2;
  _u.set(0, 1, 0);
  if (Math.abs(d.y) > 0.95) _u.set(1, 0, 0);
  _w.crossVectors(d, _u).normalize();
  _u.crossVectors(_w, d).normalize();
  return _d.copy(d).addScaledVector(_w, Math.cos(a) * t).addScaledVector(_u, Math.sin(a) * t).normalize().clone();
}

export class Combat {
  constructor(game) {
    this.game = game;
    this.timers = new Map(); // interceptor id -> seconds to its next burst
  }

  get battle() {
    return this.game.battle;
  }

  get arena() {
    return this.game.arena;
  }

  /** Where a unit's rounds start: in front of its eyes, a little to its right. */
  muzzle(u, dir) {
    const e = this.arena.eye(u);
    if (u.kind === 'tank') return { x: e.x + dir.x * 4.6, y: e.y - 0.4, z: e.z + dir.z * 4.6 };
    if (u.kind === 'bunker') return { x: e.x + dir.x * 2.4, y: e.y, z: e.z + dir.z * 2.4 };
    return { x: e.x + dir.x * 0.6 - dir.z * 0.12, y: e.y - 0.12, z: e.z + dir.z * 0.6 + dir.x * 0.12 };
  }

  /**
   * Fire a burst. aim: { point } (world) or { dir } (unit vector). opts: weapon (default the
   * unit's), spread multiplier, damage scale, shots. Resolves when the last round has landed.
   */
  burst(u, aim, { weapon = u.weapon, spreadMul = 1, scale = 1, shots = null } = {}) {
    const W = WEAPONS[weapon];
    const n = shots ?? W.shots;
    const spread = W.spread[u.stance === 'crouch' ? 1 : 0] * spreadMul;
    return new Promise((resolve) => {
      for (let i = 0; i < n; i++) {
        this.game.after(i * W.interval, () => {
          if (u.state !== 'ok') return;
          const base = aim.dir ? aim.dir.clone() : new THREE.Vector3(aim.point.x - u.x, 0, aim.point.z - u.z);
          let o = this.muzzle(u, base.clone().setY(0).normalize());
          if (aim.point) base.set(aim.point.x - o.x, aim.point.y - o.y, aim.point.z - o.z);
          base.normalize();
          o = this.muzzle(u, base);
          this.round(u, o, coneDir(base, spread), W, weapon, scale);
          if (i === n - 1) this.game.after(0.25, resolve);
        });
      }
      if (n === 0) resolve();
    });
  }

  /** One round from o along d. */
  round(u, o, d, W, weapon, scale) {
    const fx = this.game.effects;
    const maxT = W.range * 1.6;
    const hit = this.arena.bullet(o, d, maxT, this.battle.units, u);
    const end = hit ? hit.point : { x: o.x + d.x * maxT, y: o.y + d.y * maxT, z: o.z + d.z * maxT };
    fx.flash(o, W.splash ? 0.9 : 0.4);
    fx.tracer(o, end, weapon === 'lance' ? '#ff8a3a' : weapon === 'sniper' ? '#ffffff' : null);
    this.game.audio?.shot(weapon, o);
    if (!hit) return;
    if (hit.unit) {
      const r = this.battle.hit(hit.unit, { weapon, part: hit.part, dist: hit.t, shooter: u, scale });
      this.report(hit.unit, r, end);
    } else if (!W.splash) fx.dust(end, 0.5);
    if (W.splash) {
      fx.explosion(end, W.splash);
      fx.word(end, weapon === 'lance' ? 'DUAR!' : 'BLAM!', 'sfx');
      for (const b of this.battle.blast(end.x, end.z, weapon, u, hit.unit || null)) this.report(b.unit, b, this.arena.aimPoint(b.unit));
    }
  }

  report(target, r, at) {
    const fx = this.game.effects;
    const p = { x: at.x, y: at.y + 0.4, z: at.z };
    if (r.ping) fx.word(p, 'TING!', 'info');
    else if (r.damage > 0) fx.word(p, `${r.damage}`, r.crit ? 'crit' : 'dmg');
    if (r.crit && r.damage > 0) fx.word({ ...p, y: p.y + 0.5 }, target.kind === 'infantry' ? 'KRITIS!' : 'TITIK LEMAH!', 'crit');
    if (r.down) fx.word({ ...p, y: p.y + 0.9 }, 'TUMBANG', 'info');
    if (r.dead) fx.word({ ...p, y: p.y + 0.9 }, target.kind === 'infantry' ? 'GUGUR' : 'HANCUR', 'info');
  }

  /**
   * Interception fire at a moving unit, run every frame while it moves (not while time is
   * stopped for aiming). Standing soldiers with intercepting weapons, tanks and bunkers that
   * see the mover in range fire short loose bursts.
   */
  intercept(dt, mover) {
    if (!mover || mover.state !== 'ok') return;
    for (const s of this.battle.units) {
      if (s.side === mover.side || s.state !== 'ok' || !s.intercept) continue;
      if (s.kind === 'infantry' && s.stance !== 'stand') continue;
      const W = WEAPONS[s.intercept];
      const d = Math.hypot(s.x - mover.x, s.z - mover.z);
      if (d > W.range) {
        this.timers.delete(s.id);
        continue;
      }
      let t = this.timers.get(s.id);
      if (t === undefined) {
        // first sight: a moment to react
        if (!this.arena.sees(s, mover)) continue;
        t = 0.35;
      }
      t -= dt;
      if (t <= 0) {
        t = INTERCEPT.every * (0.8 + Math.random() * 0.4);
        if (this.arena.sees(s, mover)) {
          const p = this.arena.aimPoint(mover);
          this.game.views.aimAt(s, p, 0.7);
          const infantry = s.kind === 'infantry';
          this.burst(s, { point: p }, { weapon: s.intercept, spreadMul: infantry ? INTERCEPT.spread : 1.4, scale: infantry ? INTERCEPT.damage : 1, shots: infantry ? INTERCEPT.shots : W.shots });
        }
      }
      this.timers.set(s.id, t);
    }
  }

  resetIntercept() {
    this.timers.clear();
  }
}
