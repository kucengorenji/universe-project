import * as THREE from 'three';
import { GrassContact } from './render/grassContact.js';
import { Greeter } from './people/greeter.js';
import { ActorBubble } from './ui/actorBubble.js';
import { damarIdentity, chooseDamarAnchor } from '../../world/namedActor.js';
import { isOn } from '../../core/experiments.js';
import { registerProof } from '../../core/proofMetrics.js';
import { anyWithin } from './townPacks.js';
import { t } from '../../i18n/index.js';

// The living-world proofs of the town (LIVING_WORLD_BOOK §10), each behind its own
// experiment flag (core/experiments.js). TownMode only calls update() and dispose().

const HEAD = 1.95; // metres above the feet, for the bubble
const _v = new THREE.Vector3();

export class TownLife {
  constructor({ builder, quality, walkers, rigged, crowd, walkNetwork, layout, planet, city, ui, door = null, prefetch = null }) {
    this.builder = builder;
    this.crowd = crowd;
    this.rigged = rigged;
    this.events = [];
    this.prefetch = isOn('lazyInterior') ? prefetch : null; // furniture loads when a door is near
    this.frame = 0;
    this.grass = isOn('grass') && builder.groundCover ? new GrassContact({ slots: quality.tier === 'low' ? 4 : 6 }) : null;
    this.damar = isOn('greet') ? this.setupDamar({ walkers, rigged, walkNetwork, layout, planet, city, ui, door }) : null;
    this.unregister = [registerProof('grass', () => this.grassMetrics()), registerProof('greet', () => this.greetMetrics()), registerProof('lazy', () => ({ enabled: !!this.prefetch, ...(prefetch?.pack.metrics() ?? {}) }))];
  }

  /** One walker, pinned to a street near the way to the starter house, with a fixed identity. */
  setupDamar({ walkers, rigged, walkNetwork, layout, planet, city, ui, door }) {
    const slot = walkers.walkers[0]; // an existing slot: the crowd cap does not grow
    if (!slot || !rigged) return null;
    const identity = damarIdentity({ planet, city, layoutSeed: layout.seed });
    const anchor = chooseDamarAnchor(walkNetwork, { door, spawn: layout.spawn });
    const walker = anchor && walkers.pin(slot.i, anchor.edge);
    if (!walker) return null;
    rigged.identities.set(walker.i, identity.seed); // the body they wear never depends on which pool slot is free
    const greeter = new Greeter({ actorId: identity.actorId, onEvent: (event) => { this.events.push(event); if (this.events.length > 40) this.events.shift(); } });
    return { ...identity, walker, anchor, greeter, bubble: new ActorBubble({ parent: ui, name: t(identity.nameKey), text: t(identity.greetKey) }) };
  }

  /**
   * Every frame. `dt` is active seconds, `walker` is the player standing on the ground ({ x, z })
   * or null in the diorama, indoors or while driving; `camera` places the bubble.
   */
  update(dt, { walker, camera = null }) {
    const p = this.prefetch;
    if (p && p.pack.state === 'idle' && walker && ++this.frame % 8 === 0 && anyWithin(p.doors, walker, 40)) p.pack.start('near-door');
    if (this.grass) {
      this.grass.update(Math.min(dt, 0.1), walker); // a long frame must not skip the attack
      this.builder.groundCover.setContact(this.grass);
    }
    const d = this.damar;
    if (d) {
      const body = this.crowd.people[d.walker.i];
      const present = this.rigged.pool.some((p) => p.index === d.walker.i); // greeted only with a body on screen
      const out = d.greeter.update(Math.min(dt, 0.1), { actor: body, player: walker, present });
      d.walker.hold = out.hold;
      d.walker.faceYaw = out.faceYaw;
      d.bubble.show(out.bubble && camera ? this.project(body, body.height ?? 1, camera) : null);
    }
  }

  project(body, height, camera) {
    _v.set(body.x, body.y + HEAD * height, body.z);
    const inCamera = _v.clone().applyMatrix4(camera.matrixWorldInverse);
    if (inCamera.z > 0) return null; // behind the camera
    _v.project(camera);
    if (Math.abs(_v.x) > 1 || Math.abs(_v.y) > 1) return null;
    return { x: (_v.x * 0.5 + 0.5) * window.innerWidth, y: (-_v.y * 0.5 + 0.5) * window.innerHeight };
  }

  grassMetrics() {
    const g = this.grass;
    if (!g) return { enabled: false };
    return { enabled: true, active: g.active, peakActive: g.metrics.peakActive, contacts: g.metrics.contacts, stamps: g.metrics.stamps, slots: g.slots, live: g.pushers()[0] ?? null };
  }

  greetMetrics() {
    const d = this.damar;
    if (!d) return { enabled: false };
    const body = this.crowd.people[d.walker.i], g = d.greeter;
    return {
      enabled: true, actorId: d.actorId, name: t(d.nameKey), seed: d.seed, walkerIndex: d.walker.i, anchorEdge: d.anchor.edge,
      state: g.state, greetings: g.greetings, hold: g.hold, bubble: g.bubble, distance: Number.isFinite(g.distance) ? g.distance : null,
      lastGreetAt: g.lastGreetAt, clock: g.clock, position: { x: body.x, y: body.y, z: body.z }, events: this.events.slice(-12)
    };
  }

  dispose() {
    this.grass?.reset();
    this.builder.groundCover?.setContact(null);
    if (this.damar) {
      this.damar.greeter.cancel('exit');
      this.damar.walker.hold = false;
      this.damar.walker.faceYaw = null;
      this.rigged?.identities.delete(this.damar.walker.i);
      this.damar.bubble.dispose();
    }
    this.unregister.forEach((off) => off());
  }
}
