import * as THREE from 'three';
import { mulberry32 } from '../math/random.js';
import { PATH_PALETTE } from '../art/palette.js';

/** Editable, seamless 4 m surface masters, generated without external assets. */
export function createCozyPathAtlas(tileSize = 512) {
  const atlas = document.createElement('canvas');
  atlas.width = atlas.height = tileSize * 2;
  const output = atlas.getContext('2d');
  for (let tile = 0; tile < 4; tile++) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = tileSize;
    const ctx = canvas.getContext('2d'), rng = mulberry32(8107 + tile);
    const gray = value => `rgb(${value},${value},${value})`;
    ctx.fillStyle = gray(tile === 0 ? 221 : 160);
    ctx.fillRect(0, 0, tileSize, tileSize);
    const wrap = (x, y, draw) => {
      for (const dx of [-tileSize, 0, tileSize]) for (const dy of [-tileSize, 0, tileSize]) {
        ctx.save(); ctx.translate(x + dx, y + dy); draw(); ctx.restore();
      }
    };
    if (tile === 0) {
      for (let i = 0; i < 80; i++) {
        const x = rng() * tileSize, y = rng() * tileSize, r = (0.015 + rng() * 0.05) * tileSize;
        const shade = rng() < 0.5 ? 200 : 242;
        wrap(x, y, () => {
          const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
          gradient.addColorStop(0, gray(shade)); gradient.addColorStop(1, `rgba(${shade},${shade},${shade},0)`);
          ctx.fillStyle = gradient; ctx.fillRect(-r, -r, r * 2, r * 2);
        });
      }
      for (let i = 0; i < 500; i++) {
        const x = rng() * tileSize, y = rng() * tileSize, r = (0.0015 + rng() * 0.002) * tileSize;
        ctx.fillStyle = gray(rng() < 0.5 ? 189 : 244);
        wrap(x, y, () => { ctx.beginPath(); ctx.ellipse(0, 0, r * 1.4, r, 0, 0, Math.PI * 2); ctx.fill(); });
      }
    } else {
      const cols = tile === 2 ? 6 : 5, rows = tile === 2 ? 10 : 6;
      const w = tileSize / cols, h = tileSize / rows;
      for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
        const inset = tileSize * (tile === 2 ? 0.004 : 0.006);
        const x = (col + (row % 2) * 0.5) * w, y = row * h;
        const radius = tile === 2 ? h * 0.16 : h * (0.2 + rng() * 0.12);
        const tone = 226 + Math.floor(rng() * 22);
        const jw = tile === 2 ? 0 : rng() * tileSize * 0.008;
        wrap(x, y, () => {
          ctx.fillStyle = gray(250);
          ctx.beginPath(); ctx.roundRect(inset, inset, w - inset * 2 - jw, h - inset * 2, radius); ctx.fill();
          ctx.fillStyle = gray(tone);
          ctx.beginPath(); ctx.roundRect(inset * 1.8, inset * 1.8, w - inset * 3.6 - jw, h - inset * 3.6, radius * 0.85); ctx.fill();
        });
      }
    }
    output.drawImage(canvas, (tile % 2) * tileSize, Math.floor(tile / 2) * tileSize);
  }
  const texture = new THREE.CanvasTexture(atlas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.anisotropy = 8;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.userData = { tileSize, spanMetres: 4, channels: ['earth', 'stone', 'brick', 'stone'] };
  return texture;
}

const ATLAS_GLSL = `
  uniform sampler2D uCozyPaths;
  float cozyPathTone(vec2 p, float tile) {
    vec2 cell = vec2(mod(tile, 2.0), floor(tile / 2.0));
    // Two texels of inset keep the atlas families apart at grazing angles.
    return 0.45 + texture2D(uCozyPaths, (cell + 0.004 + fract(p / 4.0) * 0.992) * 0.5).r * 0.65;
  }
`;

/** Compose after the existing terrain/grass paint; paths get their own surface. */
export function patchCozyPathGround(shader, atlas, near, far) {
  Object.assign(shader.uniforms, {
    uCozyPaths: { value: atlas }, uCozyNear: { value: near.surface }, uCozyFar: { value: far.surface }
  });
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${ATLAS_GLSL}\nuniform sampler2D uCozyNear;\nuniform sampler2D uCozyFar;`)
    .replace('#include <alphatest_fragment>', `
      vec3 cozyWeights = pn.a > 0.02 ? texture2D(uCozyNear, un).rgb : texture2D(uCozyFar, uf).rgb;
      float cozyCoverage = clamp(cozyWeights.r + cozyWeights.g + cozyWeights.b, 0.0, 1.0);
      if (cozyCoverage > 0.01) {
        float family = cozyWeights.r >= max(cozyWeights.g, cozyWeights.b) ? 0.0 : cozyWeights.g >= cozyWeights.b ? 1.0 : 2.0;
        float tone = cozyPathTone(vGround.xz, family);
        diffuseColor.rgb = mix(diffuseColor.rgb, paint.rgb * tone, cozyCoverage * paint.a);
      }
      #include <alphatest_fragment>`);
  return shader;
}

/** The same stones continue across bridge ramps, in the existing merged batch. */
export function cozyBridgeMaterial(createMaterial, atlas) {
  const material = createMaterial({ vertexColors: true });
  material.userData.cozyPath = true;
  material.onBeforeCompile = shader => {
    shader.uniforms.uCozyPaths = { value: atlas };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vCozyBridge;\nvarying float vCozyUp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCozyBridge = position.xz;\nvCozyUp = normal.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${ATLAS_GLSL}\nvarying vec2 vCozyBridge;\nvarying float vCozyUp;`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(1.0, cozyPathTone(vCozyBridge, 1.0), smoothstep(0.7, 0.95, vCozyUp));');
  };
  material.customProgramCacheKey = () => 'cozy-bridge';
  return material;
}

/** Planet routes retain two batches; the cream shoulders live in the shader. */
export function cozyRouteMaterial(createMaterial, modern, span) {
  const style = modern ? PATH_PALETTE.stone : PATH_PALETTE.earth;
  const material = createMaterial({ color: style.fill, polygonOffset: true, polygonOffsetFactor: -3 });
  material.onBeforeCompile = shader => {
    shader.uniforms.uCozyBorder = { value: new THREE.Color(PATH_PALETTE.border) };
    shader.uniforms.uCozySpan = { value: span };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vCozyRoute;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCozyRoute = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vCozyRoute;\nuniform vec3 uCozyBorder;\nuniform float uCozySpan;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float shoulder = 1.0 - smoothstep(0.04, 0.15, min(vCozyRoute.y, 1.0 - vCozyRoute.y));
        float variation = sin(vCozyRoute.x / uCozySpan * 40.0) * 0.018;
        diffuseColor.rgb = mix(diffuseColor.rgb * (1.0 + variation), uCozyBorder, shoulder * 0.8);`);
  };
  material.customProgramCacheKey = () => `cozy-route-${modern}`;
  return material;
}
