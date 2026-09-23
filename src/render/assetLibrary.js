import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// One GLB pack generated in Blender (tools/blender/build_assets.py). Each asset
// is a named node, Y-up, footprint radius ~1 = one hex tile. The pack ships
// without normals or UVs; faceted normals are rebuilt here once at load.
export const ASSET_PACK_URL = `${import.meta.env.BASE_URL}models/assets.glb`;

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

/**
 * Bake one asset node into a single non-indexed geometry with material colours
 * as vertex colours and flat face normals, so it can be drawn by one
 * InstancedMesh with the shared toon material.
 */
function bakeNode(root) {
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((node) => {
    if (!node.isMesh) return;
    let geo = node.geometry.clone().applyMatrix4(node.matrixWorld);
    if (geo.index) geo = geo.toNonIndexed();
    for (const key of Object.keys(geo.attributes)) {
      if (key !== 'position') geo.deleteAttribute(key);
    }
    const color = node.material?.color ?? new THREE.Color(0xffffff);
    const count = geo.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) color.toArray(colors, i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(geo);
  });
  if (!parts.length) return null;
  const merged = mergeGeometries(parts, false);
  merged.computeVertexNormals(); // non-indexed -> one normal per face (low-poly look)
  merged.computeBoundingSphere();
  return merged;
}

/** Resolves to { name: BufferGeometry }. Rejects if the pack cannot be loaded. */
export async function loadAssetLibrary(url = ASSET_PACK_URL) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const lib = {};
  gltf.scene.updateMatrixWorld(true);
  for (const child of gltf.scene.children) {
    const geo = bakeNode(child);
    if (geo) lib[child.name] = geo;
  }
  return lib;
}
