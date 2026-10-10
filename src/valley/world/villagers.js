import * as THREE from 'three';
import { mulberry32 } from '../../math/random.js';
import { makeActor, animateActor, disposeActor, LOOKS } from './actors.js';
import { ClipPlayer } from '../anim/clips.js';
import { setFace } from '../../modes/town/people/chunkyPeople.js';
import { buildNav, route } from './nav.js';

// Villagers (docs/FARM_PLAN.md §5.4, milestone V4): a routine per time of day — they walk the
// path network to the next place, then stand, sit on a bench, loop or wander, and go home at
// night (out of sight). When the player comes close they stop, turn, look at them and greet;
// E talks (a line for the time of day, a gesture, a smile). `extra` adds anonymous wanderers.

/** What each villager does when; `at` names an anchor (see anchors()). */
export const ROUTINES = {
  seller: {
    pagi: { at: 'shopFront', kind: 'stand', face: 0 },
    siang: { at: 'gate', kind: 'stand', face: Math.PI * 0.85 },
    sore: { at: 'benchEast', kind: 'sit' },
    malam: { at: 'homeA', kind: 'home' }
  },
  elder: {
    pagi: { at: 'pathLoop', kind: 'loop' },
    siang: { at: 'benchWest', kind: 'sit' },
    sore: { at: 'bridgeEnd', kind: 'stand', face: Math.PI / 2 },
    malam: { at: 'homeB', kind: 'home' }
  },
  child: {
    pagi: { at: 'tree', kind: 'circle' },
    siang: { at: 'coop', kind: 'wander' },
    sore: { at: 'well', kind: 'wander' },
    malam: { at: 'homeA', kind: 'home' }
  }
};

export const LINES = {
  seller: {
    pagi: ['Selamat pagi! Toko baru saja buka.', 'Lobak segar hari ini, mampir ya!'],
    siang: ['Ladangmu makin rapi saja.', 'Jangan lupa menyiram sebelum terik.'],
    sore: ['Duduk sebentar enak juga, ya.', 'Langitnya oranye sekali sore ini.']
  },
  elder: {
    pagi: ['Pagi, Nak. Jalan pagi bikin sendi lancar.', 'Embunnya masih dingin.'],
    siang: ['Dulu lembah ini cuma padang ilalang.', 'Pohon apel itu kutanam waktu masih muda.'],
    sore: ['Dengar suara sungainya? Menenangkan.', 'Jembatan ini lebih tua dariku, lho.']
  },
  child: {
    pagi: ['Kejar aku kalau bisa!', 'Hari ini aku mau main sampai sore!'],
    siang: ['Ayamnya lucu! Boleh kupegang?', 'Ssst, aku lagi mengendap-endap.'],
    sore: ['Aku lempar kerikil ke sumur, lho!', 'Besok main lagi ya!']
  }
};

/** One more line per season, mixed into the conversation (V5). */
export const SEASON_LINES = {
  seller: { semi: 'Bunga sakura di alun-alun sedang mekar!', panas: 'Panas sekali, minum yang banyak ya.', gugur: 'Musim panen! Gudangku penuh labu.', dingin: 'Brr... salju pertama tahun ini.' },
  elder: { semi: 'Musim semi, waktunya menabur benih.', panas: 'Dulu aku berenang di sungai itu tiap musim panas.', gugur: 'Daun-daun itu seperti api, ya.', dingin: 'Di musim dingin, ladang ikut beristirahat.' },
  child: { semi: 'Aku menangkap kelopak sakura!', panas: 'Malam ini ada kunang-kunang!', gugur: 'Kresek-kresek! Aku suka menginjak daun.', dingin: 'Ayo bikin boneka salju!' }
};

const SPEED = { seller: 1.1, elder: 0.75, child: 2.2 };
const GREET = 2.3, LEAVE = 3.6;

export class Villagers {
  constructor(templates, ground, walkable, { extra = 0, shadows = true, seed = 7, layout } = {}) {
    this.ground = ground;
    this.walkable = walkable;
    this.nav = buildNav(ground.paths);
    this.anchor = anchors(ground, layout);
    this.group = new THREE.Group();
    this.group.name = 'villagers';
    this.list = [];
    this.time = null;
    const rng = (this.rng = mulberry32(seed));
    const add = (look, start, routine) => {
      const p = makeActor(templates, look, { shadows });
      p.root.position.set(start[0], ground.surfaceAt(...start), start[1]);
      this.group.add(p.root);
      const v = { p, look, routine, clips: new ClipPlayer(p), plan: [], mode: 'idle', act: null, engaged: false, line: 0, smile: 0, angle: rng() * 6.28, yawRate: 0 };
      this.list.push(v);
      return v;
    };
    add('seller', this.anchor.gate, ROUTINES.seller);
    add('elder', [-5.5, -0.5], ROUTINES.elder);
    add('child', [this.anchor.tree[0] + 3.6, this.anchor.tree[1]], ROUTINES.child);
    const looks = Object.keys(LOOKS).filter((k) => k !== 'player');
    for (let n = 0; n < extra; n++) {
      let start = null;
      while (!start) {
        const x = (rng() * 2 - 1) * 22, z = (rng() * 2 - 1) * 18;
        if (walkable(x, z)) start = [x, z];
      }
      const v = add(looks[n % looks.length], start, null);
      v.mode = 'wander';
      v.act = { kind: 'wander', center: start };
    }
  }

