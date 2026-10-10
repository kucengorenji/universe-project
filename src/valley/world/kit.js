import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createValleyMaterial } from '../render/valleyMaterial.js';
import { mulberry32 } from '../../math/random.js';

// Valley kit (tools/blender/valley/build_valley_kit.py): each asset is an Empty with meshes
// <asset>_<part>. Every repeated asset is drawn instanced, one InstancedMesh per part.
// Canopies get spherical normals (soft blob shading instead of facets) and a wind weight.

const materials = {};
function materialFor(part, asset) {
  // Crops are low enough to be pushed aside like the grass
  if (part === 'canopy' && asset.startsWith('crop_')) return (materials.crop ??= createValleyMaterial({ vertexColors: true, wind: true, push: true, brush: 0.1 }));
  if (part === 'canopy') return (materials.canopy ??= createValleyMaterial({ vertexColors: true, wind: true, foliage: true, brush: 0.1 }));
  if (part === 'glow') return (materials.glow ??= createValleyMaterial({ vertexColors: true, glow: 1.6, brush: 0.02 }));
  return (materials.body ??= createValleyMaterial({ vertexColors: true }));
}

/** Blob normals: away from the canopy's core, blended with the real normal to keep some form. */
function softenCanopy(geometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox, core = box.getCenter(new THREE.Vector3());
  core.y -= (box.max.y - box.min.y) * 0.15;
  const pos = geometry.attributes.position, nor = geometry.attributes.normal;
  const p = new THREE.Vector3(), n = new THREE.Vector3(), out = new THREE.Vector3();
  const wind = new Float32Array(pos.count), height = box.max.y - box.min.y || 1;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    out.subVectors(p, core).normalize().multiplyScalar(0.8).addScaledVector(n, 0.2).normalize();
    nor.setXYZ(i, out.x, out.y, out.z);
    wind[i] = 0.35 + 0.65 * (p.y - box.min.y) / height;
  }
  geometry.setAttribute('wind', new THREE.BufferAttribute(wind, 1));
}

/** Leaf-cluster texture: a dozen pointed leaves round a centre, grey (the card's colour tints it). */
let leafTex = null;
function leafTexture() {
  if (leafTex) return leafTex;
  const size = 256, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const c = canvas.getContext('2d'), rng = mulberry32(77);
  for (let i = 0; i < 18; i++) {
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * size * 0.26;
    const x = size / 2 + Math.cos(a) * r, y = size / 2 + Math.sin(a) * r, len = size * (0.13 + rng() * 0.07), w = len * 0.42;
    const v = Math.round(232 + rng() * 23);
    c.save();
    c.translate(x, y);
    c.rotate(a + (rng() - 0.5) * 1.2);
    c.fillStyle = `rgb(${v},${v},${v})`;
    c.beginPath();
    c.moveTo(-len / 2, 0);
    c.quadraticCurveTo(0, -w, len / 2, 0);
    c.quadraticCurveTo(0, w, -len / 2, 0);
    c.fill();
    c.restore();
  }
  // Transparent pixels keep the leaf colour (a canvas would store them black, and filtering
  // would then draw a dark rim round every leaf)
  const img = c.getImageData(0, 0, size, size), d = img.data;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] < 255) {
    const a = d[i + 3] / 255;
    for (let k = 0; k < 3; k++) d[i + k] = a > 0 ? Math.min(255, d[i + k] / a) : 240;
  }
  leafTex = new THREE.DataTexture(d, size, size, THREE.RGBAFormat);
  leafTex.colorSpace = THREE.SRGBColorSpace;
  leafTex.flipY = true;
  leafTex.generateMipmaps = true;
  leafTex.minFilter = THREE.LinearMipmapLinearFilter;
  leafTex.magFilter = THREE.LinearFilter;
  leafTex.needsUpdate = true;
  return leafTex;
}

/**
 * The ragged edge of a canopy (as in the reference trees): pairs of crossed leaf-cluster cards
 * standing out of its surface (each card contains the surface normal, so half of it pokes past
 * the silhouette from any side), tinted with the canopy's painted colour, shaded with its normal.
 */
