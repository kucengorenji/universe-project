import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildTemplate, makeNpc, animateNpc, setFace, disposeNpc } from '../../modes/town/people/chunkyPeople.js';
import { getToonGradient } from '../../render/assetLibrary.js';
import { CLASSES, FACTIONS, kitTag, personFor } from './soldierLook.js';

// Skirmish soldiers: the townsfolk rig (chunkyPeople.js) dressed from soldier.glb, one template
// per faction and class (other helmets and other classes' gear are dropped before merging, so
// each soldier stays one draw call). The weapon is a separate mesh placed in world space each
// frame from the stance; both arms then reach for it with two-bone IK (grip and support hand).

/** Load soldier.glb and build the ten templates. */
export async function loadSoldierTemplates(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const templates = {};
  for (const [faction, F] of Object.entries(FACTIONS)) {
    for (const [cls, C] of Object.entries(CLASSES)) {
      const scene = gltf.scene.clone(true);
      const drop = [];
      scene.traverse((o) => {
        if (!o.isMesh) return;
        // buildTemplate transforms positions in place: each template needs its own buffers
        o.geometry = o.geometry.clone();
        if (o.name.startsWith('hat_') && o.name !== 'hat_strap' && o.name !== F.helmet) drop.push(o);
        const tag = kitTag(o.name);
        if (tag && !C.kit.includes(tag)) drop.push(o);
      });
      drop.forEach((o) => o.removeFromParent());
      templates[`${faction}:${cls}`] = buildTemplate({ scene });
    }
  }
  return templates;
}

/** Weapon meshes from military.glb: geometry (from the shared pack loader) plus the support-hand and muzzle marks. */
export async function loadWeapons(url, pack) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const weapons = {};
  for (const holder of gltf.scene.children) {
    if (!holder.name.startsWith('w_') || !pack[holder.name]?.[0]) continue;
    const mark = (n) => holder.getObjectByName(`${holder.name}_${n}`)?.position.clone() ?? null;
    weapons[holder.name] = { geometry: pack[holder.name][0], support: mark('support'), muzzle: mark('muzzle') };
  }
  return weapons;
}

let weaponMaterial = null;
export const gunMaterial = () => (weaponMaterial ||= new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }));

/**
 * Stances: how the weapon sits relative to the body (grip position in the body frame, metres,
 * +Z forward, -X the soldier's right; aim = the barrel follows the aim direction), and how
 * the torso turns. Lances are held under the arm, never shouldered.
 */
export const HOLDS = {
  rifle: {
    ready: { grip: [-0.13, 1.02, 0.2], dir: [0.42, 0.62, 0.66], torso: 0 },
    aim: { grip: [-0.1, 1.36, 0.16], torso: -0.55, cheek: true }
  },
  smg: {
    ready: { grip: [-0.12, 1.0, 0.22], dir: [0.3, 0.25, 0.92], torso: 0 },
    aim: { grip: [-0.1, 1.2, 0.3], torso: -0.35 }
  },
  lance: {
    ready: { grip: [-0.17, 1.08, 0.02], dir: [0.06, 0.12, 0.99], torso: 0 },
    aim: { grip: [-0.17, 1.14, 0.02], torso: -0.2, under: true }
  }
};

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

