import * as THREE from 'three';

// Action clips for the valley actors (docs/FARM_PLAN.md §4.3). Keyframed as data rather than in
// Blender: the rig's bones are built at load from the pivots (chunkyPeople buildTemplate), and a
// pose here is the same Euler the procedural gait writes (rest is identity on these pivots), so a
// clip blends straight over the walk. Angles in radians; for every limb +X swings it back, so a
// raised arm is negative X, a bent knee positive. `hips` keys may also lower or lift the pelvis (dy).
// Each clip lists events (time, name): the world reacts on those frames, never on a guess.

const arms = (x, elbow = -0.3, z = 0) => ({
  shoulder_L: [x, 0, z], shoulder_R: [x, 0, -z], elbow_L: [elbow, 0, 0], elbow_R: [elbow, 0, 0]
});
const crouch = (k) => ({
  hips: [0, 0, 0, -0.17 * k], hip_L: [-0.95 * k, 0, 0], hip_R: [-0.95 * k, 0, 0], knee_L: [1.55 * k, 0, 0], knee_R: [1.55 * k, 0, 0],
  ankle_L: [-0.55 * k, 0, 0], ankle_R: [-0.55 * k, 0, 0]
});
const NEUTRAL = {};

/** Clips: duration, keys [time, pose], events [time, name], hold (the last pose stays: carrying). */
export const CLIPS = {
  // Two-handed swing over the head, the blade bites at 0.55 s
  hoe: {
    duration: 0.95,
    keys: [
      [0, NEUTRAL],
      [0.32, { ...arms(-2.75, -0.35), spine: [-0.16, 0, 0], chest: [-0.1, 0, 0], head: [-0.15, 0, 0] }],
      [0.55, { ...arms(-0.75, -0.15), spine: [0.42, 0, 0], chest: [0.2, 0, 0], head: [0.2, 0, 0], ...crouch(0.25) }],
      [0.72, { ...arms(-0.8, -0.2), spine: [0.38, 0, 0], chest: [0.15, 0, 0], head: [0.15, 0, 0], ...crouch(0.22) }],
      [0.95, NEUTRAL]
    ],
    events: [[0.55, 'impact']]
  },
  // Tip the can forward and pour from 0.3 to 1.05 s
  water: {
    duration: 1.3,
    keys: [
      [0, NEUTRAL],
      [0.28, { shoulder_R: [-1.05, 0, -0.1], elbow_R: [-0.35, 0, 0], wrist_R: [0.5, 0, 0], spine: [0.18, 0, 0], head: [0.25, 0, 0], shoulder_L: [0.1, 0, 0.15] }],
      [0.7, { shoulder_R: [-1.15, 0.12, -0.1], elbow_R: [-0.35, 0, 0], wrist_R: [0.75, 0, 0], spine: [0.2, 0, 0], head: [0.28, 0, 0], shoulder_L: [0.1, 0, 0.15] }],
      [1.05, { shoulder_R: [-1.05, -0.12, -0.1], elbow_R: [-0.35, 0, 0], wrist_R: [0.75, 0, 0], spine: [0.2, 0, 0], head: [0.28, 0, 0], shoulder_L: [0.1, 0, 0.15] }],
      [1.3, NEUTRAL]
    ],
    events: [[0.32, 'pour'], [1.05, 'stop']]
  },
  // Crouch and flick the seeds out
  plant: {
    duration: 0.9,
    keys: [
      [0, NEUTRAL],
      [0.3, { ...crouch(0.8), spine: [0.5, 0, 0], head: [0.3, 0, 0], shoulder_R: [-0.5, 0, -0.1], elbow_R: [-0.6, 0, 0], shoulder_L: [-0.3, 0, 0.1] }],
      [0.48, { ...crouch(0.8), spine: [0.5, 0, 0], head: [0.3, 0, 0], shoulder_R: [-1.1, 0.3, -0.2], elbow_R: [-0.2, 0, 0], wrist_R: [-0.5, 0, 0], shoulder_L: [-0.3, 0, 0.1] }],
      [0.9, NEUTRAL]
    ],
    events: [[0.46, 'drop']]
  },
  // Crouch, grab with both hands, pull it out and up over the head (ends carrying)
  harvest: {
    duration: 0.8,
    hold: true,
    keys: [
      [0, NEUTRAL],
      [0.28, { ...crouch(0.85), spine: [0.55, 0, 0], head: [0.35, 0, 0], ...arms(-0.85, -0.25, 0.05) }],
      [0.45, { ...crouch(0.55), spine: [0.2, 0, 0], head: [0.1, 0, 0], ...arms(-1.7, -0.6, 0.05) }],
      [0.8, { ...arms(-2.9, -0.7, 0.12), clavicle_L: [0, 0, 0.12], clavicle_R: [0, 0, -0.12], head: [-0.05, 0, 0] }]
    ],
    events: [[0.45, 'pull']]
  },
  // Pick something up from the ground and lift it over the head (ends carrying)
  lift: {
    duration: 0.6,
    hold: true,
    keys: [
      [0, NEUTRAL],
      [0.22, { ...crouch(0.7), spine: [0.45, 0, 0], head: [0.3, 0, 0], ...arms(-0.7, -0.2, 0.05) }],
      [0.6, { ...arms(-2.9, -0.7, 0.12), clavicle_L: [0, 0, 0.12], clavicle_R: [0, 0, -0.12], head: [-0.05, 0, 0] }]
    ],
    events: [[0.24, 'grab']]
  },
  // Overlay while carrying: the arms hold the load over the head, the legs keep walking
  carry: {
    duration: 1,
    hold: true,
    mask: ['shoulder_L', 'shoulder_R', 'elbow_L', 'elbow_R', 'clavicle_L', 'clavicle_R', 'wrist_L', 'wrist_R'],
    keys: [[0, { ...arms(-2.9, -0.7, 0.12), clavicle_L: [0, 0, 0.12], clavicle_R: [0, 0, -0.12] }]],
    events: []
  },
  // Heave the load forward from over the head
  throw: {
    duration: 0.65,
    keys: [
      [0, { ...arms(-2.9, -0.7, 0.12), clavicle_L: [0, 0, 0.12], clavicle_R: [0, 0, -0.12] }],
      [0.16, { ...arms(-3.15, -1.0, 0.12), spine: [-0.22, 0, 0], chest: [-0.12, 0, 0], head: [-0.15, 0, 0] }],
      [0.3, { ...arms(-1.3, -0.1, 0.08), spine: [0.35, 0, 0], chest: [0.15, 0, 0], head: [0.05, 0, 0] }],
      [0.65, NEUTRAL]
    ],
    events: [[0.3, 'release']]
  },
  // Push the trunk with both hands, twice
  shake: {
    duration: 0.9,
    keys: [
      [0, NEUTRAL],
      [0.18, { ...arms(-1.35, -0.9), spine: [0.15, 0, 0] }],
      [0.3, { ...arms(-1.45, -0.15), spine: [0.32, 0, 0] }],
      [0.45, { ...arms(-1.35, -0.9), spine: [0.15, 0, 0] }],
      [0.58, { ...arms(-1.45, -0.15), spine: [0.32, 0, 0] }],
      [0.9, NEUTRAL]
    ],
    events: [[0.3, 'hit'], [0.58, 'hit']]
  },
  // Crouch and stroke with the right hand (animals, V4)
  pet: {
    duration: 1.1,
    keys: [
      [0, NEUTRAL],
      [0.3, { ...crouch(0.6), spine: [0.35, 0, 0], head: [0.3, 0, 0], shoulder_R: [-1.0, 0, -0.1], elbow_R: [-0.3, 0, 0] }],
      [0.55, { ...crouch(0.6), spine: [0.35, 0, 0], head: [0.3, 0, 0], shoulder_R: [-1.0, 0.3, -0.1], elbow_R: [-0.3, 0, 0] }],
      [0.8, { ...crouch(0.6), spine: [0.35, 0, 0], head: [0.3, 0, 0], shoulder_R: [-1.0, -0.3, -0.1], elbow_R: [-0.3, 0, 0] }],
      [1.1, NEUTRAL]
    ],
    events: [[0.45, 'touch']]
  },
  // Sit on a bench (held): the seat carries the pelvis, short legs dangle, hands on the lap
  sit: {
    duration: 0.6,
    hold: true,
    keys: [
      [0, NEUTRAL],
      [0.6, {
        hips: [0, 0, 0, -0.12], hip_L: [-1.5, 0, 0.06], hip_R: [-1.5, 0, -0.06], knee_L: [1.35, 0, 0], knee_R: [1.35, 0, 0],
        ankle_L: [0.15, 0, 0], ankle_R: [0.15, 0, 0], spine: [-0.06, 0, 0], ...arms(-0.55, -0.95, 0.06)
      }]
    ],
    events: []
  },
  // Chatting: an open hand comes up, a little nod
  talk: {
    duration: 1.6,
    keys: [
      [0, NEUTRAL],
      [0.35, { shoulder_R: [-0.7, 0, -0.25], elbow_R: [-1.2, 0, 0], wrist_R: [0, 0, -0.3], head: [0.1, 0, 0.06] }],
      [0.8, { shoulder_R: [-0.85, 0.2, -0.3], elbow_R: [-1.0, 0, 0], wrist_R: [0, 0, -0.2], head: [-0.05, 0, -0.04] }],
      [1.2, { shoulder_R: [-0.7, -0.1, -0.25], elbow_R: [-1.2, 0, 0], head: [0.08, 0, 0] }],
      [1.6, NEUTRAL]
    ],
    events: []
  },
  // Emotes
  happy: {
    duration: 0.8,
    keys: [
      [0, NEUTRAL],
      [0.2, { ...arms(-2.6, -0.2, 0.35), hips: [0, 0, 0, 0.07], head: [-0.2, 0, 0] }],
      [0.4, { ...arms(-2.8, -0.1, 0.45), hips: [0, 0, 0, 0.0], head: [-0.2, 0, 0] }],
      [0.8, NEUTRAL]
    ],
    events: []
  },
  surprised: {
    duration: 0.7,
    keys: [[0, NEUTRAL], [0.15, { ...arms(-0.5, -1.2, 0.5), spine: [-0.18, 0, 0], head: [-0.2, 0, 0] }], [0.7, NEUTRAL]],
    events: []
  },
  tired: {
    duration: 1.4,
    keys: [[0, NEUTRAL], [0.4, { spine: [0.42, 0, 0], head: [0.45, 0, 0], ...arms(-0.25, -0.05, 0) }], [1.0, { spine: [0.45, 0, 0], head: [0.5, 0, 0], ...arms(-0.3, -0.05, 0) }], [1.4, NEUTRAL]],
    events: []
  }
};

