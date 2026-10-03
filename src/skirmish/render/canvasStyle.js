import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// The skirmish "canvas" look, after the watercolour-and-pencil rendering of Valkyria Chronicles:
//   1. pencil hatching inside every toon material, where the sun does not reach (diagonal
//      strokes on the dark ramp step, cross-hatching in cast shadow), see installCanvasShading
//   2. one post pass (CanvasPost): ink outlines from depth and colour edges, tone mapping, a
//      warm paper grade, paper grain, and edges of the frame that fade into the paper like a
//      wash that ran out of pigment.
// Only the skirmish page installs this: the main game keeps the stock toon shader.

export const PAPER = new THREE.Color('#efe6d2');
export const INK = new THREE.Color('#2a2119');

let installed = false;

/** Patch MeshToonMaterial (every instance, this page only) with lighting-driven pencil hatching. */
export function installCanvasShading() {
  if (installed) return;
  installed = true;
  const lib = THREE.ShaderLib.toon;
  lib.fragmentShader = lib.fragmentShader
    .replace('#include <common>', `#include <common>
      // screen-space pencil strokes: s runs across the stroke direction, wobbling a little
      float canvasStroke(vec2 p, float angle, float spacing, float width) {
        vec2 d = vec2(cos(angle), sin(angle));
        float s = dot(p, d) / spacing + 0.35 * sin(dot(p, vec2(-d.y, d.x)) * 0.045);
        float f = abs(fract(s) - 0.5) * 2.0;
        // stroke pressure varies along its length
        float pressure = 0.65 + 0.35 * sin(dot(p, vec2(-d.y, d.x)) * 0.11 + floor(s) * 2.3);
        return (1.0 - smoothstep(width, width + 0.18, f)) * pressure;
      }`)
    .replace('vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;', `
      vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
      #if NUM_DIR_LIGHTS > 0
      {
        // How lit this pixel is by the sun, 0..1, independent of its paint colour
        float sun = dot(directionalLights[0].color, vec3(0.3333));
        float paint = dot(material.diffuseColor, vec3(0.3333)) * RECIPROCAL_PI * sun;
        float lit = clamp(dot(reflectedLight.directDiffuse, vec3(0.3333)) / max(paint, 1e-4), 0.0, 1.0);
        vec2 px = gl_FragCoord.xy;
        float h1 = canvasStroke(px, 0.95, 4.5, 0.18) * (1.0 - smoothstep(0.22, 0.38, lit));
        float h2 = canvasStroke(px, -0.62, 5.5, 0.14) * (1.0 - smoothstep(0.03, 0.12, lit));
        float hatch = max(h1 * 0.45, h2 * 0.35); // cast shadow only: the dark side of the ramp stays clean
        // strokes fade with distance (vViewPosition is the view-space position)
        hatch *= 1.0 - smoothstep(35.0, 90.0, length(vViewPosition));
        outgoingLight = mix(outgoingLight, outgoingLight * vec3(0.55, 0.5, 0.5), hatch);
      }
      #endif`);
}

/** Display-space (sRGB) components: the canvas pass grades after tone mapping and the sRGB curve. */
const srgb = (c) => {
  const { r, g, b } = c.getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
  return new THREE.Vector3(r, g, b);
};

