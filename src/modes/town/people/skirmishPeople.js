import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import WALK from './townWalk.json' with { type: 'json' };
import { ASSETS } from '../../../render/assetManifest.js';
import { loadSoldierTemplate, makeSoldier, disposeSoldier, setLod } from '../../../skirmish/units/vcSoldiers.js';
import HERO_LOOKS from '../../../skirmish/units/heroLooks.json' with { type: 'json' };
import { appearanceFor } from './peopleAppearance.js';
import { seedFor } from '../../../world/identity.js';

let templates;
const bodyUrls = (low) => ({
  m: [ASSETS.soldierPack, low ? ASSETS.soldierAtlasLow : ASSETS.soldierAtlas, low ? ASSETS.soldierHeadLow : ASSETS.soldierHead],
  f: [ASSETS.soldierPackF, low ? ASSETS.soldierAtlasFLow : ASSETS.soldierAtlasF, low ? ASSETS.soldierHeadFLow : ASSETS.soldierHeadF]
});

async function loadTownBody(sex, urls) {
  const [template, motion] = await Promise.all([loadSoldierTemplate(urls), new GLTFLoader().loadAsync(sex === 'm' ? ASSETS.townWalk : ASSETS.townWalkF)]);
  installTownWalk(template, motion.animations, sex);
  return template;
}

/**
 * The townsfolk's bodies: { m, f, vc, low, loadFemale() }. The men's body is ready when this resolves; the women's is
 * loaded by `loadFemale()` (a body, two atlases and a walk clip, ~9.8 MB) so the town can appear first. With
 * `deferFemale` false both are loaded before it resolves. `low` selects the 1024 atlases (Low tier); the choice of the first
 * caller stands for the page. People whose look is female are simply not shown until `pack.f` exists.
 */
export const loadTownPeople = ({ low = false, deferFemale = false } = {}) => {
  templates ||= (async () => {
    const urls = bodyUrls(low);
    const pack = { m: await loadTownBody('m', urls.m), f: null, vc: true, low };
    pack.loadFemale = () => (pack.femaleLoad ||= loadTownBody('f', urls.f).then(f => (pack.f = f)).catch(error => { pack.femaleLoad = null; throw error; }));
    return pack;
  })().catch(error => { templates = null; throw error; });
  return templates.then(pack => (deferFemale ? pack : pack.loadFemale().then(() => pack)));
};

/** Town owns its templates; the skirmish jog and combat animation packs stay intact. */
export function installTownWalk(template, clips, sex = 'm') {
  const walk = clips.find(clip => clip.name === 'town_walk').clone();
  walk.name = 'walk';
  template.clips = template.clips.map(clip => clip.name === 'walk' ? walk : clip);
  template.clipSpeed = { ...template.clipSpeed, walk: WALK.bodies[sex].speed };
}
const looks = Object.values(HERO_LOOKS).filter(look => !look.helmet);

const lookFor = (seed, player = false) => (player ? HERO_LOOKS.arlen : looks[seedFor(seed, 'town-look') % looks.length]);

/** Does the person made from this seed need the women's body? (the pool waits for it instead of picking someone else) */
export const needsFemaleBody = (seed) => lookFor(seed).sex === 'f';

/** The actual skirmish v5 body, hair and painted face, without a weapon or combat kit. null while the body it needs is still loading. */
export function makeTownPerson(pack, { seed = 1, shadows = true, player = false, top } = {}) {
  const look = lookFor(seed, player);
  if (!pack[look.sex || 'm']) return null;
  const palette = appearanceFor(seed);
  const p = makeSoldier(pack, null, { civilian: true, look, shadows, colours: {
    tunic: top ?? palette.top, pants: palette.legs, boots: palette.shoes, hair: palette.hair,
    scarf: palette.top, glove: '#d3bda3'
  } });
  p.townPerson = true;
  p.index = -1;
  p.phase = seedFor(seed, 'stride') / 4294967296;
  p.time = 0;
  p.rest = Object.values(p.bones).map(b => ({ node: b.node, q: b.node.quaternion.clone(), pos: b.node.position.clone() }));
  p.restByName = Object.fromEntries(p.rest.map(b => [b.node.name, b]));
  p.clipPose = p.rest.map(b => ({ node: b.node, q: b.q.clone(), pos: b.pos.clone() }));
  for (const name of ['idle', 'walk', 'run']) p.actions[name].setEffectiveWeight(0).setEffectiveTimeScale(0).play();
  return p;
}

const smooth = THREE.MathUtils.smoothstep;
const q = new THREE.Quaternion(), e = new THREE.Euler();
const pelvis = new THREE.Vector3();
const offset = (p, name, x = 0, y = 0, z = 0) => {
  const bone = p.bones[name];
  if (bone) bone.node.quaternion.multiply(q.setFromEuler(e.set(x, y, z)));
};

