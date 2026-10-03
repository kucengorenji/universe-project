import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { getToonGradient } from '../../../render/assetLibrary.js';
import { appearanceFor } from './peopleAppearance.js';
import { seedFor } from '../../../world/identity.js';

// NPC v1 townsfolk (models/npc.glb, docs/art-direction/npc-v1): a faceted
// low-poly adult built from rigid parts under pivot empties (hips > hip > knee >
// ankle, spine > shoulder > elbow > wrist, neck > head). At load the parts
// merge into one rigidly skinned mesh, one draw call per person. Colours and
// the optional pieces (glasses, beard, cap, tie, the take-away cup) vary per
// person in the shader; the walk is posed in code from the walker's speed.

const TAU = Math.PI * 2;
const BONES = ['NPC_C01', 'hips', 'spine', 'chest', 'neck', 'head',
  'clavicle_L', 'shoulder_L', 'elbow_L', 'wrist_L', 'clavicle_R', 'shoulder_R', 'elbow_R', 'wrist_R', 'cup',
  'hip_L', 'knee_L', 'ankle_L', 'toe_L', 'hip_R', 'knee_R', 'ankle_R', 'toe_R'];

// Material -> [palette slot (0 = keep the authored colour), shade within the slot].
// Slot 4 is the tie on the office model (docs/art-direction/npc-v1/blender/office_faceted.py),
// the undershirt on the older C01 pack; the belt and penny strap are darker shades of the shoes.
const SLOTS = {
  M_skin: [1, 1], M_skin_dark: [1, 0.76], M_hair: [2, 1], M_beard: [2, 0.92],
  M_shirt: [3, 1], M_shirt_fold: [3, 0.86], M_shirt_stripe: [3, 1], M_shirt_dark: [3, 0.55],
  M_tie: [4, 1], M_under: [4, 1],
  M_pants: [5, 1], M_cuff: [5, 1.35], M_shoe_upper: [6, 1], M_shoe_strap: [6, 0.72], M_belt: [6, 0.5], M_cap: [7, 1]
};
// Mesh name -> optional piece (1 glasses, 2 beard and the mouth drawn on it, 3 cap,
// 4 cup, 5 hair crown, 6 tie). R04 hair is only the crop under the cap, so the crown shows
// whenever the cap is off; a pack without an authored crown gets one made at load.
const PIECE = [[/^glasses_/, 1], [/^beard_B02/, 2], [/^hat_/, 3], [/^prop_cup/, 4], [/^hair_.*_crown$/, 5], [/^tie_/, 6]];
// Facial expression assets: expr_<feature>_<variant> meshes, one variant per feature shown
// (the order is the variant index; see docs/art-direction/npc-v1/blender/c01_faceted.py).
export const EXPR = {
  eyes: ['open', 'closed', 'wide', 'squint'],
  brows: ['neutral', 'raised', 'worried', 'angry'],
  mouth: ['neutral', 'smile', 'open', 'frown', 'grin']
};
const FEATURES = Object.keys(EXPR);
/** Named expressions: [eyes, brows, mouth]. */
export const FACES = {
  neutral: ['open', 'neutral', 'neutral'],
  smile: ['squint', 'raised', 'smile'],
  laugh: ['squint', 'raised', 'grin'],
  curious: ['wide', 'raised', 'open'],
  worried: ['wide', 'worried', 'frown'],
  scared: ['wide', 'worried', 'open'],
  focused: ['open', 'angry', 'neutral'],
  angry: ['open', 'angry', 'frown'],
  content: ['open', 'neutral', 'smile'],
  asleep: ['closed', 'neutral', 'neutral']
};
const faceIndex = Object.fromEntries(Object.entries(FACES).map(([k, v]) => [k, v.map((name, i) => EXPR[FEATURES[i]].indexOf(name))]));
const MOUTH_ON_BEARD = 0.016; // metres the mouth moves forward to sit on the beard

