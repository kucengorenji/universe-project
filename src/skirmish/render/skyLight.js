import * as THREE from 'three';

// Sky dome (a watercolour wash with soft clouds), sun, sky light and fog for the skirmish,
// per time of day. The dome writes no depth, so the canvas pass treats it as open sky.

export const TIMES = {
  day: { zenith: '#8fb3cf', horizon: '#ece3cc', cloud: '#fbf6ea', sun: '#fff0d4', sunI: 2.7, elev: 52, az: 35, sky: '#d4e2ee', ground: '#8f7d58', hemiI: 1.15, exposure: 1.0 },
  dusk: { zenith: '#7088ad', horizon: '#f0b58a', cloud: '#f7d2b0', sun: '#ffae6c', sunI: 2.2, elev: 11, az: 70, sky: '#d8b4a4', ground: '#5e4b3a', hemiI: 0.85, exposure: 1.05 },
  night: { zenith: '#18213a', horizon: '#3c4a66', cloud: '#56607a', sun: '#a8bce6', sunI: 0.75, elev: 38, az: -40, sky: '#3a4866', ground: '#1e1d1a', hemiI: 0.55, exposure: 1.25 }
};

const SkyShader = {
  uniforms: { uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uCloud: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSun: { value: new THREE.Color() } },
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      gl_Position = p.xyww; // on the far plane
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uZenith, uHorizon, uCloud, uSun;
    uniform vec3 uSunDir;
    varying vec3 vDir;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
    float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.1; a *= 0.5; } return s; }
    void main() {
      vec3 d = normalize(vDir);
      float h = clamp(d.y, 0.0, 1.0);
      vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
      // clouds: flat watercolour blots on a plane above, pooled pigment at their edges
      vec2 uv = d.xz / max(d.y, 0.08) * 0.9;
      float c = fbm(uv * 0.9 + 3.0);
      float cloud = smoothstep(0.52, 0.66, c) * smoothstep(0.14, 0.4, d.y); // none near the horizon, where the plane streaks
      float rim = smoothstep(0.5, 0.56, c) - smoothstep(0.56, 0.64, c);
      col = mix(col, uCloud, cloud * 0.85);
      col = mix(col, uCloud * 0.86, rim * 0.35 * smoothstep(0.14, 0.4, d.y));
      // a soft halo where the sun is
      col += uSun * pow(max(dot(d, uSunDir), 0.0), 24.0) * 0.35;
      // below the horizon the dome is the horizon colour (the apron and fog cover it)
      col = mix(uHorizon, col, smoothstep(-0.02, 0.02, d.y));
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`
};

export class SkyLight {
  constructor(scene, { shadows = true, mapSize = 4096, extent = 115 } = {}) {
    this.scene = scene;
    this.material = new THREE.ShaderMaterial({ ...SkyShader, uniforms: THREE.UniformsUtils.clone(SkyShader.uniforms), side: THREE.BackSide, depthWrite: false, fog: false });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), this.material);
    this.dome.renderOrder = -1;
    this.dome.frustumCulled = false;
    this.sun = new THREE.DirectionalLight('#ffffff', 2.5);
    this.sun.castShadow = shadows;
    const sc = this.sun.shadow;
    sc.mapSize.set(mapSize, mapSize);
    sc.camera.left = sc.camera.bottom = -extent;
    sc.camera.right = sc.camera.top = extent;
    this.extent = extent;
    this.focus = new THREE.Vector3();
    sc.camera.near = 10;
    sc.camera.far = 520;
    sc.bias = -0.0004;
    sc.normalBias = 0.04;
    this.hemi = new THREE.HemisphereLight('#ffffff', '#888888', 1);
    scene.add(this.dome, this.sun, this.sun.target, this.hemi);
    scene.fog = new THREE.Fog('#ece3cc', 160, 900);
  }

  /** Apply a TIMES preset; returns its tone mapping exposure. */
  set(time) {
    const T = TIMES[time] || TIMES.day;
    const u = this.material.uniforms;
    u.uZenith.value.set(T.zenith);
    u.uHorizon.value.set(T.horizon);
    u.uCloud.value.set(T.cloud);
    u.uSun.value.set(T.sun);
    const el = THREE.MathUtils.degToRad(T.elev), az = THREE.MathUtils.degToRad(T.az);
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    u.uSunDir.value.copy(dir);
    this.sunDir = dir.clone();
    this.place();
    this.sun.color.set(T.sun);
    this.sun.intensity = T.sunI;
    this.hemi.color.set(T.sky);
    this.hemi.groundColor.set(T.ground);
    this.hemi.intensity = T.hemiI;
    this.scene.fog.color.set(T.horizon);
    this.time = time;
    return T.exposure;
  }

  /**
   * Centre the shadow frustum on a point (the action), snapped to whole shadow texels so the
   * shadow edges do not crawl as it moves.
   */
  follow(p) {
    const texel = (2 * this.extent) / this.sun.shadow.mapSize.x;
    const q = new THREE.Vector3(Math.round(p.x / texel) * texel, 0, Math.round(p.z / texel) * texel);
    if (q.distanceToSquared(this.focus) < 1e-6) return;
    this.focus.copy(q);
    this.place();
  }

  place() {
    if (!this.sunDir) return;
    this.sun.target.position.copy(this.focus);
    this.sun.position.copy(this.focus).addScaledVector(this.sunDir, 260);
    this.sun.target.updateMatrixWorld();
  }

  /** Shadow map size (0 switches the shadows off). */
  setShadows(size) {
    this.sun.castShadow = size > 0;
    if (size > 0 && this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.sun.shadow.mapSize.set(size, size);
    }
  }

  dispose() {
    this.dome.geometry.dispose();
    this.material.dispose();
    this.sun.shadow.map?.dispose();
    this.scene.remove(this.dome, this.sun, this.sun.target, this.hemi);
  }
}
