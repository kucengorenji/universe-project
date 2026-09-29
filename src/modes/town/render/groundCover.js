import * as THREE from 'three';
import { mulberry32 } from '../../../math/random.js';
import { pavementWidth } from '../scale.js';
import { createToonMaterial } from '../../../render/assetLibrary.js';

// Ground cover: tens of thousands of little sprites (grass tufts, flowers,
// ferns, reeds, pebbles, mushrooms...) from one painted atlas, drawn as
// crossed quads in a single instanced draw call. They sway in the wind and
// shrink away with distance, so there is no visible edge where they stop.
//
// Atlas tiles (4 x 4):
//   0 grass    1 tall grass  2 grass clump  3 dry grass
//   4 flowers (white/yellow) 5 flowers (red/pink)  6 flowers (purple/blue)  7 fern
//   8 reeds    9 weeds       10 pebbles     11 mushrooms
//   12 clover  13 heather    14 snow grass  15 dead twigs

const T = {
  GRASS: 0, TALL: 1, CLUMP: 2, DRY: 3, FLOWER_W: 4, FLOWER_R: 5, FLOWER_B: 6, FERN: 7,
  REEDS: 8, WEEDS: 9, PEBBLES: 10, MUSHROOM: 11, CLOVER: 12, HEATHER: 13, SNOWGRASS: 14, TWIGS: 15
};

/** Mid-tone of the painted green tufts (linear), the reference for ground tinting. */
const TUFT_TONE = new THREE.Color('#5e8f34');
const GREEN_TILES = new Set([T.GRASS, T.TALL, T.CLUMP, T.CLOVER, T.WEEDS, T.FERN]);

