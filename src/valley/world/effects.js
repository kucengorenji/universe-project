import * as THREE from 'three';
import { createValleyMaterial } from '../render/valleyMaterial.js';
import PALETTE from '../valleyPalette.json';

// Small painted particles for the world's reactions (docs/FARM_PLAN.md §5): soil dust from the
// hoe and from landings, water drops from the can, splashes, falling leaves and the sparkle of a
// shipped item. One instanced pool, updated on the CPU.

const KINDS = {
  dust: { colour: PALETTE.surface.dirtLight, life: 0.7, gravity: -1.5, drag: 3, size: 0.06, grow: 1.9 },
  drop: { colour: '#9fd4e6', life: 0.6, gravity: 9.8, drag: 0.4, size: 0.035, grow: 1 },
  splash: { colour: PALETTE.surface.foam, life: 0.55, gravity: 7, drag: 1, size: 0.07, grow: 1.2 },
  leaf: { colour: PALETTE.kit.leaf, life: 2.6, gravity: 0.9, drag: 2.2, size: 0.08, grow: 1, flat: true },
  blossom: { colour: PALETTE.kit.blossom, life: 2.6, gravity: 0.7, drag: 2.4, size: 0.06, grow: 1, flat: true },
  sparkle: { colour: '#ffe9a0', life: 0.9, gravity: -0.6, drag: 1.5, size: 0.07, grow: 0.4, bright: 2.4 },
  // Season air (V5): petals and autumn leaves drift and flutter, snow sinks slowly, fireflies hover
  petal: { colour: PALETTE.kit.blossom, life: 7, gravity: 0.35, drag: 0.8, size: 0.05, grow: 1, flat: true },
  autumnLeaf: { colour: '#e0883a', life: 7, gravity: 0.55, drag: 1, size: 0.075, grow: 1, flat: true },
  snow: { colour: '#ffffff', life: 8, gravity: 0.45, drag: 0.6, size: 0.028, grow: 1, bright: 1.3 },
  firefly: { colour: '#f6ff9a', life: 4, gravity: -0.05, drag: 0.4, size: 0.025, grow: 1, bright: 3.2 }
};

export class Effects {
  constructor(capacity = 640) {
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), createValleyMaterial({ brush: 0, snow: false }), capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'effects';
    this.parts = [];
    this.free = [];
    for (let i = 0; i < capacity; i++) {
      this.parts.push({ alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, max: 1, kind: KINDS.dust, spin: 0, phase: 0 });
      this.free.push(i);
      this.mesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
      this.mesh.setColorAt(i, new THREE.Color());
    }
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._e = new THREE.Euler();
  }

  /** n particles of a kind at `at`, flung out with speed around `dir` (default: up and out). */
  burst(kind, at, n, { dir = null, speed = 1.5, spread = 1, colour = null } = {}) {
    const K = KINDS[kind];
    const c = new THREE.Color(colour || K.colour).multiplyScalar(K.bright || 1);
    for (let k = 0; k < n && this.free.length; k++) {
      const i = this.free.pop(), P = this.parts[i];
      P.alive = true;
      P.kind = K;
      P.p.copy(at);
      const r = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 0.8 + 0.2, Math.random() * 2 - 1).normalize();
      P.v.copy(dir ? dir.clone().normalize().multiplyScalar(speed).addScaledVector(r, speed * 0.35 * spread) : r.multiplyScalar(speed * (0.5 + Math.random() * 0.5)));
      P.life = P.max = K.life * (0.7 + Math.random() * 0.6);
      P.spin = (Math.random() - 0.5) * 8;
      P.phase = Math.random() * 6.28;
      this.mesh.setColorAt(i, c);
    }
    this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    const m = this._m;
    for (let i = 0; i < this.parts.length; i++) {
      const P = this.parts[i];
      if (!P.alive) continue;
      P.life -= dt;
      if (P.life <= 0) {
        P.alive = false;
        this.free.push(i);
        this.mesh.setMatrixAt(i, m.makeScale(0, 0, 0));
        continue;
      }
      const K = P.kind;
      P.v.y -= K.gravity * dt;
      P.v.multiplyScalar(Math.exp(-K.drag * dt));
      if (K.flat) P.v.x += Math.sin(P.life * 4 + P.phase) * dt * 1.2; // leaves flutter as they fall
      P.p.addScaledVector(P.v, dt);
      const t = 1 - P.life / P.max;
      const size = K.size * (1 + (K.grow - 1) * t) * Math.min(1, P.life / (P.max * 0.35));
      this._q.setFromEuler(this._e.set(P.phase + t * P.spin, P.phase * 2 + t * P.spin, 0));
      this._s.set(size, K.flat ? size * 0.25 : size, size * (K.flat ? 0.7 : 1));
      this.mesh.setMatrixAt(i, m.compose(P.p, this._q, this._s));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  get alive() {
    return this.parts.length - this.free.length;
  }
}
