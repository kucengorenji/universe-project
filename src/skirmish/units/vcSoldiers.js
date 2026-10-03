import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { getToonGradient } from '../../render/assetLibrary.js';
import { CLASSES, FACTIONS, personFor } from './soldierLook.js';
import { HOLDS, gunMaterial, placeWeapon, gripWorld, supportWorld, poleR, poleL, reachArm, rotate } from './soldiers.js';

// Skirmish soldiers v2 (models/soldier_vc.glb, tools/blender/skirmish/soldier_vc.py): a smooth
// anime-proportioned figure on a real armature, animated by clips (idle, walk, run, crouch,
// crouch_walk, kneel, fall_back, fall_front) through an AnimationMixer. On top of the clips the
// upper body is posed in code: the torso turns into the stance, the head follows the aim, the
// weapon is placed and both arms reach it (two-bone IK from soldiers.js).
//
// One mesh, one draw call: the second UV map carries each vertex's palette slot and piece
// (docs in soldier_vc.py); the material recolours slots and collapses the pieces not worn.

const KIT = ['base', 'pouches', 'pack_small', 'mags', 'plate', 'armor', 'tubes', 'pack_engineer', 'tools', 'goggles'];
const SLOTS = ['skin', 'hair', 'tunic', 'scarf', 'pants', 'boots', 'helmet', 'iris'];

/** Speeds (m/s) the walk and run clips were keyed for: playback is scaled to the real speed. */
const CLIP_SPEED = { walk: 1.35, run: 3.2, crouch_walk: 1.05 };

/** Per roster soldier: hair style (1-5), hair colour, skin, eyes. Enemies get a crop under the helmet. */
const LOOKS = {
  arlen: { hair: 1, hairColor: '#4a3020', skin: '#f1c9a8', iris: '#3c6e9e' },
  mira: { hair: 4, hairColor: '#c98a3a', skin: '#f6d2b4', iris: '#4a8a4a' },
  brann: { hair: 5, hairColor: '#2a221c', skin: '#d9a07a', iris: '#5a3a24' },
  sela: { hair: 3, hairColor: '#7a2f2a', skin: '#f3cfb0', iris: '#6a4a8a' },
  otto: { hair: 2, hairColor: '#8a7a5a', skin: '#e8b892', iris: '#4a6a7a' },
  ines: { hair: 4, hairColor: '#1e1c22', skin: '#e9bf99', iris: '#2c4c7c' },
  cato: { hair: 1, hairColor: '#b07a3a', skin: '#f0c4a0', iris: '#3a7a5a' },
  lio: { hair: 2, hairColor: '#3a2618', skin: '#c88a62', iris: '#5a3a2a' },
  vesna: { hair: 3, hairColor: '#e4d6b0', skin: '#f7dcc4', iris: '#5a8aaa' }
};

export async function loadSoldierTemplates(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  return { scene: gltf.scene, clips: gltf.animations, vc: true };
}

function soldierMaterial(uniforms) {
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 uv1;
        uniform vec3 uPalette[8];
        uniform float uHair;
        uniform float uHelm;
        uniform float uKit;
        uniform float uEyes;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float piece = floor(1.0 - uv1.y); // glTF flips V: Blender's v = piece + 0.5
          bool hide = false;
          if (piece >= 1.0 && piece <= 5.0) hide = piece != uHair;
          else if (piece == 6.0 || piece == 7.0) hide = piece != uHelm;
          else if (piece >= 10.0 && piece < 20.0) hide = mod(floor(uKit / exp2(piece - 10.0)), 2.0) < 0.5;
          else if (piece >= 20.0) hide = piece != uEyes;
          if (hide) transformed = vec3(0.0);
        }`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        {
          int slot = int(floor(uv1.x));
          if (slot > 0) vColor.rgb = uPalette[slot - 1];
        }`);
  };
  m.customProgramCacheKey = () => 'skirmish-soldier-vc';
  return m;
}