/** Paint the sprite atlas (256 px tiles, base at the bottom middle of each tile). */
function paintAtlas(seed = 7) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S * 4;
  const g = c.getContext('2d');
  const rng = mulberry32(seed);
  const tile = (i, fn) => {
    g.save();
    g.translate((i % 4) * S, Math.floor(i / 4) * S);
    g.beginPath();
    g.rect(0, 0, S, S);
    g.clip();
    fn();
    g.restore();
  };
  const blade = (x, len, lean, w, c0, c1) => {
    const grad = g.createLinearGradient(x, S, x + lean, S - len);
    grad.addColorStop(0, c0);
    grad.addColorStop(1, c1);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x - w, S);
    g.quadraticCurveTo(x - w * 0.4 + lean * 0.4, S - len * 0.55, x + lean, S - len);
    g.quadraticCurveTo(x + w * 0.4 + lean * 0.4, S - len * 0.55, x + w, S);
    g.closePath();
    g.fill();
  };
  const tuft = (n, lenMin, lenMax, spread, w, c0, c1) => {
    for (let k = 0; k < n; k++) {
      const x = S / 2 + (rng() - 0.5) * spread;
      blade(x, lenMin + rng() * (lenMax - lenMin), (rng() - 0.5) * spread * 0.9, w * (0.7 + rng() * 0.6), c0, c1);
    }
  };
  const dot = (x, y, r, col) => {
    g.fillStyle = col;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  };
  const flowers = (cols) => {
    tuft(14, 70, 150, 150, 5, '#3f6b25', '#6fa23a');
    for (let k = 0; k < 9; k++) {
      const x = S / 2 + (rng() - 0.5) * 160;
      const y = S - 90 - rng() * 90;
      const col = cols[k % cols.length];
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2;
        dot(x + Math.cos(a) * 8, y + Math.sin(a) * 8, 7, col);
      }
      dot(x, y, 5, '#f4d34a');
    }
  };
  tile(T.GRASS, () => tuft(26, 60, 140, 170, 6, '#3c6a22', '#7fb445'));
  tile(T.TALL, () => tuft(22, 130, 235, 150, 5, '#3a6420', '#8fbd52'));
  tile(T.CLUMP, () => tuft(40, 50, 110, 210, 7, '#355f1e', '#6ea43b'));
  tile(T.DRY, () => tuft(24, 70, 170, 180, 5, '#8a7437', '#dcc47a'));
  tile(T.FLOWER_W, () => flowers(['#fbfbf2', '#f6e27a', '#ffffff']));
  tile(T.FLOWER_R, () => flowers(['#e2473c', '#f08aa8', '#ff6b5a']));
  tile(T.FLOWER_B, () => flowers(['#8a6bd6', '#5b86e0', '#b58be8']));
  tile(T.FERN, () => {
    for (let k = 0; k < 7; k++) {
      const a = -Math.PI / 2 + (k - 3) * 0.32;
      const len = 150 + rng() * 60;
      g.strokeStyle = '#2f5a1c';
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(S / 2, S);
      const ex = S / 2 + Math.cos(a) * len;
      const ey = S + Math.sin(a) * len;
      g.quadraticCurveTo(S / 2 + Math.cos(a) * len * 0.5, S + Math.sin(a) * len * 0.7 - 20, ex, ey);
      g.stroke();
      for (let l = 0.2; l < 1; l += 0.12) {
        const px = S / 2 + (ex - S / 2) * l;
        const py = S + (ey - S) * l - Math.sin(l * Math.PI) * 20;
        const sz = 22 * (1 - l * 0.7);
        g.fillStyle = l > 0.6 ? '#6fa845' : '#4f8a32';
        g.beginPath();
        g.ellipse(px, py, sz, sz * 0.35, a + 1.1, 0, Math.PI * 2);
        g.fill();
        g.beginPath();
        g.ellipse(px, py, sz, sz * 0.35, a - 1.1, 0, Math.PI * 2);
        g.fill();
      }
    }
  });
  tile(T.REEDS, () => {
    tuft(18, 150, 240, 120, 4, '#4d6b2a', '#9ab35a');
    for (let k = 0; k < 5; k++) {
      const x = S / 2 + (rng() - 0.5) * 110;
      const top = 30 + rng() * 50;
      g.strokeStyle = '#5b6b32';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(x, S);
      g.lineTo(x + (rng() - 0.5) * 20, top);
      g.stroke();
      g.fillStyle = '#6b4a2a';
      g.beginPath();
      g.ellipse(x, top + 22, 9, 26, 0, 0, Math.PI * 2);
      g.fill();
    }
  });
  tile(T.WEEDS, () => {
    tuft(12, 50, 110, 150, 7, '#4a6d28', '#86ad48');
    for (let k = 0; k < 4; k++) {
      const x = S / 2 + (rng() - 0.5) * 120;
      g.strokeStyle = '#557a2c';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(x, S);
      const top = S - 120 - rng() * 60;
      g.lineTo(x, top);
      g.stroke();
      dot(x, top, 11, k % 2 ? '#f5f1e6' : '#f2c936');
    }
  });
  tile(T.PEBBLES, () => {
    for (let k = 0; k < 9; k++) {
      const x = S / 2 + (rng() - 0.5) * 180;
      const w = 14 + rng() * 26;
      const shade = 110 + Math.floor(rng() * 70);
      g.fillStyle = `rgb(${shade},${shade - 4},${shade - 10})`;
      g.beginPath();
      g.ellipse(x, S - w * 0.35, w, w * 0.55, 0, Math.PI, 0);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.beginPath();
      g.ellipse(x - w * 0.3, S - w * 0.55, w * 0.35, w * 0.18, 0, 0, Math.PI * 2);
      g.fill();
    }
  });
  tile(T.MUSHROOM, () => {
    tuft(8, 30, 70, 140, 5, '#3f6b25', '#6fa23a');
    for (let k = 0; k < 5; k++) {
      const x = S / 2 + (rng() - 0.5) * 140;
      const h = 30 + rng() * 45;
      g.fillStyle = '#efe6d2';
      g.fillRect(x - 5, S - h, 10, h);
      const red = k % 2 === 0;
      g.fillStyle = red ? '#d8412f' : '#b88a55';
      g.beginPath();
      g.ellipse(x, S - h, 24, 16, 0, Math.PI, 0);
      g.closePath();
      g.fill();
      if (red) for (let d = 0; d < 3; d++) dot(x - 12 + d * 12, S - h - 7, 3, '#fff8ec');
    }
  });
  tile(T.CLOVER, () => {
    for (let k = 0; k < 16; k++) {
      const x = S / 2 + (rng() - 0.5) * 200;
      const y = S - 10 - rng() * 50;
      for (let p = 0; p < 3; p++) {
        const a = (p / 3) * Math.PI * 2 - Math.PI / 2;
        dot(x + Math.cos(a) * 9, y + Math.sin(a) * 9, 9, p ? '#5d9a36' : '#4d862c');
      }
    }
  });
  tile(T.HEATHER, () => {
    tuft(20, 50, 100, 190, 6, '#4a5a2c', '#7b8a44');
    for (let k = 0; k < 40; k++) dot(S / 2 + (rng() - 0.5) * 190, S - 30 - rng() * 70, 4, k % 3 ? '#a45ab0' : '#c07ac8');
  });
  tile(T.SNOWGRASS, () => tuft(20, 50, 120, 170, 5, '#7c8a78', '#e6ece8'));
  tile(T.TWIGS, () => {
    g.strokeStyle = '#6b5236';
    g.lineCap = 'round';
    const branch = (x, y, a, len, w, depth) => {
      const ex = x + Math.cos(a) * len;
      const ey = y + Math.sin(a) * len;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(ex, ey);
      g.stroke();
      if (depth > 0) {
        branch(ex, ey, a - 0.5 - rng() * 0.3, len * 0.7, w * 0.7, depth - 1);
        branch(ex, ey, a + 0.5 + rng() * 0.3, len * 0.7, w * 0.7, depth - 1);
      }
    };
    branch(S / 2, S, -Math.PI / 2, 70, 7, 3);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

/** Two crossed unit quads, base at y = 0, normals up (lit like the ground under them). */
function crossedQuads() {
  const pos = [];
  const uv = [];
  const idx = [];
  for (const a of [0, Math.PI / 2]) {
    const cx = Math.cos(a) * 0.5;
    const cz = Math.sin(a) * 0.5;
    const b = pos.length / 3;
    pos.push(-cx, 0, -cz, cx, 0, cz, cx, 1, cz, -cx, 1, -cz);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(8).fill([0, 1, 0]).flat(), 3));
  g.setIndex(idx);
  return g;
}

export class GroundCover {
  /**
   * builder: the town builder (heights, fields, river distance, uniforms)
   * count:   how many sprites (by quality tier)
   */
  constructor(builder, { count }) {
    this.builder = builder;
    const L = builder.L;
    this.atlas = paintAtlas(L.seed);
    this.uniforms = { uTime: builder.uniforms.uTime, uAtlas: { value: this.atlas }, uFadeNear: { value: 60 }, uFadeFar: { value: 160 } };
    const items = this.scatter(L, count);
    const geo = crossedQuads();
    const tiles = new Float32Array(items.length);
    const phases = new Float32Array(items.length);
    const mesh = new THREE.InstancedMesh(geo, this.material(), items.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const col = new THREE.Color();
    items.forEach((it, i) => {
      q.setFromAxisAngle(up, it.yaw);
      m.compose(v.set(it.x, it.y, it.z), q, s.set(it.w, it.h, it.w));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, col.setRGB(it.tint[0], it.tint[1], it.tint[2]));
      tiles[i] = it.tile;
      phases[i] = it.phase;
    });
    geo.setAttribute('aTile', new THREE.InstancedBufferAttribute(tiles, 1));
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.receiveShadow = builder.quality.settings.shadows;
    mesh.castShadow = false;
    mesh.frustumCulled = false; // one mesh over the whole disc
    mesh.name = 'groundCover';
    this.mesh = mesh;
    this.geo = geo;
    this.count = items.length;
  }

  material() {
    const m = createToonMaterial({ vertexColors: false, side: THREE.DoubleSide });
    m.alphaToCoverage = true; // soft edges under MSAA, plain cut-out otherwise
    const u = this.uniforms;
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute float aTile;
          attribute float aPhase;
          uniform float uTime;
          uniform float uFadeNear;
          uniform float uFadeFar;
          varying vec2 vAtlasUv;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 origin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          #else
            vec3 origin = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          #endif
          // Shrink into the ground with distance: no hard edge where the cover stops
          float fade = 1.0 - smoothstep(uFadeNear, uFadeFar, distance(origin, cameraPosition));
          transformed *= fade;
          // Wind: the tops sway, the bases stay put
          float sway = sin(uTime * 1.6 + aPhase) * 0.1 + sin(uTime * 2.9 + aPhase * 1.7) * 0.04;
          transformed.x += sway * uv.y * uv.y;
          vec2 tileXY = vec2(mod(aTile, 4.0), floor(aTile / 4.0));
          vAtlasUv = vec2((tileXY.x + uv.x) / 4.0, 1.0 - (tileXY.y + 1.0 - uv.y) / 4.0);`
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uAtlas;\nvarying vec2 vAtlasUv;')
        .replace(
          '#include <map_fragment>',
          `vec4 sprite = texture2D(uAtlas, vAtlasUv);
          diffuseColor *= sprite;
          if (diffuseColor.a < 0.35) discard;`
        );
    };
    m.customProgramCacheKey = () => 'ground-cover';
    this.mat = m;
    return m;
  }

  /** Where each sprite goes, driven by the same fields that colour the ground. */
  scatter(L, count) {
    const b = this.builder;
    const rng = mulberry32((L.seed || 1) * 17 + 3);
    const noise = b.noise;
    const R = L.dioramaR - 6;
    const S = {};
    const flora = { ice: 'snow', desert: 'dry', lava: 'none', barren: 'none' }[L.planetType] || 'green';
    // Buildings and fields, in a coarse grid of rectangles to reject against
    const occ = new Map();
    const cell = 24;
    const addRect = (x, z, hw, hd, yaw) => {
      const r = Math.hypot(hw, hd);
      for (let i = Math.floor((x - r) / cell); i <= Math.floor((x + r) / cell); i++) {
        for (let j = Math.floor((z - r) / cell); j <= Math.floor((z + r) / cell); j++) {
          const k = `${i},${j}`;
          if (!occ.has(k)) occ.set(k, []);
          occ.get(k).push({ x, z, hw, hd, c: Math.cos(yaw), s: Math.sin(yaw) });
        }
      }
    };
    for (const bd of L.buildings) addRect(bd.x, bd.z, bd.w / 2 + 0.6, bd.d / 2 + 0.6, bd.yaw);
    for (const f of L.fields2 || []) addRect(f.x, f.z, f.w / 2, f.d / 2, f.yaw);
    const blocked = (x, z) => {
      for (const r of occ.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`) || []) {
        const dx = x - r.x;
        const dz = z - r.z;
        if (Math.abs(dx * r.c + dz * r.s) < r.hw && Math.abs(-dx * r.s + dz * r.c) < r.hd) return true;
      }
      return false;
    };
    // Streets (with their pavements) in a segment grid
    const sgrid = new Map();
    for (const st of [...L.streets,...(L.paths||[])]) {
      const walkway = st.kind === 'garden' || st.kind === 'frontage';
      const hw = st.w / 2 + (walkway ? .25 : pavementWidth(L) + (L.modern ? .2 : .3));
      for (let i = 0; i + 1 < st.pts.length; i++) {
        const [ax, az] = st.pts[i];
        const [bx, bz] = st.pts[i + 1];
        const seg = { ax, az, bx, bz, hw };
        for (let gi = Math.floor((Math.min(ax, bx) - hw) / cell); gi <= Math.floor((Math.max(ax, bx) + hw) / cell); gi++) {
          for (let gj = Math.floor((Math.min(az, bz) - hw) / cell); gj <= Math.floor((Math.max(az, bz) + hw) / cell); gj++) {
            const k = `${gi},${gj}`;
            if (!sgrid.has(k)) sgrid.set(k, []);
            sgrid.get(k).push(seg);
          }
        }
      }
    }
    const onStreet = (x, z) => {
      const p = L.plaza;
      if (p && Math.hypot(x - p.x, z - p.z) < p.r + 1) return true;
      for (const sg of sgrid.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`) || []) {
        const dx = sg.bx - sg.ax;
        const dz = sg.bz - sg.az;
        const t = Math.max(0, Math.min(1, ((x - sg.ax) * dx + (z - sg.az) * dz) / (dx * dx + dz * dz || 1)));
        if (Math.hypot(x - sg.ax - dx * t, z - sg.az - dz * t) < sg.hw) return true;
      }
      return false;
    };
    // Ground colour relative to the painted tuft mid-tone, cached on a 6 m grid
    const groundSample = {};
    const groundColour = new THREE.Color();
    const tintGrid = new Map();
    const groundTint = (x, z) => {
      const key = `${Math.round(x / 6)},${Math.round(z / 6)}`;
      if (!tintGrid.has(key)) {
        b.sampleGround(x, z, groundSample, groundColour);
        tintGrid.set(key, [groundColour.r / TUFT_TONE.r, groundColour.g / TUFT_TONE.g, groundColour.b / TUFT_TONE.b].map((v) => THREE.MathUtils.clamp(v, 0.5, 2.2)));
      }
      return tintGrid.get(key);
    };
    /** The mix that grows here: weighted tiles, their size, and how wide a clump spreads. */
    const habitat = (x, z, s, h, rd) => {
      const meadow = noise.noise(x * 0.02, z * 0.02, 21);
      const patch = noise.noise(x * 0.05, z * 0.05, 23);
      if (flora === 'none') return rng() < 0.6 ? null : { tiles: [[T.PEBBLES, 7], [T.TWIGS, 3]], size: 0.8, r: 2.5 };
      if (rd < 4 || h < WATER_EDGE) return { tiles: [[T.REEDS, 1]], size: 1.5, r: 3 };
      if (flora === 'snow' || s.tundra > 0.5) return { tiles: [[T.SNOWGRASS, 3], [T.PEBBLES, 1]], size: 0.9, r: 3 };
      if (flora === 'dry' || s.desert > 0.5) return rng() < 0.5 ? null : { tiles: [[T.DRY, 5], [T.TWIGS, 2], [T.PEBBLES, 2]], size: 0.9, r: 2.5 };
      if (s.mountain > 0.45) return { tiles: [[T.HEATHER, 4], [T.PEBBLES, 3], [T.DRY, 2]], size: 0.9, r: 3.5 };
      if (s.beach > 0.5) return rng() < 0.6 ? null : { tiles: [[T.DRY, 3], [T.PEBBLES, 2]], size: 0.9, r: 2.5 };
      if (s.forest > 0.45) return { tiles: [[T.FERN, 4], [T.CLUMP, 3], [T.MUSHROOM, 1], [T.CLOVER, 2]], size: 0.9, r: 4 };
      // Meadows: one flower colour per patch where the patch noise is high,
      // otherwise tussocks of one grass with weeds and clover at their feet
      if (patch > 0.35) return { tiles: [[[T.FLOWER_W, T.FLOWER_R, T.FLOWER_B][Math.floor((meadow * 0.5 + 0.5) * 2.999)], 6], [T.GRASS, 2], [T.TALL, 1]], size: 0.85, r: 3.5 };
      return { tiles: [[meadow > 0.2 ? T.TALL : T.CLUMP, 5], [T.GRASS, 4], [T.CLOVER, 2], [T.WEEDS, 1]], size: 0.9, r: 2.5 };
    };
    const pick = (tiles) => {
      let total = 0;
      for (const t of tiles) total += t[1];
      let roll = rng() * total;
      for (const t of tiles) if ((roll -= t[1]) <= 0) return t[0];
      return tiles[0][0];
    };
    const valid = (x, z) => {
      if (x * x + z * z > R * R) return null;
      const h = b.heightAt(x, z);
      if (h < -0.5) return null; // water
      const s = L.fields.sample(x, z, S);
      if (s.land < 0.6 || b.slopeAt(x, z) > 0.9 || blocked(x, z) || onStreet(x, z)) return null;
      return { h, s };
    };
    const items = [];
    const push = (x, z, tile, size) => {
      const k = size * (0.6 + rng() * 0.7);
      // Tint green tufts toward the ground colour, so they sit in their field
      // instead of reading as darker stickers on a pale lawn
      const shade = 0.82 + rng() * 0.3;
      const tint = [shade, shade * (0.97 + rng() * 0.06), shade * (0.9 + rng() * 0.1)];
      if (GREEN_TILES.has(tile)) {
        const g = groundTint(x, z);
        for (let ch = 0; ch < 3; ch++) tint[ch] *= 1 + (g[ch] - 1) * 0.6;
      }
      items.push({ x, y: b.groundAt(x, z) - 0.03, z, yaw: rng() * Math.PI, w: k, h: k * (0.8 + rng() * 0.5), tile, phase: rng() * 6.28, tint });
    };
    const gauss = () => (rng() + rng() + rng() - 1.5) / 1.5;

    // Field boundaries first: tall grass and weeds along the foot of every
    // hedge and fence, the lines that make farmland read as owned land
    if (flora === 'green') {
      for (const hd of L.hedges || []) {
        const len = Math.hypot(hd.bx - hd.ax, hd.bz - hd.az);
        const nx = -(hd.bz - hd.az) / (len || 1);
        const nz = (hd.bx - hd.ax) / (len || 1);
        for (let t = 0; t < len && items.length < count * 0.2; t += 1.1) {
          const side = rng() < 0.5 ? -1 : 1;
          const off = (hd.kind === 'fence' ? 0.35 : 1.3) + rng() * 0.8;
          const x = hd.ax + ((hd.bx - hd.ax) * t) / len + nx * off * side;
          const z = hd.az + ((hd.bz - hd.az) * t) / len + nz * off * side;
          if (valid(x, z)) push(x, z, rng() < 0.6 ? T.TALL : rng() < 0.5 ? T.WEEDS : T.FLOWER_W, 1);
        }
      }
    }

    // Everywhere else in clumps: a centre, then members spread around it, so
    // there are tussocks and patches with plain ground between them
    for (let i = 0; i < count * 2 && items.length < count; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.pow(rng(), 0.72) * R; // denser toward town, where the camera spends its time
      const cx = Math.cos(a) * r;
      const cz = Math.sin(a) * r;
      const here = valid(cx, cz);
      if (!here) continue;
      // In town only lawn edges keep a clump: against a wall, a fence or a hedge
      if (here.s.city > 0.4 && ![[2.2, 0], [-2.2, 0], [0, 2.2], [0, -2.2]].some(([dx, dz]) => blocked(cx + dx, cz + dz))) continue;
      const hab = habitat(cx, cz, here.s, here.h, b.riverDist(cx, cz));
      if (!hab) continue;
      const members = 3 + Math.floor(rng() * 9);
      const spread = hab.r * (0.6 + rng() * 0.8);
      const main = pick(hab.tiles);
      for (let m = 0; m < members && items.length < count; m++) {
        const x = m ? cx + gauss() * spread : cx;
        const z = m ? cz + gauss() * spread : cz;
        if (m && !valid(x, z)) continue;
        // Most of a clump is its main plant; the rest comes from the same habitat
        const tile = rng() < 0.65 ? main : pick(hab.tiles);
        push(x, z, tile, hab.size * (tile === T.TALL || tile === T.FERN ? 1.2 : 1) * (m ? 1 : 1.15));
      }
    }
    return items;
  }

  /** Per frame: how far the cover reaches (further when the camera is up high). */
  update(camera, orbitTarget) {
    const d = orbitTarget ? camera.position.distanceTo(orbitTarget) : 0;
    const far = THREE.MathUtils.clamp(d * 1.1 + 90, 150, 900);
    this.uniforms.uFadeFar.value = far;
    this.uniforms.uFadeNear.value = far * 0.55;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
    this.atlas.dispose();
  }
}

const WATER_EDGE = -0.2;
