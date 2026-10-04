import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { getToonGradient } from '../../render/assetLibrary.js';
import { CLASSES, FACTIONS } from './soldierLook.js';
import HERO_LOOKS from './heroLooks.json';
import { HOLDS, gunMaterial, placeWeapon, gripWorld, supportWorld, poleR, poleL, reachArm, rotate } from './soldiers.js';

// Skirmish soldiers v5 (models/soldier_v5_m.glb, tools/blender/skirmish/soldier_v5.py): a VRoid
// anime body in a modelled VC1-style uniform on a humanoid rig, animated by clips (idle, walk, run,
// crouch, crouch_walk, kneel, hit, fall_back, fall_front) through an AnimationMixer. On top of the
// clips the upper body is posed in code: the torso turns into the stance and a little toward the
// aim (twist(): never more than 30 degrees, the head 60 more), the weapon is placed, both arms
// reach it (two-bone IK from soldiers.js) and the fingers close round it.
//
// One mesh, one draw call. The second UV map carries each vertex's palette slot and piece (an
// index into the mesh's extras "pieces"); each soldier draws only its own pieces (hair style,
// helmet, scarf, class kit) through an index buffer of its own. The first UV map samples the head
// atlas (VRoid's painted face, eyes and hair) for the head slots and the cloth atlas (R shade,
// G trim piping, B pencil ink) for everything else.

/** Palette slots (soldier_v5.py SLOT): the head slots sample the head atlas. */
const SLOT = { skin: 1, hair: 2, tunic: 3, scarf: 4, pants: 5, boots: 6, helmet: 7, glove: 8, leather: 9, brass: 10, metal: 11, canvas: 12, lens: 13, face: 14, iris: 15 };


/**
 * Per roster soldier (heroLooks.json, also read by soldier_v5.py for the portraits): the body
 * (m / f), hair style (a piece of that body's mesh), hair and iris colours, a skin tint (white
 * keeps VRoid's painted skin), a helmet and the neckerchief.
 */
const LOOKS = HERO_LOOKS;

/** Faction cloth: palette slots, trim (piping) and pencil ink. */
const DRESS = {
  fed: { trim: '#ece4cc', ink: '#2c2a30', glove: '#4a3a30', leather: '#6a4a30', brass: '#c9a24a', metal: '#5f7462', canvas: '#7a7d5c', lens: '#9ab4c0' },
  imp: { trim: '#b8342c', ink: '#1c1a1c', glove: '#232327', leather: '#3a2c24', brass: '#9a8a6a', metal: '#4a4d52', canvas: '#55574e', lens: '#c24a3a' }
};

/** Both bodies: { m: [glb, cloth atlas, head atlas], f: [...] } -> { m: template, f: template }. */
export async function loadSoldierTemplates(sources) {
  const entries = await Promise.all(Object.entries(sources).map(async ([sex, urls]) => [sex, await loadTemplate(...urls)]));
  return { ...Object.fromEntries(entries), vc: true };
}

async function loadTemplate(url, clothUrl, headUrl) {
  const loader = new THREE.TextureLoader();
  const [gltf, cloth, head] = await Promise.all([new GLTFLoader().loadAsync(url), loader.loadAsync(clothUrl), loader.loadAsync(headUrl)]);
  // glTF UVs, so no flip. The cloth atlas is data (shade, trim, ink); the head atlas is colour
  cloth.flipY = head.flipY = false;
  cloth.colorSpace = THREE.NoColorSpace;
  head.colorSpace = THREE.SRGBColorSpace;
  cloth.anisotropy = head.anisotropy = 8;
  let mesh = null, far = null;
  gltf.scene.traverse((o) => o.isSkinnedMesh && (o.name.includes('lod1') ? (far = o) : (mesh = o)));
  const pieces = mesh.userData.pieces;
  // the body's size against the men's (the weapon's carry is laid out for them): the head joint's height
  gltf.scene.updateMatrixWorld(true);
  const crown = new THREE.Vector3();
  gltf.scene.getObjectByName('head').getWorldPosition(crown);
  return {
    scene: gltf.scene, clips: gltf.animations, cloth, head, pieces, clipSpeed: mesh.userData.clip_speed || {}, scale: crown.y / 1.545,
    buckets: { close: buckets(mesh.geometry), far: far && buckets(far.geometry) }, cache: new Map()
  };
}