/** Distance-driven, phase-matched locomotion. Overlay poses are restored before each mixer update. */
export function animateTownPerson(p, dt, speed, { pose = null, jump = 0, turn = 0 } = {}) {
  dt = THREE.MathUtils.clamp(dt, 0, .1);
  for (const b of p.clipPose) { b.node.quaternion.copy(b.q); b.node.position.copy(b.pos); }
  const k = 1 - Math.exp(-dt * 12);
  p.speed += (Math.max(0, speed) - p.speed) * k;
  p.time += dt;
  const moving = smooth(p.speed, .04, .6), run = smooth(p.speed, 2.8, 4.6);
  const weights = [1 - moving, moving * (1 - run), moving * run];
  const stride = THREE.MathUtils.lerp(p.clipSpeed.walk * p.actions.walk.getClip().duration,
    (p.clipSpeed.run || 5) * p.actions.run.getClip().duration, run) * p.root.scale.x;
  p.phase = (p.phase + dt * p.speed / Math.max(.1, stride)) % 1;
  ['idle', 'walk', 'run'].forEach((name, i) => {
    const a = p.actions[name];
    a.setEffectiveWeight(weights[i]);
    a.time = name === 'idle' ? p.time % a.getClip().duration : p.phase * a.getClip().duration;
  });
  p.mixer.update(dt);
  for (const b of p.clipPose) { b.q.copy(b.node.quaternion); b.pos.copy(b.node.position); }
  // Resting poses use the same humanoid joints; no combat pose or gun IK leaks into town.
  const resting = pose === 'sit' || pose === 'drive' || pose === 'sleep';
  if (resting) p.lastPose = pose;
  p.poseBlend = (p.poseBlend || 0) + ((resting ? 1 : 0) - (p.poseBlend || 0)) * (1 - Math.exp(-dt * 14));
  if (p.poseBlend > .001) {
    for (const b of p.rest) { b.node.quaternion.copy(b.q); b.node.position.copy(b.pos); }
    const sleep = p.lastPose === 'sleep';
    const hips = p.bones.hips.node;
    hips.position.y -= sleep ? 0 : .48 * p.bodyScale;
    offset(p, 'hips', sleep ? -Math.PI / 2 : 0);
    for (const side of ['L', 'R']) {
      offset(p, `hip_${side}`, sleep ? -.05 : -1.48);
      offset(p, `knee_${side}`, sleep ? .1 : 1.45);
      offset(p, `ankle_${side}`, sleep ? .12 : .03);
      offset(p, `shoulder_${side}`, sleep ? 0 : -.38, 0, side === 'L' ? -1.4 : 1.4);
      offset(p, `elbow_${side}`, 0, (side === 'L' ? -1 : 1) * (sleep ? .22 : .95));
    }
    offset(p, 'chest', Math.sin(p.time * 1.8) * .012);
    for (const b of p.clipPose) {
      q.copy(b.node.quaternion);
      b.node.quaternion.copy(b.q).slerp(q, p.poseBlend);
      pelvis.copy(b.node.position);
      b.node.position.copy(b.pos).lerp(pelvis, p.poseBlend);
    }
  } else {
    const bank = THREE.MathUtils.clamp(-turn * .025 * moving, -.1, .1);
    offset(p, 'chest', 0, 0, bank);
    offset(p, 'head', 0, THREE.MathUtils.clamp(turn * .08, -.25, .25), -bank * .6);
    if (jump > .02) {
      const air = smooth(jump, .02, .35);
      for (const side of ['L', 'R']) {
        offset(p, `hip_${side}`, -.18 * air);
        offset(p, `knee_${side}`, .35 * air);
      }
    }
  }
}
export function disposeTownPerson(p) {
  p.mixer.stopAllAction();
  p.mixer.uncacheRoot(p.root);
  for (const skeleton of new Set([p.mesh.skeleton, p.far?.skeleton].filter(Boolean))) skeleton.dispose();
  disposeSoldier(p);
}

/** Reuse bodies while preserving each walker's own appearance across camera/LOD changes. */
export class SkirmishPeople {
  constructor(pack, scene, { count, shadows, seed = 1 }) {
    Object.assign(this, { pack, scene, count, shadows, seed, timer: 0 });
    this.pool = [];
    this.identities = new Map(); // walker index -> look seed of a named person; the pool slot never decides who they are
  }
  assign(walkers, people, cam, reach = Infinity) {
    const distance = i => Math.hypot(people[i].x - cam.x, people[i].z - cam.z);
    const held = new Set();
    for (const p of this.pool) {
      if (distance(p.index) < reach * 1.25) held.add(p.index);
      else { people[p.index].visible = true; disposeTownPerson(p); }
    }
    this.pool = this.pool.filter(p => held.has(p.index));
    const near = walkers.filter(w => !held.has(w.i) && distance(w.i) < reach).sort((a, b) => distance(a.i) - distance(b.i));
    const seedOf = w => this.identities.get(w.i) ?? this.seed * 131 + w.i;
    // a person who needs the women's body waits until it has loaded: nobody else takes their place
    for (const w of near.filter(w => this.pack.f || !needsFemaleBody(seedOf(w))).slice(0, this.count - this.pool.length)) {
      const p = makeTownPerson(this.pack, { seed: seedOf(w), shadows: this.shadows });
      p.index = w.i;
      p.root.scale.setScalar(people[w.i].height);
      p.root.rotation.y = people[w.i].yaw;
      this.scene.add(p.root);
      this.pool.push(p);
    }
  }
  update(dt, walkers, people, cam) {
    this.timer -= dt;
    if (this.timer <= 0) { this.assign(walkers, people, cam); this.timer = .25; }
    for (const p of this.pool) {
      const walker = people[p.index];
      walker.visible = false;
      p.root.position.set(walker.x, walker.y, walker.z);
      const turn = Math.atan2(Math.sin(walker.yaw - p.root.rotation.y), Math.cos(walker.yaw - p.root.rotation.y)) * (1 - Math.exp(-dt * 12));
      p.root.rotation.y += turn;
      animateTownPerson(p, dt, walker.speed, { turn: dt > 0 ? turn / dt : 0 });
      setLod(p, p.root.position.distanceTo(cam));
    }
  }
  dispose() { this.pool.forEach(disposeTownPerson); this.pool = []; }
}
