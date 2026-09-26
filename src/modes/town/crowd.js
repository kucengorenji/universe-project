import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../map/mapGenerator.js';

// Stylised people, drawn as instanced body parts (4 draw calls for the whole
// crowd, however many walkers there are). Each person is a few boxes posed per
// frame: legs and arms swing with the walk cycle, the body bobs.
//
// The player avatar is person #0 of the same crowd, unless a rigged model is
// provided (see TownMode), in which case #0 is hidden.

const PART = {
  // name: [geometry builder, pivot (x, y, z) in the body frame]
  head: () => {
    const g = mergeGeometries([
      new THREE.BoxGeometry(0.26, 0.28, 0.26).translate(0, 0.14, 0).toNonIndexed(),
      new THREE.BoxGeometry(0.29, 0.1, 0.29).translate(0, 0.27, -0.01).toNonIndexed() // hair / cap
    ]);
    return g;
  },
  torso: () =>
    mergeGeometries([
      new THREE.BoxGeometry(0.44, 0.52, 0.26).translate(0, 0.26, 0).toNonIndexed(),
      new THREE.BoxGeometry(0.4, 0.16, 0.24).translate(0, -0.06, 0).toNonIndexed()
    ]),
  arm: () => new THREE.BoxGeometry(0.11, 0.58, 0.12).translate(0, -0.27, 0).toNonIndexed(),
  leg: () => new THREE.BoxGeometry(0.15, 0.82, 0.16).translate(0, -0.41, 0).toNonIndexed()
};

const SKIN = [0xf1c9a5, 0xd9a47a, 0xa8714a, 0x7a4c2e, 0xf5d6bd];
const SHIRT_FANTASY = [0x8a5a33, 0x4a6a3a, 0x7a3a2e, 0x3f5f8a, 0xb89a5a, 0x6b4a6e];
const SHIRT_MODERN = [0x3f6fb0, 0xc4513a, 0xf2f2ee, 0x2f2f33, 0xe0b030, 0x3f8f5a, 0x9aa3ad];
const PANTS = [0x3a3a44, 0x5a4a3a, 0x2f3e5a, 0x6b5a45];

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _c = new THREE.Color();

export class Crowd {
  constructor(count, { modern, seed, shadows }) {
    this.count = count;
    this.people = [];
    this.group = new THREE.Group();
    const mat = new THREE.MeshToonMaterial({ color: 0xffffff });
    this.material = mat;
    const make = (geo, n) => {
      geo.computeVertexNormals();
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.castShadow = shadows;
      m.frustumCulled = false; // people move: bounds would go stale
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
      return m;
    };
    this.head = make(PART.head(), count);
    this.torso = make(PART.torso(), count);
    this.arms = make(PART.arm(), count * 2);
    this.legs = make(PART.leg(), count * 2);
    const rng = mulberry32(seed);
    const shirts = modern ? SHIRT_MODERN : SHIRT_FANTASY;
    for (let i = 0; i < count; i++) {
      const skin = SKIN[Math.floor(rng() * SKIN.length)];
      const shirt = shirts[Math.floor(rng() * shirts.length)];
      const pants = PANTS[Math.floor(rng() * PANTS.length)];
      const height = 0.92 + rng() * 0.16;
      this.head.setColorAt(i, _c.set(skin));
      this.torso.setColorAt(i, _c.set(shirt));
      this.arms.setColorAt(i * 2, _c.set(shirt));
      this.arms.setColorAt(i * 2 + 1, _c.set(shirt));
      this.legs.setColorAt(i * 2, _c.set(pants));
      this.legs.setColorAt(i * 2 + 1, _c.set(pants));
      this.people.push({ x: 0, y: 0, z: 0, yaw: 0, phase: rng() * 10, speed: 0, height, visible: true, jump: 0 });
    }
    [this.head, this.torso, this.arms, this.legs].forEach((m) => (m.instanceColor.needsUpdate = true));
  }

  /** Recolour person i (the player wears the faction colour). */
  dress(i, { shirt, pants, skin }) {
    if (skin !== undefined) this.head.setColorAt(i, _c.set(skin));
    if (shirt !== undefined) {
      this.torso.setColorAt(i, _c.set(shirt));
      this.arms.setColorAt(i * 2, _c.set(shirt));
      this.arms.setColorAt(i * 2 + 1, _c.set(shirt));
    }
    if (pants !== undefined) {
      this.legs.setColorAt(i * 2, _c.set(pants));
      this.legs.setColorAt(i * 2 + 1, _c.set(pants));
    }
    [this.head, this.torso, this.arms, this.legs].forEach((m) => (m.instanceColor.needsUpdate = true));
  }