/** One soldier: the dressed NPC, its weapon, and its stance. */
export function makeSoldier(templates, weapons, { faction = 'fed', cls = 'scout', seed = 1, shadows = true } = {}) {
  const C = CLASSES[cls];
  const F = FACTIONS[faction];
  const p = makeNpc(templates[`${faction}:${cls}`], { shadows });
  const [skin, hair, top, tie, legs, shoes, cap] = p.material.userData.uniforms.uPalette.value;
  const person = personFor(seed);
  skin.set(person.skin);
  hair.set(person.hair);
  top.set(F.top);
  tie.set(F.scarf);
  legs.set(F.legs);
  shoes.set(F.boots);
  cap.set(F.helmet_color);
  // helmet on (cap slot shown), cup never; glasses and beards on a few
  p.material.userData.uniforms.uHide.value.set(person.glasses ? 0 : 1, person.beard ? 0 : 1, 0, 1);
  p.material.userData.uniforms.uTie.value = 1;
  p.cup = false;
  p.mood = 'focused';
  setFace(p, 'focused');
  const w = weapons[C.weapon];
  const gun = new THREE.Mesh(w.geometry, gunMaterial());
  gun.castShadow = shadows;
  p.root.add(gun); // posed in root space every frame
  return Object.assign(p, { faction, cls, gun, weapon: w, hold: HOLDS[C.hold], stance: 'ready', crouch: 0, aimYaw: 0, aimPitch: 0, aimBlend: 0, crouchBlend: 0 });
}

export function disposeSoldier(s) {
  s.gun.removeFromParent();
  disposeNpc(s);
}

/**
 * Pose a soldier for this frame: the walk from chunkyPeople, then crouch (kneeling when still,
 * a low walk when moving), the torso turned into the stance, recoil and hit flinches, the weapon
 * placed and both hands brought to it. Downed and dead soldiers fall and lie still.
 *   speed: ground speed (m/s); aim: true while aiming (aimYaw/aimPitch relative to the body);
 *   down: 'down' (on the back, rescuable) | 'dead' (face down) | false
 */
export function animateSoldier(s, dt, speed, { aim = false, crouch = false, turn = 0, down = false } = {}) {
  s.recoil = (s.recoil || 0) * Math.exp(-dt * 14);
  s.flinch = (s.flinch || 0) * Math.exp(-dt * 5);
  if (down) {
    s.gun.visible = false;
    fall(s, dt, down === 'dead');
    return;
  }
  s.gun.visible = true;
  s.fallT = 0;
  const k = 1 - Math.exp(-dt * 10);
  s.aimBlend += ((aim ? 1 : 0) - s.aimBlend) * k;
  s.crouchBlend += ((crouch ? 1 : 0) - s.crouchBlend) * k;
  animateNpc(s, dt, aim ? Math.min(speed, 1.2) : speed, { turn });
  const B = s.bones;
  const a = s.aimBlend;
  const c = s.crouchBlend;
  const hold = s.hold;

  if (c > 0.001) {
    const still = 1 - THREE.MathUtils.smoothstep(s.speed, 0.2, 1.0);
    // kneel: right knee to the ground, left foot planted ahead
    const kc = c * still;
    B.hips.node.position.y -= 0.42 * kc;
    rotate(B.hip_L, -1.35 * kc, 0, 0.05 * kc);
    rotate(B.knee_L, 1.45 * kc);
    rotate(B.ankle_L, -0.1 * kc);
    rotate(B.hip_R, -0.25 * kc, 0, -0.08 * kc);
    rotate(B.knee_R, 1.9 * kc);
    rotate(B.ankle_R, 0.55 * kc);
    rotate(B.toe_R, -0.6 * kc);
    rotate(B.spine, 0.12 * kc);
    // moving crouched: hips low, knees bent, leaning into the walk
    const km = c * (1 - still);
    B.hips.node.position.y -= 0.3 * km;
    for (const side of ['L', 'R']) {
      rotate(B[`hip_${side}`], -0.5 * km);
      rotate(B[`knee_${side}`], 0.85 * km);
      rotate(B[`ankle_${side}`], -0.35 * km);
    }
    rotate(B.spine, 0.32 * km);
    rotate(B.neck, -0.25 * km);
  }

  // Torso turns sideways into the shot; the head keeps looking along the aim and leans to the stock
  const torso = THREE.MathUtils.lerp(hold.ready.torso, hold.aim.torso, a);
  rotate(B.spine, -0.1 * s.flinch, torso * 0.4 + s.aimYaw * a * 0.3);
  rotate(B.chest, -s.aimPitch * a * 0.4 - 0.25 * s.flinch - 0.05 * s.recoil, torso * 0.6 + s.aimYaw * a * 0.4);
  rotate(B.neck, 0.15 * s.flinch, -torso * 0.4);
  rotate(B.head, s.aimPitch * a * 0.5 + (hold.aim.cheek ? 0.12 * a : 0), -torso * 0.6 + s.aimYaw * a * 0.3, hold.aim.cheek ? -0.22 * a : 0);
  if (s.flinch > 0.3) setFace(s, 'worried');
  else if (a > 0.5) setFace(s, 'focused');

  s.root.updateMatrixWorld(true);
  placeWeapon(s, a);
  reachArm(s, 'R', gripWorld(s), poleR(s));
  if (s.weapon.support) reachArm(s, 'L', supportWorld(s), poleL(s));
}

