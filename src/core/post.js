import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// Post-processing shared by every mode: the scene renders once into an MSAA
// target, bloom is built from it at a quarter of the resolution, and a single
// final pass adds the bloom, tone maps and grades (saturation, contrast,
// warmth, vignette) straight onto the screen. Modes pick a look with
// configure(); the Low tier (or the setting) switches it all off and the
// renderer draws straight to the screen.
//
// One final pass on purpose: the stock composer blended the bloom back into
// the multisampled target and copied it through two more full-screen passes,
// which cost over 30 ms a frame at Retina size on an M1 Pro.

const PREF_KEY = 'planet_globe_post';

const FinalShader = {
  uniforms: {
    tScene: { value: null },
    tBloom: { value: null },
    uBloom: { value: 1 },
    toneMappingExposure: { value: 1 },
    uSaturation: { value: 1 },
    uContrast: { value: 1 },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uVignette: { value: 0.25 }
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
    uniform sampler2D tBloom;
    uniform float uBloom;
    uniform float uSaturation;
    uniform float uContrast;
    uniform vec3 uGain;
    uniform float uVignette;
    #include <tonemapping_pars_fragment>
    #include <colorspace_pars_fragment>
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tScene, vUv);
      // Bloom adds light, never opacity: the canvas is transparent where a mode shows a CSS backdrop
      vec3 col = c.rgb + texture2D(tBloom, vUv).rgb * uBloom;
      #if defined( ACES_FILMIC_TONE_MAPPING )
        col = ACESFilmicToneMapping(col);
      #elif defined( NEUTRAL_TONE_MAPPING )
        col = NeutralToneMapping(col);
      #elif defined( AGX_TONE_MAPPING )
        col = AgXToneMapping(col);
      #elif defined( REINHARD_TONE_MAPPING )
        col = ReinhardToneMapping(col);
      #elif defined( LINEAR_TONE_MAPPING )
        col = LinearToneMapping(col);
      #endif
      #ifdef SRGB_TRANSFER
        col = sRGBTransferOETF(vec4(col, 1.0)).rgb;
      #endif
      // Grade in display space, as the old separate grade pass did
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;
      col *= uGain;
      vec2 d = (vUv - 0.5) * vec2(1.0, 0.82);
      col *= 1.0 - uVignette * smoothstep(0.28, 0.78, length(d) * 1.2);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`
};

const TONE_DEFINES = {
  [THREE.ACESFilmicToneMapping]: 'ACES_FILMIC_TONE_MAPPING',
  [THREE.NeutralToneMapping]: 'NEUTRAL_TONE_MAPPING',
  [THREE.AgXToneMapping]: 'AGX_TONE_MAPPING',
  [THREE.ReinhardToneMapping]: 'REINHARD_TONE_MAPPING',
  [THREE.LinearToneMapping]: 'LINEAR_TONE_MAPPING'
};

/** UnrealBloomPass without its last step: the blurred glow stays in its own texture for the final pass. */
class Glow extends UnrealBloomPass {
  render(renderer, input) {
    this.highPassUniforms.tDiffuse.value = input;
    this.highPassUniforms.luminosityThreshold.value = this.threshold;
    this.fsQuad.material = this.materialHighPassFilter;
    renderer.setRenderTarget(this.renderTargetBright);
    this.fsQuad.render(renderer);
    let from = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i++) {
      const blur = this.separableBlurMaterials[i];
      this.fsQuad.material = blur;
      blur.uniforms.colorTexture.value = from.texture;
      blur.uniforms.direction.value = UnrealBloomPass.BlurDirectionX;
      renderer.setRenderTarget(this.renderTargetsHorizontal[i]);
      this.fsQuad.render(renderer);
      blur.uniforms.colorTexture.value = this.renderTargetsHorizontal[i].texture;
      blur.uniforms.direction.value = UnrealBloomPass.BlurDirectionY;
      renderer.setRenderTarget(this.renderTargetsVertical[i]);
      this.fsQuad.render(renderer);
      from = this.renderTargetsVertical[i];
    }
    const composite = this.compositeMaterial;
    this.fsQuad.material = composite;
    composite.uniforms.bloomStrength.value = this.strength;
    composite.uniforms.bloomRadius.value = this.radius;
    renderer.setRenderTarget(this.renderTargetsHorizontal[0]);
    this.fsQuad.render(renderer);
    return this.renderTargetsHorizontal[0].texture;
  }
}

/** Looks per mode; configure() mixes one in. */
export const LOOKS = {
  space: { bloom: { strength: 0.7, radius: 0.5, threshold: 0.96 }, grade: { saturation: 1.08, contrast: 1.05, gain: [1, 1, 1.02], vignette: 0.42 } },
  planet: { bloom: { strength: 0.3, radius: 0.45, threshold: 0.97 }, grade: { saturation: 1.04, contrast: 1.03, gain: [1, 1, 1], vignette: 0.28 } },
  town: { bloom: { strength: 0.2, radius: 0.45, threshold: 0.97 }, grade: { saturation: 1.06, contrast: 1.04, gain: [1.01, 1, 0.99], vignette: 0.26 } },
  // Neutral tone mapping keeps the room's saturated toy colours close to their palette values
  interior: { bloom: { strength: 0.3, radius: 0.5, threshold: 0.9 }, grade: { saturation: 1.06, contrast: 1.04, gain: [1.02, 1, 0.97], vignette: 0.32 }, toneMapping: THREE.NeutralToneMapping, exposure: 1 }
};

export class Post {
  constructor(engine) {
    this.engine = engine;
    this.target = null;
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

  get renderer() {
    return this.engine.renderer;
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

  /**
   * MSAA samples for the scene target: phones get fewer, and so do Retina screens, whose pixels
   * are small enough that 2 look like 4. Keyed to the screen, not the governed pixel ratio, so
   * stepping the resolution down never raises the sample count.
   */
  get samples() {
    const tier = this.engine.quality.tier;
    const n = tier === 'high' ? 4 : tier === 'medium' ? 2 : 0;
    return (window.devicePixelRatio || 1) >= 1.75 ? Math.min(n, 2) : n;
  }

  build() {
    const samples = this.samples;
    this.builtSamples = samples;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples });
    this.target.texture.name = 'Post.scene';
    this.bloom = new Glow(new THREE.Vector2(256, 256), 0.3, 0.5, 0.9);
    this.material = new THREE.RawShaderMaterial({
      name: 'Post.final',
      uniforms: THREE.UniformsUtils.clone(FinalShader.uniforms),
      vertexShader: FinalShader.vertexShader,
      fragmentShader: FinalShader.fragmentShader,
      depthTest: false,
      depthWrite: false
    });
    this.toneKey = null;
    this.quad = new FullScreenQuad(this.material);
    this.resize();
    this.applyLook();
  }

  dispose() {
    if (!this.target) return;
    this.target.dispose();
    this.bloom.dispose();
    this.material.dispose();
    this.quad.dispose();
    this.target = null;
  }

  resize() {
    if (!this.target) return;
    const { width, height } = this.engine.size;
    const pr = this.renderer.getPixelRatio();
    const w = Math.max(1, Math.floor(width * pr));
    const h = Math.max(1, Math.floor(height * pr));
    this.target.setSize(w, h);
    // The glow starts at a quarter of the screen: it is blurry anyway, and cheaper on an iGPU
    this.bloom.setSize(Math.max(64, w * 0.5), Math.max(64, h * 0.5));
  }

  /** Pick a look (a LOOKS key or an object), optionally with extra bloom. */
  configure(look, { boost } = {}) {
    this.look = typeof look === 'string' ? LOOKS[look] || LOOKS.town : look;
    if (boost !== undefined) this.boost = boost;
    this.renderer.toneMapping = this.look.toneMapping ?? THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.look.exposure ?? 1.05;
    this.applyLook();
  }

  setBoost(boost) {
    if (Math.abs(boost - this.boost) < 0.01) return;
    this.boost = boost;
    this.applyLook();
  }

  applyLook() {
    if (!this.target) return;
    const { bloom, grade } = this.look;
    this.bloom.strength = bloom.strength + this.boost;
    this.bloom.radius = bloom.radius;
    this.bloom.threshold = bloom.threshold - this.boost * 0.25;
    const u = this.material.uniforms;
    u.uSaturation.value = grade.saturation;
    u.uContrast.value = grade.contrast;
    u.uGain.value.fromArray(grade.gain);
    u.uVignette.value = grade.vignette;
  }

  /** Tone mapping and output transfer follow the renderer, as OutputPass did. */
  syncDefines() {
    const r = this.renderer;
    const key = `${r.toneMapping}:${r.outputColorSpace}`;
    if (key === this.toneKey) return;
    this.toneKey = key;
    const defines = {};
    if (THREE.ColorManagement.getTransfer(r.outputColorSpace) === THREE.SRGBTransfer) defines.SRGB_TRANSFER = '';
    if (TONE_DEFINES[r.toneMapping]) defines[TONE_DEFINES[r.toneMapping]] = '';
    this.material.defines = defines;
    this.material.needsUpdate = true;
  }

  /**
   * Compile a scene's shaders ahead of use, for the target it will really be drawn into: the
   * post target and the screen get different programs (tone mapping, output colour space).
   */
  compileAsync(scene, camera) {
    const r = this.renderer;
    if (this.enabled && !this.target) this.build();
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.enabled ? this.target : null);
    const done = r.compileAsync(scene, camera);
    r.setRenderTarget(prev);
    return done;
  }

  render(scene, camera) {
    const r = this.renderer;
    if (!this.enabled) {
      if (this.target) this.dispose();
      r.render(scene, camera);
      return;
    }
    if (this.target && this.builtSamples !== this.samples) this.dispose();
    if (!this.target) this.build();
    r.setRenderTarget(this.target);
    r.render(scene, camera);
    const u = this.material.uniforms;
    const glow = this.bloom.strength > 0.01;
    if (glow) u.tBloom.value = this.bloom.render(r, this.target.texture);
    u.uBloom.value = glow ? 1 : 0;
    u.tScene.value = this.target.texture;
    u.toneMappingExposure.value = r.toneMappingExposure;
    this.syncDefines();
    r.setRenderTarget(null);
    this.quad.render(r);
  }
}
