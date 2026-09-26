import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { getToonGradient } from '../../render/assetLibrary.js';

// Rigged people from character.glb: one shared skeleton layout, ten outfits
// (vertex-coloured, one draw call each) and clips idle / walk / run / sit /
// sleep / drive / panic. Close to the camera, a small pool of these stands in
// for the instanced crowd; far away the cheap crowd takes over again.

const OUTFITS = {
  modern: ['casual_m', 'casual_f', 'worker', 'business', 'elder', 'casual_f'],
  fantasy: ['peasant', 'townsfolk_f', 'guard', 'elder', 'peasant', 'casual_m']
};

let sharedMaterial = null;
function peopleMaterial() {
  sharedMaterial ||= new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() });
  return sharedMaterial;
}

/** One rigged person with a single outfit and its own mixer. */
export function makePerson(gltf, outfit, { shadows = true, color = null } = {}) {
  const root = cloneSkinned(gltf.scene);
  const drop = [];
  let found = false;
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.name !== outfit) {
      drop.push(o);
      return;
    }
    found = true;
    o.material = color ? new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient(), color }) : peopleMaterial();
    o.castShadow = shadows;
    o.frustumCulled = false;
  });
  if (!found) return null;
  drop.forEach((o) => o.parent.remove(o));
  const mixer = new THREE.AnimationMixer(root);
  const actions = {};
  for (const clip of gltf.animations) {
    const a = mixer.clipAction(clip);
    a.play();
    a.setEffectiveWeight(0);
    actions[clip.name] = a;
  }
  if (!actions.idle || !actions.walk) return null;
  actions.idle.setEffectiveWeight(1);
  return { root, mixer, actions, pose: 'idle' };
}

/** Blend idle / walk / run (or panic) from a speed; or hold one pose (sit, sleep, drive). */
export function animatePerson(p, dt, speed, { panic = false, pose = null } = {}) {
  const A = p.actions;
  const sm = THREE.MathUtils.smoothstep;
  const set = (name, w) => A[name] && A[name].setEffectiveWeight(w);
  if (pose && A[pose]) {
    for (const k of Object.keys(A)) set(k, k === pose ? 1 : 0);
  } else {
    const idle = 1 - sm(speed, 0.1, 0.9);
    const run = sm(speed, 2.8, 4.6);
    const walk = Math.max(0, 1 - idle - run);
    set('idle', idle);
    set('walk', walk);
    set('run', panic ? 0 : run);
    set('panic', panic ? run : 0);
    set('sit', 0);
    set('sleep', 0);
    set('drive', 0);
    A.walk.setEffectiveTimeScale(Math.max(0.4, speed / 1.5));
    if (A.run) A.run.setEffectiveTimeScale(Math.max(0.6, speed / 5.2));
  }
  p.mixer.update(dt);
}

export class RiggedPeople {
  constructor(gltf, scene, { count, modern, shadows, seed = 1 }) {
    this.pool = [];
    const list = OUTFITS[modern ? 'modern' : 'fantasy'];
    for (let i = 0; i < count; i++) {
      const p = makePerson(gltf, list[(i + seed) % list.length], { shadows });
      if (!p) continue;
      // Every seventh one is a child
      if (i % 7 === 3) p.root.scale.setScalar(0.72);
      p.root.visible = false;
      p.index = -1;
      scene.add(p.root);
      this.pool.push(p);
    }
    this.timer = 0;
    this.scene = scene;
  }

  /** Give the pool to the walkers nearest the camera (every quarter second). */
  assign(walkers, people, cam, reach = 70) {
    const near = [];
    for (const w of walkers) {
      const p = people[w.i];
      const d = Math.hypot(p.x - cam.x, p.z - cam.z);
      if (d < reach) near.push([d, w]);
    }
    near.sort((a, b) => a[0] - b[0]);
    const chosen = new Set(near.slice(0, this.pool.length).map(([, w]) => w.i));
    // Keep existing assignments where possible (no popping between rigs)
    const free = [];
    for (const r of this.pool) {
      if (r.index >= 0 && chosen.has(r.index)) chosen.delete(r.index);
      else {
        r.index = -1;
        free.push(r);
      }
    }
    for (const i of chosen) {
      const r = free.pop();
      if (!r) break;
      r.index = i;
    }
  }

  update(dt, walkers, people, cam) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.assign(walkers, people, cam);
      this.timer = 0.25;
    }
    const fleeing = new Set(walkers.filter((w) => w.flee).map((w) => w.i));
    for (const r of this.pool) {
      if (r.index < 0) {
        r.root.visible = false;
        continue;
      }
      const p = people[r.index];
      r.root.visible = true;
      p.visible = false; // the instanced stand-in hides
      r.root.position.set(p.x, p.y, p.z);
      r.root.rotation.y = p.yaw;
      animatePerson(r, dt, p.speed, { panic: fleeing.has(r.index) && p.speed > 3 });
    }
  }

  dispose() {
    for (const r of this.pool) {
      r.mixer.stopAllAction();
      this.scene.remove(r.root);
    }
    this.pool = [];
  }
}