/** A round leaves the barrel: the weapon kicks back and up. */
export function kick(s) {
  s.recoil = 1;
}

/** Struck by a round: the body jerks back. */
export function flinch(s) {
  s.flinch = 1;
}

/**
 * Falling down (half a second), then lying still: the dead face down, the downed on their back
 * with knees up. The hips drop to the ground and turn a quarter round about the body's side axis.
 */
function fall(s, dt, dead) {
  s.fallT = Math.min(1, (s.fallT || 0) + dt * 2.2);
  const t = s.fallT;
  const e = t < 1 ? 1 - (1 - t) ** 3 : 1;
  const B = s.bones;
  animateNpc(s, 0, 0);
  const lie = dead ? Math.PI / 2 : -Math.PI / 2;
  B.hips.node.position.set(0, THREE.MathUtils.lerp(B.hips.y, 0.16, e), (dead ? 0.35 : -0.35) * e);
  pose(B.hips, lie * e, 0, 0);
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? 1 : -1;
    pose(B[`hip_${side}`], dead ? 0.08 * e : -0.55 * e, 0, sx * 0.12 * e);
    pose(B[`knee_${side}`], dead ? 0.15 * e : 1.0 * e);
    pose(B[`ankle_${side}`], dead ? 0.6 * e : -0.3 * e);
    pose(B[`shoulder_${side}`], (dead ? -0.4 : 0.15) * e, 0, sx * (dead ? 0.9 : 0.45) * e);
    pose(B[`elbow_${side}`], -0.6 * e);
  }
  pose(B.spine, 0);
  pose(B.chest, 0);
  pose(B.neck, 0, dead ? 0.6 * e : 0.3 * e);
  pose(B.head, dead ? -0.2 * e : 0.1 * e, dead ? 0.5 * e : 0);
  setFace(s, dead ? 'asleep' : 'worried');
}

/** Set a bone to its rest rotation times an Euler offset. */
function pose(b, x = 0, y = 0, z = 0) {
  b.node.quaternion.copy(b.rest).multiply(_q.setFromEuler(new THREE.Euler(x, y, z)));
}

export function rotate(b, x = 0, y = 0, z = 0) {
  b.node.quaternion.multiply(_q.setFromEuler(new THREE.Euler(x, y, z)));
}

const _s = new THREE.Vector3();

/**
 * Weapon transform in the soldier's root space, from the ready carry to the aim. Aimed rifles sit
 * with the butt in the right shoulder (the shoulder bone, wherever the turned torso put it), SMGs
 * a hand lower, lances under the arm. Recoil pushes the weapon back and tips the muzzle up.
 */