function leafFringe(canopy, count, size, seed) {
  const pos = canopy.attributes.position, nor = canopy.attributes.normal, col = canopy.attributes.color, wind = canopy.attributes.wind;
  const rng = mulberry32(seed), P = [], N = [], C = [], W = [], U = [], I = [];
  const p = new THREE.Vector3(), n = new THREE.Vector3(), t = new THREE.Vector3(), b = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (let k = 0, tries = 0; k < count && tries < count * 20; k++, tries++) {
    const i = Math.floor(rng() * pos.count);
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i).normalize();
    if (n.y < -0.15 && rng() < 0.85) { k--; continue; } // mostly the upper, outer, sunlit side
    t.crossVectors(n, Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : up).normalize();
    b.crossVectors(n, t);
    const a = rng() * Math.PI * 2, s = size * (0.75 + rng() * 0.5);
    const side = t.clone().multiplyScalar(Math.cos(a)).addScaledVector(b, Math.sin(a));
    // Centre a little inside the canopy: the outer half of each card shows past the surface
    const centre = p.clone().addScaledVector(n, s * 0.12);
    const shade = 1.1 + rng() * 0.14; // outer leaves catch more light than the mass behind
    for (const across of [side, n.clone().cross(side)]) {
      // Card spanned by the normal and `across`, tilted slightly so it is never seen edge-on
      const out = n.clone().multiplyScalar(s / 2), wide = across.clone().addScaledVector(n.clone().cross(across), 0.35).normalize().multiplyScalar(s / 2);
      const base = P.length / 3;
      for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        const q = centre.clone().addScaledVector(wide, u * 2 - 1).addScaledVector(out, v * 2 - 1);
        P.push(q.x, q.y, q.z);
        N.push(n.x, n.y, n.z);
        C.push(col.getX(i) * shade, col.getY(i) * shade, col.getZ(i) * shade);
        W.push(wind ? wind.getX(i) : 1);
        U.push(u, v);
      }
      I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('wind', new THREE.Float32BufferAttribute(W, 1));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setIndex(I);
  g.computeBoundingSphere();
  return g;
}

const FRINGE = { tree: [60, 0.85], tree_far: [22, 1.2], bush: [22, 0.45] }; // [spots, card size m]

export async function loadKit(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const kit = {};
  for (const root of gltf.scene.children) {
    const parts = [];
    root.updateMatrixWorld(true);
    const toRoot = root.matrixWorld.clone().invert();
    root.traverse((node) => {
      if (!node.isMesh) return;
      const part = node.name.slice(root.name.length + 1);
      const geometry = node.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoot, node.matrixWorld));
      if (part === 'canopy') softenCanopy(geometry);
      else if (!geometry.attributes.wind) geometry.setAttribute('wind', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count), 1));
      geometry.computeBoundingSphere();
      parts.push({ part, geometry, material: materialFor(part, root.name) });
    });
    // Fringe the foliage: trees (fewer, larger cards far away) and bushes
    const canopy = parts.find((q) => q.part === 'canopy');
    const kind = root.name.startsWith('tree_') ? (root.name.endsWith('_far') ? 'tree_far' : 'tree') : root.name.startsWith('bush') ? 'bush' : null;
    if (canopy && kind && typeof document !== 'undefined') {
      const [count, size] = FRINGE[kind];
      materials.leaves ??= createValleyMaterial({ map: leafTexture(), alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, wind: true, noFlip: true, foliage: true, brush: 0.05 });
      parts.push({ part: 'leaves', geometry: leafFringe(canopy.geometry, count, size, root.name.length * 31), material: materials.leaves });
    }
    kit[root.name] = parts;
  }
  return kit;
}

/** One InstancedMesh per part of `asset`, for a list of matrices. */
export function instanceKit(kit, asset, matrices, { castShadow = true } = {}) {
  const group = new THREE.Group();
  group.name = asset;
  for (const { part, geometry, material } of kit[asset] || []) {
    const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.computeBoundingSphere();
    // Leaf cards would cast square shadows (the depth pass ignores their alpha): the canopy casts for them
    mesh.castShadow = castShadow && part !== 'glow' && part !== 'leaves';
    mesh.receiveShadow = true;
    mesh.name = `${asset}_${part}`;
    group.add(mesh);
  }
  return group;
}

/**
 * Near/far instancing for assets with an <asset>_far stand-in: instances within `near` metres
 * of the view use the full model, the rest the coarse one. Re-sorted a few times a second.
 */
