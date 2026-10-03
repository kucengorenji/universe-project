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
const gunMaterial = () => (weaponMaterial ||= new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }));

/**
 * Stances: how the weapon sits relative to the body (grip position in the body frame, metres,
 * +Z forward, -X the soldier's right; aim = the barrel follows the aim direction), and how
 * the torso turns. Lances are held under the arm, never shouldered.
 */
const HOLDS = {
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
 * Pose a soldier for this frame: the walk from chunkyPeople, then crouch, the torso turned into
 * the stance, the weapon placed and both hands brought to it.
 *   speed: ground speed (m/s); aim: true while aiming (aimYaw/aimPitch relative to the body);
 *   down: lying (downed or dead)
 */
export function animateSoldier(s, dt, speed, { aim = false, crouch = false, turn = 0, down = false } = {}) {
  // downed or dead: lying on the back, the weapon dropped
  s.gun.visible = !down;
  if (down) {
    animateNpc(s, dt, 0, { pose: 'sleep' });
    return;
  }
  const k = 1 - Math.exp(-dt * 10);
  s.aimBlend += ((aim ? 1 : 0) - s.aimBlend) * k;
  s.crouchBlend += ((crouch ? 1 : 0) - s.crouchBlend) * k;
  animateNpc(s, dt, aim ? Math.min(speed, 1.2) : speed, { turn });
  const B = s.bones;
  const a = s.aimBlend;
  const c = s.crouchBlend;
  const hold = s.hold;

  // Kneel: right knee to the ground, left foot planted ahead
  if (c > 0.001) {
    const still = 1 - THREE.MathUtils.smoothstep(s.speed, 0.2, 1.2);
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
  }

  // Torso turns sideways into the shot; the head keeps looking along the aim
  const torso = THREE.MathUtils.lerp(hold.ready.torso, hold.aim.torso, a);
  rotate(B.spine, 0, torso * 0.4 + s.aimYaw * a * 0.3);
  rotate(B.chest, -s.aimPitch * a * 0.4, torso * 0.6 + s.aimYaw * a * 0.4);
  rotate(B.neck, 0, -torso * 0.4);
  rotate(B.head, s.aimPitch * a * 0.5, -torso * 0.6 + s.aimYaw * a * 0.3);
  if (a > 0.5) setFace(s, 'focused');

  s.root.updateMatrixWorld(true);
  placeWeapon(s, a);
  reachArm(s, 'R', gripWorld(s), poleR(s));
  if (s.weapon.support) reachArm(s, 'L', supportWorld(s), poleL(s));
}

function rotate(b, x = 0, y = 0, z = 0) {
  b.node.quaternion.multiply(_q.setFromEuler(new THREE.Euler(x, y, z)));
}

/** Weapon transform in the soldier's root space: from the ready carry to the aim. */
function placeWeapon(s, a) {
  const { ready, aim } = s.hold;
  const crouchDrop = 0.42 * s.crouchBlend * (1 - THREE.MathUtils.smoothstep(s.speed, 0.2, 1.2));
  const grip = new THREE.Vector3().fromArray(ready.grip).lerp(_v.fromArray(aim.grip), a);
  grip.y -= crouchDrop;
  // the aim direction in root space (body yaw stays on the root)
  const aimDir = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(-s.aimPitch, s.aimYaw, 0, 'YXZ'));
  const dir = new THREE.Vector3().fromArray(ready.dir).normalize().lerp(aimDir, a).normalize();
  // pull the grip toward the aiming shoulder line as the torso turns
  if (aim.cheek) grip.x += 0.04 * a;
  s.gun.position.copy(grip);
  // the barrel (+Z) along dir, kept upright (no roll)
  _m.lookAt(_w.set(0, 0, 0), dir.clone().negate(), UP);
  s.gun.quaternion.setFromRotationMatrix(_m);
  s.gun.updateMatrixWorld(true);
}

const gripWorld = (s) => s.gun.localToWorld(new THREE.Vector3(0, -0.02, 0.0));
const supportWorld = (s) => s.gun.localToWorld(s.weapon.support.clone());
// elbows point down and out
const poleR = (s) => s.root.localToWorld(new THREE.Vector3(-0.6, 0.4, -0.2));
const poleL = (s) => s.root.localToWorld(new THREE.Vector3(0.5, 0.5, 0.2));

/** Two-bone IK: rotate shoulder then elbow so the wrist lands on target, the elbow toward the pole. */
function reachArm(s, side, target, pole) {
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