// Soft joints: near each of these pivots the skin is shared between the bone and its
// parent, so knees, elbows, waist, shoulders and ankles bend instead of showing the
// rigid pieces cracking apart. [blend radius along the axis, reach across it (m), axis from, axis to]
const SOFT = {
  spine: [0.12, 0.3, 'spine', 'chest'], // wide: the shirt's hem follows the hips
  chest: [0.08, 0.3, 'spine', 'chest'],
  neck: [0.035, 0.09, 'chest', 'neck'],
  shoulder_L: [0.055, 0.1, 'shoulder_L', 'elbow_L'],
  shoulder_R: [0.055, 0.1, 'shoulder_R', 'elbow_R'],
  elbow_L: [0.055, 0.08, 'elbow_L', 'wrist_L'],
  elbow_R: [0.055, 0.08, 'elbow_R', 'wrist_R'],
  wrist_L: [0.03, 0.06, 'elbow_L', 'wrist_L'],
  wrist_R: [0.03, 0.06, 'elbow_R', 'wrist_R'],
  hip_L: [0.07, 0.11, 'hip_L', 'knee_L'],
  hip_R: [0.07, 0.11, 'hip_R', 'knee_R'],
  knee_L: [0.065, 0.1, 'knee_L', 'ankle_L'],
  knee_R: [0.065, 0.1, 'knee_R', 'ankle_R'],
  ankle_L: [0.04, 0.1, 'knee_L', 'ankle_L'],
  ankle_R: [0.04, 0.1, 'knee_R', 'ankle_R'],
  toe_L: [0.03, 0.08, 'ankle_L', 'toe_L'],
  toe_R: [0.03, 0.08, 'ankle_R', 'toe_R']
};
const smooth01 = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const TIES = ['#3e5433', '#2f3b5c', '#6b2a2f', '#3a3a40', '#8a6a2a'];
const CAPS = ['#2b2f38', '#b0463a', '#3f6fb0', '#d9b25c', '#477652'];

/** Load npc.glb and turn it into a rigidly skinned template. */
export function loadNpcPack(url) {
  return new GLTFLoader().loadAsync(url).then(buildTemplate);
}

