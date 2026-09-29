import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { getToonGradient } from '../../render/assetLibrary.js';
import { locomotionClips, animatePerson } from './peopleMotion.js';
export { animatePerson } from './peopleMotion.js';
import { appearanceMaterial, makeFace } from './peopleAppearance.js';
import { disposePerson } from './personLifecycle.js';
export { disposePerson } from './personLifecycle.js';

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
export function makePerson(gltf, outfit, { shadows = true, color = null, appearanceSeed = null } = {}) {
  const root = cloneSkinned(gltf.scene);
  const drop = [];
  let found = false;
  const personalMaterial = appearanceSeed === null ? null : appearanceMaterial(outfit, appearanceSeed);
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.name !== outfit) {
      drop.push(o);
      return;
    }
    found = true;
    o.material = personalMaterial || (color ? new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient(), color }) : peopleMaterial());
    o.castShadow = shadows;
    o.frustumCulled = false;
  });
  if (!found) return null;
  drop.forEach((o) => o.parent.remove(o));
  let face = null;
  if (personalMaterial) { face=makeFace(appearanceSeed); root.getObjectByName('head')?.add(face); }
  const mixer = new THREE.AnimationMixer(root);
  const actions = {};
  for (const clip of locomotionClips(gltf)) {
    const a = mixer.clipAction(clip);
    a.play();
    a.setEffectiveWeight(0);
    actions[clip.name] = a;
  }
  if (!actions.idle || !actions.walk) return null;
  actions.idle.setEffectiveWeight(1);
  return { root, mixer, actions, pose: 'idle', personalMaterial, outfit, face, gaitPhase: 0, animSpeed: 0 };
}

export class RiggedPeople {
  constructor(gltf, scene, { count, modern, shadows, seed = 1 }) {
    this.pool = [];
    const list = OUTFITS[modern ? 'modern' : 'fantasy'];
    this.outfits = list;
    this.seed = seed;
    for (let i = 0; i < count; i++) {
      const p = makePerson(gltf, list[(i + seed) % list.length], { shadows, appearanceSeed: seed * 131 + i });
      if (!p) continue;
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
    const dist = (i) => Math.hypot(people[i].x - cam.x, people[i].z - cam.z);
    // Hysteresis: a rig keeps its walker until it is clearly out of reach, so
    // people at the edge do not swap between rig and instance every tick
    const free = [];
    const held = new Set();
    for (const r of this.pool) {
      if (r.index >= 0 && dist(r.index) < reach * 1.25) held.add(r.index);
      else {
        if (r.index >= 0) people[r.index].visible = true;
        r.index = -1;
        free.push(r);
      }
    }
    if (!free.length) return;
    const near = [];
    for (const w of walkers) {
      if (held.has(w.i)) continue;
      const d = dist(w.i);
      if (d < reach) near.push([d, w.i]);
    }
    near.sort((a, b) => a[0] - b[0]);
    for (const [, i] of near) {
      const slot=free.findIndex(r=>r.outfit===this.outfits[(i+this.seed)%this.outfits.length]);
      if(slot<0)continue;
      const [r] = free.splice(slot,1);
      const identity=this.seed*131+i;
      r.personalMaterial?.userData.setSeed(identity);
      if(r.face){r.face.removeFromParent();r.face=makeFace(identity);r.root.getObjectByName('head')?.add(r.face);}
      r.index = i;
      r.root.scale.setScalar(people[i].height);
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
      r.root.rotation.y += Math.atan2(Math.sin(p.yaw-r.root.rotation.y),Math.cos(p.yaw-r.root.rotation.y))*(1-Math.exp(-dt*12));
      animatePerson(r, dt, p.speed, { panic: fleeing.has(r.index) && p.speed > 3 });
    }
  }

  dispose() {
    for (const r of this.pool) disposePerson(r);
    this.pool = [];
  }
}
