import * as THREE from 'three';
import { createValleyMaterial } from '../render/valleyMaterial.js';
import PALETTE from '../valleyPalette.json';

// River surface (docs/FARM_PLAN.md §3 "Air"): only the grid cells the water actually reaches, at
// the water line, each vertex carrying its depth (water line minus ground) for the shore foam.

export function buildWater(ground) {
  const { n, half, heights, water } = ground;
  const pos = [], depth = [], index = [];
  const vertex = new Map();
  const at = (i, j) => {
    const key = j * n + i;
    if (!vertex.has(key)) {
      vertex.set(key, pos.length / 3);
      pos.push(-half + i, water, -half + j);
      depth.push(water - heights[key]);
    }
    return vertex.get(key);
  };
  // Cells the water reaches, grown by two cells so the mesh border always ends under the bank
  // (a border in the open would show the 1 m grid as a stair-stepped shore)
  const wet = new Uint8Array((n - 1) * (n - 1));
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const lowest = Math.min(heights[j * n + i], heights[j * n + i + 1], heights[(j + 1) * n + i], heights[(j + 1) * n + i + 1]);
    if (lowest > water + 0.05) continue;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const a = i + di, b = j + dj;
      if (a >= 0 && b >= 0 && a < n - 1 && b < n - 1) wet[b * (n - 1) + a] = 1;
    }
  }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    if (!wet[j * (n - 1) + i]) continue;
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    index.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('depth', new THREE.Float32BufferAttribute(depth, 1));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  // The height field as a half-float texture (texel = grid sample) for the shader's shore depth
  const half16 = new Uint16Array(n * n);
  for (let k = 0; k < n * n; k++) half16[k] = THREE.DataUtils.toHalfFloat(heights[k]);
  const heightTexture = new THREE.DataTexture(half16, n, n, THREE.RedFormat, THREE.HalfFloatType);
  heightTexture.minFilter = heightTexture.magFilter = THREE.LinearFilter;
  heightTexture.needsUpdate = true;
  const S = PALETTE.surface;
  const material = createValleyMaterial({
    transparent: true, depthWrite: false, brush: 0.16, scroll: 0.03,
    water: { shallow: S.water, deep: S.waterDeep, foam: S.foam, heights: heightTexture, half, n, level: water }
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.name = 'valley-water';
  mesh.renderOrder = 1;
  mesh.userData.heightTexture = heightTexture;
  return mesh;
}