export function buildTemplate(gltf) {
  const source = gltf.scene.getObjectByName(BONES[0]);
  if (!source) return null;
  gltf.scene.updateMatrixWorld(true);
  const toRoot = source.matrixWorld.clone().invert();
  // A bone per pivot, same local transforms, same hierarchy
  const bones = [];
  const boneOf = new Map();
  for (const name of BONES) {
    const node = name === BONES[0] ? source : source.getObjectByName(name);
    if (!node) return null;
    const bone = new THREE.Bone();
    bone.name = name;
    if (node !== source) bone.position.copy(node.position), bone.quaternion.copy(node.quaternion), bone.scale.copy(node.scale);
    boneOf.set(node, bones.length);
    bones.push(bone);
  }
  for (const [node, i] of boneOf) {
    let p = node.parent;
    while (p && !boneOf.has(p)) p = p.parent;
    if (p && node !== source) bones[boneOf.get(p)].add(bones[i]);
  }
  // Soft joints in the bind pose (root space): pivot, axis, and the bones on either side
  const pivot = (name) => new THREE.Vector3().setFromMatrixPosition(source.getObjectByName(name).matrixWorld).applyMatrix4(toRoot);
  const joints = Object.entries(SOFT).map(([name, [r, lat, a, b]]) => {
    const child = BONES.indexOf(name);
    let parentNode = source.getObjectByName(name).parent;
    while (parentNode && !boneOf.has(parentNode)) parentNode = parentNode.parent;
    return { child, parent: boneOf.get(parentNode), p: pivot(name), axis: pivot(b).sub(pivot(a)).normalize(), r, lat };
  });
  const _d = new THREE.Vector3();
  /** Second bone and its weight for a vertex rigidly on `bone` (0 when it stays rigid). */
  const soften = (x, y, z, bone) => {
    let best = null;
    let bestW = 0;
    for (const j of joints) {
      const mine = j.child === bone;
      if (!mine && j.parent !== bone) continue;
      _d.set(x, y, z).sub(j.p);
      const s = _d.dot(j.axis);
      const lat = _d.addScaledVector(j.axis, -s).length();
      const f = 1 - smooth01(j.lat, j.lat * 1.6, lat);
      if (f <= 0) continue;
      const t = smooth01(-j.r, j.r, s); // the child's share across the joint
      // A child vertex hands weight to the parent on the parent's side; a parent vertex to
      // the child around the pivot only (parent geometry reaching past it stays with the parent)
      const w = mine ? f * (1 - t) : f * t * (1 - smooth01(0, j.r, s));
      if (w > bestW) {
        bestW = w;
        best = mine ? j.parent : j.child;
      }
    }
    return best === null || bestW < 0.02 ? null : [best, bestW];
  };
  const parts = [];
  let authoredCrown = false;
  source.traverse((o) => o.isMesh && /^hair_.*_crown$/.test(o.name) && (authoredCrown = true));
  const tag = (geo, bone, slot, shade, piece, color = null, expr = 0) => {
    const n = geo.attributes.position.count;
    const c = color || new THREE.Color(shade, shade, shade);
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(colors, i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSlot', new THREE.BufferAttribute(new Float32Array(n).fill(slot), 1));
    geo.setAttribute('aPiece', new THREE.BufferAttribute(new Float32Array(n).fill(piece), 1));
    geo.setAttribute('aExpr', new THREE.BufferAttribute(new Float32Array(n).fill(expr), 1));
    const index = new Uint16Array(n * 4);
    const weight = new Float32Array(n * 4);
    const pos = geo.attributes.position;
    for (let i = 0; i < n; i++) {
      index[i * 4] = bone;
      weight[i * 4] = 1;
      // Clothes and skin only: head gear, faces and the cup stay rigid
      const soft = piece || expr ? null : soften(pos.getX(i), pos.getY(i), pos.getZ(i), bone);
      if (soft) {
        index[i * 4 + 1] = soft[0];
        weight[i * 4] = 1 - soft[1];
        weight[i * 4 + 1] = soft[1];
      }
    }
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(index, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(weight, 4));
    parts.push(geo);
  };
  source.traverse((mesh) => {
    if (!mesh.isMesh) return;
    let p = mesh.parent;
    while (p && !boneOf.has(p)) p = p.parent;
    const bone = boneOf.get(p) ?? 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', mesh.geometry.attributes.position);
    g.setAttribute('normal', mesh.geometry.attributes.normal);
    const count = mesh.geometry.attributes.position.count;
    g.setIndex(mesh.geometry.index || Array.from({ length: count }, (_, i) => i));
    const geo = g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld));
    const [slot, shade] = SLOTS[mesh.material.name] || [0, 1];
    // Expression variant: feature (1 eyes, 2 brows, 3 mouth) * 8 + variant index
    const em = /^expr_([a-z]+)_([a-z]+)/.exec(mesh.name);
    const fi = em ? FEATURES.indexOf(em[1]) : -1;
    const expr = fi >= 0 && EXPR[em[1]].includes(em[2]) ? (fi + 1) * 8 + EXPR[em[1]].indexOf(em[2]) : 0;
    tag(geo, bone, slot, shade, PIECE.find(([re]) => re.test(mesh.name))?.[1] ?? 0, slot ? null : mesh.material.color, expr);
    if (!authoredCrown && /^head_H/.test(mesh.name)) {
      // Crown: over the top and down the back of the skull, clear of the brow
      geo.computeBoundingBox();
      const { min, max } = geo.boundingBox;
      const w = max.x - min.x, h = max.y - min.y, d = max.z - min.z;
      const top = new RoundedBoxGeometry(w * 1.06, h * 0.2, d * 0.94, 2, Math.min(w, d) * 0.08)
        .translate((min.x + max.x) / 2, max.y - h * 0.06, (min.z + max.z) / 2 - d * 0.05);
      const back = new RoundedBoxGeometry(w * 1.06, h * 0.55, d * 0.3, 2, Math.min(w, d) * 0.08)
        .translate((min.x + max.x) / 2, max.y - h * 0.3, min.z + d * 0.12);
      for (const g of [top, back]) {
        g.deleteAttribute('uv');
        if (!g.index) g.setIndex(Array.from({ length: g.attributes.position.count }, (_, i) => i));
        tag(g, bone, 2, 1, 5);
      }
    }
  });
  if (!parts.length) return null;
  const geometry = mergeGeometries(parts);
  geometry.computeBoundingSphere();
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }));
  mesh.name = 'npc';
  const root = new THREE.Group();
  root.add(bones[0], mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  return { root, triangles: geometry.index.count / 3 };
}

/** Per-person material: palette slots and hidden pieces in uniforms, one shared program. */
function npcMaterial() {
  const uniforms = { uPalette: { value: Array.from({ length: 7 }, () => new THREE.Color()) }, uHide: { value: new THREE.Vector4() }, uTie: { value: 0 }, uExpr: { value: new THREE.Vector3() } };
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSlot;\nattribute float aPiece;\nattribute float aExpr;\nuniform vec3 uPalette[7];\nuniform vec4 uHide;\nuniform float uTie;\nuniform vec3 uExpr;\nvarying vec3 vBind;\nvarying float vDepth;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vBind = position;
        // A hidden piece collapses onto its bone: degenerate, never rasterised
        int piece = int(aPiece + 0.5);
        if ((piece > 0 && piece < 5 && uHide[piece - 1] > 0.5) || (piece == 5 && uHide[2] < 0.5) || (piece == 6 && uTie < 0.5)) transformed = vec3(0.0);
        // Expressions: only the chosen variant of each feature is drawn
        int ex = int(aExpr + 0.5);
        if (ex > 0) {
          int feature = ex / 8;
          float want = feature == 1 ? uExpr.x : feature == 2 ? uExpr.y : uExpr.z;
          if (abs(float(ex - feature * 8) - want) > 0.5) transformed = vec3(0.0);
          else if (feature == 3 && uHide[1] < 0.5) transformed.z += ${MOUTH_ON_BEARD.toFixed(3)};
        }`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        int slot = int(aSlot + 0.5);
        if (slot > 0) vColor.rgb *= uPalette[slot - 1];`)
      .replace('#include <project_vertex>', '#include <project_vertex>\nvDepth = -mvPosition.z;');
    // Painted pixels, as in the reference art: 2 cm cells of the bind pose, each a shade lighter
    // or darker. They stick to the cloth as it moves and fade out before they could shimmer.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBind;\nvarying float vDepth;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float px = fract(sin(dot(floor(vBind * 45.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        diffuseColor.rgb *= 1.0 + (px - 0.5) * 0.13 * (1.0 - smoothstep(5.0, 16.0, vDepth));`);
  };
  m.customProgramCacheKey = () => 'npc-v1-pixels';
  m.userData.uniforms = uniforms;
  return m;
}

