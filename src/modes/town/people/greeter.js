// The greeting of a named townsperson as a small state machine (LIVING_WORLD_BOOK §3):
//   idle -> stop (0.3 s: stops, turns toward the player) -> talk (2.4 s bubble) -> linger -> release
// Enter radius 2.3 m, exit 3.6 m (hysteresis), one greeting per approach, 15 s cooldown of active
// time. All time is the `dt` passed in, so a paused game freezes it and nothing is replayed after.
// Nothing here moves a mesh: the caller reads `hold`, `faceYaw` and `bubble` and acts on them.

export const GREET = Object.freeze({ enter: 2.3, exit: 3.6, cooldown: 15, stopS: 0.3, talkS: 2.4, releaseS: 0.25, turnRate: (120 * Math.PI) / 180 });

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Greeter {
  constructor({ actorId, onEvent = () => {} }) {
    this.actorId = actorId;
    this.onEvent = onEvent;
    this.state = 'idle';
    this.clock = 0; // active seconds since this greeter was made
    this.stateT = 0;
    this.lastGreetAt = null;
    this.armed = true; // a fresh approach is allowed
    this.yaw = 0;
    this.greetings = 0;
    this.sequence = 0;
    this.interactionId = null;
    this.distance = Infinity;
  }

  get ready() { return this.lastGreetAt === null || this.clock - this.lastGreetAt >= GREET.cooldown; }
  get hold() { return this.state !== 'idle'; }
  get bubble() { return this.state === 'talk'; }

  emit(type, extra = {}) {
    this.sequence++;
    this.onEvent({ eventId: type, instanceId: `${this.actorId}:${this.sequence}`, actorId: this.actorId, interactionId: this.interactionId, worldTime: this.clock, ...extra });
  }

  /** Back to idle at once (scene exit, interior, driving, actor not on screen). No greeting is claimed. */
  cancel(reason = 'cancel') {
    if (this.state === 'talk') this.emit('lw.actor.talk.end', { reason });
    this.state = 'idle';
    this.armed = true; // whoever comes back is a new approach
    this.interactionId = null;
  }

  /**
   * @param dt     active seconds (0 while paused)
   * @param actor  { x, z, yaw } where the person stands now
   * @param player { x, z } on foot, or null (diorama, indoors, driving)
   * @param present false when the person is not on screen (no body to greet with)
   * @returns { hold, faceYaw (radians, or null), bubble }
   */
  update(dt, { actor, player, present = true }) {
    if (!player || !present) {
      if (this.state !== 'idle') this.cancel('away');
      this.distance = Infinity;
      return this.output();
    }
    this.clock += dt;
    this.distance = Math.hypot(player.x - actor.x, player.z - actor.z);
    const bearing = Math.atan2(player.x - actor.x, player.z - actor.z);

    if (this.state === 'idle') {
      if (this.distance > GREET.exit) this.armed = true;
      else if (this.armed && this.distance <= GREET.enter && this.ready) {
        this.state = 'stop';
        this.stateT = 0;
        this.armed = false;
        this.yaw = actor.yaw;
        this.interactionId = `${this.actorId}#${this.greetings + 1}`;
        this.emit('lw.actor.state.enter', { phase: 'stop' });
      }
    }
    if (this.state !== 'idle') this.turn(dt, bearing);
    const gone = this.distance > GREET.exit;
    switch (this.state) {
      case 'stop':
        this.stateT += dt;
        if (gone) this.release('exit');
        else if (this.stateT >= GREET.stopS) {
          this.state = 'talk';
          this.stateT = 0;
          this.lastGreetAt = this.clock;
          this.greetings++;
          this.emit('lw.actor.greet', { phase: 'greet', position: { x: actor.x, z: actor.z } });
          this.emit('lw.actor.talk.start', { phase: 'start' });
        }
        break;
      case 'talk':
        this.stateT += dt;
        if (gone) { this.emit('lw.actor.talk.end', { reason: 'exit' }); this.release('exit', false); }
        else if (this.stateT >= GREET.talkS) { this.emit('lw.actor.talk.end', { reason: 'done' }); this.state = 'linger'; this.stateT = 0; }
        break;
      case 'linger':
        if (gone) this.release('exit', false);
        break;
      case 'release':
        this.stateT += dt;
        if (this.stateT >= GREET.releaseS) { this.state = 'idle'; this.interactionId = null; }
        break;
      default:
    }
    return this.output();
  }

  release(reason, announce = true) {
    if (announce) this.emit('lw.actor.state.enter', { phase: 'release', reason });
    this.state = 'release';
    this.stateT = 0;
  }

  /** The body follows the player, at most 120 degrees a second, never snapping. */
  turn(dt, bearing) {
    if (this.state === 'release') return;
    const delta = wrap(bearing - this.yaw), step = GREET.turnRate * dt;
    this.yaw = wrap(this.yaw + Math.max(-step, Math.min(step, delta)));
  }

  output() {
    return { hold: this.hold, faceYaw: this.state === 'idle' ? null : this.yaw, bubble: this.bubble };
  }
}