export function placeWeapon(s, a) {
  const { ready, aim } = s.hold;
  // how far the hands sit lower than standing (a body may say so itself: s.gripDrop)
  const crouchDrop = s.gripDrop ?? 0.42 * s.crouchBlend * (1 - THREE.MathUtils.smoothstep(s.speed, 0.2, 1.0));
  // the aim direction in root space (body yaw stays on the root)
  const aimDir = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(-s.aimPitch - 0.12 * s.recoil, s.aimYaw, 0, 'YXZ'));
  const readyGrip = new THREE.Vector3().fromArray(ready.grip);
  readyGrip.y -= crouchDrop;
  let aimGrip;
  if (aim.under) aimGrip = new THREE.Vector3().fromArray(aim.grip).setY(aim.grip[1] - crouchDrop);
  else {
    // the shoulder pocket, just inside the right shoulder joint
    s.bones.shoulder_R.node.getWorldPosition(_s);
    s.root.worldToLocal(_s);
    _s.x += 0.05;
    _s.y -= aim.cheek ? 0.03 : 0.16;
    _s.z += 0.04;
    // the grip sits forward of the butt by the stock's length
    aimGrip = _s.clone().addScaledVector(aimDir, aim.cheek ? 0.3 : 0.22);
  }
  const grip = readyGrip.lerp(aimGrip, a).addScaledVector(aimDir, -0.07 * s.recoil * a);
  const dir = new THREE.Vector3().fromArray(ready.dir).normalize().lerp(aimDir, a).normalize();
  s.gun.position.copy(grip);
  // the barrel (+Z) along dir, kept upright (no roll)
  _m.lookAt(_w.set(0, 0, 0), dir.clone().negate(), UP);
  s.gun.quaternion.setFromRotationMatrix(_m);
  s.gun.updateMatrixWorld(true);
}

export const gripWorld = (s) => s.gun.localToWorld(new THREE.Vector3(0, -0.02, 0.0));
export const supportWorld = (s) => s.gun.localToWorld(s.weapon.support.clone());
// elbows point down and out
export const poleR = (s) => s.root.localToWorld(new THREE.Vector3(-0.6, 0.4, -0.2));
export const poleL = (s) => s.root.localToWorld(new THREE.Vector3(0.5, 0.5, 0.2));

/** Two-bone IK: rotate shoulder then elbow so the wrist lands on target, the elbow toward the pole. */
export function reachArm(s, side, target, pole) {
  const S = s.bones[`shoulder_${side}`].node;
  const E = s.bones[`elbow_${side}`].node;
  const W = s.bones[`wrist_${side}`].node;
  const sp = S.getWorldPosition(new THREE.Vector3());
  const ep = E.getWorldPosition(new THREE.Vector3());
  const wp = W.getWorldPosition(new THREE.Vector3());
  const la = ep.distanceTo(sp);
  const lb = wp.distanceTo(ep);
  const toT = target.clone().sub(sp);
  const d = THREE.MathUtils.clamp(toT.length(), Math.abs(la - lb) + 1e-3, la + lb - 1e-3);
  const u = toT.normalize();
  const pv = pole.clone().sub(sp);
  const v = pv.sub(u.clone().multiplyScalar(pv.dot(u))).normalize();
  const cosA = THREE.MathUtils.clamp((la * la + d * d - lb * lb) / (2 * la * d), -1, 1);
  const elbow = sp.clone().addScaledVector(u, la * cosA).addScaledVector(v, la * Math.sqrt(1 - cosA * cosA));
  aimBone(S, ep.clone().sub(sp), elbow.clone().sub(sp));
  S.updateMatrixWorld(true);
  const ep2 = E.getWorldPosition(new THREE.Vector3());
  const wp2 = W.getWorldPosition(new THREE.Vector3());
  aimBone(E, wp2.sub(ep2), sp.clone().addScaledVector(u, d).sub(ep2));
  E.updateMatrixWorld(true);
}

/** Turn a bone (in world space) so its current direction `from` points along `to`. */
function aimBone(bone, from, to) {
  const delta = _q.setFromUnitVectors(from.normalize(), to.normalize());
  const world = bone.getWorldQuaternion(new THREE.Quaternion());
  const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(parent.invert().multiply(delta.multiply(world)));
}