/** Dress a person from an identity seed; the same seed gives the same look (colours match the far crowd). */
export function dressNpc(person, identity) {
  const a = appearanceFor(identity);
  const [skin, hair, top, tie, legs, shoes, cap] = person.material.userData.uniforms.uPalette.value;
  skin.setHex(a.skin);
  hair.setHex(a.hair);
  top.setHex(a.top);
  tie.set(TIES[seedFor(identity, 'tie-colour') % TIES.length]);
  legs.setHex(a.legs);
  shoes.setHex(a.shoes);
  cap.set(CAPS[seedFor(identity, 'cap') % CAPS.length]);
  const roll = (key, p) => (seedFor(identity, key) % 1000) / 1000 < p;
  const cup = roll('cup', 0.18);
  person.material.userData.uniforms.uHide.value.set(roll('glasses', 0.3) ? 0 : 1, roll('beard', 0.28) ? 0 : 1, roll('cap', 0.35) ? 0 : 1, cup ? 0 : 1);
  person.material.userData.uniforms.uTie.value = roll('tie', 0.45) ? 1 : 0;
  person.cup = cup;
  // Everyone walks and rests a little differently, and has a usual face
  const u = (key) => (seedFor(identity, key) % 1000) / 1000;
  person.style = { stride: 0.93 + u('stride') * 0.14, arm: 0.8 + u('arm') * 0.4, bounce: 0.8 + u('bounce') * 0.5, lean: (u('lean') - 0.4) * 0.08, sway: 0.7 + u('sway') * 0.6, seed: u('phase') * 100 };
  person.mood = u('mood') < 0.4 ? 'content' : u('mood') < 0.5 ? 'smile' : 'neutral';
  person.time = person.style.seed;
}

/** The player: the office reference look (pale shirt, loosened tie, brown loafers), the tie in the faction's colour. */
export function dressPlayer(person, { top = 0x027b49 } = {}) {
  const [skin, hair, shirt, tie, legs, shoes, cap] = person.material.userData.uniforms.uPalette.value;
  skin.setHex(0xd99b73);
  hair.setHex(0x2e211b);
  shirt.set('#d3d2b9');
  tie.setHex(top);
  legs.setHex(0x46464b);
  shoes.setHex(0x7a4a2c);
  cap.setHex(0x25262b);
  person.material.userData.uniforms.uHide.value.set(1, 1, 1, 1);
  person.material.userData.uniforms.uTie.value = 1;
  person.cup = false;
  person.style = { stride: 1, arm: 1, bounce: 1, lean: 0, sway: 1, seed: 0 };
  person.mood = 'content';
}

/** Show a named expression (see FACES). */
export function setFace(person, name) {
  const f = faceIndex[name] || faceIndex.neutral;
  person.material.userData.uniforms.uExpr.value.set(f[0], f[1], f[2]);
}

