import * as THREE from 'three';
import { loadSurfaces, SURFACE } from '../../../skirmish/battlefield/envKit.js';
import { hatchTexture } from '../../../skirmish/render/canvasStyle.js';

// Town's semantic surface ids remain the atlas ids used by assetLibrary. The
// Skirmish paint adds relief and brushwork, without replacing the town palette.
const SURFACE_NAMES = [null, 'plaster', 'brick', 'timber', 'stone', 'roof_tile',
  'roof_tile', 'metal', 'bark', 'cobble', 'concrete', 'dirt', 'grass', 'dirt', 'canvas', 'concrete'];
const SPANS = [1, 2, 1.2, 1, 1.6, 1.6, 1.6, 1, 1, 1.4, 2, 3, 3, 3, 1.5, 2];
export const TOWN_PAINT_SURFACES = Object.freeze(SURFACE_NAMES.map(name => name === null ? -1 : SURFACE[name]));

const cache = new Map();

/** Share the actual painted Skirmish tiles, at a smaller town texture budget. */
export function loadTownPaintedSurfaces(url, { size = 256, means = null } = {}) {
  const key = `${url}:${size}`;
  if (!cache.has(key)) {
    const pending = loadSurfaces(url).then(source => {
      // A file that is already `size` wide (derived once by tools/assets/derive_lowres.mjs) is used as it is,
      // with the tile means of the full-size original so the shading divisor does not move.
      if (means && source.image.width === size) source.userData.means = means.map(([r, g, b]) => new THREE.Vector3(r, g, b));
      const target = compactTownPaintedSurfaces(source, size);
      if (target !== source) source.dispose();
      return target;
    });
    pending.catch(() => cache.delete(key));
    cache.set(key, pending);
  }
  return cache.get(key);
}

/** Box-filter each array layer independently; colours and mean tint stay intact. */
export function compactTownPaintedSurfaces(source, size = 256) {
  const { width, height, depth, data } = source.image;
  if (size >= width) return source;
  if (!Number.isInteger(size) || size < 1 || width !== height || width % size) {
    throw new RangeError('Painted surface size must divide the square source tile size');
  }
  const step = width / size;
  const pixels = new Uint8Array(size * size * depth * 4);
  for (let layer = 0; layer < depth; layer++) {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dst = ((layer * size + y) * size + x) * 4;
      for (let channel = 0; channel < 4; channel++) {
        let sum = 0;
        for (let dy = 0; dy < step; dy++) for (let dx = 0; dx < step; dx++) {
          sum += data[((layer * height + y * step + dy) * width + x * step + dx) * 4 + channel];
        }
        pixels[dst + channel] = Math.round(sum / (step * step));
      }
    }
  }
  const texture = new THREE.DataArrayTexture(pixels, size, size, depth);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.userData.means = source.userData.means;
  texture.needsUpdate = true;
  return texture;
}

function paintUniforms(shader, surfaces) {
  shader.uniforms.uTownPaint = { value: surfaces };
  shader.uniforms.uTownPaintMean = {
    value: TOWN_PAINT_SURFACES.map(layer => layer < 0 ? new THREE.Vector3(1, 1, 1) : surfaces.userData.means[layer])
  };
  shader.uniforms.uTownPaintLayer = { value: TOWN_PAINT_SURFACES };
  shader.uniforms.uTownPaintInv = { value: SPANS.map(span => 1 / span) };
}

const PAINT_COMMON = `
  uniform highp sampler2DArray uTownPaint;
  uniform vec3 uTownPaintMean[16];
  uniform float uTownPaintLayer[16];
  uniform float uTownPaintInv[16];
  vec3 townPaint(vec2 p, int semantic) {
    vec3 tile = texture(uTownPaint, vec3(p * uTownPaintInv[semantic], uTownPaintLayer[semantic])).rgb;
    return clamp(tile / max(uTownPaintMean[semantic], vec3(0.02)), vec3(0.48), vec3(1.65));
  }
  float townPaintDetail(float depth) { return 1.0 - smoothstep(65.0, 150.0, depth); }
`;

