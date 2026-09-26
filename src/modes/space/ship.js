import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createToonMaterial } from '../../render/assetLibrary.js';

// The player's frigate: model + flight model. Manual flight is arcade style
// (thrust along the nose, yaw, vertical thrusters, drag so it settles); the
// autopilot flies an arrive-steering curve to a moving point and parks there.

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/** Solid-colour part baked into one vertex-coloured, flat-shaded geometry. */
function part(geo, color, matrix) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (matrix) g.applyMatrix4(matrix);
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  const c = new THREE.Color(color);
  const cols = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < g.attributes.position.count; i++) c.toArray(cols, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}

const M = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

/** Stand-in frigate built from primitives (used until / unless the Blender pack loads). Nose = +Z. */
export function proceduralShipGeometry() {
  const hull = 0xe9ecef;
  const trim = 0x3a4150;
  const stripe = 0x027b49;
  const glass = 0x7fd6ff;
  const parts = [];
  // Main hull: a long wedge (box with the nose squeezed)
  const body = new THREE.BoxGeometry(0.46, 0.2, 1.5, 1, 1, 4);
  const pos = body.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const k = THREE.MathUtils.clamp((z + 0.2) / 0.95, 0, 1); // 0 aft .. 1 nose
    pos.setX(i, pos.getX(i) * (1 - k * 0.72));
    pos.setY(i, pos.getY(i) * (1 - k * 0.55) - k * 0.03);
  }
  parts.push(part(body, hull));
  parts.push(part(new THREE.BoxGeometry(0.48, 0.03, 0.9), stripe, M(0, 0.02, -0.1)));
  // Canopy
  parts.push(part(new THREE.SphereGeometry(0.12, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), glass, M(0, 0.08, 0.28, 0, 0, 0, 0.8, 0.6, 1.8)));
  // Swept wings
  const wing = new THREE.BoxGeometry(0.9, 0.035, 0.42);
  const wp = wing.attributes.position;
  for (let i = 0; i < wp.count; i++) {
    const x = Math.abs(wp.getX(i));
    wp.setZ(i, wp.getZ(i) * (1 - x * 0.9) - x * 0.45);
  }
  for (const s of [-1, 1]) {
    parts.push(part(wing.clone(), hull, M(s * 0.42, -0.02, -0.2, 0, 0, s * -0.08)));
    parts.push(part(new THREE.BoxGeometry(0.05, 0.16, 0.26), trim, M(s * 0.85, 0.05, -0.62, 0, 0, s * 0.2)));
    // Engine nacelles
    parts.push(part(new THREE.CylinderGeometry(0.085, 0.1, 0.62, 10), trim, M(s * 0.28, -0.02, -0.52, Math.PI / 2)));
    parts.push(part(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 10), 0x9fe8ff, M(s * 0.28, -0.02, -0.84, Math.PI / 2)));
  }
  parts.push(part(new THREE.BoxGeometry(0.06, 0.24, 0.34), trim, M(0, 0.16, -0.55)));
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  return g;
}

function glowSprite(color, size) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(160,230,255,0.8)');
  grad.addColorStop(1, 'rgba(80,160,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.scale.setScalar(size);
  return s;
}

/** Player ships in the hangar: model, handling and where the engines glow (model space, nose +Z). */
export const SHIPS = {
  frigate: {
    asset: 'ship_frigate',
    name: 'Fregat',
    desc: 'Seimbang: cukup cepat, cukup lincah, nyaman untuk jelajah jauh.',
    maxSpeed: 22,
    boostSpeed: 70,
    accel: 26,
    turn: 1.5,
    engines: [[-0.33, 0, -0.8, 0.5], [0.33, 0, -0.8, 0.5]]
  },
  interceptor: {
    asset: 'ship_interceptor',
    name: 'Interceptor',
    desc: 'Ringan dan gesit. Boost paling kencang, belok paling tajam.',
    maxSpeed: 30,
    boostSpeed: 95,
    accel: 36,
    turn: 2.2,
    engines: [[0, 0.03, -0.74, 0.55]]
  },
  freighter: {
    asset: 'ship_freighter',
    name: 'Freighter',
    desc: 'Berat dan stabil. Lambat berbelok, tapi tenang dan tangguh.',
    maxSpeed: 17,
    boostSpeed: 48,
    accel: 15,
    turn: 0.95,
    engines: [[-0.2, 0, -1.36, 0.4], [0.2, 0, -1.36, 0.4], [-0.2, 0.2, -1.36, 0.4], [0.2, 0.2, -1.36, 0.4]]
  }
};

export class Ship {
  constructor(lods, cfg = SHIPS.frigate) {
    this.cfg = cfg;
    this.object = new THREE.Group();
    this.material = createToonMaterial({ vertexColors: true });
    // lods: [geo LOD0, LOD1, LOD2] (any may be missing) -> THREE.LOD
    const lod = new THREE.LOD();
    const levels = lods.filter(Boolean);
    const dists = [0, 14, 40];
    levels.forEach((g, i) => lod.addLevel(new THREE.Mesh(g, this.material), dists[i]));
    this.model = lod;
    this.object.add(lod);
    this.engines = cfg.engines.map(([x, y, z, size]) => {
      const s = glowSprite(0x9fe8ff, size);
      s.position.set(x, y, z);
      s.userData.size = size;
      this.object.add(s);
      return s;
    });
    this.geometries = levels;

    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.bank = 0;
    this.thrust = 0;
    this.autopilot = null; // { target: fn -> Vector3, velocity: fn -> Vector3, done, arrived }
    this.maxSpeed = cfg.maxSpeed;
    this.boostSpeed = cfg.boostSpeed;
  }

