import * as THREE from 'three';
import PALETTE from '../valleyPalette.json';
import { valleyUniforms } from './valleyMaterial.js';

// Sky dome, sun/moon and hemisphere fill for the valley, one preset per time of day
// (valleyPalette.json `times`). Switching eases over ~1.5 s so times can be compared live.

const COLOR_KEYS = ['sun', 'sky', 'horizon', 'hemiSky', 'hemiGround', 'fog'];
const WHITE = new THREE.Color(1, 1, 1);
const NUMBER_KEYS = ['sunIntensity', 'hemiIntensity', 'fogNear', 'fogFar', 'night'];

function preset(name) {
  const t = PALETTE.times[name];
  const el = THREE.MathUtils.degToRad(t.sunElevation), az = THREE.MathUtils.degToRad(t.sunAzimuth);
  const out = { dir: new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)) };
  for (const k of COLOR_KEYS) out[k] = new THREE.Color(t[k]);
  for (const k of NUMBER_KEYS) out[k] = t[k];
  return out;
}

export class ValleySky {
  constructor(scene, { shadows = true, mapSize = 2048 } = {}) {
    this.scene = scene;
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(900, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uCloud: { value: new THREE.Color() }, uTime: valleyUniforms.uTime },
        vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        // Soft painted clouds: value-noise fbm on a plane above the valley, drifting with the wind
        fragmentShader: `uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uCloud; uniform float uTime; varying vec3 vDir;
          float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
          float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int k = 0; k < 5; k++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
          void main(){ float t = smoothstep(-0.05, 0.55, vDir.y); vec3 col = mix(uHorizon, uTop, t);
            if (vDir.y > 0.0) {
              vec2 p = vDir.xz / (vDir.y + 0.18) * 1.6 + vec2(uTime * 0.012, uTime * 0.005);
              float c = smoothstep(0.52, 0.72, fbm(p)) * smoothstep(0.0, 0.18, vDir.y);
              float lit = smoothstep(0.5, 0.85, fbm(p + vec2(0.08, 0.05)));
              col = mix(col, mix(uCloud, uCloud * 0.86 + uTop * 0.08, lit), c * 0.9);
            }
            gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          }`
      })
    );
    this.dome.renderOrder = -1;
    this.dome.frustumCulled = false;
    scene.add(this.dome);
    this.sun = new THREE.DirectionalLight();
    this.sun.castShadow = shadows;
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -34;
    cam.right = cam.top = 34;
    cam.near = 1;
    cam.far = 160;
    this.sun.shadow.mapSize.set(mapSize, mapSize);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.intensity = 0.5; // soft, coloured cast shadows, as in the painted reference
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight();
    scene.add(this.hemi);
    scene.fog = new THREE.Fog(0xffffff, 60, 200);
    this.current = null;
    this.target = null;
    this.seasonTint = { color: new THREE.Color('#ffffff'), mix: 0 };
  }

  /** A season's cast over the sky and the haze (cooler in winter, warmer in autumn). */
  setSeason({ tint, mix }) {
    this.seasonTint.color.set(tint);
    this.seasonTint.mix = mix;
    this.apply();
  }

  set(name, { instant = false } = {}) {
    this.name = name;
    this.target = preset(name);
    if (instant || !this.current) this.current = preset(name);
    this.apply();
  }

  /** Follow the focus so the shadow map always covers what the camera sees. */
  update(dt, focus) {
    if (this.target && this.current) {
      const k = 1 - Math.exp(-dt * 2.5);
      for (const key of COLOR_KEYS) this.current[key].lerp(this.target[key], k);
      for (const key of NUMBER_KEYS) this.current[key] += (this.target[key] - this.current[key]) * k;
      this.current.dir.lerp(this.target.dir, k).normalize();
    }
    this.apply(focus);
  }

  apply(focus = this.sun.target.position) {
    const c = this.current;
    const { color: tint, mix } = this.seasonTint;
    this.dome.material.uniforms.uTop.value.copy(c.sky).lerp(tint, mix);
    this.dome.material.uniforms.uHorizon.value.copy(c.horizon).lerp(tint, mix);
    // Clouds: near white by day, warmed by the horizon at dusk, dim blue at night
    this.dome.material.uniforms.uCloud.value.copy(c.horizon).lerp(WHITE, 0.72 * (1 - c.night)).multiplyScalar(1 - c.night * 0.45);
    this.sun.color.copy(c.sun);
    this.sun.intensity = c.sunIntensity;
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(c.dir, 80);
    this.hemi.color.copy(c.hemiSky);
    this.hemi.groundColor.copy(c.hemiGround);
    this.hemi.intensity = c.hemiIntensity;
    this.scene.fog.color.copy(c.fog).lerp(tint, mix);
    this.scene.fog.near = c.fogNear;
    this.scene.fog.far = c.fogFar;
    valleyUniforms.uNight.value = c.night;
  }

  dispose() {
    this.dome.geometry.dispose();
    this.dome.material.dispose();
    this.sun.dispose();
    this.scene.remove(this.dome, this.sun, this.sun.target, this.hemi);
  }
}