/** Scoped shader patch. Existing roof paint, vehicle tint and night glass remain. */
export function patchTownPaintedProps(shader, surfaces, { lod = 0, hatch } = {}) {
  if (!surfaces || lod > 1) return shader;
  paintUniforms(shader, surfaces);
  const attribute = shader.vertexShader.includes('attribute vec3 surface;') ? '' : 'attribute vec3 surface;';
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      ${attribute}
      varying vec3 vTownPaintPos;
      varying vec3 vTownPaintNormal;
      varying float vTownPaintSurface;
      varying float vTownPaintDepth;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      vTownPaintPos = position;
      vTownPaintNormal = normal;
      vTownPaintSurface = surface.z;`)
    .replace('#include <project_vertex>', '#include <project_vertex>\nvTownPaintDepth = length(mvPosition.xyz);');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      ${PAINT_COMMON}
      varying vec3 vTownPaintPos;
      varying vec3 vTownPaintNormal;
      varying float vTownPaintSurface;
      varying float vTownPaintDepth;`)
    .replace('#include <alphatest_fragment>', `
      float townDetail = townPaintDetail(vTownPaintDepth);
      if (vTownPaintSurface > 0.5 && townDetail > 0.001) {
        int semantic = int(clamp(floor(vTownPaintSurface + 0.5), 1.0, 15.0));
        vec3 n = abs(normalize(vTownPaintNormal));
        ${lod === 0 ? `
          // Triplanar brushwork follows bevels and roof slopes without UV seams.
          vec3 w = pow(n, vec3(4.0));
          w /= max(w.x + w.y + w.z, 0.001);
          vec3 pigment;
          // Almost every wall is cardinal: skip the two zero-weight samples.
          // Bevels and pitched roofs retain the same three-way paint blend.
          if (w.x > 0.999) pigment = townPaint(vec2(vTownPaintPos.z, -vTownPaintPos.y), semantic);
          else if (w.y > 0.999) pigment = townPaint(vTownPaintPos.xz, semantic);
          else if (w.z > 0.999) pigment = townPaint(vec2(vTownPaintPos.x, -vTownPaintPos.y), semantic);
          else pigment = townPaint(vec2(vTownPaintPos.z, -vTownPaintPos.y), semantic) * w.x
            + townPaint(vTownPaintPos.xz, semantic) * w.y
            + townPaint(vec2(vTownPaintPos.x, -vTownPaintPos.y), semantic) * w.z;`
        : `vec2 plane = n.x > n.y && n.x > n.z ? vec2(vTownPaintPos.z, -vTownPaintPos.y)
            : n.y > n.z ? vTownPaintPos.xz : vec2(vTownPaintPos.x, -vTownPaintPos.y);
          vec3 pigment = townPaint(plane, semantic);`}
        diffuseColor.rgb *= mix(vec3(1.0), pigment, townDetail * 0.88);
      }
      #include <alphatest_fragment>`);
  if (lod === 0) {
    shader.uniforms.uTownHatch = { value: hatch || hatchTexture() };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uTownHatch;')
      .replace('#include <tonemapping_fragment>', `
        // Pencil shade is on these materials only; other game modes keep their shader.
        if (vTownPaintSurface > 0.5 && townDetail > 0.001) {
          vec3 n = abs(normalize(vTownPaintNormal));
          vec2 plane = n.x > n.y && n.x > n.z ? vTownPaintPos.zy
            : n.y > n.z ? vTownPaintPos.xz : vTownPaintPos.xy;
          vec4 hatch = texture2D(uTownHatch, plane * 0.58);
          float lit = clamp(dot(reflectedLight.directDiffuse, vec3(0.333)) /
            max(dot(diffuseColor.rgb, vec3(0.333)), 0.02), 0.0, 1.0);
          float pencil = hatch.r * mix(0.11, 0.045, lit) + hatch.g * (1.0 - lit) * 0.035;
          gl_FragColor.rgb *= 1.0 - pencil * townDetail;
        }
        #include <tonemapping_fragment>`);
  }
  return shader;
}

/** Painted near-ground detail follows Town's paving masks and existing colours. */
export function patchTownPaintedGround(shader, surfaces, { near, far, modern = false } = {}) {
  if (!surfaces) return shader;
  paintUniforms(shader, surfaces);
  shader.uniforms.uTownPaintNearMask = { value: near.surface };
  shader.uniforms.uTownPaintFarMask = { value: far.surface };
  shader.uniforms.uTownPaintNearRect = { value: new THREE.Vector3(near.x0, near.z0, near.size) };
  shader.uniforms.uTownPaintFarRect = { value: new THREE.Vector3(far.x0, far.z0, far.size) };
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vTownPaintGround;\nvarying float vTownPaintGroundDepth;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTownPaintGround = position;')
    .replace('#include <project_vertex>', '#include <project_vertex>\nvTownPaintGroundDepth = length(mvPosition.xyz);');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      ${PAINT_COMMON}
      uniform sampler2D uTownPaintNearMask;
      uniform sampler2D uTownPaintFarMask;
      uniform vec3 uTownPaintNearRect;
      uniform vec3 uTownPaintFarRect;
      varying vec3 vTownPaintGround;
      varying float vTownPaintGroundDepth;`)
    .replace('#include <alphatest_fragment>', `
      float townGroundDetail = townPaintDetail(vTownPaintGroundDepth);
      if (townGroundDetail > 0.001) {
        vec2 p = vTownPaintGround.xz;
        vec2 nearUv = (p - uTownPaintNearRect.xy) / uTownPaintNearRect.z;
        vec2 farUv = (p - uTownPaintFarRect.xy) / uTownPaintFarRect.z;
        vec3 weights = nearUv.x > 0.0 && nearUv.y > 0.0 && nearUv.x < 1.0 && nearUv.y < 1.0
          ? texture2D(uTownPaintNearMask, nearUv).rgb : texture2D(uTownPaintFarMask, farUv).rgb;
        float paved = max(weights.r, max(weights.g, weights.b));
        // A surface chooses one tile: unused paving types cost no extra samples.
        int semantic = weights.r > 0.5 ? ${modern ? 15 : 11}
          : weights.g > 0.5 ? 9 : weights.b > 0.5 ? 10 : 12;
        if (paved < 0.01 && paint.a > 0.1) semantic = 11;
        vec3 pigment = townPaint(p, semantic);
        diffuseColor.rgb *= mix(vec3(1.0), pigment, townGroundDetail * 0.7);
      }
      #include <alphatest_fragment>`);
  return shader;
}