/** One soldier from the template: its own skeleton, material, mixer and weapon. */
export function makeSoldier(template, weapons, { faction = 'fed', cls = 'scout', seed = 1, id = null, shadows = true } = {}) {
  const C = CLASSES[cls];
  const F = FACTIONS[faction];
  const root = cloneSkinned(template.scene);
  let mesh = null;
  root.traverse((o) => o.isSkinnedMesh && (mesh = o));
  const person = personFor(seed);
  const look = (faction === 'fed' && LOOKS[id]) || { hair: faction === 'imp' ? 5 : 1 + (seed % 5), hairColor: person.hair, skin: person.skin, iris: '#3a4a5a' };
  const pal = { skin: look.skin, hair: look.hairColor, tunic: F.top, scarf: F.scarf, pants: F.legs, boots: F.boots, helmet: F.helmet_color, iris: look.iris };
  // enemies wear helmets; our soldiers go bareheaded so their faces read (as in the reference)
  const helm = faction === 'imp' ? 7 : 0;
  const kitMask = C.kit.reduce((m, tag) => m | (1 << KIT.indexOf(tag)), 0);
  const uniforms = {
    uPalette: { value: SLOTS.map((k) => new THREE.Color(pal[k])) },
    uHair: { value: helm ? 5 : look.hair },
    uHelm: { value: helm },
    uKit: { value: kitMask },
    uEyes: { value: 20 }
  };
  mesh.material = soldierMaterial(uniforms);
  mesh.castShadow = shadows;
  mesh.frustumCulled = false;
  const bones = {};
  root.traverse((o) => o.isBone && (bones[o.name] = { node: o, rest: o.quaternion.clone() }));
  const mixer = new THREE.AnimationMixer(root);
  const actions = {};
  for (const clip of template.clips) {
    const a = mixer.clipAction(clip);
    if (!/walk|run|idle/.test(clip.name)) {
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
    }
    actions[clip.name] = a;
  }
  actions.idle.play();
  const gun = new THREE.Mesh(weapons[C.weapon].geometry, gunMaterial());
  gun.castShadow = shadows;
  root.add(gun);
  return {
    root, mesh, material: mesh.material, uniforms, bones, mixer, actions, current: 'idle', faction, cls, gun,
    weapon: weapons[C.weapon], hold: HOLDS[C.hold], aimYaw: 0, aimPitch: 0, aimBlend: 0, crouchBlend: 0,
    speed: 0, recoil: 0, flinch: 0, blink: 2 + Math.random() * 3, vc: true
  };
}

export function disposeSoldier(s) {
  s.mixer.stopAllAction();
  s.material.dispose();
  s.gun.removeFromParent();
  s.root.removeFromParent();
}

export const kick = (s) => (s.recoil = 1);
export const flinch = (s) => (s.flinch = 1);

function play(s, name, fade = 0.22) {
  if (s.current === name) return;
  const next = s.actions[name];
  const prev = s.actions[s.current];
  next.reset().setEffectiveWeight(1).play();
  if (prev) prev.crossFadeTo(next, fade, false);
  s.current = name;
}

/**
 * One frame: pick the clip for the motion (and its playback speed), advance the mixer, then pose
 * the upper body for the weapon. down: 'down' | 'dead' | false.
 */
