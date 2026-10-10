import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { createValleyMaterial } from '../render/valleyMaterial.js';
import { mulberry32 } from '../../math/random.js';

// Farm animals (docs/FARM_PLAN.md §5.4, milestone V4) from tools/blender/valley/build_valley_animals.py:
// pivots become bones, rigid parts merge into one skinned mesh per animal (one draw call, plus
// its ink outline). Poses are procedural: gait, pecking, wing flaps, tail wags, head turns,
// hops and sleep. Behaviour:
//   chicken: wanders and pecks near the coop; bolts from a running player; comes closer to a
//            player standing still with seeds in hand; can be lifted and thrown (flaps down).
//   cow:     grazes by the barn; turns its head to follow the player; loves being petted.
//   dog:     follows the player around; barks at chickens; wags when petted.
// At night they all settle down to sleep.

const strip = (name) => name.replace(/\.?\d{3}$/, '');
const OUTLINE = new THREE.Color('#5a463c'); // multiplies the part's own colour: a soft coloured line

/** Load the pack: one rigid-skinned template per species. */
export async function loadAnimals(url) {
  return animalTemplates(await new GLTFLoader().loadAsync(url));
}

export function animalTemplates(gltf) {
  const out = {};
  for (const holder of [...gltf.scene.children]) {
    const id = strip(holder.name).replace(/^animal_/, '');
    holder.traverse((o) => { o.name = strip(o.name); });
    out[id] = rigidTemplate(holder.children[0]);
  }
  return out;
}

/** Pivots -> bones, mesh parts -> one geometry weighted fully to their pivot. */
function rigidTemplate(source) {
  source.parent?.updateMatrixWorld(true);
  const toRoot = source.matrixWorld.clone().invert();
  const bones = [], boneOf = new Map();
  source.traverse((o) => {
    if (o.isMesh) return;
    const b = new THREE.Bone();
    b.name = o === source ? 'root' : o.name;
    if (o !== source) b.position.copy(o.position), b.quaternion.copy(o.quaternion);
    boneOf.set(o, bones.length);
    bones.push(b);
  });
  for (const [o, i] of boneOf) if (o !== source) bones[boneOf.get(o.parent)].add(bones[i]);
  const parts = [];
  source.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', mesh.geometry.attributes.position);
    g.setAttribute('normal', mesh.geometry.attributes.normal);
    const n = mesh.geometry.attributes.position.count;
    g.setIndex(mesh.geometry.index || Array.from({ length: n }, (_, i) => i));
    const geo = g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld));
    // Material colour times the painted shading baked in Blender (COLOR_0), when there is one
    const c = mesh.material.color, colors = new Float32Array(n * 3), paint = mesh.geometry.attributes.color;
    for (let i = 0; i < n; i++) {
      c.toArray(colors, i * 3);
      if (paint) for (let k = 0; k < 3; k++) colors[i * 3 + k] *= paint.getComponent(i, k);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const bone = boneOf.get(mesh.parent) ?? 0;
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(n * 4).map((_, k) => (k % 4 === 0 ? bone : 0)), 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(n * 4).map((_, k) => (k % 4 === 0 ? 1 : 0)), 4));
    parts.push(geo);
  });
  const geometry = mergeGeometries(parts);
  geometry.computeBoundingSphere();
  const mesh = new THREE.SkinnedMesh(geometry, createValleyMaterial({ vertexColors: true, brush: 0.05, snow: false }));
  mesh.name = 'animal';
  const root = new THREE.Group();
  root.add(bones[0], mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  return { root, triangles: geometry.index.count / 3 };
}

let outlineMaterial = null;
function outline() {
  if (outlineMaterial) return outlineMaterial;
  outlineMaterial = new THREE.MeshBasicMaterial({ color: OUTLINE, side: THREE.BackSide, vertexColors: true });
  outlineMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(objectNormal) * 0.009;');
  };
  outlineMaterial.customProgramCacheKey = () => 'valley-animal-outline-colour';
  return outlineMaterial;
}

const SPECIES = {
  chicken: { walk: 0.8, run: 3.2, radius: 6.5, stride: 6, size: 0.18 },
  cow: { walk: 0.45, run: 0.45, radius: 3.5, stride: 2.2, size: 0.7 },
  dog: { walk: 1.4, run: 3.6, radius: 7, stride: 4, size: 0.3 }
};

export class Animal {
  constructor(templates, species, home, { shadows = true, seed = 1 } = {}) {
    this.species = species;
    this.cfg = SPECIES[species];
    this.home = home; // [x, z]
    this.root = cloneSkinned(templates[species].root);
    const mesh = this.root.getObjectByName('animal');
    mesh.castShadow = shadows;
    mesh.frustumCulled = false;
    const ink = new THREE.SkinnedMesh(mesh.geometry, outline());
    ink.frustumCulled = false;
    mesh.parent.add(ink);
    ink.bind(mesh.skeleton, mesh.bindMatrix);
    this.bones = {};
    this.root.traverse((o) => { if (o.isBone) this.bones[o.name] = { node: o, y: o.position.y }; });
    this.state = 'wander';
    this.target = null;
    this.wait = seed % 3;
    this.speed = 0;
    this.phase = seed;
    this.t = seed * 1.7;
    this.mood = 0; // > 0: happy (tail, hop), counts down
    this.look = 0; // head yaw
    this.rng = mulberry32(seed * 7919);
    this.held = false; // lifted or flying: the pickup system moves it
  }