const ease = (t) => t * t * (3 - 2 * t);
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _a = new THREE.Quaternion();

/** The pose of `clip` at time t: bone -> [x, y, z, dy]; keys missing a bone ease from/to zero. */
export function samplePose(clip, t) {
  const keys = clip.keys;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, p1] = keys[i];
    if (t > t1) continue;
    const [t0, p0] = keys[i - 1];
    const k = ease((t - t0) / (t1 - t0 || 1));
    const out = {};
    for (const bone of new Set([...Object.keys(p0), ...Object.keys(p1)])) {
      const a = p0[bone] || [0, 0, 0, 0], b = p1[bone] || [0, 0, 0, 0];
      out[bone] = [0, 1, 2, 3].map((j) => (a[j] || 0) + ((b[j] || 0) - (a[j] || 0)) * k);
    }
    return out;
  }
  return keys.at(-1)[1];
}

/** Bones a clip touches: its mask, or every bone named in any key. */
export function clipBones(clip) {
  return clip.mask || [...new Set(clip.keys.flatMap(([, pose]) => Object.keys(pose)))];
}

/**
 * Plays one clip at a time over the procedural pose of a person (call after animateNpc each
 * frame). Blends in and out over `blend` seconds; fires the clip's events once each; a `hold`
 * clip stays on its last pose until stopped.
 */
