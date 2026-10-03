import { STATS, WEAPONS, BASE_CP, DOWN_TURNS, CAPTURE_RADIUS, TOUCH_RADIUS, RESELECT_AP, MIN_AP_SHARE, HEADSHOT, CROUCH_DAMAGE, ENEMY_SCALE, TURN_LIMIT, DIFFICULTY, falloff, rankFor } from './rules.js';
import { enemyForces } from './roster.js';

// Battle state for one skirmish: units, sides, turns, command points, damage, downed soldiers,
// camp captures and the result. Pure (no three.js); the 3D game and the AI drive it.
// Sides: 'fed' (the player) and 'imp'. Unit states: ok, down (rescuable), dead, evac (rescued).

let nextId = 1;

function makeUnit(side, kind, cls, props) {
  const S = STATS[kind === 'infantry' ? cls : kind];
  const scale = side === 'imp' ? ENEMY_SCALE : 1;
  const W = S.weapon ? WEAPONS[S.weapon] : null;
  return {
    id: props.id || `u${nextId++}`,
    side,
    kind,
    cls: kind === 'infantry' ? cls : kind,
    name: props.name || cls,
    face: props.face || 1,
    leader: !!props.leader,
    hp: Math.round(S.hp * scale),
    maxHp: Math.round(S.hp * scale),
    apMax: S.ap,
    weapon: S.weapon,
    intercept: S.intercept || (W?.intercept ? S.weapon : null),
    ammo: W?.ammo ?? Infinity,
    maxAmmo: W?.ammo ?? Infinity,
    cost: S.cp || 1,
    x: props.x,
    z: props.z,
    yaw: props.yaw ?? 0,
    stance: 'stand',
    state: 'ok',
    downTurns: 0,
    picks: 0
  };
}

export class Battle {
  /**
   * @param o.field       generateField() output
   * @param o.squad       [{ id, name, cls, face, leader, x, z }] the deployed player units
   * @param o.difficulty  'easy' | 'normal' | 'hard'
   */
  constructor({ field, squad, difficulty = 'normal' }) {
    this.field = field;
    this.difficulty = DIFFICULTY[difficulty] ? difficulty : 'normal';
    this.units = [];
    this.events = [];
    for (const s of squad) this.units.push(makeUnit('fed', 'infantry', s.cls, { ...s, yaw: Math.PI }));
    // enemy infantry on its deploy slots, then spread along the trench if it runs out
    const slots = [...field.deploy.imp];
    const trench = field.trenches[0]?.pts || [];
    enemyForces(this.difficulty).forEach((e, i) => {
      const at = slots[i] || (trench.length ? { x: trench[i % trench.length][0], z: trench[i % trench.length][1] - 1.5 } : { x: field.camps[1].x + i * 2, z: field.camps[1].z + 6 });
      this.units.push(makeUnit('imp', 'infantry', e.cls, { ...e, x: at.x, z: at.z, yaw: 0 }));
    });
    if (field.tank) this.units.push(makeUnit('imp', 'tank', 'tank', { id: 'tank', name: 'Tank berat', x: field.tank.x, z: field.tank.z, yaw: field.tank.yaw }));
    field.bunkers.forEach((b, i) => this.units.push(makeUnit('imp', 'bunker', 'bunker', { id: `bunker${i}`, name: `Bunker ${i + 1}`, x: b.x, z: b.z, yaw: b.yaw })));
    this.camps = field.camps.map((c) => ({ id: c.id, x: c.x, z: c.z, owner: c.side }));
    this.turn = 1;
    this.side = 'fed';
    this.over = null;
    this.startTurn('fed');
  }

  unit(id) {
    return this.units.find((u) => u.id === id);
  }

  alive(side) {
    return this.units.filter((u) => u.side === side && u.state === 'ok');
  }

  /** Command points for a side's turn: the base plus one per living leader. */
  cpFor(side) {
    const leaders = this.alive(side).filter((u) => u.leader).length;
    return (side === 'fed' ? BASE_CP : DIFFICULTY[this.difficulty].cp) + leaders;
  }

  startTurn(side) {
    this.side = side;
    this.cp = this.cpFor(side);
    for (const u of this.units) {
      if (u.side !== side) continue;
      u.picks = 0;
      // downed soldiers hold on for a few of their side's turns
      if (u.state === 'down' && --u.downTurns <= 0) this.kill(u, 'bleed');
    }
    this.log({ type: 'turn', side, turn: this.turn, cp: this.cp });
  }

  canSelect(u) {
    return !this.over && u && u.side === this.side && u.state === 'ok' && u.kind !== 'bunker' && u.cost <= this.cp;
  }

  /** Spend command points on a unit; returns its AP budget (metres) for this action. */
  select(u) {
    if (!this.canSelect(u)) return 0;
    this.cp -= u.cost;
    u.picks++;
    this.acting = u;
    return u.apMax * Math.max(MIN_AP_SHARE, RESELECT_AP ** (u.picks - 1));
  }

