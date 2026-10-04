import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// The skirmish "CANVAS" look, after the watercolour-and-pencil rendering of Valkyria Chronicles:
//   1. pencil hatching inside every toon material (installCanvasShading): strokes from a tiling
//      hatch texture, projected from the world on three axes (from the rest pose on skinned
//      soldiers), so they stay on the surfaces as the camera moves. Light strokes everywhere,
//      denser on the dark side, cross-hatching in cast shadow; pigment blotches vary the paint.
//      A material can opt out with the define CANVAS_PLAIN (the tall grass: much overdraw, and
//      its blades already read as strokes).
//   2. the sky dome takes the same strokes (SkyLight.setHatch).
//   3. one post pass (CanvasPost): ink outlines from depth and colour edges, a soft glow from a
//      quarter-resolution blur (also the depth of field while aiming), a warm paper grade, paper
//      grain, and a frame whose edges turn back into paper: the colour runs out, the pencil
//      lines carry on, and pigment pools along the edge of the wash.
// Only the skirmish page installs this: the main game keeps the stock toon shader.

export const PAPER = new THREE.Color('#efe6d2');
export const INK = new THREE.Color('#2a2119');

// screen pixels covered by one hatch texture tile (46 rows of strokes: about 5 px apart)
const STROKE_PX_PER_TILE = 230;

let hatch = null;

/**
 * The tiling 256 x 256 hatch texture, drawn once: r = pencil strokes leaning one way (the light
 * layer), g = strokes across them (the cross-hatching), b = soft pigment blotches. Mipmapped, so
 * distant strokes melt into an even tone instead of shimmering.
 */