const CanvasShader = {
  uniforms: {
    tScene: { value: null },
    tDepth: { value: null },
    uNear: { value: 0.1 },
    uFar: { value: 1000 },
    uTexel: { value: new THREE.Vector2(1, 1) },
    uPx: { value: 1 },
    uPaper: { value: srgb(PAPER) },
    uInk: { value: srgb(INK) },
    tNoise: { value: null },
    uLine: { value: 1.25 }, // outline width in screen pixels (x device pixel ratio)
    uWash: { value: 1 },
    toneMappingExposure: { value: 1 }
  },
  vertexShader: /* glsl */ `
    precision highp float;
    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;
    attribute vec3 position;
    attribute vec2 uv;
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tScene;
    uniform sampler2D tDepth;
    uniform float uNear;
    uniform float uFar;
    uniform vec2 uTexel;
    uniform float uPx;
    uniform vec3 uPaper;
    uniform vec3 uInk;
    uniform float uLine;
    uniform float uWash;
    uniform sampler2D tNoise; // tiling noise: r fine grain, g coarse blotches, ba smooth wobble
    #include <tonemapping_pars_fragment>
    #include <colorspace_pars_fragment>
    varying vec2 vUv;

    float viewZ(vec2 uv) {
      float d = texture2D(tDepth, uv).x;
      return (uNear * uFar) / ((uFar - uNear) * d - uFar);
    }
    vec3 toneMapped(vec2 uv) {
      // ACESFilmicToneMapping applies toneMappingExposure itself
      vec3 c = ACESFilmicToneMapping(texture2D(tScene, uv).rgb);
      return sRGBTransferOETF(vec4(c, 1.0)).rgb;
    }
    float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
    // scene luminance squashed to 0..1 and lifted toward perceptual: cheap stand-in for the tone-mapped value
    float lumaHdr(vec2 uv) {
      float l = luma(texture2D(tScene, uv).rgb);
      return sqrt(l / (1.0 + l));
    }

    void main() {
      vec2 px = vUv / uTexel;
      // hand-drawn wobble: lines sample a slightly displaced grid
      vec2 wob = (texture2D(tNoise, px / (768.0 * uPx)).ba - 0.5) * 2.4 * uPx * uTexel;
      vec2 uv = vUv + wob;
      vec3 col = toneMapped(vUv);

      // ink: depth discontinuities relative to distance (silhouettes, creases), plus colour edges
      vec2 o = uTexel * uPx * uLine;
      float zc = -viewZ(uv);
      float zl = -viewZ(uv - vec2(o.x, 0.0)), zr = -viewZ(uv + vec2(o.x, 0.0));
      float zd = -viewZ(uv - vec2(0.0, o.y)), zu = -viewZ(uv + vec2(0.0, o.y));
      float dz = max(max(abs(zl - zc), abs(zr - zc)), max(abs(zd - zc), abs(zu - zc)));
      // a second-order term picks out creases where both neighbours bend the same way
      float crease = abs(zl + zr - 2.0 * zc) + abs(zd + zu - 2.0 * zc);
      float edgeZ = smoothstep(0.018, 0.05, dz / max(zc, 0.5)) + smoothstep(0.05, 0.12, crease / max(zc, 0.5)) * 0.6;
      float lc = luma(col);
      float gx = lumaHdr(uv + vec2(o.x, 0.0)) - lumaHdr(uv - vec2(o.x, 0.0));
      float gy = lumaHdr(uv + vec2(0.0, o.y)) - lumaHdr(uv - vec2(0.0, o.y));
      float edgeC = smoothstep(0.12, 0.28, length(vec2(gx, gy)));
      float sky = step(0.9999, texture2D(tDepth, vUv).x);
      // lines thin out and lighten with distance, like pencil pressure easing off
      float far = smoothstep(25.0, 110.0, zc);
      float ink = clamp(max(edgeZ, edgeC * 0.6) * (1.0 - far * 0.8), 0.0, 1.0) * (1.0 - sky);
      ink *= 0.7 + 0.3 * texture2D(tNoise, px / (90.0 * uPx)).r;

      // paper grade: warm, a little desaturated, shadows lifted toward sepia
      float l = luma(col);
      col = mix(vec3(l), col, 0.97);
      col = mix(col, col * vec3(1.04, 0.99, 0.9), 0.3);
      col = mix(uPaper * 0.2, vec3(1.0), col);

      // distance wash: the far field dissolves into paper
      col = mix(col, uPaper, smoothstep(80.0, 260.0, zc) * 0.4 * (1.0 - sky));
      col = mix(col, uInk, ink * 0.82);

      // paper: fibres and grain, stronger in the light
      float grain = texture2D(tNoise, px / (200.0 * uPx)).r * 0.6 + texture2D(tNoise, px / (1600.0 * uPx)).g * 0.4;
      col *= 0.965 + 0.05 * grain;

      // the frame fades into the paper with a ragged watercolour edge
      vec2 q = vUv * 2.0 - 1.0;
      float edge = max(abs(q.x) * 0.92, abs(q.y));
      float rag = (texture2D(tNoise, vUv * vec2(1.6, 1.1)).g - 0.5) * 0.14;
      float wash = smoothstep(0.92, 1.05, edge + rag) * uWash;
      col = mix(col, uPaper * (0.97 + 0.05 * grain), wash);

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`
};

