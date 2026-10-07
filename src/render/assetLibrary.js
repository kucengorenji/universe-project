import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { applySurfaceCoordinates, surfaceForMaterial } from './townSurfaces.js';

// Asset packs generated in Blender (tools/blender/build_assets.py). Each asset
// is an Empty named after the asset whose children are <name>_LOD0/1/2 meshes,
// Y-up, footprint radius ~1 = one hex tile. Packs ship without normals or UVs;
// faceted normals are rebuilt here once at load. URLs live in assetManifest.js.

/** 3-step cel-shading ramp shared by every toon material. */
let gradientMap = null;
export function getToonGradient() {
  if (!gradientMap) {
    gradientMap = new THREE.DataTexture(new Uint8Array([110, 185, 255]), 3, 1, THREE.RedFormat);
    gradientMap.minFilter = THREE.NearestFilter;
    gradientMap.magFilter = THREE.NearestFilter;
    gradientMap.generateMipmaps = false;
    gradientMap.needsUpdate = true;
  }
  return gradientMap;
}

export function createToonMaterial(params = {}) {
  return new THREE.MeshToonMaterial({ gradientMap: getToonGradient(), ...params });
}

/** Palette materials that light up at night: 1 = always, 0.7 = window glass (lit per building). */
const EMISSIVE = {
  M_glass_lit: 1,
  M_lamp: 1,
  M_fire: 1,
  M_engine: 1,
  M_glass: 0.7,
  // Curtain walls (0.72): the town material draws mullions and floor bands on them by day
  M_glass_blue: 0.72,
  M_glass_teal: 0.72,
  M_glass_dark: 0.7,
  M_cockpit: 0.7
};

/**
 * Bake one LOD node into a single non-indexed geometry with material colours
 * as vertex colours and flat face normals, relative to the node itself (so
 * the holder's layout position in the .blend does not leak in).
 * crease: smooth normals instead, split where faces meet at more than this angle
 * (bevelled props). glow: extra material name -> emissive weight for this pack.
 */
function bakeNode(root, { crease = 0, glow: glowNames = null } = {}) {
  root.updateMatrixWorld(true);
  const toLocal = root.matrixWorld.clone().invert();
  const parts = [];
  const m = new THREE.Matrix4();
  root.traverse((node) => {
    if (!node.isMesh) return;
    let geo = node.geometry.clone().applyMatrix4(m.multiplyMatrices(toLocal, node.matrixWorld));
    if (geo.index) geo = geo.toNonIndexed();
    for (const key of Object.keys(geo.attributes)) {
      if (key !== 'position') geo.deleteAttribute(key);
    }
    const color = node.material?.color ?? new THREE.Color(0xffffff);
    const count = geo.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) color.toArray(colors, i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    // Night glow: lamps and fires always, windows on some buildings (see town material)
    const glow = glowNames?.[node.material?.name] ?? EMISSIVE[node.material?.name] ?? 0;
    geo.setAttribute('emissive', new THREE.BufferAttribute(new Float32Array(count).fill(glow), 1));
    // Paint: surfaces the game tints per instance (vehicle bodies, horses)
    geo.setAttribute('paint', new THREE.BufferAttribute(new Float32Array(count).fill(node.material?.name === 'M_paint' ? 1 : 0), 1));
    // Roof: 1 = tiles, 2 = the darker ridge/eave tone. The town paints them from its palette (b.roof).
    const roofName = node.material?.name || '';
    geo.setAttribute('roof', new THREE.BufferAttribute(new Float32Array(count).fill(/^M_roof_/.test(roofName) ? (/_dark$/.test(roofName) ? 2 : 1) : 0), 1));
    applySurfaceCoordinates(geo, surfaceForMaterial(node.material?.name));
    parts.push(geo);
  });
  if (!parts.length) return null;
  const merged = mergeGeometries(parts, false);
  if (crease) toCreasedNormals(merged, crease);
  else merged.computeVertexNormals(); // non-indexed -> one normal per face (low-poly look)
  merged.computeBoundingSphere();
  return merged;
}

/** A geometry sharing a pack model's buffers, so an instanced attribute can be added without touching the pack. */
export function wrapGeometry(src) {
  const g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(src.attributes)) g.setAttribute(k, a);
  g.index = src.index;
  g.boundingSphere = src.boundingSphere;
  g.boundingBox = src.boundingBox;
  return g;
}

/**
 * Resolves to { assetName: { 0?: BufferGeometry, 1?: ..., 2?: ... } }. Rejects if the pack cannot load.
 * Packs are loaded once per URL and shared by every mode: never dispose their geometries.
 * options ({ crease, glow }, see bakeNode) apply to the first load of a URL.
 */
const packs = new Map();
export function loadAssetPack(url, options) {
  if (!packs.has(url)) {
    const p = loadPack(url, options);
    p.catch(() => packs.delete(url)); // a failed load may be retried later
    packs.set(url, p);
  }
  return packs.get(url);
}

async function loadPack(url, options) {
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const lib = {};
  for (const holder of gltf.scene.children) {
    for (const child of holder.children) {
      const m = /_LOD(\d)/.exec(child.name);
      if (!m) continue;
      const geo = bakeNode(child, options);
      if (!geo) continue;
      // Refreshed town models keep the original parcel measurements in the
      // pack. Visual mesh changes must not move coordinate-based saved rooms.
      if (holder.userData.layoutFootprint) geo.userData.layoutFootprint = { ...holder.userData.layoutFootprint };
      if (holder.userData.townAssetRevision) geo.userData.townAssetRevision = holder.userData.townAssetRevision;
      (lib[holder.name] ||= {})[Number(m[1])] = geo;
    }
  }
  return lib;
}