  /**
   * One step. world: { ground, walkable, player: { p, speed, seeds }, chickens, night, icons }.
   */
  update(dt, world) {
    this.t += dt;
    this.mood = Math.max(0, this.mood - dt);
    const pos = this.root.position;
    if (this.held) {
      this.pose(dt, 0, { flap: this.species === 'chicken' });
      return;
    }
    const { player } = world;
    const toPlayer = new THREE.Vector2(player.p.x - pos.x, player.p.z - pos.z), dist = toPlayer.length();
    let goal = null, speed = 0, lookAt = null;
    if (world.night) {
      // Back home and asleep
      if (this.state !== 'sleep') this.state = Math.hypot(pos.x - this.home[0], pos.z - this.home[1]) > 1.5 ? 'gohome' : 'sleep';
      if (this.state === 'gohome') goal = this.home, speed = this.cfg.walk * 1.4;
      if (this.state === 'sleep' && this.rng() < dt * 0.2) world.icons.show(this.root, 'zzz', 1.6, this.cfg.size * 2 + 0.3);
    } else {
      if (this.state === 'sleep' || this.state === 'gohome') this.state = 'wander';
      if (this.species === 'chicken') ({ goal, speed, lookAt } = this.chicken(dt, world, toPlayer, dist));
      if (this.species === 'cow') ({ goal, speed, lookAt } = this.cow(dt, world, dist));
      if (this.species === 'dog') ({ goal, speed, lookAt } = this.dog(dt, world, toPlayer, dist));
    }
    let moved = 0;
    if (goal && speed > 0) {
      const dx = goal[0] - pos.x, dz = goal[1] - pos.z, d = Math.hypot(dx, dz);
      if (d > 0.15) {
        const step = Math.min(d, speed * dt), nx = pos.x + (dx / d) * step, nz = pos.z + (dz / d) * step;
        if (world.walkable(nx, nz)) { pos.x = nx; pos.z = nz; moved = step / dt; }
        else this.target = null; // blocked: pick somewhere else
        this.turnTo(Math.atan2(dx, dz), dt, 8);
      } else if (this.state === 'gohome') this.state = 'sleep';
    }
    pos.y = world.ground.surfaceAt(pos.x, pos.z);
    // Head: towards whatever it is watching, within its neck's reach
    let want = 0;
    if (lookAt) {
      const a = Math.atan2(lookAt[0] - pos.x, lookAt[1] - pos.z) - this.root.rotation.y;
      want = THREE.MathUtils.clamp(Math.atan2(Math.sin(a), Math.cos(a)), -0.9, 0.9);
    }
    this.look += (want - this.look) * (1 - Math.exp(-dt * 6));
    this.speed += (moved - this.speed) * (1 - Math.exp(-dt * 10));
    this.pose(dt, this.speed, { peck: this.state === 'peck', sleep: this.state === 'sleep', flap: this.state === 'flee' && this.species === 'chicken', bark: this.barking > 0 });
  }

  chicken(dt, world, toPlayer, dist) {
    const { player } = world;
    if (this.state === 'flee' && (this.fleeFor -= dt) <= 0) this.state = 'wander';
    if (dist < 2.6 && player.speed > 3 && this.state !== 'flee') {
      this.state = 'flee';
      this.fleeFor = 1.6;
      this.startles = (this.startles || 0) + 1;
      world.icons.show(this.root, 'alert', 1, 0.75);
    }
    if (this.state === 'flee') {
      const away = toPlayer.clone().normalize().multiplyScalar(-3);
      return { goal: [this.root.position.x + away.x, this.root.position.z + away.y], speed: this.cfg.run };
    }
    // Seeds in a still hand: come closer, hopeful
    if (player.seeds && player.speed < 0.1 && dist < 6) {
      if (this.state !== 'approach') world.icons.show(this.root, 'note', 1.2, 0.75);
      this.state = 'approach';
      return { goal: dist > 0.9 ? [player.p.x, player.p.z] : null, speed: 1.2, lookAt: [player.p.x, player.p.z] };
    }
    if (this.state === 'approach') this.state = 'wander';
    return this.wander(dt, world, true);
  }

  cow(dt, world, dist) {
    const r = this.wander(dt, world, true);
    if (dist < 6) r.lookAt = [world.player.p.x, world.player.p.z];
    if (this.mood > 0) r.speed = 0;
    return r;
  }