/** The triangles of each piece (the index buffer split by the piece of its first vertex). */
function buckets(geometry) {
  const index = geometry.index.array;
  const uv1 = geometry.attributes.uv1;
  const lists = new Map();
  for (let t = 0; t < index.length; t += 3) {
    const piece = Math.floor(1 - uv1.getY(index[t])); // glTF flips V
    let l = lists.get(piece);
    if (!l) lists.set(piece, (l = []));
    l.push(index[t], index[t + 1], index[t + 2]);
  }
  return lists;
}

/** A geometry sharing the template's attributes, drawing only the given pieces (cached per set). */
function geometryFor(template, source, which, names) {
  const ids = names.map((n) => template.pieces.indexOf(n)).filter((i) => i >= 0).sort((a, b) => a - b);
  const key = `${which}:${ids.join(',')}`;
  let g = template.cache.get(key);
  if (!g) {
    g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(source.attributes)) g.setAttribute(name, attr);
    const lists = template.buckets[which];
    const total = ids.reduce((n, i) => n + (lists.get(i)?.length || 0), 0);
    const index = new Uint32Array(total);
    let at = 0;
    for (const i of ids) {
      const l = lists.get(i);
      if (l) index.set(l, at), (at += l.length);
    }
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.boundingSphere = source.boundingSphere;
    g.boundingBox = source.boundingBox;
    template.cache.set(key, g);
  }
  return g;
}

