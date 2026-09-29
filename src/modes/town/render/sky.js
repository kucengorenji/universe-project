import * as THREE from 'three';
import { createNoise3D } from '../../../math/simplex3d.js';
import { mulberry32 } from '../../../math/random.js';

// Town sky: gradient dome with sun disc and halo, drifting clouds, stars at
// night. `update(sun)` also returns the matching lighting (sun or moon light,
// sky fill, fog colour and how much "night" there is for glowing windows).

const PALETTES = {
  // [day top, day horizon, sunset, night top, night horizon]
  terran: [0x4f8fd6, 0xcfe4f4, 0xf4a15a, 0x050a1c, 0x16213f],
  ocean: [0x4a92dc, 0xd2ecf7, 0xf6a868, 0x050b1e, 0x152545],
  desert: [0xc98e55, 0xf5e2bf, 0xe4683a, 0x120a10, 0x2a1a22],
  ice: [0x86b3df, 0xeef6fb, 0xf3b4c8, 0x071226, 0x1b2a48],
  lava: [0x2e100c, 0x9a4428, 0xd24a22, 0x0c0404, 0x3a1208],
  barren: [0x020306, 0x15161c, 0x3a3230, 0x010102, 0x0b0c10]
};

const smooth = THREE.MathUtils.smoothstep;
const col = (h) => new THREE.Color(h);

