import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { getToonGradient } from '../../render/assetLibrary.js';
import { CLASSES, FACTIONS, personFor } from './soldierLook.js';
import { HOLDS, gunMaterial, placeWeapon, gripWorld, supportWorld, poleR, poleL, reachArm, rotate } from './soldiers.js';
import { FACE_RECT, faceTexture } from './facePainter.js';

// Skirmish soldiers v2 (models/soldier_vc.glb, tools/blender/skirmish/soldier_vc.py): a smooth
// anime-proportioned figure on a real armature, animated by clips (idle, walk, run, crouch,
// crouch_walk, kneel, fall_back, fall_front) through an AnimationMixer. On top of the clips the
// upper body is posed in code: the torso turns into the stance and a little toward the aim
// (twist(): never more than 30 degrees, the head 60 more), the
// weapon is placed and both arms reach it (two-bone IK from soldiers.js).
//
// One mesh, one draw call: the second UV map carries each vertex's palette slot and piece
// (docs in soldier_vc.py); the material recolours slots and collapses the pieces not worn. The
// first UV map samples the shared painted atlas (shade, trim, ink); the face is a per-character
// painted texture (facePainter.js) projected from the front onto the head.

const KIT = ['base', 'pouches', 'pack_small', 'mags', 'plate', 'armor', 'tubes', 'pack_engineer', 'tools', 'goggles'];
const SLOTS = ['skin', 'hair', 'tunic', 'scarf', 'pants', 'boots', 'helmet', 'iris', 'glove'];

/** Speeds (m/s) the walk and run clips were keyed for: playback is scaled to the real speed. */
const CLIP_SPEED = { walk: 1.35, run: 3.2, crouch_walk: 1.05 };

/**
 * Per roster soldier: hair style (1-5), hair colour, skin, eyes, gloves (null: bare hands) and the
 * painted face (facePainter.js spec: eye shape, brows, mouth, extras). Enemies are generated.
 */
const LOOKS = {
  arlen: { hair: 1, hairColor: '#5a4636', skin: '#f2cdb0', iris: '#6a4a32', face: { eye: { tilt: 0.05 }, brow: { thick: 1.1, arch: 0.15 } } },
  mira: { hair: 4, hairColor: '#c98a3a', skin: '#f6d4b8', iris: '#4a8a4a', gloves: null, face: { female: true, freckles: true, eye: { h: 0.0205, iris: 0.64 }, mouth: { smile: 0.6 } } },
  brann: { hair: 5, hairColor: '#2a221c', skin: '#d9a07a', iris: '#4a3424', face: { eye: { h: 0.016, tilt: -0.05 }, brow: { thick: 1.5, tilt: 0.6, gap: -0.002 }, mouth: { w: 0.019 }, scar: true } },
  sela: { hair: 3, hairColor: '#7a2f2a', skin: '#f3cfb0', iris: '#6a4a8a', face: { female: true, eye: { tilt: 0.2 }, brow: { arch: 0.5 } } },
  otto: { hair: 2, hairColor: '#8a7a5a', skin: '#e8b892', iris: '#4a6a7a', face: { eye: { h: 0.0175 }, brow: { thick: 1.3 }, mole: [0.03, 1.532] } },
  ines: { hair: 4, hairColor: '#1e1c22', skin: '#e9bf99', iris: '#2c4c7c', face: { female: true, eye: { tilt: 0.28, h: 0.018 }, brow: { tilt: 0.3 } } },
  cato: { hair: 1, hairColor: '#b07a3a', skin: '#f0c4a0', iris: '#3a7a5a', gloves: null, face: { eye: { h: 0.02, iris: 0.66 }, mouth: { smile: 0.8 }, freckles: true } },
  lio: { hair: 2, hairColor: '#3a2618', skin: '#c88a62', iris: '#5a3a2a', face: { eye: { tilt: 0.12 }, brow: { thick: 1.2, arch: 0.3 } } },
  vesna: { hair: 3, hairColor: '#cdb98c', skin: '#f7dcc4', iris: '#5a8aaa', face: { female: true, eye: { h: 0.0178, tilt: 0.15, iris: 0.58 }, brow: { thick: 0.7 }, blush: 0.4 } }
};