/** One NPC from the template: a skinned clone with its own material and pose state. */
export function makeNpc(template, { shadows = true } = {}) {
  const root = cloneSkinned(template.root);
  const mesh = root.getObjectByName('npc');
  const material = npcMaterial();
  mesh.material = material;
  mesh.castShadow = shadows;
  mesh.frustumCulled = false; // posed bones move the geometry past its bind bounds
  const bones = {};
  root.traverse((o) => { if (o.isBone) bones[o.name] = { node: o, rest: o.quaternion.clone(), y: o.position.y }; });
  // Without the cup the right arm hangs like the left one (mirrored across X)
  const l = new THREE.Euler().setFromQuaternion(bones.shoulder_L.rest);
  const le = new THREE.Euler().setFromQuaternion(bones.elbow_L.rest);
  const armDown = {
    shoulder: new THREE.Quaternion().setFromEuler(new THREE.Euler(l.x, -l.y, -l.z)),
    elbow: new THREE.Quaternion().setFromEuler(new THREE.Euler(le.x, -le.y, -le.z))
  };
  return {
    root, mesh, material, bones, armDown, phase: 0, speed: 0, cup: false, index: -1, time: 0, mood: 'neutral',
    style: { stride: 1, arm: 1, bounce: 1, lean: 0, sway: 1, seed: 0 },
    look: { yaw: 0, pitch: 0, toYaw: 0, toPitch: 0, next: 1 },
    face: { blink: 2, closed: 0, glance: 0, current: '' },
    air: 0
  };
}

export function disposeNpc(p) {
  if (!p) return;
  p.material.dispose();
  p.mesh.skeleton?.dispose();
  p.root.removeFromParent();
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
function pose(b, rest, x = 0, y = 0, z = 0) {
  b.node.quaternion.multiplyQuaternions(rest ?? b.rest, _q.setFromEuler(_e.set(x, y, z)));
}
const bump = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));
const wrap = (x) => x - Math.floor(x);

// Leg lengths of the model (m): hip to knee, knee to ankle, ankle to sole, heel and ball
// of the foot from the ankle. Used to keep the standing foot on the ground.
const THIGH = 0.4, SHIN = 0.4, ANKLE_H = 0.105, HEEL = 0.082, BALL = 0.128, HIP_H = 0.905;

/** Share of the gait cycle a foot is on the ground: half when walking, about a third running. */
const stanceShare = (run) => 0.5 - 0.15 * run;

/**
 * Leg angles at gait phase phi (0..1; heel strike at 0.25, toe-off at 0.25 + stance share).
 * Positive X swings a joint back (knee bends, toes point down). In stance the thigh sweeps
 * back at an almost even rate (so the planted foot does not skate); in swing it eases
 * forward, the knee folds early to clear the ground, then straightens for the heel strike.
 * The foot keeps its own pitch: toes up at heel strike, flat, peeling off, toes up in swing.
 */
function gait(phi, A, run) {
  const sf = stanceShare(run);
  const into = wrap(phi - 0.25);
  const stance = into < sf;
  const u = stance ? into / sf : (into - sf) / (1 - sf);
  const hip = A * (stance ? 0.8 * (2 * u - 1) - 0.2 * Math.cos(Math.PI * u) : Math.cos(Math.PI * u));
  const swingFlex = stance ? 0 : Math.sin(Math.PI * u ** 0.7) ** 2;
  const load = stance ? bump(u, 0.18, 0.12) : 0;
  const knee = A * ((1.35 + run * 1.1) * swingFlex + 0.45 * load);
  const lift = stance ? -0.2 * bump(u, 0, 0.12) + (0.5 + run * 0.35) * bump(u, 0.97, 0.13) : -0.12 * swingFlex - 0.15 * bump(u, 1, 0.12);
  return { hip, knee, foot: (A / 0.4) * lift, stance };
}

/** Height from the hip joint down to the lowest point of the sole (heel or ball). */
function legDrop(hip, knee, foot) {
  const a2 = hip + knee;
  const ankle = THIGH * Math.cos(hip) + SHIN * Math.cos(a2);
  const heel = ANKLE_H * Math.cos(foot) - HEEL * Math.sin(foot);
  const ball = ANKLE_H * Math.cos(foot) + BALL * Math.sin(foot);
  return ankle + Math.max(heel, ball);
}

/** How far the ankle is ahead of the hip (m). */
function legReach(hip, knee) {
  return -(THIGH * Math.sin(hip) + SHIN * Math.sin(hip + knee));
}

function poseLeg(B, side, g, extra) {
  const hip = g.hip + extra.hip;
  const knee = g.knee + extra.knee;
  const foot = g.foot + extra.foot;
  pose(B[`hip_${side}`], null, hip, 0, extra.hipZ);
  pose(B[`knee_${side}`], null, knee);
  pose(B[`ankle_${side}`], null, foot - hip - knee, 0, -extra.hipZ);
  // The toes stay on the ground while the heel peels off
  pose(B[`toe_${side}`], null, -Math.max(0, foot) * 0.9);
  return legDrop(hip, knee, foot);
}

