import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// v2 preserves UVs, indexed geometry, smooth normals and glTF materials.
// Cached resources belong to the library, never to an individual town scene.
const cache = new Map();
export function loadTexturedPack(url) {
  if (!cache.has(url)) cache.set(url, new GLTFLoader().loadAsync(url).then(gltf => {
    const pack = {};
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(root => {
      const match = root.name.match(/^(.*)_LOD([012])$/);
      if (!match) return;
      const [, name, level] = match;
      const inverse = root.matrixWorld.clone().invert();
      const parts = [];
      root.traverse(node => {
        if (!node.isMesh) return;
        const geometry = node.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, node.matrixWorld));
        const material = node.material;
        material.map && (material.map.anisotropy = 4);
        parts.push({ geometry, material });
      });
      (pack[name] ||= {})[level] = parts;
    });
    return pack;
  }).catch(error => { cache.delete(url); throw error; }));
  return cache.get(url);
}
