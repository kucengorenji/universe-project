import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Post-processing shared by every mode: MSAA scene target -> bloom -> tone
// mapping (OutputPass) -> a small grade (saturation, contrast, warmth,
// vignette). Modes pick a look with configure(); the Low tier (or the setting)
// switches it all off and the renderer draws straight to the screen.

const PREF_KEY = 'planet_globe_post';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSaturation: { value: 1 },
    uContrast: { value: 1 },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uVignette: { value: 0.25 }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSaturation;
    uniform float uContrast;
    uniform vec3 uGain;
    uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;
      col *= uGain;
      vec2 d = (vUv - 0.5) * vec2(1.0, 0.82);
      col *= 1.0 - uVignette * smoothstep(0.28, 0.78, length(d) * 1.2);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`
};

/** Looks per mode; configure() mixes one in. */
export const LOOKS = {
  space: { bloom: { strength: 0.7, radius: 0.5, threshold: 0.96 }, grade: { saturation: 1.08, contrast: 1.05, gain: [1, 1, 1.02], vignette: 0.42 } },
  planet: { bloom: { strength: 0.3, radius: 0.45, threshold: 0.97 }, grade: { saturation: 1.04, contrast: 1.03, gain: [1, 1, 1], vignette: 0.28 } },
  town: { bloom: { strength: 0.2, radius: 0.45, threshold: 0.97 }, grade: { saturation: 1.06, contrast: 1.04, gain: [1.01, 1, 0.99], vignette: 0.26 } },
  interior: { bloom: { strength: 0.35, radius: 0.5, threshold: 0.92 }, grade: { saturation: 1.05, contrast: 1.03, gain: [1.04, 1, 0.95], vignette: 0.4 } }
};

export class Post {
  constructor(engine) {
    this.engine = engine;
    this.renderer = engine.renderer;
    this.composer = null;
    let saved = null;
    try {
      saved = localStorage.getItem(PREF_KEY);
    } catch {
      /* optional */
    }
    this.pref = saved === 'on' || saved === 'off' ? saved : 'auto';
    this.look = LOOKS.town;
    this.boost = 0; // extra bloom a mode can add at night
  }

  /** Effects are on unless switched off, or on the Low tier in auto. */
  get enabled() {
    if (this.pref === 'on') return true;
    if (this.pref === 'off') return false;
    return this.engine.quality.tier !== 'low';
  }

  setPref(pref) {
    this.pref = pref;
    try {
      localStorage.setItem(PREF_KEY, pref);
    } catch {
      /* optional */
    }
  }

  /** MSAA samples for the scene target: phones get fewer. */
  get samples() {
    const tier = this.engine.quality.tier;
    return tier === 'high' ? 4 : tier === 'medium' ? 2 : 0;
  }

  build() {
    const r = this.renderer;
    const composer = new EffectComposer(r);
    const samples = this.samples;
    composer.renderTarget1.samples = samples;
    composer.renderTarget2.samples = samples;
    this.builtSamples = samples;
    this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    composer.addPass(this.renderPass);
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.5, 0.9);
    // Bloom at half the usual resolution: it is blurry anyway, and cheaper on an iGPU
    const setSize = bloom.setSize.bind(bloom);
    bloom.setSize = (w, h) => setSize(Math.max(64, w * 0.5), Math.max(64, h * 0.5));
    // Add light, never opacity: the canvas is transparent where a mode shows a CSS backdrop
    const bm = bloom.blendMaterial;
    bm.blending = THREE.CustomBlending;
    bm.blendEquation = THREE.AddEquation;
    bm.blendSrc = THREE.OneFactor;
    bm.blendDst = THREE.OneFactor;
    bm.blendSrcAlpha = THREE.ZeroFactor;
    bm.blendDstAlpha = THREE.OneFactor;
    this.bloom = bloom;
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    composer.addPass(this.grade);
    this.composer = composer;
    this.resize();
    this.applyLook();
  }

  dispose() {
    if (!this.composer) return;
    this.composer.passes.forEach((p) => p.dispose?.());
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();
    this.composer = null;
  }

  resize() {
    if (!this.composer) return;
    const { width, height } = this.engine.size;
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(width, height);
  }

  /** Pick a look (a LOOKS key or an object), optionally with extra bloom. */
  configure(look, { boost } = {}) {
    this.look = typeof look === 'string' ? LOOKS[look] || LOOKS.town : look;
    if (boost !== undefined) this.boost = boost;
    this.applyLook();
  }

  setBoost(boost) {
    if (Math.abs(boost - this.boost) < 0.01) return;
    this.boost = boost;
    this.applyLook();
  }

  applyLook() {
    if (!this.composer) return;
    const { bloom, grade } = this.look;
    this.bloom.strength = bloom.strength + this.boost;
    this.bloom.radius = bloom.radius;
    this.bloom.threshold = bloom.threshold - this.boost * 0.25;
    const u = this.grade.uniforms;
    u.uSaturation.value = grade.saturation;
    u.uContrast.value = grade.contrast;
    u.uGain.value.fromArray(grade.gain);
    u.uVignette.value = grade.vignette;
  }

  render(scene, camera) {
    if (!this.enabled) {
      if (this.composer) this.dispose();
      this.renderer.render(scene, camera);
      return;
    }
    if (this.composer && this.builtSamples !== this.samples) this.dispose();
    if (!this.composer) this.build();
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.composer.render();
  }
}