/** Where the eyes wander: a new target every few seconds, eased toward. */
function updateLook(p, dt, range, busy) {
  const L = p.look;
  L.next -= dt;
  if (L.next <= 0) {
    L.toYaw = (Math.random() * 2 - 1) * range;
    L.toPitch = (Math.random() - 0.35) * 0.25;
    L.next = 2 + Math.random() * 4;
    if (!busy && Math.abs(L.toYaw) > range * 0.6 && Math.random() < 0.35) p.face.glance = 0.9;
  }
  const k = 1 - Math.exp(-dt * 3.5);
  L.yaw += (L.toYaw - L.yaw) * k;
  L.pitch += (L.toPitch - L.pitch) * k;
}

/** Expression for the moment: state first, then a passing glance, the usual mood, and blinks. */
function updateFace(p, dt, state) {
  const F = p.face;
  F.blink -= dt;
  if (F.blink <= 0) {
    F.closed = 0.13;
    F.blink = 1.8 + Math.random() * 3.8;
  }
  F.closed -= dt;
  F.glance -= dt;
  let name = state || (F.glance > 0 ? 'curious' : p.mood);
  if (F.closed > 0 && name !== 'asleep') name = name === 'smile' || name === 'laugh' ? name : 'neutral_blink';
  if (name === F.current) return;
  F.current = name;
  if (name === 'neutral_blink') {
    const f = faceIndex[state || p.mood] || faceIndex.neutral;
    p.material.userData.uniforms.uExpr.value.set(1, f[1], f[2]);
  } else setFace(p, name);
}

/**
 * Pose the rigid parts. Walking and running are a gait cycle for the legs (heel strike,
 * roll, toe-off, knee flex in swing), a pelvis that bobs, sways and turns with the legs,
 * shoulders counter-turning, arms swinging late with soft elbows and wrists, and a head
 * that stays level and looks around. Standing still breathes and shifts its weight.
 * opts: panic (arms up), pose ('sit' | 'sleep'), jump (height above ground, m), turn (rad/s).
 */