  /** Reaching downed soldiers: friends are carried out, enemies finished. Engineers top up ammo. */
  touch(u) {
    for (const o of this.units) {
      if (o === u || o.kind !== 'infantry') continue;
      const d = Math.hypot(o.x - u.x, o.z - u.z);
      if (o.state === 'down' && d < TOUCH_RADIUS) {
        if (o.side === u.side) {
          o.state = 'evac';
          this.log({ type: 'evac', unit: o.id, by: u.id });
        } else this.kill(o, 'touched');
      }
      if (u.cls === 'engineer' && o.side === u.side && o.state === 'ok' && d < 2.2 && o.ammo < o.maxAmmo) {
        o.ammo = o.maxAmmo;
        this.log({ type: 'resupply', unit: o.id, by: u.id });
      }
    }
  }

  /** End the acting unit's action: camps it stands on change hands; the battle may end. */
  endAction(u = this.acting) {
    this.acting = null;
    if (u && u.state === 'ok' && u.kind === 'infantry') {
      for (const c of this.camps) {
        if (c.owner === u.side || Math.hypot(c.x - u.x, c.z - u.z) > CAPTURE_RADIUS) continue;
        const was = c.owner;
        c.owner = u.side;
        this.log({ type: 'capture', camp: c.id, side: u.side, from: was });
        if (c.id === 'enemy' && u.side === 'fed') this.finish('fed', 'base');
        if (c.id === 'player' && u.side === 'imp') this.finish('imp', 'base');
      }
    }
    this.check();
  }

  endTurn() {
    if (this.over) return;
    if (this.side === 'fed') this.startTurn('imp');
    else {
      this.turn++;
      if (this.turn > TURN_LIMIT) return this.finish('imp', 'time');
      this.startTurn('fed');
    }
    this.check();
  }

  /** Can this unit fire now (ammo left)? */
  canFire(u) {
    return u.state === 'ok' && u.weapon && u.ammo > 0;
  }

  useAmmo(u) {
    if (u.ammo !== Infinity) u.ammo--;
  }

  /**
   * One hit. part: 'head' | 'body' | 'weak' | 'armor'; dist: shot distance (m);
   * scale: extra factor (interception fire is weaker). Returns { damage, crit, ping, down, dead }.
   */
  hit(target, { weapon, part, dist, shooter = null, scale = 1 }) {
    if (!target || target.state === 'dead' || target.state === 'evac') return { damage: 0 };
    const W = WEAPONS[weapon];
    let damage;
    let crit = false;
    if (target.kind !== 'infantry') {
      damage = W.vsArmor * (part === 'weak' ? STATS.tank.weakpoint : 1);
      crit = part === 'weak' && damage > 0;
    } else {
      if (target.state === 'down') return { damage: 0 };
      damage = W.damage * falloff(W, dist);
      if (part === 'head') {
        damage *= HEADSHOT;
        crit = true;
      }
      if (target.stance === 'crouch') damage *= CROUCH_DAMAGE;
    }
    if (shooter?.side === 'imp') damage *= ENEMY_SCALE;
    damage = Math.round(damage * scale);
    if (damage <= 0) return { damage: 0, ping: true };
    target.hp = Math.max(0, target.hp - damage);
    const out = { damage, crit };
    if (target.hp === 0) {
      if (target.kind === 'infantry' && target.side === 'fed') {
        target.state = 'down';
        target.downTurns = DOWN_TURNS;
        out.down = true;
        this.log({ type: 'down', unit: target.id });
      } else {
        this.kill(target, 'hit');
        out.dead = true;
      }
    }
    this.log({ type: 'hit', unit: target.id, damage, crit, by: shooter?.id });
    return out;
  }

  /** Blast damage around a point (lance rounds, tank shells). Returns [{ unit, ...hit }]. */
  blast(x, z, weapon, shooter, direct = null) {
    const W = WEAPONS[weapon];
    const out = [];
    for (const u of this.units) {
      if (u === direct || u.state !== 'ok') continue;
      const d = Math.hypot(u.x - x, u.z - z) - (u.kind === 'tank' ? 2 : u.kind === 'bunker' ? 2.3 : 0);
      if (d > W.splash) continue;
      const k = 1 - Math.max(0, d) / W.splash;
      const r = this.hit(u, { weapon, part: u.kind === 'infantry' ? 'body' : 'armor', dist: 0, shooter, scale: 0.5 + 0.5 * k });
      out.push({ unit: u, ...r });
    }
    return out;
  }

  kill(u, why) {
    u.state = 'dead';
    u.hp = 0;
    this.log({ type: 'dead', unit: u.id, why });
  }

  check() {
    if (this.over) return this.over;
    if (!this.alive('fed').some((u) => u.kind === 'infantry')) return this.finish('imp', 'wiped');
    if (!this.units.some((u) => u.side === 'imp' && u.state === 'ok' && u.kind !== 'bunker')) return this.finish('fed', 'wiped');
    return null;
  }

  finish(winner, reason) {
    if (this.over) return this.over;
    const deaths = this.units.filter((u) => u.side === 'fed' && u.state === 'dead').length;
    // downed soldiers at the end are picked up by the medics: only the dead count
    this.over = { winner, reason, turns: this.turn, deaths, rank: winner === 'fed' ? rankFor(this.turn, deaths) : '-' };
    this.log({ type: 'over', ...this.over });
    return this.over;
  }

  log(e) {
    this.events.push(e);
  }

  /** Events since the last drain (for the HUD). */
  drain() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