  /** Write every person's pose into the instance buffers. */
  pose() {
    for (let i = 0; i < this.count; i++) {
      const p = this.people[i];
      if (!p.visible) {
        _m.makeScale(0, 0, 0);
        this.head.setMatrixAt(i, _m);
        this.torso.setMatrixAt(i, _m);
        this.arms.setMatrixAt(i * 2, _m);
        this.arms.setMatrixAt(i * 2 + 1, _m);
        this.legs.setMatrixAt(i * 2, _m);
        this.legs.setMatrixAt(i * 2 + 1, _m);
        continue;
      }
      const run = THREE.MathUtils.clamp(p.speed / 3.2, 0, 1.6);
      const swing = Math.sin(p.phase) * (0.1 + Math.min(1, p.speed / 1.4) * 0.45 + run * 0.2);
      const bob = Math.abs(Math.cos(p.phase)) * 0.05 * Math.min(1, p.speed) + p.jump;
      const k = p.height;
      // Body frame: position, yaw (front = +Z), uniform height scale
      const body = _m2.compose(_v.set(p.x, p.y + bob, p.z), _q.setFromEuler(_e.set(0, p.yaw, 0)), _s.setScalar(k));
      const part = (mesh, idx, px, py, pz, rx = 0) => {
        _m.compose(_v.set(px, py, pz), _q.setFromEuler(_e.set(rx, 0, 0)), _s.set(1, 1, 1));
        mesh.setMatrixAt(idx, _m.premultiply(body));
      };
      const lean = Math.min(0.25, p.speed * 0.04);
      part(this.torso, i, 0, 0.94, 0, lean);
      part(this.head, i, 0, 1.47, lean * 0.4);
      part(this.arms, i * 2, -0.285, 1.42, 0, swing);
      part(this.arms, i * 2 + 1, 0.285, 1.42, 0, -swing);
      part(this.legs, i * 2, -0.1, 0.86, 0, -swing * 1.1);
      part(this.legs, i * 2 + 1, 0.1, 0.86, 0, swing * 1.1);
    }
    [this.head, this.torso, this.arms, this.legs].forEach((m) => (m.instanceMatrix.needsUpdate = true));
  }

  dispose() {
    [this.head, this.torso, this.arms, this.legs].forEach((m) => {
      m.geometry.dispose();
      m.dispose();
    });
    this.material.dispose();
  }
}

/**
 * Walkers following the street polylines back and forth on one side of the
 * street, at their own pace. Cheap: no pathfinding, no avoidance.
 */
export class Pedestrians {
  constructor(crowd, first, lines, rng, heightAt) {
    this.crowd = crowd;
    this.heightAt = heightAt;
    this.walkers = [];
    const usable = lines.filter((l) => l.pts.length >= 2);
    if (!usable.length) return;
    for (let i = first; i < crowd.count; i++) {
      const line = usable[Math.floor(rng() * usable.length)];
      const lens = [0];
      for (let k = 1; k < line.pts.length; k++) lens.push(lens[k - 1] + Math.hypot(line.pts[k].x - line.pts[k - 1].x, line.pts[k].z - line.pts[k - 1].z));
      const total = lens[lens.length - 1];
      if (total < 8) continue;
      this.walkers.push({
        i,
        line,
        lens,
        total,
        s: rng() * total,
        dir: rng() < 0.5 ? 1 : -1,
        side: (rng() < 0.5 ? -1 : 1) * (line.w / 2 - 0.9 + rng() * 0.6),
        speed: 1.0 + rng() * 0.6,
        pause: 0
      });
    }
  }

  update(dt, near) {
    const people = this.crowd.people;
    for (const w of this.walkers) {
      const p = people[w.i];
      if (w.pause > 0) {
        w.pause -= dt;
        p.speed = 0;
        continue;
      }
      w.s += w.speed * w.dir * dt;
      if (w.s > w.total || w.s < 0) {
        w.dir *= -1;
        w.s = THREE.MathUtils.clamp(w.s, 0, w.total);
        w.pause = Math.random() < 0.3 ? 1 + Math.random() * 3 : 0;
      }
      let k = 1;
      while (k < w.lens.length - 1 && w.lens[k] < w.s) k++;
      const a = w.line.pts[k - 1];
      const b = w.line.pts[k];
      const t = (w.s - w.lens[k - 1]) / (w.lens[k] - w.lens[k - 1] || 1);
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      // Keep to the right-hand side of the walking direction
      const side = w.side * w.dir;
      p.x = a.x + dx * t - (dz / len) * side;
      p.z = a.z + dz * t + (dx / len) * side;
      p.y = this.heightAt(p.x, p.z);
      p.yaw = Math.atan2(dx * w.dir, dz * w.dir);
      p.speed = w.speed;
      p.phase += dt * w.speed * 5.2;
      p.visible = near ? near(p.x, p.z) : true;
    }
  }
}