  /** Start each villager towards their place for this time of day. */
  setTime(time) {
    this.time = time;
    for (const v of this.list) {
      if (!v.routine) continue;
      const act = v.routine[time];
      const at = this.anchor[act.at];
      v.act = { ...act, center: at.pos ?? at };
      v.clips.stop();
      v.p.root.visible = true;
      v.engaged = false;
      const from = [v.p.root.position.x, v.p.root.position.z];
      const goal = act.kind === 'loop' ? at[0] : act.kind === 'sit' ? at.pos : act.kind === 'circle' ? [at[0] + 3.6, at[1]] : at;
      v.plan = route(this.nav, from, goal);
      v.mode = 'walk';
    }
  }

  /** Place everyone at their spot for the current time at once (QA, first load). */
  settle() {
    for (const v of this.list) {
      if (!v.routine || v.mode !== 'walk') continue;
      const goal = v.plan.at(-1);
      v.p.root.position.set(goal[0], this.ground.surfaceAt(...goal), goal[1]);
      v.plan = [];
      this.arrive(v);
    }
  }

  /** The villager in front of (x, z) within reach, facing f: anyone close enough to greet you can be answered. */
  inFront(x, z, f, reach = GREET) {
    for (const v of this.list) {
      if (!v.p.root.visible || !v.routine) continue;
      const p = v.p.root.position, dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz);
      if (d < reach && (dx * f.x + dz * f.z) / (d || 1) > 0.4) return v;
    }
    return null;
  }

  /** E on a villager: a line for the time of day, a gesture and a smile. Returns the line. */
  talk(v) {
    const day = LINES[v.look]?.[this.time];
    if (!day) return null;
    const lines = [...day, SEASON_LINES[v.look]?.[this.season]].filter(Boolean);
    const text = lines[v.line++ % lines.length];
    if (v.mode !== 'sit') v.clips.play('talk');
    v.smile = 3;
    setFace(v.p, 'laugh');
    v.p.face.current = 'laugh';
    v.p.mood = 'laugh';
    return text;
  }

  /** world: { player: Vector3, frozen, onGreet(v, text) }. */
  update(dt, world) {
    for (const v of this.list) {
      const { p } = v;
      if (world.frozen) {
        animateActor(p, dt, 0);
        v.clips.update(dt);
        continue;
      }
      if (!p.root.visible) continue;
      const pos = p.root.position, toPlayer = new THREE.Vector2(world.player.x - pos.x, world.player.z - pos.z), dist = toPlayer.length();
      // Close enough to greet: stop and turn (not while on the way somewhere)
      const settled = v.mode !== 'walk' && v.mode !== 'home';
      if (!v.engaged && dist < GREET && settled && v.routine) {
        v.engaged = true;
        world.onGreet?.(v, LINES[v.look]?.[this.time]?.[0]);
      } else if (v.engaged && dist > LEAVE) v.engaged = false;
      let speed = 0, heading = null;
      if (v.engaged) {
        if (v.mode !== 'sit') heading = Math.atan2(toPlayer.x, toPlayer.y);
      } else if (v.mode === 'walk') {
        const next = v.plan[0];
        const dx = next[0] - pos.x, dz = next[1] - pos.z, d = Math.hypot(dx, dz);
        if (d < 0.2) {
          v.plan.shift();
          if (!v.plan.length) this.arrive(v);
        } else {
          const step = Math.min(d, SPEED[v.look] * dt);
          pos.x += (dx / d) * step;
          pos.z += (dz / d) * step;
          heading = Math.atan2(dx, dz);
          speed = SPEED[v.look];
        }
      } else if (v.mode === 'circle') {
        const c = v.act.center, r = 3.6;
        v.angle += (dt * SPEED.child) / r;
        const x = c[0] + Math.cos(v.angle) * r, z = c[1] + Math.sin(v.angle) * r;
        heading = Math.atan2(x - pos.x, z - pos.z);
        pos.x = x;
        pos.z = z;
        speed = SPEED.child;
      } else if (v.mode === 'loop' || v.mode === 'wander') {
        ({ speed, heading } = this.stroll(v, dt));
      } else if (v.mode === 'stand' && v.act.face !== undefined) heading = v.act.face;
      if (heading !== null) {
        let delta = heading - p.root.rotation.y;
        delta = Math.atan2(Math.sin(delta), Math.cos(delta));
        const turn = delta * (1 - Math.exp(-dt * 8));
        p.root.rotation.y += turn;
        v.yawRate = dt > 0 ? turn / dt : 0;
      } else v.yawRate = 0;
      if (v.mode !== 'sit') pos.y = this.ground.surfaceAt(pos.x, pos.z);
      // Eyes on the player while engaged; a smile fades back to the usual face
      if (v.engaged) {
        const a = Math.atan2(toPlayer.x, toPlayer.y) - p.root.rotation.y;
        p.look.toYaw = THREE.MathUtils.clamp(Math.atan2(Math.sin(a), Math.cos(a)), -0.7, 0.7);
        p.look.toPitch = -0.1;
        p.look.next = 0.5;
      }
      if (v.smile > 0 && (v.smile -= dt) <= 0) {
        p.mood = LOOKS[v.look].mood;
        p.face.current = '';
      }
      animateActor(p, dt, speed, { turn: v.yawRate });
      v.clips.update(dt);
    }
  }

  arrive(v) {
    const kind = v.act.kind;
    v.mode = kind;
    if (kind === 'sit') {
      const seat = this.anchor[v.act.at];
      v.p.root.position.set(seat.pos[0], this.ground.heightAt(...seat.pos), seat.pos[1]);
      v.p.root.rotation.y = seat.face;
      v.clips.play('sit');
    } else if (kind === 'home') v.p.root.visible = false; // indoors for the night
    else if (kind === 'loop') v.loopIndex = 1;
  }

  /** Loop along points, or amble around a centre. */
  stroll(v, dt) {
    const pos = v.p.root.position;
    if (v.wait > 0) {
      v.wait -= dt;
      return { speed: 0, heading: null };
    }
    let goal;
    if (v.mode === 'loop') goal = this.anchor.pathLoop[v.loopIndex % this.anchor.pathLoop.length];
    else {
      if (!v.target) {
        const a = this.rng() * Math.PI * 2, r = 0.8 + this.rng() * 3;
        const x = v.act.center[0] + Math.cos(a) * r, z = v.act.center[1] + Math.sin(a) * r;
        if (this.walkable(x, z)) v.target = [x, z];
        else return { speed: 0, heading: null };
      }
      goal = v.target;
    }
    const dx = goal[0] - pos.x, dz = goal[1] - pos.z, d = Math.hypot(dx, dz);
    if (d < 0.2) {
      if (v.mode === 'loop') v.loopIndex++;
      v.target = null;
      v.wait = v.mode === 'loop' ? 1.5 : 0.8 + this.rng() * 2;
      return { speed: 0, heading: null };
    }
    const speed = v.mode === 'loop' ? SPEED[v.look] : SPEED[v.look] * 0.6;
    const step = Math.min(d, speed * dt), nx = pos.x + (dx / d) * step, nz = pos.z + (dz / d) * step;
    if (v.mode === 'wander' && !this.walkable(nx, nz)) {
      v.target = null;
      return { speed: 0, heading: null };
    }
    pos.x = nx;
    pos.z = nz;
    return { speed, heading: Math.atan2(dx, dz) };
  }

  dispose() {
    for (const { p } of this.list) disposeActor(p);
    this.list = [];
  }
}

