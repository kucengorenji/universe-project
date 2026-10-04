import { SPOT_RANGE, SPOT_RANGE_SCOPE, WEAPONS } from './rules.js';

// What one side knows of the other (simple fog of war). An enemy is spotted while any of the
// side's standing soldiers, tanks or bunkers sees it within spotting range; an enemy that fires
// on the side gives itself away. Once spotted, an enemy that drops out of sight stays on the
// map as its last known position (a ghost), until it is seen again or found dead. Pure: needs
// the battle state and the arena's sight test only.

export class Spotting {
  /** @param side the side whose knowledge this is ('fed' for the player) */
  constructor(battle, arena, side = 'fed') {
    this.battle = battle;
    this.arena = arena;
    this.side = side;
    this.known = new Map(); // enemy id -> { x, z, yaw, visible, turn (last seen), state }
  }

  /** Spotting range of a watcher (m). */
  range(u) {
    return WEAPONS[u.weapon]?.scope ? SPOT_RANGE_SCOPE : SPOT_RANGE;
  }

  /** Re-check every enemy against every watcher. Returns true when what is visible changed. */
  update() {
    const b = this.battle;
    const watchers = b.units.filter((u) => u.side === this.side && u.state === 'ok');
    let changed = false;
    for (const e of b.units) {
      if (e.side === this.side) continue;
      const was = this.known.get(e.id);
      if (e.state === 'evac') continue;
      const seen = e.state !== 'dead' && watchers.some((w) => Math.hypot(w.x - e.x, w.z - e.z) <= this.range(w) && this.arena.sees(w, e));
      if (seen) changed = this.mark(e) || changed;
      else if (was?.visible) {
        was.visible = false;
        changed = true;
      }
      // the dead stay where they fell once anyone knew of them
      if (e.state === 'dead' && was && was.state !== 'dead') {
        Object.assign(was, { x: e.x, z: e.z, state: 'dead', visible: false });
        changed = true;
      }
    }
    return changed;
  }

  /** Mark an enemy as seen now (also used when it reveals itself by firing). */
  mark(e) {
    const k = this.known.get(e.id);
    const moved = !k || !k.visible || k.x !== e.x || k.z !== e.z || k.state !== e.state;
    this.known.set(e.id, { x: e.x, z: e.z, yaw: e.yaw, visible: true, turn: this.battle.turn, state: e.state });
    return moved;
  }

  /** An enemy fired at this side: it is seen for now. */
  reveal(id) {
    const e = this.battle.unit(id);
    if (e && e.side !== this.side && e.state === 'ok') this.mark(e);
  }

  isVisible(id) {
    return !!this.known.get(id)?.visible;
  }

  /**
   * The enemies as this side knows them, for drawing: visible ones as they are, the others at
   * their last known position with ghost: true (and seenTurn). Unknown enemies are left out.
   */
  view() {
    const out = [];
    for (const u of this.battle.units) {
      if (u.side === this.side) continue;
      const k = this.known.get(u.id);
      if (!k) continue;
      if (k.visible) out.push(u);
      else out.push({ ...u, x: k.x, z: k.z, yaw: k.yaw, state: k.state === 'dead' ? 'dead' : 'ok', ghost: k.state !== 'dead', seenTurn: k.turn });
    }
    return out;
  }
}