export class LodInstances {
  constructor(kit, asset, matrices, { near = 26, single = false } = {}) {
    this.asset = asset;
    this.near = near;
    this.matrices = matrices;
    this.positions = matrices.map((m) => new THREE.Vector3().setFromMatrixPosition(m));
    this.group = new THREE.Group();
    this.group.name = `${asset}-lod`;
    this.full = instanceKit(kit, asset, matrices);
    // Far trees sit outside the shadow map anyway: drawing them into it only costs a pass
    this.far = instanceKit(kit, kit[`${asset}_far`] ? `${asset}_far` : asset, single ? [] : matrices, { castShadow: false });
    this.group.add(this.full, this.far);
    this.wait = 0;
    this.last = null;
    this.slots = matrices.map(() => ({ group: this.full, k: 0 }));
    this.wobbles = new Map();
  }

  /** Give instance i a push (rad of tilt) towards direction (x, z): it rocks and settles. */
  shake(i, amount, dir) {
    this.wobbles.set(i, { t: 0, amount, axis: new THREE.Vector3(dir.z, 0, -dir.x).normalize() });
  }

  /** Index and distance of the instance nearest (x, z), or null beyond `reach`. */
  nearest(x, z, reach) {
    let best = null;
    this.positions.forEach((p, i) => {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < reach && (!best || d < best.d)) best = { i, d, p };
    });
    return best;
  }

  /** Every frame: rock the shaken instances (the near/far sort runs a few times a second). */
  animate(dt) {
    for (const [i, w] of this.wobbles) {
      w.t += dt;
      const angle = w.amount * Math.exp(-w.t * 2.6) * Math.sin(w.t * 13);
      const p = this.positions[i];
      _w.makeTranslation(p.x, p.y, p.z).multiply(_r.makeRotationAxis(w.axis, angle)).multiply(_t.makeTranslation(-p.x, -p.y, -p.z)).multiply(this.matrices[i]);
      const slot = this.slots[i];
      for (const mesh of slot.group.children) {
        mesh.setMatrixAt(slot.k, _w);
        mesh.instanceMatrix.needsUpdate = true;
      }
      if (w.t > 2.5) {
        for (const mesh of slot.group.children) mesh.setMatrixAt(slot.k, this.matrices[i]);
        this.wobbles.delete(i);
      }
    }
  }

  update(dt, view) {
    this.wait -= dt;
    if (this.wait > 0 && this.last && this.last.distanceToSquared(view) < 4) return;
    this.wait = 0.3;
    this.last = (this.last ?? new THREE.Vector3()).copy(view);
    let a = 0, b = 0;
    const near2 = this.near * this.near;
    this.positions.forEach((p, i) => {
      const dx = p.x - view.x, dz = p.z - view.z;
      const into = dx * dx + dz * dz < near2 ? this.full : this.far;
      const k = into === this.full ? a++ : b++;
      this.slots[i] = { group: into, k };
      for (const mesh of into.children) mesh.setMatrixAt(k, this.matrices[i]);
    });
    for (const [group, count] of [[this.full, a], [this.far, b]]) {
      for (const mesh of group.children) {
        mesh.count = count;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
    }
  }
}

const _w = new THREE.Matrix4(), _r = new THREE.Matrix4(), _t = new THREE.Matrix4();

/** Instances that can be shaken (bushes): one batch, same shake/nearest/animate as the trees. */
export class ShakeInstances extends LodInstances {
  constructor(kit, asset, matrices) {
    super(kit, asset, matrices, { near: Infinity, single: true });
  }
}

/**
 * Static batch: every placement of the given assets baked into one mesh per material (body,
 * canopy, glow), so thirty kinds of props cost three draw calls instead of one per part.
 * byAsset: { asset: [Matrix4] }.
 */
export function mergeKit(kit, byAsset) {
  const groups = {};
  for (const [asset, matrices] of Object.entries(byAsset)) {
    for (const { part, geometry, material } of kit[asset] || []) {
      const key = material.uuid;
      groups[key] ??= { material, part, parts: [] };
      for (const m of matrices) groups[key].parts.push(geometry.clone().applyMatrix4(m));
    }
  }
  const group = new THREE.Group();
  group.name = 'valley-static';
  for (const { material, part, parts } of Object.values(groups)) {
    const geometry = mergeGeometries(parts);
    parts.forEach((g) => g.dispose());
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = part !== 'glow';
    mesh.receiveShadow = true;
    mesh.name = `static_${part}`;
    group.add(mesh);
  }
  return group;
}

export function kitTriangles(kit, asset) {
  return (kit[asset] || []).reduce((sum, { geometry }) => sum + (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3, 0);
}