  get position() {
    return this.object.position;
  }

  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  faceTowards(dir, dt, rate = 2.2) {
    const yaw = Math.atan2(dir.x, dir.z);
    const pitch = Math.asin(THREE.MathUtils.clamp(dir.y / (dir.length() || 1), -0.9, 0.9));
    let dy = yaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const k = 1 - Math.exp(-dt * rate);
    this.yaw += dy * k;
    this.pitch += (pitch - this.pitch) * k;
    return dy;
  }

  /** input: { forward, strafe, turn, lift, boost } in -1..1 */
  update(dt, input) {
    let turnRate = 0;
    const ap = this.autopilot;
    const manual = input.forward || input.turn || input.lift || input.strafe;
    if (ap && manual) this.cancelAutopilot();

    if (this.autopilot) {
      const target = ap.target();
      const tv = ap.velocity?.() ?? _v2.set(0, 0, 0);
      const to = _v.copy(target).sub(this.position);
      const dist = to.length();
      const cruise = dist > 60 ? this.boostSpeed : this.maxSpeed * 1.4;
      const accel = 26;
      const speed = Math.min(cruise, Math.sqrt(2 * accel * 0.6 * dist));
      const desired = to.normalize().multiplyScalar(speed).add(tv);
      const dv = desired.sub(this.velocity);
      const maxDv = accel * dt;
      if (dv.length() > maxDv) dv.setLength(maxDv);
      this.velocity.add(dv);
      const rel = _v2.copy(this.velocity).sub(tv);
      if (rel.length() > 1.5) turnRate = this.faceTowards(rel, dt, 2.4);
      else if (ap.look) turnRate = this.faceTowards(_v.copy(ap.look()).sub(this.position), dt, 1.2);
      this.thrust = THREE.MathUtils.lerp(this.thrust, Math.min(1, rel.length() / 20), 1 - Math.exp(-dt * 4));
      if (!ap.arrived && dist < 1.2 && rel.length() < 2) {
        ap.arrived = true;
        ap.onArrive?.();
      }
    } else {
      const boost = input.boost && input.forward > 0 ? 1 : 0;
      const top = boost ? this.boostSpeed : this.maxSpeed;
      // Turning has momentum: the nose swings in and settles
      this.yawVel = THREE.MathUtils.lerp(this.yawVel || 0, -input.turn * this.cfg.turn, 1 - Math.exp(-dt * 3.5));
      this.yaw += this.yawVel * dt;
      turnRate = this.yawVel;
      this.pitch = THREE.MathUtils.lerp(this.pitch, input.lift * 0.35, 1 - Math.exp(-dt * 3));
      const fwd = this.forward(_v);
      const right = _v2.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
      const accel = this.cfg.accel * (boost ? 2.6 : 1);
      this.velocity.addScaledVector(fwd, input.forward * accel * dt);
      this.velocity.addScaledVector(right, (input.strafe || 0) * 14 * dt);
      this.velocity.y += input.lift * 12 * dt;
      // Flight assist: the sideways part of the velocity bleeds into the nose direction,
      // so turns carve with a little drift instead of sliding forever
      const along = this.velocity.dot(fwd);
      const lateral = this.velocity.clone().addScaledVector(fwd, -along);
      this.velocity.addScaledVector(lateral, -(1 - Math.exp(-dt * 1.6)));
      this.velocity.addScaledVector(fwd, lateral.length() * (1 - Math.exp(-dt * 1.6)) * Math.sign(along || 1) * 0.6);
      this.velocity.multiplyScalar(Math.exp(-dt * (input.forward ? 0.1 : 0.45)));
      if (this.velocity.length() > top) this.velocity.setLength(THREE.MathUtils.lerp(this.velocity.length(), top, 1 - Math.exp(-dt * 2.5)));
      this.thrust = THREE.MathUtils.lerp(this.thrust, Math.max(0, input.forward) * (boost ? 1 : 0.6), 1 - Math.exp(-dt * 5));
      turnRate += (input.strafe || 0) * -0.6;
    }
    this.boostFx = THREE.MathUtils.lerp(this.boostFx || 0, input.boost && input.forward > 0 && !this.autopilot ? 1 : 0, 1 - Math.exp(-dt * 3));

    this.position.addScaledVector(this.velocity, dt);
    this.bank = THREE.MathUtils.lerp(this.bank, THREE.MathUtils.clamp(turnRate * 0.9, -0.6, 0.6), 1 - Math.exp(-dt * 3));
    this.object.quaternion.setFromEuler(new THREE.Euler(-this.pitch, this.yaw, this.bank, 'YXZ'));
    const flicker = 0.9 + Math.random() * 0.2;
    this.engines.forEach((s) => s.scale.setScalar((0.25 + this.thrust * 0.75) * flicker * s.userData.size * 1.4));
  }

  flyTo(opts) {
    this.autopilot = { ...opts, arrived: false };
  }

  cancelAutopilot() {
    const ap = this.autopilot;
    this.autopilot = null;
    ap?.onCancel?.();
  }

  get speed() {
    return this.velocity.length();
  }

  dispose() {
    this.material.dispose();
    this.engines.forEach((s) => {
      s.material.map.dispose();
      s.material.dispose();
    });
  }
}