export function animateNpc(p, dt, speed, { panic = false, pose: hold = null, jump = 0, turn = 0 } = {}) {
  dt = Math.max(0, dt);
  p.time = (p.time || 0) + dt;
  p.speed += (Math.max(0, hold ? 0 : speed) - p.speed) * (1 - Math.exp(-dt * 10));
  const B = p.bones;
  const st = p.style;
  const t = p.time;
  const breath = Math.sin(t * 1.6 + st.seed) * 0.018;
  if (hold === 'sit' || hold === 'sleep') {
    holdPose(p, dt, hold, breath);
    return;
  }
  const v = p.speed;
  const sm = THREE.MathUtils.smoothstep;
  const walk = sm(v, 0.1, 0.9);
  const run = sm(v, 2.8, 4.6);
  const idle = 1 - walk;
  const scale = p.root.scale.y || 1;
  const vs = v / scale; // speed in the model's own metres
  // Longer steps the faster you go; the stride is measured from the legs themselves
  const A = THREE.MathUtils.lerp(THREE.MathUtils.clamp(0.16 + 0.22 * vs, 0.16, 0.5), THREE.MathUtils.clamp(0.5 + 0.04 * vs, 0.5, 0.72), run) * st.stride * walk;
  const reach = (g) => legReach(g.hip, g.knee);
  // The planted foot must sweep back exactly as fast as the body moves on: the stride (per
  // cycle) is the rate at which the foot's reach changes over the flat-footed middle of stance
  const sf = stanceShare(run);
  const pa = 0.25 + sf * 0.3, pb = 0.25 + sf * 0.6;
  const sweep = (reach(gait(pa, A, run)) - reach(gait(pb, A, run))) / (pb - pa);
  const stride = Math.max(0.3, sweep) * scale;
  p.phase = (p.phase + (dt * v) / stride) % 1;
  const ph = p.phase;
  const w = TAU * ph;
  // In the air: knees tuck, arms lift for balance
  p.air += ((jump > 0.02 ? 1 : 0) - p.air) * (1 - Math.exp(-dt * 14));
  const air = p.air;

  // Standing: weight drifts from foot to foot, knees soften on the loaded side
  const shift = Math.sin(t * 0.55 * st.sway + st.seed) * idle;
  const extra = (s) => ({
    hip: -air * 0.55 + idle * 0.03,
    knee: air * 0.95 + idle * Math.max(0, -s * shift) * 0.12,
    foot: air * 0.2,
    hipZ: idle * shift * 0.03 * (s > 0 ? 1 : -1)
  });
  const gL = gait(ph, A, run);
  const gR = gait(wrap(ph + 0.5), A, run);
  const dropL = poseLeg(B, 'L', gL, extra(1));
  const dropR = poseLeg(B, 'R', gR, extra(-1));

  // Pelvis: as low as the standing leg lets it be (so that foot is on the ground), plus a
  // hop between steps when running; sways over the standing leg, rolls and turns with the stride
  const ground = air > 0.02 ? 0 : Math.max(dropL, dropR) - HIP_H;
  // Running: between one foot's toe-off and the other's heel strike both are off the ground
  let flight = 0;
  if (!gL.stance && !gR.stance && sf < 0.5) {
    const f = wrap(ph - 0.25 - sf) % 0.5 / (0.5 - sf);
    flight = run * 0.06 * Math.sin(Math.PI * THREE.MathUtils.clamp(f, 0, 1)) * st.bounce;
  }
  B.hips.node.position.y = B.hips.y + ground + flight;
  B.hips.node.position.x = idle * shift * 0.018 + walk * Math.sin(w) * 0.012 * (1 - run * 0.5);
  const pelvisYaw = Math.sin(w) * (0.1 + run * 0.06) * walk;
  const pelvisRoll = Math.cos(w) * 0.035 * walk + idle * shift * 0.03;
  pose(B.hips, null, 0, pelvisYaw, pelvisRoll);

  // Torso: waist and chest share the counter-turn to the pelvis (the chest more), lean into
  // speed and into turns; the chest breathes
  const lean = st.lean + walk * 0.04 + run * 0.2 + air * 0.08;
  const turnLean = THREE.MathUtils.clamp(-turn * 0.05 * (0.4 + walk), -0.14, 0.14);
  const counter = -pelvisYaw * 2.0;
  pose(B.spine, null, lean * 0.55, counter * 0.4, -pelvisRoll * 0.5 + turnLean * 0.5);
  pose(B.chest, null, lean * 0.45 + breath * (0.6 + idle), counter * 0.6, -pelvisRoll * 0.4 + turnLean * 0.5);

  // Head: level and steady (cancels the torso), looks around, into turns, and nods with steps
  updateLook(p, dt, 0.35 + idle * 0.45, panic || run > 0.5);
  const lookYaw = p.look.yaw + THREE.MathUtils.clamp(turn * 0.15, -0.35, 0.35);
  const headYaw = -(pelvisYaw + counter) * 0.9 + lookYaw;
  const nod = Math.cos(2 * w) * 0.02 * walk;
  const headPitch = -lean * 0.8 + p.look.pitch + nod - breath * idle * 0.5;
  pose(B.neck, null, headPitch * 0.35, headYaw * 0.35, (pelvisRoll * 0.9) * 0.3);
  pose(B.head, null, headPitch * 0.65, headYaw * 0.65, 0);

  // Arms swing against the legs, a beat late; the shoulder blades travel with them,
  // elbows bend on the forward swing, wrists trail
  const armW = w - 0.35;
  const arm = (0.3 + A * 0.35 + run * 0.3) * st.arm * walk;
  const armIdle = (s) => idle * (0.02 * Math.sin(t * 0.8 + s + st.seed) - s * shift * 0.02);
  const swingL = Math.sin(armW);
  const out = 0.05 + run * 0.12 + air * 0.35;
  const shrug = breath * 0.4 * idle + run * 0.06 + air * 0.08;
  pose(B.clavicle_L, null, 0, swingL * 0.14 * walk, shrug);
  pose(B.clavicle_R, null, 0, swingL * 0.14 * walk, -shrug);
  if (panic) {
    pose(B.shoulder_L, null, -2.5 + Math.sin(w) * 0.3, 0, 0.3);
    pose(B.shoulder_R, p.cup ? null : p.armDown.shoulder, -2.5 - Math.sin(w) * 0.3, 0, -0.3);
    pose(B.elbow_L, null, -0.5 - Math.sin(w * 2) * 0.3);
    if (!p.cup) pose(B.elbow_R, p.armDown.elbow, -0.5 + Math.sin(w * 2) * 0.3);
  } else {
    pose(B.shoulder_L, null, swingL * arm - air * 0.5 + armIdle(1), 0, out);
    pose(B.elbow_L, null, -(0.14 + walk * 0.12 + run * 1.05 + Math.max(0, -swingL) * arm * 0.7 + air * 0.4) - idle * breath);
    if (p.cup) {
      pose(B.shoulder_R, null, -swingL * arm * 0.25);
      pose(B.elbow_R, null);
    } else {
      pose(B.shoulder_R, p.armDown.shoulder, -swingL * arm - air * 0.5 + armIdle(-1), 0, -out);
      pose(B.elbow_R, p.armDown.elbow, -(0.14 + walk * 0.12 + run * 1.05 + Math.max(0, swingL) * arm * 0.7 + air * 0.4) - idle * breath);
    }
  }
  const flick = Math.sin(armW - 0.7) * 0.18 * walk * st.arm;
  pose(B.wrist_L, null, flick + idle * 0.05, 0, -0.04);
  if (!p.cup) pose(B.wrist_R, null, -flick + idle * 0.05, 0, 0.04);

  updateFace(p, dt, panic ? 'scared' : air > 0.5 ? 'curious' : run > 0.6 ? 'focused' : null);
}