export function animateSoldier(s, dt, speed, { aim = false, crouch = false, turn = 0, down = false } = {}) {
  s.speed += (speed - s.speed) * (1 - Math.exp(-dt * 10));
  s.recoil *= Math.exp(-dt * 14);
  s.flinch *= Math.exp(-dt * 5);
  const k = 1 - Math.exp(-dt * 10);
  s.aimBlend += ((aim && !down ? 1 : 0) - s.aimBlend) * k;
  s.crouchBlend += ((crouch ? 1 : 0) - s.crouchBlend) * k;
  // eyes: shut when down, a blink every few seconds
  s.blink -= dt;
  if (s.blink < -0.12) s.blink = 2 + Math.random() * 4;
  s.uniforms.uEyes.value = down || s.blink < 0 ? 21 : 20;

  if (down) {
    s.gun.visible = false;
    play(s, down === 'dead' ? 'fall_front' : 'fall_back', 0.12);
    s.mixer.update(dt);
    return;
  }
  s.gun.visible = true;
  const v = s.speed;
  let clip;
  if (crouch) clip = v > 0.3 ? 'crouch_walk' : aim ? 'kneel' : 'crouch';
  else clip = v < 0.15 ? 'idle' : v < 2.4 ? 'walk' : 'run';
  play(s, clip);
  const a = s.actions[clip];
  a.timeScale = CLIP_SPEED[clip] ? THREE.MathUtils.clamp(v / CLIP_SPEED[clip], 0.5, 1.8) : 1;
  s.mixer.update(dt);
  // hands sit lower with the hips
  s.gripDrop = clip === 'kneel' ? 0.42 : clip === 'crouch' ? 0.32 : clip === 'crouch_walk' ? 0.22 : 0;

  const B = s.bones;
  const am = s.aimBlend;
  const hold = s.hold;
  const torso = THREE.MathUtils.lerp(hold.ready.torso, hold.aim.torso, am);
  rotate(B.spine, -0.1 * s.flinch, torso * 0.4 + s.aimYaw * am * 0.3);
  rotate(B.chest, -s.aimPitch * am * 0.4 - 0.25 * s.flinch - 0.05 * s.recoil, torso * 0.6 + s.aimYaw * am * 0.4);
  rotate(B.neck, 0.15 * s.flinch, -torso * 0.4);
  rotate(B.head, s.aimPitch * am * 0.5 + (hold.aim.cheek ? 0.1 * am : 0), -torso * 0.6 + s.aimYaw * am * 0.3, hold.aim.cheek ? -0.2 * am : 0);
  s.root.updateMatrixWorld(true);
  placeWeapon(s, am);
  reachArm(s, 'R', gripWorld(s), poleR(s));
  if (s.weapon.support) reachArm(s, 'L', supportWorld(s), poleL(s));
}

/** A head-and-shoulders portrait of a soldier (data URL), rendered once with the given renderer. */
export function portrait(renderer, template, weapons, opts, size = 160) {
  const s = makeSoldier(template, weapons, { ...opts, shadows: false });
  s.gun.visible = false;
  s.mixer.update(0);
  const scene = new THREE.Scene();
  scene.add(s.root, new THREE.HemisphereLight('#fff6e8', '#7a6a58', 1.4));
  const sun = new THREE.DirectionalLight('#fff0d8', 2.2);
  sun.position.set(1.5, 2.5, 3);
  scene.add(sun);
  s.root.updateMatrixWorld(true);
  const head = new THREE.Vector3();
  s.bones.head.node.getWorldPosition(head);
  const cam = new THREE.PerspectiveCamera(24, 1, 0.05, 10);
  cam.position.set(head.x + 0.18, head.y + 0.06, head.z + 0.75);
  cam.lookAt(head.x, head.y + 0.02, head.z);
  const rt = new THREE.WebGLRenderTarget(size, size, { samples: 4 });
  const prev = renderer.getRenderTarget();
  const prevTone = renderer.toneMapping;
  renderer.setRenderTarget(rt);
  renderer.setClearColor('#efe6d2', 1);
  renderer.clear();
  renderer.render(scene, cam);
  const px = new Uint8Array(size * size * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
  renderer.setRenderTarget(prev);
  renderer.setClearColor('#000000', 0);
  renderer.toneMapping = prevTone;
  rt.dispose();
  disposeSoldier(s);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  // the render target is linear and upside down
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = ((size - 1 - y) * size + x) * 4, o = (y * size + x) * 4;
      for (let k = 0; k < 3; k++) img.data[o + k] = Math.round(255 * Math.pow(px[i + k] / 255, 1 / 2.2));
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
}