function cloudTexture(seed, dark) {
  const W = 1024;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const noise = createNoise3D(seed);
  for (let y = 0; y < H; y++) {
    const phi = (y / H) * Math.PI;
    for (let x = 0; x < W; x++) {
      const th = (x / W) * Math.PI * 2;
      const dx = Math.cos(th) * Math.sin(phi);
      const dy = Math.cos(phi);
      const dz = Math.sin(th) * Math.sin(phi);
      const n = noise.fbm(dx * 2.6, dy * 5.5, dz * 2.6, 5, 2.1, 0.52);
      const a = Math.max(0, Math.min(1, (n - 0.08) * 2.4));
      const o = (y * W + x) * 4;
      const v = dark ? 110 : 255;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
      img.data[o + 3] = a * 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class TownSky {
  constructor(planetType, starLight, { seed = 1, clouds = true, darkClouds = false } = {}) {
    const p = PALETTES[planetType] || PALETTES.terran;
    this.palette = { dayTop: col(p[0]), dayHorizon: col(p[1]), sunset: col(p[2]), nightTop: col(p[3]), nightHorizon: col(p[4]) };
    this.airless = planetType === 'barren';
    this.nightFill = col(0x3a4f86);
    this.starLight = col(starLight);
    this.group = new THREE.Group();
    this.cloudTex = clouds ? cloudTexture(seed, darkClouds) : null;
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(5200, 48, 24),
      new THREE.ShaderMaterial({
        uniforms: {
          uTop: { value: new THREE.Color() },
          uHorizon: { value: new THREE.Color() },
          uSunDir: { value: new THREE.Vector3(0, 1, 0) },
          uSunColor: { value: new THREE.Color() },
          uSunGlow: { value: 1 },
          uClouds: { value: this.cloudTex },
          uCloudAmt: { value: clouds ? 1 : 0 },
          uCloudLight: { value: new THREE.Color(1, 1, 1) },
          uOffset: { value: 0 }
        },
        vertexShader: `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww; // always at the far plane
          }`,
        fragmentShader: `
          uniform vec3 uTop;
          uniform vec3 uHorizon;
          uniform vec3 uSunDir;
          uniform vec3 uSunColor;
          uniform float uSunGlow;
          uniform sampler2D uClouds;
          uniform float uCloudAmt;
          uniform vec3 uCloudLight;
          uniform float uOffset;
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            float h = d.y;
            vec3 c = mix(uHorizon, uTop, pow(smoothstep(-0.02, 0.6, h), 0.8));
            c = mix(c, uHorizon * 0.85, smoothstep(0.0, -0.35, h));
            float s = max(dot(d, normalize(uSunDir)), 0.0);
            // Halo, then a crisp disc
            c += uSunColor * (pow(s, 12.0) * 0.35 + pow(s, 180.0) * 0.8) * uSunGlow;
            c = mix(c, uSunColor * 1.6, smoothstep(0.9993, 0.9996, s) * uSunGlow);
            if (uCloudAmt > 0.0 && h > -0.02) {
              // Clouds on a flattened dome: squash the direction toward the horizon
              vec3 q = normalize(vec3(d.x, d.y * 2.2 + 0.25, d.z));
              vec2 uv = vec2(atan(q.z, q.x) / 6.28318 + 0.5 + uOffset, acos(clamp(q.y, -1.0, 1.0)) / 3.14159);
              float a = texture2D(uClouds, uv).a * smoothstep(-0.02, 0.18, h) * uCloudAmt;
              vec3 cc = uCloudLight * (0.85 + 0.25 * pow(s, 4.0));
              c = mix(c, cc, a * 0.9);
            }
            gl_FragColor = vec4(c, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false
      })
    );
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    // Stars: fade in at night (always there on airless worlds)
    const rng = mulberry32(seed + 17);
    const n = 1800;
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const z = rng() * 0.98 + 0.02;
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      pos.set([Math.cos(a) * r * 4800, z * 4800, Math.sin(a) * r * 4800], i * 3);
      size[i] = rng() < 0.05 ? 3 : 1 + rng() * 1.2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    this.stars = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms: { uAlpha: { value: 0 } },
        vertexShader: `attribute float size; void main() { gl_PointSize = size; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform float uAlpha; void main() { float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(1.0), uAlpha * (1.0 - smoothstep(0.2, 0.5, d))); }`,
        transparent: true,
        depthWrite: false,
        fog: false
      })
    );
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -9;
    this.group.add(this.stars);

    this.light = {
      sunColor: new THREE.Color(),
      sunIntensity: 0,
      lightDir: new THREE.Vector3(),
      hemiSky: new THREE.Color(),
      hemiIntensity: 1,
      ambient: 0.2,
      fog: new THREE.Color(),
      night: 0
    };
  }

  /** sun: unit vector toward the star in town space. */
  update(sun, dt) {
    const P = this.palette;
    const e = sun.y;
    const day = smooth(e, -0.12, 0.22);
    const twilight = Math.max(0, 1 - Math.abs(e - 0.03) / 0.22) * (this.airless ? 0 : 1);
    const u = this.dome.material.uniforms;
    const top = u.uTop.value.copy(P.nightTop).lerp(P.dayTop, day);
    const hor = u.uHorizon.value.copy(P.nightHorizon).lerp(P.dayHorizon, day).lerp(P.sunset, twilight * 0.65);
    void top;
    u.uSunDir.value.set(sun.x, sun.y, sun.z);
    u.uSunColor.value.copy(this.starLight).lerp(P.sunset, twilight * 0.6);
    u.uSunGlow.value = smooth(e, -0.08, 0.02);
    u.uOffset.value += dt * 0.0015;
    u.uCloudLight.value.setRGB(1, 1, 1).lerp(P.sunset, twilight * 0.5).multiplyScalar(0.25 + day * 0.75);
    this.stars.material.uniforms.uAlpha.value = this.airless ? 0.9 : 1 - smooth(e, -0.18, 0.02);

    const L = this.light;
    L.night = 1 - smooth(e, -0.14, 0.06);
    if (e > -0.04) {
      // Sun light, warm and low at sunrise / sunset
      L.lightDir.set(sun.x, Math.max(sun.y, 0.06), sun.z).normalize();
      L.sunColor.copy(this.starLight).lerp(P.sunset, twilight * 0.7);
      L.sunIntensity = 2.5 * smooth(e, -0.04, 0.2);
    } else {
      // Moonlight from the other side of the sky
      L.lightDir.set(-sun.x, Math.max(-sun.y, 0.25), -sun.z).normalize();
      L.sunColor.setRGB(0.55, 0.66, 1.0);
      L.sunIntensity = 0.32 * smooth(-e, 0.04, 0.2);
    }
    // Nights stay readable: a cool blue fill instead of black
    L.hemiSky.copy(this.nightFill).lerp(P.dayTop, day).lerp(new THREE.Color(0.6, 0.65, 0.8), 0.3 * day);
    L.hemiIntensity = 0.55 + day * 0.5;
    L.ambient = 0.12 + day * 0.1;
    L.fog.copy(hor);
    return L;
  }

  dispose() {
    this.dome.geometry.dispose();
    this.dome.material.dispose();
    this.stars.geometry.dispose();
    this.stars.material.dispose();
    this.cloudTex?.dispose();
  }
}