/** Faction trim (the piping on hems, collars, cuffs), gloves and pencil ink. */
const DRESS = {
  fed: { trim: '#ece4cc', gloves: '#3e3029', ink: '#2c2a30' },
  imp: { trim: '#b8342c', gloves: '#232327', ink: '#1c1a1c' }
};

/** An enemy's face from its seed: a few shapes of brow and eye, dark eyes. */
function enemyFace(seed) {
  const h = Math.imul(seed ^ 0x2c1b3c6d, 0x297a2d39) >>> 0;
  return { eye: { h: 0.0155 + (h % 4) * 0.001, tilt: ((h >>> 3) % 5) * 0.06 - 0.12 }, brow: { thick: 1.2 + ((h >>> 6) % 4) * 0.15, tilt: 0.4 + ((h >>> 9) % 3) * 0.2 }, mouth: { smile: -0.4 }, scar: (h >>> 12) % 5 === 0, blush: 0.15 };
}

export async function loadSoldierTemplates(url, atlasUrl) {
  const [gltf, atlas] = await Promise.all([new GLTFLoader().loadAsync(url), new THREE.TextureLoader().loadAsync(atlasUrl)]);
  // data, not colour: R shade, G trim (hair: sheen), B ink; glTF UVs, so no flip
  atlas.flipY = false;
  atlas.colorSpace = THREE.NoColorSpace;
  atlas.anisotropy = 8;
  return { scene: gltf.scene, clips: gltf.animations, atlas, vc: true };
}