// anime faces take only a light cast shadow: the hair's shadow must not cut across the eyes
const LIGHTS = THREE.ShaderChunk.lights_fragment_begin.replace(
  /directLight\.color \*= (\( directLight\.visible && receiveShadow \) \? getShadow\( directionalShadowMap[^;]*);/,
  'directLight.color *= mix( $1, 1.0, vFace * 0.75 );'
);

function soldierMaterial(uniforms) {
  const m = new THREE.MeshToonMaterial({ gradientMap: getToonGradient(), side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        #ifndef USE_UV1
          attribute vec2 uv1;
        #endif
        varying vec2 vAtlasUv;
        varying float vSlot;
        varying float vFace;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vAtlasUv = uv;
        vSlot = floor(uv1.x);
        vFace = (vSlot == 1.0 || vSlot == 14.0 || vSlot == 15.0) ? 1.0 : 0.0;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uCloth;
        uniform sampler2D uHead;
        uniform vec3 uPalette[16];
        uniform vec3 uTrim;
        uniform vec3 uInk;
        varying vec2 vAtlasUv;
        varying float vSlot;
        varying float vFace;`)
      .replace('#include <lights_fragment_begin>', LIGHTS)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          int slot = int(vSlot + 0.5);
          if (slot == 1 || slot == 2 || slot == 14 || slot == 15) {
            // VRoid's painted head: hair, brows and irises are brightness, coloured per soldier
            vec4 h = texture2D(uHead, vAtlasUv);
            if (h.a < 0.5) discard;
            vec3 c = h.rgb;
            if (slot == 2) c = h.r * uPalette[1];
            else if (slot == 15) c = mix(vec3(0.02), uPalette[14], h.r);
            else if (slot == 1) c *= uPalette[0];
            diffuseColor.rgb = c;
          } else {
            vec3 a = texture2D(uCloth, vAtlasUv).rgb;
            vec3 base = uPalette[clamp(slot - 1, 0, 15)];
            diffuseColor.rgb = mix(base * a.r, uTrim * a.r, a.g);
            diffuseColor.rgb = mix(diffuseColor.rgb, mix(uInk, base * 0.3, 0.4), a.b * 0.85);
          }
        }`);
  };
  m.customProgramCacheKey = () => 'skirmish-soldier-v5';
  return m;
}

/** One soldier from the template: its own skeleton, material, mixer, pieces and weapon. */
export function makeSoldier(templates, weapons, { faction = 'fed', cls = 'scout', seed = 1, id = null, shadows = true } = {}) {
  const C = CLASSES[cls];
  const F = FACTIONS[faction];
  const D = DRESS[faction];
  const look = (faction === 'fed' && LOOKS[id]) || { hair: 'hair_base', hairColor: '#2a2624', iris: '#3a3430' };
  const template = templates[look.sex || 'm'];
  const root = cloneSkinned(template.scene);
  // the close model, and the far one (decimated) shown past LOD_FAR metres
  let mesh = null, far = null;
  root.traverse((o) => o.isSkinnedMesh && (o.name.includes('lod1') ? (far = o) : (mesh = o)));
  // the Empire's soldiers are faceless behind their masked helmets
  const helmet = faction === 'imp' ? 'helm_imp' : look.helmet || null;
  // the short base cut lies under every style (VRoid hair leaves the nape open between its locks),
  // unless the style shows the brow it would cover
  const under = helmet || look.underlay !== false ? ['hair_base'] : [];
  const names = ['always', 'face', ...under, ...(helmet ? [helmet] : [look.hair]), ...(look.scarf ? ['scarf'] : []), ...C.kit.map((k) => `kit_${k}`)];
  mesh.geometry = geometryFor(template, mesh.geometry, 'close', names);
  if (far) far.geometry = geometryFor(template, far.geometry, 'far', names);
  const color = (hex) => new THREE.Color(hex);
  const palette = {
    skin: look.skin || '#ffffff', hair: look.hairColor, tunic: F.top, scarf: F.scarf, pants: F.legs, boots: F.boots, helmet: F.helmet_color,
    glove: D.glove, leather: D.leather, brass: D.brass, metal: D.metal, canvas: D.canvas, lens: D.lens, face: '#ffffff', iris: look.iris
  };
  const pal = Array.from({ length: 16 }, () => new THREE.Color(1, 1, 1));
  for (const [k, v] of Object.entries(palette)) pal[SLOT[k] - 1] = color(v);
  const uniforms = {
    uPalette: { value: pal },
    uCloth: { value: template.cloth },
    uHead: { value: template.head },
    uTrim: { value: color(D.trim) },
    uInk: { value: color(D.ink) }
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
  const fingers = FINGER_BONES.map(([name, side, k]) => bones[name] && [bones[name].node, side, k]).filter(Boolean);
  return {
    root, mesh, far, material: mesh.material, uniforms, bones, mixer, actions, current: 'idle', faction, cls, gun,
    weapon: weapons[C.weapon], hold: HOLDS[C.hold], aimYaw: 0, aimPitch: 0, aimBlend: 0, crouchBlend: 0,
    speed: 0, recoil: 0, flinch: 0, vc: true, chestRest, fingers, clipSpeed: template.clipSpeed, bodyScale: template.scale
  };
}

/** Finger joints that close round the weapon: [bone, side, joint 1-3]. */
const FINGER_BONES = ['index', 'middle', 'ring', 'pinky'].flatMap((f) => ['L', 'R'].flatMap((s) => [1, 2, 3].map((k) => [`${f}_0${k}_${s}`, s, k, f])));
const CURL = [0, 1.0, 1.25, 0.8];
const _axis = new THREE.Vector3(0, 0, 1);
const _fq = new THREE.Quaternion();

/** Close the fingers round the grip (the trigger finger of the right hand a little open). */
function grip(s, k) {
  for (const [node, side, joint] of s.fingers) {
    const trigger = side === 'R' && node.name.startsWith('index');
    const a = CURL[joint] * (trigger ? 0.55 : 1) * k;
    // bones rest along +-x (the T-pose), palms down: the curl turns about the forward axis
    _fq.setFromAxisAngle(_axis, side === 'R' ? a : -a);
    node.quaternion.copy(_fq);
  }
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
  a.timeScale = s.clipSpeed[clip] ? THREE.MathUtils.clamp(v / s.clipSpeed[clip], 0.5, 1.8) : 1;
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
  grip(s, 1);
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

/** The heroes' painted portraits (soldier_v5.py renders a 3 x 3 sheet in roster order): id -> data URL. */
export async function loadPortraits(url) {
  const img = await new THREE.ImageLoader().loadAsync(url);
  const size = img.width / 3;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  return Object.fromEntries(Object.keys(HERO_LOOKS).map((id, k) => {
    g.drawImage(img, (k % 3) * size, Math.floor(k / 3) * size, size, size, 0, 0, size, size);
    return [id, c.toDataURL()];
  }));
}