  dog(dt, world, toPlayer, dist) {
    const { player } = world;
    this.barking = Math.max(0, (this.barking || 0) - dt);
    const chick = world.chickens.find((c) => !c.held && c.root.position.distanceTo(this.root.position) < 2.4);
    if (chick && this.barking <= 0 && this.rng() < dt * 0.8) {
      this.barking = 0.8;
      world.icons.show(this.root, 'alert', 0.9, 0.8);
      chick.state = 'flee';
      chick.fleeFor = 1.2;
    }
    if (dist < 14 && dist > 2.4 && this.mood <= 0) {
      this.state = 'follow'; // runs to catch up, then trots alongside (faster than a walking player)
      return { goal: [player.p.x - (toPlayer.x / dist) * 1.8, player.p.z - (toPlayer.y / dist) * 1.8], speed: dist > 4 ? this.cfg.run : 2.3, lookAt: [player.p.x, player.p.z] };
    }
    if (dist <= 2.4) {
      this.state = 'sit';
      this.turnTo(Math.atan2(toPlayer.x, toPlayer.y), dt, 4);
      return { goal: null, speed: 0, lookAt: [player.p.x, player.p.z] };
    }
    return this.wander(dt, world, false);
  }

  /** Amble between random points around home; pecking/grazing pauses in between. */
  wander(dt, world, peck) {
    if (this.wait > 0) {
      this.wait -= dt;
      this.state = peck ? 'peck' : 'idle';
      return { goal: null, speed: 0 };
    }
    if (!this.target) {
      for (let k = 0; k < 8 && !this.target; k++) {
        const a = this.rng() * Math.PI * 2, r = this.rng() * this.cfg.radius;
        const x = this.home[0] + Math.cos(a) * r, z = this.home[1] + Math.sin(a) * r;
        if (world.walkable(x, z)) this.target = [x, z];
      }
    }
    if (!this.target) return { goal: null, speed: 0 };
    this.state = 'wander';
    const pos = this.root.position;
    if (Math.hypot(this.target[0] - pos.x, this.target[1] - pos.z) < 0.2) {
      this.target = null;
      this.wait = 1.5 + this.rng() * 3;
      return { goal: null, speed: 0 };
    }
    return { goal: this.target, speed: this.cfg.walk };
  }

  turnTo(angle, dt, rate) {
    let d = angle - this.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.root.rotation.y += d * (1 - Math.exp(-dt * rate));
  }

  /** Petted (or a chicken set down): a happy moment. */
  cheer(icons) {
    this.mood = 2.6;
    icons.show(this.root, 'heart', 1.6, this.cfg.size * 2 + 0.45);
  }

  pose(dt, speed, { peck = false, sleep = false, flap = false, bark = false } = {}) {
    const B = this.bones, t = this.t, set = (name, x = 0, y = 0, z = 0) => B[name] && B[name].node.rotation.set(x, y, z);
    this.phase += dt * speed * this.cfg.stride;
    const w = Math.min(1, speed / 0.6), s = Math.sin(this.phase), happy = this.mood > 0 ? 1 : 0;
    const body = B.body.node;
    body.position.y = B.body.y + Math.abs(Math.cos(this.phase)) * 0.025 * w * this.cfg.size * 6 - (sleep ? this.cfg.size * 0.45 : 0)
      + happy * Math.max(0, Math.sin(t * 9)) * 0.06;
    set('body', sleep ? 0.05 : 0, 0, s * 0.04 * w);
    // Head: watches, pecks (chicken) or grazes (cow) when idle, droops asleep, bobs barking
    const pecking = peck ? Math.max(0, Math.sin(t * (this.species === 'chicken' ? 7 : 1.5))) ** 4 : 0;
    const dip = this.species === 'chicken' ? 0.9 : this.species === 'cow' ? 0.55 : 0;
    set('neck', pecking * dip + (sleep ? 0.5 : 0) + (bark ? Math.sin(t * 22) * 0.12 : 0), this.look * 0.5, 0);
    set('head', pecking * dip * 0.5 + (sleep ? 0.2 : 0) - happy * 0.15, this.look * 0.5, happy * Math.sin(t * 6) * 0.15);
    // Legs: alternate (chicken) or diagonal pairs (cow, dog); folded asleep
    const amp = 0.55 * w;
    if (this.species === 'chicken') {
      set('leg_L', sleep ? -0.4 : s * amp);
      set('leg_R', sleep ? -0.4 : -s * amp);
    } else {
      set('leg_FL', s * amp); set('leg_BR', s * amp);
      set('leg_FR', -s * amp); set('leg_BL', -s * amp);
    }
    // Wings beat when it flees or flies; tails wag with joy (and a slow swish for the cow)
    const beat = flap ? Math.sin(t * 30) * 0.9 : 0;
    set('wing_L', 0, 0, -0.1 - Math.abs(beat));
    set('wing_R', 0, 0, 0.1 + Math.abs(beat));
    const wag = this.species === 'dog' ? (this.state === 'follow' || this.state === 'sit' || happy ? 0.6 : 0.15) * Math.sin(t * (happy ? 18 : 10))
      : this.species === 'cow' ? (happy ? 0.6 * Math.sin(t * 10) : 0.25 * Math.sin(t * 1.3)) : 0;
    set('tail', this.species === 'dog' ? -0.3 : 0, wag, this.species === 'cow' ? wag * 0.4 : 0);
  }
}