/** Named places of the routines, from the layout and the placed square. */
export function anchors(ground, layout) {
  const sq = ground.features.find((f) => f.id === 'square' && f.placed);
  const S = sq ? [sq.x, sq.z] : [-1, 27];
  const objects = ground.featureObjects;
  const bench = (sign) => {
    const b = objects.find((o) => o.kit === 'bench' && Math.sign(o.x - S[0]) === sign);
    const a = ((b?.rot ?? 180) * Math.PI) / 180, f = [Math.sin(a), Math.cos(a)];
    return { pos: [(b?.x ?? S[0]) + f[0] * 0.05, (b?.z ?? S[1] + 5.5) + f[1] * 0.05], face: a };
  };
  const door = (kit) => {
    const h = objects.find((o) => o.kit === kit);
    if (!h) return S;
    const a = (h.rot * Math.PI) / 180;
    return [h.x + Math.sin(a) * 3.1, h.z + Math.cos(a) * 3.1];
  };
  const bridge = ground.bridges[0];
  const coop = layout?.objects.find((o) => o.kit === 'coop');
  return {
    square: S,
    shopFront: [S[0], S[1] - 1.8],
    gate: [6.6, -1.4],
    benchWest: bench(-1),
    benchEast: bench(1),
    homeA: door('house_villager_a'),
    homeB: door('house_villager_b'),
    well: [S[0] + 1.6, S[1] + 4.2],
    tree: [-1.5, 12],
    coop: coop ? [coop.x + 1.5, coop.z + 3.5] : [0, -16],
    bridgeEnd: bridge ? [bridge.abutmentEnds[0].x, bridge.abutmentEnds[0].z] : [24, 12],
    pathLoop: [[-5.5, -0.5], [4, 1.6], [9, 2.4], [12, 6], [9, 2.4], [4, 1.6]]
  };
}
