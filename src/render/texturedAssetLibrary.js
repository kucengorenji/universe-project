import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createToonMaterial } from './assetLibrary.js';

// v2 preserves UVs, indexed geometry, smooth normals and the texture maps.
// Cached resources belong to the library, never to an individual town scene.

/**
 * One shading family for the whole town (docs/ART_DIRECTION.md): glTF PBR
 * materials become the shared toon ramp, keeping their map, alpha cut-out and
 * sidedness. Smooth normals stay, so foliage keeps its volume.
 */
function toToon(source, converted) {
  if (!source?.isMeshStandardMaterial) return source;
  if (!converted.has(source)) {
    const m = createToonMaterial({
      name: source.name,
      color: source.color,
      map: source.map,
      alphaTest: source.alphaTest,
      side: source.side,
      vertexColors: source.vertexColors
    });
    converted.set(source, m);
  }
  return converted.get(source);
}

/**
 * Palette packs (the environment kit) give every shade its own material over
 * one shared image: leaf_0..3, stone_0..2. Parts that sample the same image (or
 * none) merge into one geometry, the material colour moving into a vertex
 * colour, so an oak is two draws (bark, leaves) instead of five.
 */
const merged = new Map();
function mergeByImage(parts) {
  const groups = new Map();
  for (const part of parts) {
    const key = `${part.material.map?.source?.uuid ?? 'plain'}:${part.material.side}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(part);
  }
  return [...groups.values()].map(list => {
    if (list.length === 1) return list[0];
    const keep = ['position', 'normal', 'uv'].filter(a => list.every(p => p.geometry.attributes[a]));
    const indexed = list.every(p => p.geometry.index);
    const geometries = list.map(({ geometry, material }) => {
      const g = new THREE.BufferGeometry();
      for (const a of keep) g.setAttribute(a, geometry.attributes[a]);
      if (geometry.index) g.setIndex(geometry.index);
      // Mixed parts merge unindexed: expand the indexed ones first
      const flat = indexed || !g.index ? g : g.toNonIndexed();
      const colors = new Float32Array(flat.attributes.position.count * 3);
      for (let i = 0; i < colors.length; i += 3) material.color.toArray(colors, i);
      flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      return flat;
    });
    const first = list[0].material;
    const key = `${first.name}:${first.map?.uuid ?? ''}`;
    if (!merged.has(key)) merged.set(key, createToonMaterial({ name: first.name, map: first.map, side: first.side, alphaTest: first.alphaTest, vertexColors: true }));
    return { geometry: mergeGeometries(geometries), material: merged.get(key) };
  });
}

const cache = new Map();
export function loadTexturedPack(url, { mergeShades = false } = {}) {
  if (!cache.has(url)) cache.set(url, new GLTFLoader().loadAsync(url).then(gltf => {
    const pack = {};
    const converted = new Map();
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
        const material = toToon(node.material, converted);
        material.map && (material.map.anisotropy = 4);
        parts.push({ geometry, material });
      });
      (pack[name] ||= {})[level] = mergeShades ? mergeByImage(parts) : parts;
    });
    return pack;
  }).catch(error => { cache.delete(url); throw error; }));
  return cache.get(url);
}
