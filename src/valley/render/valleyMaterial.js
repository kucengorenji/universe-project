import * as THREE from 'three';
import { mulberry32 } from '../../math/random.js';

// Valley shading (docs/FARM_PLAN.md §2.3): the toon family of the rest of the universe, but a
// 2-step ramp with a wide soft terminator, smooth normals, and a world-space brush texture that
// breaks up flat colour like paint. Shadows stay coloured: the shadow side keeps 45% of the sun
// and the hemisphere light (sky above, warm earth below) fills the rest.

/** Soft 2-step ramp: shadow 0.45, lit 1, blended over the terminator. */
let ramp = null;
export function softRamp() {
  if (ramp) return ramp;
  const n = 64, data = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1), t = Math.min(1, Math.max(0, (x - 0.4) / 0.26));
    data[i] = Math.round(255 * (0.45 + 0.55 * t * t * (3 - 2 * t)));
  }
  ramp = new THREE.DataTexture(data, n, 1, THREE.RedFormat);
  ramp.minFilter = ramp.magFilter = THREE.LinearFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  return ramp;
}

/**
 * Tileable grey brush strokes centred on 0.5, so the shader can multiply them in as ±variation.
 * One tile spans BRUSH_TILE metres.
 */
export const BRUSH_TILE = 3;
let brush = null;
export function brushTexture(size = 512) {
  if (brush) return brush;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d'), rng = mulberry32(5150);
  ctx.fillStyle = 'rgb(128,128,128)';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 1400; i++) {
    const x = rng() * size, y = rng() * size;
    const len = (0.025 + rng() * 0.05) * size, wid = len * (0.18 + rng() * 0.2);
    const angle = (rng() < 0.7 ? -0.5 : 0.9) + (rng() - 0.5) * 0.6; // two dominant stroke directions
    const v = Math.round(128 + (rng() - 0.5) * 70);
    ctx.fillStyle = `rgba(${v},${v},${v},${0.18 + rng() * 0.22})`;
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
      ctx.save();
      ctx.translate(x + dx, y + dy);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.ellipse(0, 0, len, wid, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  brush = new THREE.CanvasTexture(canvas);
  brush.wrapS = brush.wrapT = THREE.RepeatWrapping;
  brush.colorSpace = THREE.NoColorSpace;
  brush.anisotropy = 4;
  return brush;
}

/** Uniforms shared by every valley material; the look-dev scene drives them each frame. */
export const valleyUniforms = {
  uTime: { value: 0 },
  uNight: { value: 0 },
  uWind: { value: new THREE.Vector2(0.8, 0.35) },
  uBrush: { value: null },
  uGlowColor: { value: new THREE.Color('#ffd98a') },
  // Up to 8 things pushing the grass aside: (x, z, radius, strength); strength 0 = unused
  uPushers: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
  // Season (docs/FARM_PLAN.md §2.2, V5): snow on everything facing up, foliage shifted towards a
  // season colour, sakura blossom on (spring) or turned to leaf, grass height
  uSnow: { value: 0 },
  uSnowColor: { value: new THREE.Color('#dbe3ee') }, // a little blue and below white, so forms and shade still read
  uFoliageColor: { value: new THREE.Color('#ffffff') },
  uFoliageMix: { value: 0 },
  uBlossom: { value: 1 },
  uGrassHeight: { value: 1 }
};

/**
 * opts: brush (0..1 strength), wind (geometry has a `wind` attribute 0 = rigid, 1 = free tip),
 * glow (lights up at night), scroll (brush drifts, for water), noFlip (double-sided cards keep
 * their upward normal on the back face, so grass shades like the ground), water (geometry has a
 * `depth` attribute: foam at the shore line, deeper colour and opacity further out), plus
 * MeshToonMaterial params. push (with wind): bends away from uPushers, for grass, flowers, crops.
 * foliage: takes the season's leaf colour; grass: scaled by the season's grass height; snow: false
 * keeps a material clear of snow (animals, particles, water).
 */
export function createValleyMaterial({ brush: brushAmount = 0.08, wind = false, glow = 0, scroll = 0, noFlip = false, water = null, push = false, foliage = false, grass = false, snow = true, ...params } = {}) {
  // The brush is a canvas: made on first use in the page, skipped where there is no DOM (tests)
  if (typeof document !== 'undefined') valleyUniforms.uBrush.value ??= brushTexture();
  const material = new THREE.MeshToonMaterial({ gradientMap: softRamp(), ...params });
  material.customProgramCacheKey = () => `valley:${wind}:${glow > 0}:${scroll > 0}:${noFlip}:${!!water}:${push}:${foliage}:${grass}:${snow && !water}`;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, valleyUniforms, {
      uShallow: { value: new THREE.Color(water?.shallow ?? '#ffffff') },
      uDeep: { value: new THREE.Color(water?.deep ?? '#ffffff') },
      uFoam: { value: new THREE.Color(water?.foam ?? '#ffffff') },
      uHeights: { value: water?.heights ?? null },
      uHeightGrid: { value: new THREE.Vector3(water?.half ?? 0, water?.n ?? 1, water?.level ?? 0) },
      uBrushAmount: { value: brushAmount },
      uGlow: { value: glow },
      uScroll: { value: scroll }
    });
    shader.defines ??= {};
    if (wind) shader.defines.VALLEY_WIND = '';
    if (glow > 0) shader.defines.VALLEY_GLOW = '';
    if (noFlip) shader.defines.VALLEY_NOFLIP = '';
    if (water) shader.defines.VALLEY_WATER = '';
    if (push) shader.defines.VALLEY_PUSH = '';
    if (foliage) shader.defines.VALLEY_FOLIAGE = '';
    if (grass) shader.defines.VALLEY_GRASS = '';
    if (snow && !water) shader.defines.VALLEY_SNOW = '';
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        uniform vec2 uWind;
        uniform vec4 uPushers[8];
        uniform float uGrassHeight;
        varying vec3 vValleyWorld;
        varying vec3 vValleyNormal;
        #ifdef VALLEY_WIND
          attribute float wind;
        #endif
        #ifdef VALLEY_WATER
          attribute float depth;
          varying float vDepth;
        #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef VALLEY_GRASS
          transformed.y *= uGrassHeight;
        #endif
        #ifdef USE_INSTANCING
          mat4 valleyModel = modelMatrix * instanceMatrix;
        #else
          mat4 valleyModel = modelMatrix;
        #endif
        #ifdef VALLEY_WIND
          vec3 valleyBase = valleyModel[3].xyz;
          float phase = uTime * 1.6 + valleyBase.x * 0.23 + valleyBase.z * 0.19;
          // Gusts roll across the valley along the wind direction
          float gust = 0.55 + 0.45 * sin(uTime * 0.55 - dot(valleyBase.xz, normalize(uWind)) * 0.06);
          float sway = (sin(phase) * 0.7 + sin(phase * 2.3 + transformed.y * 1.7) * 0.3) * gust;
          transformed.xz += uWind * sway * wind * 0.12;
          #ifdef VALLEY_PUSH
            // Bend away from feet and thrown things; the push is in world space, turned into the
            // instance's own frame (rotation about Y only, so the transpose undoes it)
            vec2 pushW = vec2(0.0);
            for (int k = 0; k < 8; k++) {
              vec4 P = uPushers[k];
              vec2 d = valleyBase.xz - P.xy;
              float l = length(d);
              float f = (1.0 - smoothstep(P.z * 0.25, P.z, l)) * P.w;
              if (l > 0.001) pushW += d / l * f;
            }
            float amount = min(length(pushW), 1.0);
            if (amount > 0.001) {
              vec3 pushL = transpose(mat3(valleyModel)) * vec3(pushW.x, 0.0, pushW.y);
              vec2 dirL = pushL.xz / max(length(pushL.xz), 0.0001);
              transformed.xz += dirL * amount * wind * 0.2;
              transformed.y -= amount * wind * 0.07;
            }
          #endif
        #endif`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vValleyWorld = (valleyModel * vec4(transformed, 1.0)).xyz;
        vValleyNormal = normalize(mat3(valleyModel) * objectNormal);
        #ifdef VALLEY_WATER
          vDepth = depth;
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uBrush;
        uniform float uBrushAmount;
        uniform float uScroll;
        uniform float uTime;
        uniform float uNight;
        uniform float uGlow;
        uniform vec3 uGlowColor;
        uniform float uSnow;
        uniform vec3 uSnowColor;
        uniform vec3 uFoliageColor;
        uniform float uFoliageMix;
        uniform float uBlossom;
        varying vec3 vValleyWorld;
        varying vec3 vValleyNormal;
        #ifdef VALLEY_WATER
          uniform vec3 uShallow;
          uniform vec3 uDeep;
          uniform vec3 uFoam;
          uniform sampler2D uHeights;
          uniform vec3 uHeightGrid; // half size, samples per side, water line
          varying float vDepth;
        #endif`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        #ifdef VALLEY_WATER
        {
          // Shore foam breathes in and out along the bank; deeper water darkens and turns opaque
          // Depth from the bilinear height texture, not the per-vertex value: the shore line then
          // follows a smooth contour instead of the 1 m grid's zigzag
          vec2 hv = ((vValleyWorld.xz + uHeightGrid.x) + 0.5) / uHeightGrid.y;
          float vDepth = uHeightGrid.z - texture2D(uHeights, hv).r;
          float wave = sin(uTime * 1.3 + vValleyWorld.x * 0.9 + vValleyWorld.z * 0.7) * 0.5 + 0.5;
          float foam = 1.0 - smoothstep(0.02, 0.16 + wave * 0.1, vDepth);
          float ring = smoothstep(0.24, 0.3, vDepth + wave * 0.06) * (1.0 - smoothstep(0.3, 0.36, vDepth + wave * 0.06));
          diffuseColor.rgb = mix(uShallow, uDeep, smoothstep(0.15, 1.1, vDepth));
          diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, max(foam, ring * 0.45));
          diffuseColor.a = mix(0.62, 0.9, smoothstep(0.05, 0.9, vDepth));
          diffuseColor.a = max(diffuseColor.a, foam);
          // Sun glints: little cells that flicker on and off across open water (dimmed at night)
          vec2 cellId = floor(vValleyWorld.xz * 6.5 + vec2(uTime * 0.6, uTime * 0.35));
          float glint = step(0.993, fract(sin(dot(cellId, vec2(12.9898, 78.233))) * 43758.5453));
          diffuseColor.rgb += glint * 0.85 * (1.0 - foam) * (1.0 - uNight * 0.8) * smoothstep(0.25, 0.6, vDepth);
        }
        #endif
        {
          vec3 w = abs(normalize(vValleyNormal));
          w /= w.x + w.y + w.z;
          vec3 p = vValleyWorld / ${BRUSH_TILE.toFixed(1)};
          vec2 drift = vec2(uTime * uScroll, uTime * uScroll * 0.6);
          float b = texture2D(uBrush, p.zy).r * w.x + texture2D(uBrush, p.xz + drift).r * w.y + texture2D(uBrush, p.xy).r * w.z;
          diffuseColor.rgb *= 1.0 + (b - 0.5) * 2.0 * uBrushAmount;
          #ifdef VALLEY_FOLIAGE
            // Season leaf colour, keeping the painted light and dark; blossom (pink: blue above
            // green) turns to leaf outside spring. Fruit (red, little blue) is left alone.
            float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
            float blossom = smoothstep(0.02, 0.12, diffuseColor.b - diffuseColor.g) * step(diffuseColor.g, diffuseColor.r);
            float fruit = smoothstep(0.15, 0.3, diffuseColor.r - diffuseColor.g) * (1.0 - blossom);
            vec3 leaf = mix(diffuseColor.rgb, uFoliageColor * lum * 2.1, uFoliageMix);
            vec3 offBlossom = uFoliageColor * lum * 1.9;
            // In spring the blossom keeps its own pink; otherwise it becomes leaf of the season
            vec3 petal = mix(offBlossom, diffuseColor.rgb, uBlossom);
            diffuseColor.rgb = mix(mix(leaf, petal, blossom), diffuseColor.rgb, fruit);
          #endif
          #ifdef VALLEY_SNOW
            // Snow lies on whatever faces up, in soft drifts broken up by the brush strokes
            float up = smoothstep(0.45, 0.85, normalize(vValleyNormal).y);
            float snowDrift = smoothstep(0.35, 0.6, b + up * 0.3);
            diffuseColor.rgb = mix(diffuseColor.rgb, uSnowColor, uSnow * up * snowDrift);
          #endif
        }`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        #ifdef VALLEY_NOFLIP
          normal = normalize(vNormal);
        #endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        #ifdef VALLEY_GLOW
          totalEmissiveRadiance += uGlowColor * uNight * uGlow;
        #endif`);
  };
  return material;
}