/**
 * A tiling 256 x 256 noise texture, made once: r = fine grain (fbm), g = coarse blotches,
 * b/a = smooth wobble. Sampling it is far cheaper than evaluating fbm per pixel.
 */
function noiseTexture(N = 256) {
  let seed = 7;
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const lattice = (period) => Float32Array.from({ length: period * period }, rand);
  const value = (L, period, x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const at = (i, j) => L[((j % period) + period) % period * period + (((i % period) + period) % period)];
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  // fbm whose octaves all tile over N pixels
  const fbm = (x, y, base, octaves) => {
    let s = 0, amp = 0.5, norm = 0;
    for (let o = 0; o < octaves; o++) {
      const period = base << o;
      const L = (fbm.cache[period] ||= lattice(period));
      s += amp * value(L, period, (x / N) * period, (y / N) * period);
      norm += amp;
      amp *= 0.5;
    }
    return s / norm;
  };
  fbm.cache = {};
  const data = new Uint8Array(N * N * 4);
  const wobble = [lattice(4), lattice(4)];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      data[i] = fbm(x, y, 32, 3) * 255;
      data[i + 1] = fbm(x, y, 4, 3) * 255;
      data[i + 2] = value(wobble[0], 4, (x / N) * 4, (y / N) * 4) * 255;
      data[i + 3] = value(wobble[1], 4, (x / N) * 4, (y / N) * 4) * 255;
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Scene -> multisampled target with depth -> one canvas pass to the screen. */
export class CanvasPost {
  constructor(renderer, { samples = 2 } = {}) {
    this.renderer = renderer;
    this.enabled = true;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples });
    this.target.depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);
    this.material = new THREE.RawShaderMaterial({
      name: 'CanvasPost',
      uniforms: THREE.UniformsUtils.clone(CanvasShader.uniforms),
      vertexShader: CanvasShader.vertexShader,
      fragmentShader: CanvasShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
      defines: { ACES_FILMIC_TONE_MAPPING: '' }
    });
    this.noise = noiseTexture();
    this.material.uniforms.tNoise.value = this.noise;
    this.quad = new FullScreenQuad(this.material);
  }

  /** MSAA samples of the scene target: none at high pixel ratios, where the ink lines hide the steps. */
  setSamples(n) {
    if (this.target.samples === n) return;
    const { width, height } = this.target;
    this.target.dispose();
    this.target.samples = n;
    this.target.setSize(width, height);
  }

  setSize(w, h) {
    this.target.setSize(w, h);
    this.material.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.material.uniforms.uPx.value = Math.max(1, this.renderer.getPixelRatio());
  }

  render(scene, camera) {
    const r = this.renderer;
    if (!this.enabled) {
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    // drawn into a target, three skips tone mapping and the output curve: this pass applies them
    r.setRenderTarget(this.target);
    r.render(scene, camera);
    const u = this.material.uniforms;
    u.tScene.value = this.target.texture;
    u.tDepth.value = this.target.depthTexture;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.toneMappingExposure.value = r.toneMappingExposure;
    r.setRenderTarget(null);
    this.quad.render(r);
  }

  dispose() {
    this.target.dispose();
    this.noise.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}