/** Sitting (hips down to the seat, hands on the lap) or lying asleep on the back. */
function holdPose(p, dt, hold, breath) {
  const B = p.bones;
  const L = p.look;
  for (const b of ['chest', 'clavicle_L', 'clavicle_R', 'toe_L', 'toe_R']) pose(B[b], null);
  if (hold === 'sit') {
    B.hips.node.position.set(0, B.hips.y - 0.46, 0);
    pose(B.hips, null);
    for (const s of ['L', 'R']) {
      pose(B[`hip_${s}`], null, -1.5, 0, s === 'L' ? 0.04 : -0.04);
      pose(B[`knee_${s}`], null, 1.45);
      pose(B[`ankle_${s}`], null, 0.05);
    }
    pose(B.spine, null, -0.04 + breath);
    updateLook(p, dt, 0.6, false);
    pose(B.neck, null, L.pitch * 0.35, L.yaw * 0.35);
    pose(B.head, null, L.pitch * 0.65 - breath * 0.5, L.yaw * 0.65);
    pose(B.shoulder_L, null, -0.42, 0, 0.08);
    pose(B.elbow_L, null, -0.95 - breath);
    pose(B.wrist_L, null, 0.15);
    pose(B.shoulder_R, p.armDown.shoulder, -0.42, 0, -0.08);
    pose(B.elbow_R, p.armDown.elbow, -0.95 - breath);
    pose(B.wrist_R, null, 0.15);
    updateFace(p, dt, null);
  } else {
    B.hips.node.position.set(0, B.hips.y, 0);
    pose(B.hips, null, -Math.PI / 2);
    for (const s of ['L', 'R']) {
      pose(B[`hip_${s}`], null, -0.05, 0, s === 'L' ? 0.05 : -0.05);
      pose(B[`knee_${s}`], null, 0.12);
      pose(B[`ankle_${s}`], null, 0.3);
    }
    const slow = Math.sin(p.time * 0.9) * 0.02;
    pose(B.spine, null, slow);
    pose(B.neck, null, -0.1);
    pose(B.head, null, -0.12, 0.25);
    pose(B.shoulder_L, null, 0, 0, 0.12);
    pose(B.elbow_L, null, -0.3 - slow);
    pose(B.wrist_L, null);
    pose(B.shoulder_R, p.armDown.shoulder, 0, 0, -0.12);
    pose(B.elbow_R, p.armDown.elbow, -0.3 - slow);
    pose(B.wrist_R, null);
    updateFace(p, dt, 'asleep');
  }
}

/**
 * Near the camera a pool of NPCs stands in for the instanced crowd (the same
 * interface as RiggedPeople): each keeps its walker until it is clearly out of reach.
 */
export class ChunkyPeople {
  constructor(template, scene, { count, shadows, seed = 1 }) {
    this.seed = seed;
    this.pool = [];
    for (let i = 0; i < count; i++) {
      const p = makeNpc(template, { shadows });
      p.root.visible = false;
      scene.add(p.root);
      this.pool.push(p);
    }
    this.timer = 0;
  }

  assign(walkers, people, cam, reach = 70) {
    const dist = (i) => Math.hypot(people[i].x - cam.x, people[i].z - cam.z);
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
    for (const w of walkers) if (!held.has(w.i) && dist(w.i) < reach) near.push([dist(w.i), w.i]);
    near.sort((a, b) => a[0] - b[0]);
    for (const [, i] of near) {
      const r = free.pop();
      if (!r) break;
      r.index = i;
      dressNpc(r, this.seed * 131 + i);
      r.root.scale.setScalar(people[i].height);
      r.root.rotation.y = people[i].yaw;
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
      const dyaw = Math.atan2(Math.sin(p.yaw - r.root.rotation.y), Math.cos(p.yaw - r.root.rotation.y)) * (1 - Math.exp(-dt * 12));
      r.root.rotation.y += dyaw;
      animateNpc(r, dt, p.speed, { panic: fleeing.has(r.index) && p.speed > 3, turn: dt > 0 ? dyaw / dt : 0 });
    }
  }

  dispose() {
    for (const r of this.pool) disposeNpc(r);
    this.pool = [];
  }
}