const F = FACE_RECT;
const GLSL = (v) => v.toFixed(4);
// anime faces take only a light cast shadow: the hair's shadow must not cut across the eyes
const LIGHTS = THREE.ShaderChunk.lights_fragment_begin.replace(
  /directLight\.color \*= (\( directLight\.visible && receiveShadow \) \? getShadow\( directionalShadowMap[^;]*);/,
  'directLight.color *= mix( $1, 1.0, vFace * 0.75 );'
);

function soldierMaterial(uniforms) {
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        #ifndef USE_UV1
          attribute vec2 uv1;
        #endif
        uniform vec3 uPalette[9];
        uniform float uHair;
        uniform float uHelm;
        uniform float uKit;
        varying vec2 vAtlasUv;
        varying vec2 vFaceUv;
        varying float vFace;
        varying float vHair;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float piece = floor(1.0 - uv1.y); // uv1 carries (slot, piece); glTF flips V
          bool hide = false;
          if (piece >= 1.0 && piece <= 5.0) hide = piece != uHair;
          else if (piece == 6.0 || piece == 7.0) hide = piece != uHelm;
          else if (piece >= 10.0 && piece < 20.0) hide = mod(floor(uKit / exp2(piece - 10.0)), 2.0) < 0.5;
          if (hide) transformed = vec3(0.0);
          vAtlasUv = uv;
          // the face texture is projected from the front of the rest pose (glTF: +z is forward)
          vFace = piece == 30.0 ? smoothstep(0.05, 0.4, normal.z) : 0.0;
          vFaceUv = vec2((position.x - ${GLSL(F.x0)}) / ${GLSL(F.x1 - F.x0)}, (position.y - ${GLSL(F.z0)}) / ${GLSL(F.z1 - F.z0)});
          vHair = floor(uv1.x) == 2.0 ? 1.0 : 0.0;
        }`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        {
          int slot = int(floor(uv1.x));
          // slotted parts: the palette colour, shaded by the authored grey (folds, seams, gradients)
          if (slot > 0) vColor.rgb *= uPalette[slot - 1];
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uAtlas;
        uniform sampler2D uFace;
        uniform vec3 uTrim;
        uniform vec3 uInk;
        uniform float uShut;
        varying vec2 vAtlasUv;
        varying vec2 vFaceUv;
        varying float vFace;
        varying float vHair;`)
      .replace('#include <lights_fragment_begin>', LIGHTS)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 a = texture2D(uAtlas, vAtlasUv).rgb;
          vec3 base = diffuseColor.rgb;
          diffuseColor.rgb *= a.r;
          if (vHair > 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, min(base * 1.4 + 0.03, vec3(0.92)), a.g * 0.6);
          else diffuseColor.rgb = mix(diffuseColor.rgb, uTrim * a.r, a.g);
          // pencil: the faction's ink on cloth, a darker shade of the hair colour on hair
          diffuseColor.rgb = mix(diffuseColor.rgb, vHair > 0.5 ? base * 0.45 : mix(uInk, base * 0.3, 0.4), a.b * 0.85);
          if (vFace > 0.001 && vFaceUv.x > 0.0 && vFaceUv.x < 1.0 && vFaceUv.y > 0.0 && vFaceUv.y < 1.0) {
            vec4 f = texture2D(uFace, vec2((vFaceUv.x + uShut) * 0.5, vFaceUv.y));
            diffuseColor.rgb = mix(diffuseColor.rgb, f.rgb, f.a * vFace);
          }
        }`);
  };
  m.customProgramCacheKey = () => 'skirmish-soldier-vc3';
  return m;
}

/** One soldier from the template: its own skeleton, material, mixer and weapon. */
export function makeSoldier(template, weapons, { faction = 'fed', cls = 'scout', seed = 1, id = null, shadows = true } = {}) {
  const C = CLASSES[cls];
  const F = FACTIONS[faction];
  const root = cloneSkinned(template.scene);
  // the close model, and the far one (fewer segments, no small details) shown past LOD_FAR metres
  let mesh = null, far = null;
  root.traverse((o) => o.isSkinnedMesh && (o.name.includes('lod1') ? (far = o) : (mesh = o)));
  const person = personFor(seed);
  const look = (faction === 'fed' && LOOKS[id]) || { hair: faction === 'imp' ? 5 : 1 + (seed % 5), hairColor: person.hair, skin: person.skin, iris: '#3a3430', face: enemyFace(seed) };
  const D = DRESS[faction];
  const gloves = look.gloves === null ? look.skin : look.gloves || D.gloves;
  const pal = { skin: look.skin, hair: look.hairColor, tunic: F.top, scarf: F.scarf, pants: F.legs, boots: F.boots, helmet: F.helmet_color, iris: look.iris, glove: gloves };
  // enemies wear helmets; our soldiers go bareheaded so their faces read (as in the reference)
  const helm = faction === 'imp' ? 7 : 0;
  const kitMask = C.kit.reduce((m, tag) => m | (1 << KIT.indexOf(tag)), 0);
  const uniforms = {
    uPalette: { value: SLOTS.map((k) => new THREE.Color(pal[k])) },
    uHair: { value: helm ? 5 : look.hair },
    uHelm: { value: helm },
    uKit: { value: kitMask },
    uAtlas: { value: template.atlas },
    uFace: { value: faceTexture({ ...look.face, skin: look.skin, hair: look.hairColor, iris: look.iris }) },
    uTrim: { value: new THREE.Color(D.trim) },
    uInk: { value: new THREE.Color(D.ink) },
    uShut: { value: 0 }
  };
  mesh.material = soldierMaterial(uniforms);
  for (const m of [mesh, far]) {
    if (!m) continue;
    m.material = mesh.material;
    m.castShadow = shadows;
    m.frustumCulled = false;
  }
  if (far) far.visible = false;
  const bones = {};
  root.traverse((o) => o.isBone && (bones[o.name] = { node: o, rest: o.quaternion.clone() }));
  // the weapon is carried on the chest (soldiers.placeWeapon): its rest matrix in root space
  root.updateMatrixWorld(true);
  const chestRest = root.matrixWorld.clone().invert().multiply(bones.chest.node.matrixWorld);
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
    root, mesh, far, material: mesh.material, uniforms, bones, mixer, actions, current: 'idle', faction, cls, gun,
    weapon: weapons[C.weapon], hold: HOLDS[C.hold], aimYaw: 0, aimPitch: 0, aimBlend: 0, crouchBlend: 0,
    speed: 0, recoil: 0, flinch: 0, blink: 2 + Math.random() * 3, vc: true, chestRest
  };
}

export function disposeSoldier(s) {
  s.mixer.stopAllAction();
  s.material.dispose();
  s.gun.removeFromParent();
  s.root.removeFromParent();
}

export const LOD_FAR = 24;

/** Show the close or the far model by the distance to the camera (with a little hysteresis). */
export function setLod(s, distance) {
  if (!s.far) return;
  const farNow = s.far.visible ? distance > LOD_FAR - 2 : distance > LOD_FAR + 2;
  s.far.visible = farNow;
  s.mesh.visible = !farNow;
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
  // The mixer writes a bone only when the clips' value for it changed since the last frame
  // (PropertyMixer.apply), and many tracks here are constant. The pose added on top below (torso
  // turn, aim, the IK arms) would then pile up frame after frame (heads spinning round): put back
  // the clips' pose of the last frame first, then let the mixer move on from there.
  if (s.clipPose) for (const [b, q] of s.clipPose) b.node.quaternion.copy(q);
  s.speed += (speed - s.speed) * (1 - Math.exp(-dt * 10));
  s.recoil *= Math.exp(-dt * 14);
  s.flinch *= Math.exp(-dt * 5);
  const k = 1 - Math.exp(-dt * 10);
  s.aimBlend += ((aim && !down ? 1 : 0) - s.aimBlend) * k;
  s.crouchBlend += ((crouch ? 1 : 0) - s.crouchBlend) * k;
  // eyes: shut when down, a blink every few seconds
  s.blink -= dt;
  if (s.blink < -0.12) s.blink = 2 + Math.random() * 4;
  s.uniforms.uShut.value = down || s.blink < 0 ? 1 : 0;

  if (down) {
    s.gun.visible = false;
    play(s, down === 'dead' ? 'fall_front' : 'fall_back', 0.12);
    s.mixer.update(dt);
    saveClipPose(s);
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
  saveClipPose(s);

  const B = s.bones;
  const am = s.aimBlend;
  const hold = s.hold;
  const torso = THREE.MathUtils.lerp(hold.ready.torso, hold.aim.torso, am);
  const T = twist(s.aimYaw);
  rotate(B.spine, -0.1 * s.flinch, torso * 0.4 + T.spine * am);
  rotate(B.chest, -s.aimPitch * am * 0.4 - 0.25 * s.flinch - 0.05 * s.recoil, torso * 0.6 + T.chest * am);
  rotate(B.neck, 0.15 * s.flinch, -torso * 0.4);
  rotate(B.head, s.aimPitch * am * 0.5 + (hold.aim.cheek ? 0.1 * am : 0), -torso * 0.6 + T.head * am, hold.aim.cheek ? -0.2 * am : 0);
  s.root.updateMatrixWorld(true);
  placeWeapon(s, am);
  reachArm(s, 'R', gripWorld(s), poleR(s));
  if (s.weapon.support) reachArm(s, 'L', supportWorld(s), poleL(s));
}

/** Remember every bone's rotation as the clips left it this frame (see animateSoldier). */
function saveClipPose(s) {
  s.clipPose ||= Object.values(s.bones).map((b) => [b, new THREE.Quaternion()]);
  for (const [b, q] of s.clipPose) q.copy(b.node.quaternion);
}

/**
 * How an aim off to the side is shared out, as in Valkyria Chronicles: the torso turns at most
 * 30 degrees, the head at most 60 more; anything beyond is the body's job (UnitViews turns the
 * whole soldier to face the target before it fires). Returns yaw (rad) for spine, chest, head.
 */
export const TWIST = { torso: 0.52, head: 1.05 };
export function twist(aimYaw) {
  const t = THREE.MathUtils.clamp(aimYaw, -TWIST.torso, TWIST.torso);
  const h = THREE.MathUtils.clamp(aimYaw - t, -TWIST.head, TWIST.head);
  return { spine: t * 0.4, chest: t * 0.6, head: h };
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