export function hatchTexture() {
  if (hatch) return hatch;
  const N = 256;
  let seed = 11;
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const layer = (draw) => {
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, N, N);
    // every mark is drawn nine times, shifted by a tile, so the texture wraps without seams
    const wrap = (fn) => {
      for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) {
        g.save();
        g.translate(ox, oy);
        fn(g);
        g.restore();
      }
    };
    draw(g, wrap);
    return g.getImageData(0, 0, N, N).data;
  };
  const strokes = (angle, rows, alpha) => (g, wrap) => {
    g.lineCap = 'round';
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const nx = -dy, ny = dx;
    const spacing = (N * 1.42) / rows;
    for (let r = 0; r < rows; r++) {
      // each row is a few strokes of varied length, pressure and width, with small gaps
      let s = -N * 0.9 + rand() * 20;
      const off = (r - rows / 2) * spacing + (rand() - 0.5) * spacing * 0.5;
      while (s < N * 0.9) {
        const len = 14 + rand() * 34;
        const a = alpha * (0.45 + rand() * 0.55);
        const w = 0.8 + rand() * 0.9;
        const bend = (rand() - 0.5) * 2.5;
        const x0 = N / 2 + dx * s + nx * off, y0 = N / 2 + dy * s + ny * off;
        const x1 = x0 + dx * len + nx * bend, y1 = y0 + dy * len + ny * bend;
        wrap((g2) => {
          g2.strokeStyle = `rgba(255,255,255,${a.toFixed(3)})`;
          g2.lineWidth = w;
          g2.beginPath();
          g2.moveTo(x0, y0);
          g2.quadraticCurveTo((x0 + x1) / 2 + nx * bend, (y0 + y1) / 2 + ny * bend, x1, y1);
          g2.stroke();
        });
        s += len + 2 + rand() * 9;
      }
    }
  };
  const blotches = (g, wrap) => {
    for (let i = 0; i < 70; i++) {
      const x = rand() * N, y = rand() * N, r = 18 + rand() * 50, a = 0.08 + rand() * 0.18;
      wrap((g2) => {
        const grad = g2.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, `rgba(255,255,255,${a})`);
        grad.addColorStop(0.75, `rgba(255,255,255,${a * 0.6})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g2.fillStyle = grad;
        g2.beginPath();
        g2.arc(x, y, r, 0, Math.PI * 2);
        g2.fill();
      });
    }
  };
  const r = layer(strokes(-1.02, 46, 0.95));
  const g = layer(strokes(0.5, 38, 0.9));
  const b = layer(blotches);
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    data[i * 4] = r[i * 4];
    data[i * 4 + 1] = g[i * 4];
    data[i * 4 + 2] = b[i * 4];
    data[i * 4 + 3] = 255;
  }
  hatch = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  hatch.wrapS = hatch.wrapT = THREE.RepeatWrapping;
  hatch.magFilter = THREE.LinearFilter;
  hatch.minFilter = THREE.LinearMipmapLinearFilter;
  hatch.generateMipmaps = true;
  hatch.anisotropy = 4;
  hatch.needsUpdate = true;
  return hatch;
}

let installed = false;

/** Patch MeshToonMaterial (every instance, this page only) with world-anchored pencil hatching. */
export function installCanvasShading() {
  if (installed) return;
  installed = true;
  const lib = THREE.ShaderLib.toon;
  lib.uniforms.uCanvasHatch = { value: hatchTexture() };
  lib.vertexShader = lib.vertexShader
    .replace('#include <common>', `#include <common>
      varying vec3 vCanvasPos;
      varying vec3 vCanvasNrm;`)
    .replace('#include <project_vertex>', `#include <project_vertex>
      #ifdef USE_SKINNING
        // soldiers: the rest pose, so the strokes ride on the body as it moves
        vCanvasPos = position;
        vCanvasNrm = normal;
      #else
        {
          vec4 cw = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            cw = instanceMatrix * cw;
          #endif
          vCanvasPos = ( modelMatrix * cw ).xyz;
          vCanvasNrm = inverseTransformDirection( transformedNormal, viewMatrix );
        }
      #endif`);
  lib.fragmentShader = lib.fragmentShader
    .replace('#include <common>', `#include <common>
      uniform sampler2D uCanvasHatch;
      varying vec3 vCanvasPos;
      varying vec3 vCanvasNrm;
      // the hatch texture projected along the axis the surface faces most (one sample per
      // octave). Its scale follows the size of a pixel on the surface in octaves (two blended),
      // so strokes keep about the same width on screen near and far while staying anchored to it
      vec4 canvasHatch() {
        vec3 n = abs( vCanvasNrm );
        vec2 p = n.x > n.y && n.x > n.z ? vCanvasPos.zy : n.y > n.z ? vCanvasPos.xz : vCanvasPos.xy;
        vec3 fw = fwidth( vCanvasPos );
        float pxWorld = max( max( fw.x, fw.y ), max( fw.z, 1e-5 ) );
        float level = log2( pxWorld * ${STROKE_PX_PER_TILE.toFixed(1)} );
        float fl = floor( level );
        vec2 pA = p * exp2( -fl );
        return mix( texture2D( uCanvasHatch, pA ), texture2D( uCanvasHatch, pA * 0.5 ), smoothstep( 0.0, 1.0, fract( level ) ) );
      }`)
    .replace('vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;', `
      vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
      #if NUM_DIR_LIGHTS > 0 && ! defined( CANVAS_PLAIN )
      {
        vec4 h = canvasHatch();
        // how lit this pixel is by the sun, 0..1, independent of its paint colour
        float sun = dot( directionalLights[ 0 ].color, vec3( 0.3333 ) );
        float paint = dot( material.diffuseColor, vec3( 0.3333 ) ) * RECIPROCAL_PI * sun;
        float lit = clamp( dot( reflectedLight.directDiffuse, vec3( 0.3333 ) ) / max( paint, 1e-4 ), 0.0, 1.0 );
        #ifdef USE_SKINNING
          float light = 0.0; // the soldiers' atlas already carries its own pencil work
        #else
          float light = 0.42;
        #endif
        float shade = 1.0 - smoothstep( 0.2, 0.62, lit );
        float castShade = 1.0 - smoothstep( 0.03, 0.16, lit );
        float hatch = h.r * ( light + 0.6 * shade ) + h.g * 0.62 * castShade;
        // strokes ease off with distance (vViewPosition is the view-space position); the mipmaps already soften them
        hatch *= 1.0 - smoothstep( 45.0, 120.0, length( vViewPosition ) );
        hatch = clamp( hatch, 0.0, 1.0 );
        // pigment pools unevenly: blotches a little deeper or paler than the paint
        outgoingLight *= 0.93 + 0.16 * h.b;
        outgoingLight = mix( outgoingLight, outgoingLight * vec3( 0.46, 0.43, 0.47 ), hatch );
      }
      #endif`);
}

/** Display-space (sRGB) components: the canvas pass grades after tone mapping and the sRGB curve. */
const srgb = (c) => {
  const { r, g, b } = c.getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
  return new THREE.Vector3(r, g, b);
};

const QUAD_VERTEX = /* glsl */ `
  precision highp float;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  attribute vec3 position;
  attribute vec2 uv;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

/** Scene (HDR) -> quarter resolution, tone mapped: a 4-tap box over 4 x 4 pixels. */
const DownShader = {
  uniforms: { tScene: { value: null }, uTexel: { value: new THREE.Vector2() }, toneMappingExposure: { value: 1 } },
  vertexShader: QUAD_VERTEX,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tScene;
    uniform vec2 uTexel; // of the scene target
    #include <tonemapping_pars_fragment>
    #include <colorspace_pars_fragment>
    varying vec2 vUv;
    vec3 tm(vec2 uv) { return sRGBTransferOETF(vec4(ACESFilmicToneMapping(texture2D(tScene, uv).rgb), 1.0)).rgb; }
    void main() {
      vec2 o = uTexel;
      vec3 c = tm(vUv + vec2(-o.x, -o.y)) + tm(vUv + vec2(o.x, -o.y)) + tm(vUv + vec2(-o.x, o.y)) + tm(vUv + vec2(o.x, o.y));
      gl_FragColor = vec4(c * 0.25, 1.0);
    }`
};

/** One 2D blur pass: a centre tap and eight bilinear taps on a ring (about a 6 x 6 tent). */
const BlurShader = {
  uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
  vertexShader: QUAD_VERTEX,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tSrc;
    uniform vec2 uDir; // one texel of the source
    varying vec2 vUv;
    void main() {
      vec2 o = uDir * 1.5;
      vec3 c = texture2D(tSrc, vUv).rgb * 0.2;
      c += (texture2D(tSrc, vUv + vec2(o.x, 0.0)).rgb + texture2D(tSrc, vUv - vec2(o.x, 0.0)).rgb + texture2D(tSrc, vUv + vec2(0.0, o.y)).rgb + texture2D(tSrc, vUv - vec2(0.0, o.y)).rgb) * 0.12;
      c += (texture2D(tSrc, vUv + o * 1.6).rgb + texture2D(tSrc, vUv - o * 1.6).rgb + texture2D(tSrc, vUv + vec2(o.x, -o.y) * 1.6).rgb + texture2D(tSrc, vUv + vec2(-o.x, o.y) * 1.6).rgb) * 0.08;
      gl_FragColor = vec4(c, 1.0);
    }`
};

const CanvasShader = {
  uniforms: {
    tScene: { value: null },
    tDepth: { value: null },
    tBlur: { value: null },
    tNoise: { value: null },
    tHatch: { value: null },
    uNear: { value: 0.1 },
    uFar: { value: 1000 },
    uTexel: { value: new THREE.Vector2(1, 1) },
    uAspect: { value: 1 },
    uPx: { value: 1 },
    uPaper: { value: srgb(PAPER) },
    uInk: { value: srgb(INK) },
    uLine: { value: 1.5 }, // outline width in screen pixels (x device pixel ratio)
    uWash: { value: 1 },
    uGlow: { value: 1 },
    uFocus: { value: 10 }, // depth of field: focus distance (m) and strength 0..1 (aiming)
    uDof: { value: 0 },
    uAim: { value: 0 }, // the ink vignette while aiming, 0..1
    toneMappingExposure: { value: 1 }
  },
  vertexShader: QUAD_VERTEX,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tScene;
    uniform sampler2D tDepth;
    uniform sampler2D tBlur;
    uniform sampler2D tNoise; // tiling noise: r fine grain, g coarse blotches, ba smooth wobble
    uniform sampler2D tHatch;
    uniform float uNear;
    uniform float uFar;
    uniform vec2 uTexel;
    uniform float uAspect;
    uniform float uPx;
    uniform vec3 uPaper;
    uniform vec3 uInk;
    uniform float uLine;
    uniform float uWash;
    uniform float uGlow;
    uniform float uFocus;
    uniform float uDof;
    uniform float uAim;
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
      vec2 wob = (texture2D(tNoise, px / (768.0 * uPx)).ba - 0.5) * 2.6 * uPx * uTexel;
      vec2 uv = vUv + wob;
      vec3 col = toneMapped(vUv);
      vec3 blur = texture2D(tBlur, vUv).rgb;

      // ink: depth discontinuities relative to distance (silhouettes, creases), plus colour edges
      vec2 o = uTexel * uPx * uLine;
      float zc = -viewZ(uv);
      float zl = -viewZ(uv - vec2(o.x, 0.0)), zr = -viewZ(uv + vec2(o.x, 0.0));
      float zd = -viewZ(uv - vec2(0.0, o.y)), zu = -viewZ(uv + vec2(0.0, o.y));
      float dz = max(max(abs(zl - zc), abs(zr - zc)), max(abs(zd - zc), abs(zu - zc)));
      // a second-order term picks out creases where both neighbours bend the same way
      float crease = abs(zl + zr - 2.0 * zc) + abs(zd + zu - 2.0 * zc);
      float edgeZ = smoothstep(0.015, 0.045, dz / max(zc, 0.5)) + smoothstep(0.045, 0.11, crease / max(zc, 0.5)) * 0.7;
      float gx = lumaHdr(uv + vec2(o.x, 0.0)) - lumaHdr(uv - vec2(o.x, 0.0));
      float gy = lumaHdr(uv + vec2(0.0, o.y)) - lumaHdr(uv - vec2(0.0, o.y));
      float edgeC = smoothstep(0.1, 0.24, length(vec2(gx, gy)));
      float sky = step(0.9999, texture2D(tDepth, vUv).x);
      // lines keep their weight up close and only lighten far away, like pencil pressure easing off
      float far = smoothstep(40.0, 160.0, zc);
      float ink = clamp(max(edgeZ, edgeC * 0.65) * (1.0 - far * 0.65), 0.0, 1.0) * (1.0 - sky);
      ink *= 0.72 + 0.28 * texture2D(tNoise, px / (90.0 * uPx)).r;

      // depth of field while aiming: what is far from the focus melts into the blurred copy
      float coc = clamp(abs(zc - uFocus) / max(uFocus * 1.1, 3.0) - 0.3, 0.0, 1.0) * uDof;
      col = mix(col, blur, coc);
      ink *= 1.0 - coc * 0.75;

      // soft glow: bright paint bleeds into the paper around it, and a faint haze over everything
      vec3 glow = max(blur - 0.68, 0.0) * 1.4;
      col += glow * 0.4 * uGlow;
      col = 1.0 - (1.0 - col) * (1.0 - blur * 0.1 * uGlow);

      // paper grade: warm, shadows lifted toward sepia, midtones a touch richer
      float l = luma(col);
      col = mix(vec3(l), col, 1.06);
      col = mix(col, col * vec3(1.04, 0.99, 0.9), 0.28);
      col = mix(uPaper * 0.24, vec3(1.0), col);

      // distance wash: the far field dissolves into paper
      col = mix(col, uPaper, smoothstep(90.0, 300.0, zc) * 0.38 * (1.0 - sky));

      // the frame: the colour runs out toward the edges and pools in a darker rim where it stops;
      // the pencil lines keep going into the bare paper
      float grain = texture2D(tNoise, px / (200.0 * uPx)).r * 0.6 + texture2D(tNoise, px / (1600.0 * uPx)).g * 0.4;
      float d = min(min(vUv.x, 1.0 - vUv.x) * uAspect, min(vUv.y, 1.0 - vUv.y)); // distance to the edge, in screen heights
      float rag = (texture2D(tNoise, vUv * vec2(1.7 * uAspect, 1.7)).g - 0.5) * 0.07 + (grain - 0.5) * 0.012;
      float wash = (1.0 - smoothstep(0.012, 0.07, d + rag)) * uWash;
      float rim = smoothstep(0.08, 0.3, wash) * (1.0 - smoothstep(0.3, 0.62, wash));
      col = mix(col, col * col * 1.1, rim * 0.35);
      col = mix(col, uPaper * (0.97 + 0.05 * grain), smoothstep(0.25, 0.95, wash));

      // the ink vignette while aiming: edges darken and pick up cross strokes
      float vig = smoothstep(0.24, 0.0, d) * uAim;
      float strokes = texture2D(tHatch, px / (256.0 * uPx)).g;
      col = mix(col, col * vec3(0.66, 0.6, 0.58), vig * (0.35 + 0.3 * strokes));

      col = mix(col, uInk, ink * 0.85 * (1.0 - wash * 0.45));

      // paper: fibres and grain, the tooth of the sheet showing through the paint
      col *= 0.94 + 0.08 * grain;
      col += (texture2D(tNoise, px / (60.0 * uPx)).r - 0.5) * 0.03;

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

const raw = (S) =>
  new THREE.RawShaderMaterial({ uniforms: THREE.UniformsUtils.clone(S.uniforms), vertexShader: S.vertexShader, fragmentShader: S.fragmentShader, depthTest: false, depthWrite: false });

/**
 * Scene -> (multisampled) target with depth -> a quarter-resolution blurred copy -> one canvas
 * pass to the screen. dof({ focus, strength }) and aim(k) drive the aiming look.
 */
export class CanvasPost {
  constructor(renderer, { samples = 2 } = {}) {
    this.renderer = renderer;
    this.enabled = true;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples });
    this.target.depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);
    const small = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.blurA = small();
    this.blurB = small();
    this.material = raw(CanvasShader);
    this.material.name = 'CanvasPost';
    this.material.defines = { ACES_FILMIC_TONE_MAPPING: '' };
    this.down = raw(DownShader);
    this.down.defines = { ACES_FILMIC_TONE_MAPPING: '' };
    this.blur = raw(BlurShader);
    this.noise = noiseTexture();
    this.material.uniforms.tNoise.value = this.noise;
    this.material.uniforms.tHatch.value = hatchTexture();
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
    const qw = Math.max(1, Math.round(w / 4)), qh = Math.max(1, Math.round(h / 4));
    this.blurA.setSize(qw, qh);
    this.blurB.setSize(qw, qh);
    const u = this.material.uniforms;
    u.uTexel.value.set(1 / w, 1 / h);
    u.uAspect.value = w / h;
    u.uPx.value = Math.max(1, this.renderer.getPixelRatio());
    this.down.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.qTexel = new THREE.Vector2(1 / qw, 1 / qh);
  }

  /** Depth of field: focus distance (m) and strength 0..1. */
  dof(focus, strength) {
    const u = this.material.uniforms;
    u.uFocus.value = focus;
    u.uDof.value = strength;
  }

  /** The aiming vignette, 0..1. */
  aim(k) {
    this.material.uniforms.uAim.value = k;
  }

  render(scene, camera) {
    const r = this.renderer;
    if (!this.enabled) {
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    // drawn into a target, three skips tone mapping and the output curve: these passes apply them
    r.setRenderTarget(this.target);
    r.render(scene, camera);
    const exposure = r.toneMappingExposure;
    // the blurred copy: down to a quarter, then one 2D blur
    this.down.uniforms.tScene.value = this.target.texture;
    this.down.uniforms.toneMappingExposure.value = exposure;
    this.quad.material = this.down;
    r.setRenderTarget(this.blurA);
    this.quad.render(r);
    this.quad.material = this.blur;
    this.blur.uniforms.tSrc.value = this.blurA.texture;
    this.blur.uniforms.uDir.value.copy(this.qTexel);
    r.setRenderTarget(this.blurB);
    this.quad.render(r);
    const u = this.material.uniforms;
    u.tScene.value = this.target.texture;
    u.tDepth.value = this.target.depthTexture;
    u.tBlur.value = this.blurB.texture;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.toneMappingExposure.value = exposure;
    this.quad.material = this.material;
    r.setRenderTarget(null);
    this.quad.render(r);
  }

  dispose() {
    this.target.dispose();
    this.blurA.dispose();
    this.blurB.dispose();
    this.noise.dispose();
    for (const m of [this.material, this.down, this.blur]) m.dispose();
    this.quad.dispose();
  }
}
