import * as THREE from 'three';
import { mulberry32 } from '../../map/mapGenerator.js';
import { HORIZON_R, WATER_Y } from './townBuilder.js';

// Forests past the playable disc, out toward the horizon: painted tree
// silhouettes on billboards that turn to face the camera around their trunk
// (one draw call for thousands). Up close the disc has real 3D trees; out
// here a flat card with two tones of shading reads the same through the haze.

const TILES = ['pine', 'pine_snow', 'oak', 'oak_autumn', 'birch', 'acacia', 'palm', 'bushes'];

function paintAtlas() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S * 4;
  c.height = S * 2;
  const g = c.getContext('2d');
  const rng = mulberry32(11);
  const at = (i, fn) => {
    g.save();
    g.translate((i % 4) * S, Math.floor(i / 4) * S);
    fn();
    g.restore();
  };
  const trunk = (w, h, col) => {
    g.fillStyle = col;
    g.fillRect(S / 2 - w / 2, S - h, w, h);
  };
  // Canopy of overlapping blobs, lit from the upper left
  const blobs = (cx, cy, r, light, dark, n = 7) => {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rng() * 0.4;
      const d = r * (0.35 + rng() * 0.35);
      const bx = cx + Math.cos(a) * d;
      const by = cy + Math.sin(a) * d * 0.8;
      const br = r * (0.45 + rng() * 0.2);
      g.fillStyle = dark;
      g.beginPath();
      g.arc(bx, by, br, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = light;
      g.beginPath();
      g.arc(bx - br * 0.25, by - br * 0.3, br * 0.72, 0, Math.PI * 2);
      g.fill();
    }
  };
  const cone = (light, dark, snow) => {
    trunk(14, 40, '#5a3b22');
    for (let t = 0; t < 4; t++) {
      const y0 = S - 40 - t * 48;
      const w = 104 - t * 20;
      g.fillStyle = dark;
      g.beginPath();
      g.moveTo(S / 2 - w, y0);
      g.lineTo(S / 2, y0 - 96);
      g.lineTo(S / 2 + w, y0);
      g.closePath();
      g.fill();
      g.fillStyle = light;
      g.beginPath();
      g.moveTo(S / 2 - w, y0);
      g.lineTo(S / 2, y0 - 96);
      g.lineTo(S / 2 - w * 0.1, y0);
      g.closePath();
      g.fill();
      if (snow) {
        g.fillStyle = '#eef3f6';
        g.beginPath();
        g.moveTo(S / 2 - w * 0.45, y0 - 50);
        g.lineTo(S / 2, y0 - 96);
        g.lineTo(S / 2 + w * 0.45, y0 - 50);
        g.closePath();
        g.fill();
      }
    }
  };
  at(0, () => cone('#3f7d3a', '#24522a', false));
  at(1, () => cone('#3a6f3c', '#23472c', true));
  at(2, () => {
    trunk(18, 90, '#5e4027');
    blobs(S / 2, 110, 84, '#6fae45', '#3f7a2e');
  });
  at(3, () => {
    trunk(18, 90, '#5e4027');
    blobs(S / 2, 110, 84, '#e39a3a', '#b0572a');
  });
  at(4, () => {
    trunk(10, 140, '#e8e4dc');
    blobs(S / 2, 90, 58, '#9fcf5c', '#5f9a3a', 6);
  });
  at(5, () => {
    trunk(14, 100, '#6a4a2c');
    g.fillStyle = '#5b7f32';
    g.beginPath();
    g.ellipse(S / 2, 120, 110, 40, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#86a84a';
    g.beginPath();
    g.ellipse(S / 2 - 18, 108, 86, 26, 0, 0, Math.PI * 2);
    g.fill();
  });
  at(6, () => {
    g.strokeStyle = '#8a6a44';
    g.lineWidth = 12;
    g.beginPath();
    g.moveTo(S / 2, S);
    g.quadraticCurveTo(S / 2 + 30, 150, S / 2 + 10, 60);
    g.stroke();
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      g.strokeStyle = k % 2 ? '#4f8a3a' : '#6fae4a';
      g.lineWidth = 16;
      g.beginPath();
      g.moveTo(S / 2 + 10, 60);
      g.quadraticCurveTo(S / 2 + 10 + Math.cos(a) * 50, 40 + Math.sin(a) * 20, S / 2 + 10 + Math.cos(a) * 100, 70 + Math.abs(Math.sin(a)) * 50);
      g.stroke();
    }
  });
  at(7, () => {
    blobs(S / 2 - 50, 190, 50, '#6aa845', '#3d7430', 5);
    blobs(S / 2 + 50, 200, 44, '#78b24c', '#437b33', 5);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

export class FarTrees {
  constructor(builder, { count }) {
    this.builder = builder;
    const L = builder.L;
    this.atlas = paintAtlas();
    const flora = { ice: 'snow', desert: 'dry', lava: 'none', barren: 'none' }[L.planetType] || 'green';
    const items = flora === 'none' ? [] : this.scatter(L, count, flora);
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.translate(0, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position;
    geo.attributes.uv = quad.attributes.uv;
    const off = new Float32Array(items.length * 4);
    const tile = new Float32Array(items.length);
    const tint = new Float32Array(items.length * 3);
    items.forEach((it, i) => {
      off.set([it.x, it.y, it.z, it.h], i * 4);
      tile[i] = it.tile;
      tint.set(it.tint, i * 3);
    });
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 4));
    geo.setAttribute('aTile', new THREE.InstancedBufferAttribute(tile, 1));
    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
    geo.instanceCount = items.length;
    this.uniforms = {
      uAtlas: { value: this.atlas },
      uLight: { value: new THREE.Color(1, 1, 1) },
      fogColor: { value: new THREE.Color() },
      fogNear: { value: 1 },
      fogFar: { value: 1000 }
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      fog: true,
      alphaToCoverage: true,
      vertexShader: `
        attribute vec4 aOffset;
        attribute float aTile;
        attribute vec3 aTint;
        varying vec2 vUv;
        varying vec3 vTint;
        #include <fog_pars_vertex>
        void main() {
          // Turn around the trunk to face the camera
          vec3 toCam = cameraPosition - aOffset.xyz;
          vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x));
          float h = aOffset.w;
          vec3 world = aOffset.xyz + right * position.x * h * 0.9 + vec3(0.0, position.y * h, 0.0);
          vec2 t = vec2(mod(aTile, 4.0), floor(aTile / 4.0));
          vUv = vec2((t.x + uv.x) / 4.0, 1.0 - (t.y + 1.0 - uv.y) / 2.0);
          vTint = aTint;
          vec4 mvPosition = viewMatrix * vec4(world, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D uAtlas;
        uniform vec3 uLight;
        varying vec2 vUv;
        varying vec3 vTint;
        #include <fog_pars_fragment>
        void main() {
          vec4 c = texture2D(uAtlas, vUv);
          if (c.a < 0.4) discard;
          gl_FragColor = vec4(c.rgb * vTint * uLight, c.a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'farTrees';
    this.geo = geo;
    this.count = items.length;
  }

  scatter(L, count, flora) {
    const b = this.builder;
    const rng = mulberry32((L.seed || 1) * 29 + 5);
    const noise = b.noise;
    const R0 = L.dioramaR + 20;
    const R1 = Math.min(HORIZON_R * 0.62, 2600);
    const S = {};
    const c = new THREE.Color();
    const items = [];
    for (let i = 0; i < count * 5 && items.length < count; i++) {
      const a = rng() * Math.PI * 2;
      const r = R0 + Math.pow(rng(), 1.6) * (R1 - R0); // denser near the disc, thinning into the haze
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const s = L.fields.sample(x, z, S);
      if (s.land < 0.75 || s.city > 0.2 || s.otherCity > 0.2) continue;
      const y = b.farHeight(x, z, S, c);
      if (y < WATER_Y + 0.5) continue;
      const stand = noise.noise(x * 0.004, z * 0.004, 9);
      const autumn = noise.noise(x * 0.002, z * 0.002, 13) > 0.45;
      let p = s.forest > 0.45 ? 0.9 : s.mountain > 0.5 ? 0.35 : s.tundra > 0.5 ? 0.08 : s.desert > 0.5 ? 0.02 : 0.08;
      if (y > 60) p *= 0.3; // bare peaks
      if (rng() > p) continue;
      let tile;
      if (flora === 'snow' || s.tundra > 0.5 || y > 45) tile = 1;
      else if (flora === 'dry') tile = s.beach > 0.4 ? 6 : 5;
      else if (s.mountain > 0.5 || Math.abs(stand) > 0.25) tile = 0;
      else if (s.forest > 0.45) tile = autumn ? 3 : rng() < 0.3 ? 4 : 2;
      else tile = rng() < 0.3 ? 7 : 2;
      const h = (tile === 7 ? 4 : tile === 4 ? 9 : 10) * (0.7 + rng() * 0.6);
      const shade = 0.82 + rng() * 0.3;
      items.push({ x, y: y - 0.5, z, h, tile, tint: [shade, shade, shade * (0.95 + rng() * 0.08)] });
    }
    return items;
  }

  /** Light follows the time of day (fog uniforms are filled in by the renderer). */
  update(sunIntensity, night) {
    const l = THREE.MathUtils.clamp(0.35 + sunIntensity * 0.28, 0.3, 1.1) * (1 - night * 0.55);
    this.uniforms.uLight.value.setScalar(l);
  }

  dispose() {
    this.geo.dispose();
    this.material.dispose();
    this.atlas.dispose();
  }
}

export { TILES as FAR_TREE_TILES };