export class ClipPlayer {
  constructor(person, { blend = 0.14 } = {}) {
    this.p = person;
    this.blend = blend;
    this.clip = null;
    this.name = null;
    this.time = 0;
    this.weight = 0;
    this.fading = null; // the pose being blended out: { pose, bones, weight }
  }

  /** Start a clip. onEvent(name) fires on its event frames, onEnd() when it finishes. */
  play(name, { onEvent, onEnd } = {}) {
    if (this.clip) this.fading = { pose: samplePose(this.clip, this.time), bones: clipBones(this.clip), weight: this.weight };
    this.clip = CLIPS[name];
    this.name = name;
    this.time = 0;
    this.weight = this.fading ? 1 : 0;
    this.fired = new Set();
    this.onEvent = onEvent;
    this.onEnd = onEnd;
  }

  stop() {
    if (this.clip) this.fading = { pose: samplePose(this.clip, this.time), bones: clipBones(this.clip), weight: this.weight };
    this.clip = null;
    this.name = null;
  }

  /** True while a clip owns the body: until it ends, or (held clips) until its last pose is reached. Masked overlays never lock. */
  get busy() {
    const c = this.clip;
    return !!c && !c.mask && (!c.hold || this.time < c.duration);
  }

  update(dt) {
    const step = dt / this.blend;
    if (this.fading) {
      this.fading.weight -= step;
      if (this.fading.weight <= 0) this.fading = null;
      else this.apply(this.fading.pose, this.fading.bones, this.fading.weight);
    }
    if (!this.clip) return;
    this.time += dt;
    const clip = this.clip;
    for (const [t, name] of clip.events) {
      if (this.time >= t && !this.fired.has(t)) {
        this.fired.add(t);
        this.onEvent?.(name);
      }
    }
    const end = this.time >= clip.duration;
    const t = Math.min(this.time, clip.duration);
    // Ease in at the start; a clip that returns to neutral needs no fade out, a held one stays
    this.weight = Math.min(1, this.weight + step);
    this.apply(samplePose(clip, t), clipBones(clip), this.weight);
    if (end && !clip.hold) {
      this.clip = null;
      this.name = null;
      const done = this.onEnd;
      this.onEnd = null;
      done?.();
    }
  }

  /** Slerp each bone from its procedural rotation towards the clip's, by weight. */
  apply(pose, bones, weight) {
    const B = this.p.bones;
    for (const name of bones) {
      const b = B[name];
      if (!b) continue;
      const v = pose[name] || [0, 0, 0, 0];
      _q.multiplyQuaternions(b.rest, _a.setFromEuler(_e.set(v[0], v[1], v[2])));
      b.node.quaternion.slerp(_q, weight);
      if (name === 'hips' && v[3]) b.node.position.y += v[3] * weight;
    }
  }
}
