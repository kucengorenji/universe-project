import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getToonGradient } from '../../render/assetLibrary.js';

// The skirmish environment kit (models/skirmish_env.glb, tools/blender/skirmish/env_kit.py) and its
// painted surfaces (textures/skirmish_surfaces.png, tools/blender/skirmish/surfaces.py).
//
// Kit meshes carry, per vertex, a surface index (uv.x) and a colour (the surface's tint times the
// occlusion baked in Blender). The surfaces are 512² tiles stacked into one texture array; the
// material samples a vertex's surface in the model's own space, projected along the three axes and
// blended by the normal (triplanar), so bricks follow walls and tiles follow the roof wherever an
// instance stands and however it is turned. The pencil hatching (canvasStyle.js) still applies.

/** Surfaces in strip order, and the metres of world one tile covers: mirrors surfaces.py. */
export const SURFACES = ['plaster', 'brick', 'stone', 'timber', 'plank', 'roof_tile', 'concrete', 'sandbag', 'canvas', 'metal',
  'leaf', 'bark', 'hay', 'glass', 'painted', 'cobble', 'grass', 'dirt', 'road', 'wheat', 'plough', 'water'];
const TILE_M = { plaster: 2.0, brick: 1.2, stone: 1.6, timber: 1.0, plank: 1.2, roof_tile: 1.6, concrete: 2.0, sandbag: 0.6, canvas: 1.5, metal: 1.0,
  leaf: 1.4, bark: 1.0, hay: 1.0, glass: 1.0, painted: 1.2, cobble: 1.4, grass: 3.0, dirt: 3.0, road: 3.0, wheat: 2.0, plough: 3.0, water: 6.0 };
export const SURFACE = Object.fromEntries(SURFACES.map((k, i) => [k, i]));

/** The surface strip as a texture array (one layer per tile, mipmapped, sRGB). */
export async function loadSurfaces(url) {
  const img = await new THREE.ImageLoader().loadAsync(url);
  const size = img.width;
  const layers = Math.round(img.height / size);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size * layers;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const data = new Uint8Array(g.getImageData(0, 0, size, size * layers).data.buffer);
  const tex = new THREE.DataArrayTexture(data, size, size, layers);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  // each tile's mean colour (linear): the ground divides by it to keep only a tile's pattern
  const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  tex.userData.means = Array.from({ length: layers }, (_, l) => {
    const sum = [0, 0, 0];
    const base = l * size * size * 4;
    for (let i = 0; i < size * size; i += 7) for (let c = 0; c < 3; c++) sum[c] += toLin(data[base + i * 4 + c] / 255);
    const n = Math.ceil((size * size) / 7);
    return new THREE.Vector3(sum[0] / n, sum[1] / n, sum[2] / n);
  });
  return tex;
}

/** The kit: { asset name -> BufferGeometry } (each asset an Empty with one <name>_LOD0 child). */
export async function loadEnvKit(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const kit = {};
  for (const holder of gltf.scene.children) {
    const toLocal = holder.matrixWorld.clone().invert();
    holder.traverse((o) => {
      if (!o.isMesh || !/_LOD0$/.test(o.name)) return;
      const geo = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toLocal, o.matrixWorld));
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      kit[holder.name] = geo;
    });
  }
  return kit;
}

/** The kit and its surfaces: { kit, surfaces }. */
export async function loadEnv(kitUrl, surfacesUrl) {
  const [kit, surfaces] = await Promise.all([loadEnvKit(kitUrl), loadSurfaces(surfacesUrl)]);
  return { kit, surfaces };
}

/** Toon material for kit geometry: the vertex's painted surface, tinted and shaded by its colour. */
export function envMaterial(surfaces, { plain = false } = {}) {
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() });
  if (plain) m.defines = { CANVAS_PLAIN: '' };
  const tileM = SURFACES.map((k) => 1 / TILE_M[k]);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSurf = { value: surfaces };
    sh.uniforms.uTileInv = { value: tileM };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vEnvPos;
        varying vec3 vEnvNrm;
        varying float vEnvSurf;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vEnvPos = position;
        vEnvNrm = normal;
        vEnvSurf = uv.x;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform highp sampler2DArray uSurf;
        uniform float uTileInv[${SURFACES.length}];
        varying vec3 vEnvPos;
        varying vec3 vEnvNrm;
        varying float vEnvSurf;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          int s = int(floor(vEnvSurf));
          float layer = float(s);
          vec3 p = vEnvPos * uTileInv[s];
          vec3 w = pow(abs(normalize(vEnvNrm)), vec3(4.0));
          w /= (w.x + w.y + w.z);
          // walls read across and up; the ground projection runs along x and z
          vec3 t = w.x * texture(uSurf, vec3(-p.z, -p.y, layer)).rgb
                 + w.y * texture(uSurf, vec3(p.x, p.z, layer)).rgb
                 + w.z * texture(uSurf, vec3(p.x, -p.y, layer)).rgb;
          diffuseColor.rgb *= t;
        }`);
  };
  m.customProgramCacheKey = () => `skirmish-env${plain ? '-plain' : ''}`;
  return m;
}
