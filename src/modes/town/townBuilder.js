import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createToonMaterial } from '../../render/assetLibrary.js';
import { createNoise3D } from '../../math/simplex3d.js';
import { PLANET_TYPES, TERRAN_PALETTE } from '../../world/planetTypes.js';
import { DIORAMA_R } from './townLayout.js';
import { GroundPaint, detailNoiseTexture } from './groundPaint.js';

// Turns a town layout into a tabletop diorama: one terrain disc (heights and
// colours from the blended hex fields), street ribbons, water, a soil skirt
// around the rim, and every building / tree / prop as instanced meshes split
// into spatial chunks with per-chunk LOD.

export const WATER_Y = -0.8;
export const HORIZON_R = 4200;
const CHUNKS = 6;
const LOD_NEAR = 260;
const LOD_MID = 620;

/**
 * Town catalogue. `fb` = fallback asset from the planet pack (scaled to the
 * target size) used when the town pack does not provide the model yet.
 * fit: 'w' (footprint width), 'h' (height) or 'span' (length along X).
 * fwdX: planet-pack vehicles face +X; turn them to face +Z like everything here.
 */
export const CATALOG = {
  f_house_small: { fb: 'house_a', fit: 'w', size: 6.5 },
  f_house: { fb: 'house_b', fit: 'w', size: 8 },
  f_house_tall: { fb: 'house_c', fit: 'w', size: 7.5 },
  f_townhouse: { fb: 'house_c', fit: 'w', size: 6.5 },
  f_tavern: { fb: 'house_b', fit: 'w', size: 12 },
  f_shop: { fb: 'house_a', fit: 'w', size: 8.5 },
  f_temple: { fb: 'temple', fit: 'w', size: 20 },
  f_castle: { fb: 'castle', fit: 'w', size: 46 },
  f_tower: { fb: 'tower', fit: 'h', size: 22 },
  f_wall: { fb: 'wall_segment', fit: 'span', size: 8, nativeSpan: 8 },
  f_palisade: { fb: 'fence_segment', fit: 'span', size: 3.2, nativeSpan: 3 },
  f_wall_tower: { fb: 'wall_tower', fit: 'h', size: 13 },
  f_gate: { fb: 'wall_tower', fit: 'h', size: 15 },
  f_well: { proto: 'well' },
  f_market_stall: { proto: 'stall' },
  f_lamp: { proto: 'torch' },
  f_dock: { fb: 'dock', fit: 'w', size: 22 },
  m_house: { fb: 'modern_house', fit: 'w', size: 12 },
  m_apartment: { fb: 'apartment', fit: 'w', size: 19 },
  m_office: { fb: 'tower_glass_b', fit: 'w', size: 21 },
  m_tower_a: { fb: 'tower_glass_a', fit: 'w', size: 28 },
  m_tower_b: { fb: 'tower_glass_b', fit: 'w', size: 28 },
  m_shop: { fb: 'modern_house', fit: 'w', size: 13 },
  m_spire: { fb: 'landmark_spire', fit: 'w', size: 22 },
  m_lamp: { proto: 'streetlight' },
  m_bench: { proto: 'bench' },
  m_car: { fb: 'truck', fit: 'w', size: 4.6, fwdX: true, byLength: true },
  m_dock: { fb: 'dock', fit: 'w', size: 34 },
  barn: { fb: 'barn', fit: 'w', size: 14 },
  windmill: { fb: 'windmill', fit: 'h', size: 16 },
  boat: { fb: 'boat', fit: 'w', size: 12, fwdX: true, byLength: true },
  container_ship: { fb: 'container_ship', fit: 'w', size: 44, fwdX: true, byLength: true },
  caravan: { fb: 'caravan', fit: 'w', size: 5, fwdX: true, byLength: true },
  truck: { fb: 'truck', fit: 'w', size: 7, fwdX: true, byLength: true },
  // span: `size` is the height; the length along X comes per instance
  wheat_row: { fb: 'wheat_row', fit: 'span', size: 1.1 },
  crop_row: { fb: 'crop_row', fit: 'span', size: 0.8 },
  hay_bale: { fb: 'hay_bale', fit: 'w', size: 1.8 },
  // Nature: `size` from the layout is the canopy width; trees fit by height
  tree_round: { fb: 'tree_round', fit: 'h', size: 9, natural: true },
  tree_round_b: { fb: 'tree_round_b', fit: 'h', size: 8, natural: true },
  tree_pine: { fb: 'tree_pine', fit: 'h', size: 12, natural: true },
  tree_pine_b: { fb: 'tree_pine_b', fit: 'h', size: 11, natural: true },
  tree_pine_snow: { fb: 'tree_pine_snow', fit: 'h', size: 11, natural: true },
  tree_palm: { fb: 'tree_palm', fit: 'h', size: 10, natural: true },
  tree_acacia: { fb: 'tree_acacia', fit: 'h', size: 8, natural: true },
  bush: { fb: 'bush', fit: 'w', size: 2.4, natural: true },
  bush_b: { fb: 'bush_b', fit: 'w', size: 2.2, natural: true },
  grass_tuft: { fb: 'grass_tuft', fit: 'w', size: 1.1, natural: true },
  rock: { fb: 'rock', fit: 'w', size: 3, natural: true },
  rock_b: { fb: 'rock_b', fit: 'w', size: 3, natural: true },
  rock_mesa: { fb: 'rock_mesa', fit: 'w', size: 14, natural: true },
  cactus: { fb: 'cactus', fit: 'h', size: 4, natural: true }
};

/**
 * Modelled footprint of every town-pack asset: union of its variants' LOD0
 * bounding boxes in x/z (front = +Z). The layout places buildings by these,
 * so porches, balconies and roof overhangs never run into each other.
 */
export function packFootprints(townPack) {
  const out = {};
  for (const [key, lods] of Object.entries(townPack || {})) {
    const g = lods[0] || lods[1];
    if (!g) continue;
    if (!g.boundingBox) g.computeBoundingBox();
    const b = g.boundingBox;
    const name = key.replace(/_v\d+$/, '');
    const f = (out[name] ||= { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
    f.minX = Math.min(f.minX, b.min.x);
    f.maxX = Math.max(f.maxX, b.max.x);
    f.minZ = Math.min(f.minZ, b.min.z);
    f.maxZ = Math.max(f.maxZ, b.max.z);
  }
  return out;
}

// ---------------------------------------------------------------- proto props (until the town pack has them)

function colored(geo, hex, matrix) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (matrix) g.applyMatrix4(matrix);
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  const c = new THREE.Color(hex);
  const a = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < g.attributes.position.count; i++) c.toArray(a, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const T = (x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(sx, sy, sz));

function protoGeometry(kind) {
  const parts = [];
  if (kind === 'well') {
    parts.push(colored(new THREE.CylinderGeometry(1.5, 1.6, 1, 14), 0xbdb6a8, T(0, 0.5, 0)));
    parts.push(colored(new THREE.CylinderGeometry(1.15, 1.15, 0.2, 14), 0x3f79b8, T(0, 0.92, 0)));
    for (const s of [-1, 1]) parts.push(colored(new THREE.BoxGeometry(0.2, 2.2, 0.2), 0x6b4426, T(s * 1.2, 2, 0)));
    parts.push(colored(new THREE.ConeGeometry(2, 1.2, 4), 0xc4513a, T(0, 3.6, 0, Math.PI / 4)));
  } else if (kind === 'stall') {
    parts.push(colored(new THREE.BoxGeometry(3.4, 1, 2.2), 0x8a5a33, T(0, 0.5, 0)));
    for (const x of [-1.6, 1.6]) for (const z of [-1, 1]) parts.push(colored(new THREE.BoxGeometry(0.14, 2.6, 0.14), 0x6b4426, T(x, 1.3, z)));
    parts.push(colored(new THREE.BoxGeometry(3.8, 0.12, 2.8), 0xefe6cf, T(0, 2.65, 0.1)));
    parts.push(colored(new THREE.BoxGeometry(3.8, 0.5, 0.08), 0xc4513a, T(0, 2.45, 1.5)));
    parts.push(colored(new THREE.BoxGeometry(2.6, 0.3, 1.4), 0xe0b030, T(0, 1.15, 0.1)));
  } else if (kind === 'torch') {
    parts.push(colored(new THREE.CylinderGeometry(0.1, 0.14, 3, 6), 0x5a3520, T(0, 1.5, 0)));
    parts.push(colored(new THREE.CylinderGeometry(0.24, 0.16, 0.4, 6), 0x3a2a1a, T(0, 3.1, 0)));
    parts.push(colored(new THREE.OctahedronGeometry(0.22, 0), 0xffb347, T(0, 3.45, 0)));
  } else if (kind === 'streetlight') {
    parts.push(colored(new THREE.CylinderGeometry(0.09, 0.13, 6.5, 8), 0x5d6066, T(0, 3.25, 0)));
    parts.push(colored(new THREE.BoxGeometry(0.12, 0.12, 1.6), 0x5d6066, T(0, 6.4, 0.7)));
    parts.push(colored(new THREE.BoxGeometry(0.5, 0.16, 0.7), 0xfff3c4, T(0, 6.3, 1.4)));
  } else if (kind === 'bench') {
    parts.push(colored(new THREE.BoxGeometry(2, 0.12, 0.6), 0x8a5a33, T(0, 0.5, 0)));
    parts.push(colored(new THREE.BoxGeometry(2, 0.5, 0.1), 0x8a5a33, T(0, 0.85, -0.28)));
    for (const x of [-0.85, 0.85]) parts.push(colored(new THREE.BoxGeometry(0.1, 0.5, 0.5), 0x3a3a3a, T(x, 0.25, 0)));
  }
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- builder

export class TownBuilder {
  constructor(layout, { planetPack, townPack, quality, planetType }) {
    this.L = layout;
    this.planetPack = planetPack || {};
    this.townPack = townPack || {};
    this.quality = quality;
    this.type = PLANET_TYPES[planetType] || PLANET_TYPES.terran;
    this.look = this.type.look || {};
    this.palette = { ...TERRAN_PALETTE, ...(this.look.palette || {}) };
    this.group = new THREE.Group();
    this.disposables = [];
    this.noise = createNoise3D(layout.seed + 7);
    this.fitCache = new Map();
    this.protoCache = new Map();
    this.chunks = [];
    this.uniforms = { uNight: { value: 0 }, uTime: { value: 0 } };
    this.setupGroundColors();
    this.buildHeights();
    const detail = quality.settings.detail;
    this.paint = new GroundPaint(layout, { res: detail >= 1 ? 2048 : detail >= 0.75 ? 1536 : 1024, farRes: detail >= 0.75 ? 1024 : 512 });
    this.disposables.push(this.paint);
    this.detailTex = this.track(detailNoiseTexture());
    this.material = this.track(this.makePropMaterial());
    this.terrainMaterial = this.track(this.makeTerrainMaterial());
    this.buildTerrain();
    this.buildHorizon();
    this.buildWater();
    this.buildFieldRows();
    this.buildInstances();
  }

  track(o) {
    this.disposables.push(o);
    return o;
  }

  // -------------------------------------------------------------- materials

  /** Buildings and props: toon shading, and glass or lamps that glow at night. */
  makePropMaterial() {
    const m = createToonMaterial({ vertexColors: true });
    const u = this.uniforms;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uNight = u.uNight;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float emissive;\nvarying float vEmissive;\nvarying float vLit;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vEmissive = emissive;
          #ifdef USE_INSTANCING
            // Some buildings keep their lights off: a stable hash of the instance position
            vLit = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
          #else
            vLit = 1.0;
          #endif`
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying float vEmissive;\nvarying float vLit;')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          float glow = vEmissive >= 0.99 ? 1.0 : vEmissive * step(0.38, vLit);
          totalEmissiveRadiance += vec3(1.0, 0.76, 0.42) * glow * uNight * 1.35;`
        );
    };
    m.customProgramCacheKey = () => 'town-props';
    return m;
  }

  /** Ground: vertex colours from the fields, painted streets on top, fine grain everywhere. */
  makeTerrainMaterial() {
    const m = createToonMaterial({ vertexColors: true });
    const near = this.paint.near;
    const far = this.paint.far;
    const uni = {
      uPaintNear: { value: near.tex },
      uPaintFar: { value: far.tex },
      uNearRect: { value: new THREE.Vector3(near.x0, near.z0, near.size) },
      uFarRect: { value: new THREE.Vector3(far.x0, far.z0, far.size) },
      uDetail: { value: this.detailTex }
    };
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uni);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGround;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform sampler2D uPaintNear;
          uniform sampler2D uPaintFar;
          uniform vec3 uNearRect;
          uniform vec3 uFarRect;
          uniform sampler2D uDetail;
          varying vec3 vGround;`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          vec2 un = (vGround.xz - uNearRect.xy) / uNearRect.z;
          vec2 uf = (vGround.xz - uFarRect.xy) / uFarRect.z;
          vec4 pn = (un.x > 0.0 && un.y > 0.0 && un.x < 1.0 && un.y < 1.0) ? texture2D(uPaintNear, un) : vec4(0.0);
          vec4 pf = (uf.x > 0.0 && uf.y > 0.0 && uf.x < 1.0 && uf.y < 1.0) ? texture2D(uPaintFar, uf) : vec4(0.0);
          vec4 paint = pn.a > 0.02 ? pn : pf;
          // Grain: two octaves of tiling noise, stronger on bare ground than on paving
          float g = texture2D(uDetail, vGround.xz * 0.11).r * 0.6 + texture2D(uDetail, vGround.xz * 0.023).r * 0.4;
          diffuseColor.rgb *= mix(0.86 + g * 0.26, 0.95 + g * 0.1, paint.a);
          diffuseColor.rgb = mix(diffuseColor.rgb, paint.rgb * (0.94 + g * 0.1), paint.a);`
        );
    };
    m.customProgramCacheKey = () => 'town-ground';
    return m;
  }

  // -------------------------------------------------------------- height field

  setupGroundColors() {
    const L = this.L;
    const pal = Object.fromEntries(Object.entries(this.palette).map(([k, v]) => [k, new THREE.Color(v)]));
    const mtn = { rock: 0x9a8672, rockDark: 0x6e5f52, snow: 0xf5f8fb, ...(this.look.mountain || {}) };
    this.gc = {
      pal,
      rock: new THREE.Color(mtn.rock),
      rockDark: new THREE.Color(mtn.rockDark),
      snow: new THREE.Color(mtn.snow),
      // Inside town: trodden lawns and yards (streets and plazas are painted on top)
      cityGround: new THREE.Color(this.palette.plains).lerp(new THREE.Color(L.modern ? 0xa9ad9a : 0xb3a47a), L.modern ? 0.3 : 0.36),
      soil: new THREE.Color(0x9a7447),
      tmp: new THREE.Color()
    };
  }

  /** Height and colour of the ground at (x, z), from the blended hex fields. */
  sampleGround(x, z, S, c) {
    const L = this.L;
    const { pal, rock, rockDark, snow, cityGround, soil, tmp } = this.gc;
    const noise = this.noise;
    const smooth = THREE.MathUtils.smoothstep;
    const s = L.fields.sample(x, z, S);
    const land = smooth(s.land, 0.36, 0.64);
    const gentle = noise.noise(x * 0.004, z * 0.004, 1) * 3.2 + noise.noise(x * 0.018, z * 0.018, 2) * 0.9;
    const ridged = 1 - Math.abs(noise.noise(x * 0.005, z * 0.005, 3));
    const mountain = Math.pow(s.mountain, 1.4) * (30 + ridged * ridged * 70 + noise.noise(x * 0.02, z * 0.02, 4) * 6);
    const town = smooth(s.city + s.otherCity * 0.8, 0.12, 0.5);
    let h = 1.3 + gentle * (1 - town) + mountain * (1 - town);
    h = THREE.MathUtils.lerp(-4 - s.deep * 7 + gentle * 0.5, h, land);
    h = THREE.MathUtils.lerp(h, 1.1, town * land);
    if (!c) return h;
    // Beach tiles are 170 m across: only the strip by the water is sand
    const shore = 1 - smooth(h, WATER_Y + 1.2, WATER_Y + 3.5);
    const beach = s.beach * shore;
    const wOther = Math.max(0, 1 - s.forest - s.desert - s.tundra - s.beach - s.mountain);
    c.copy(pal.plains).multiplyScalar(wOther + s.mountain + s.beach - beach);
    for (const [k, w] of [['forest', s.forest], ['desert', s.desert], ['tundra', s.tundra], ['beach', beach]]) {
      if (w > 0) c.add(tmp.copy(pal[k]).multiplyScalar(w));
    }
    if (s.forest > 0) c.lerp(tmp.copy(pal.forest).multiplyScalar(0.8), s.forest * 0.3);
    if (s.mountain > 0.05) {
      const high = smooth(h, 55, 85);
      const m = tmp.copy(rock).lerp(rockDark, smooth(ridged, 0.5, 1));
      if (high > 0) m.lerp(snow, high);
      c.lerp(m, smooth(s.mountain, 0.15, 0.6));
    }
    if (s.farm > 0.2) c.lerp(soil, smooth(s.farm, 0.3, 0.7) * 0.35);
    c.lerp(cityGround, smooth(s.city + s.otherCity, 0.3, 0.6));
    // Underwater ground takes the water colour, deeper = darker
    if (h < WATER_Y + 0.4) {
      const depth = smooth(WATER_Y - h, -0.4, 6);
      tmp.copy(pal.coast).lerp(pal.ocean, depth).lerp(pal.ocean_deep, smooth(WATER_Y - h, 5, 10));
      c.lerp(tmp, Math.min(1, 0.35 + depth));
    } else if (h < WATER_Y + 1.6 && s.land < 0.75) c.lerp(pal.beach, 0.6);
    c.offsetHSL(0, 0, noise.noise(x * 0.03, z * 0.03, 5) * 0.035);
    return h;
  }

  /** Heights on a regular grid over the playable disc (also used by walkers and vehicles). */
  buildHeights() {
    const R = DIORAMA_R + 40; // a margin so the horizon ring stitches onto real heights
    const cell = this.quality.settings.detail >= 1 ? 4 : this.quality.settings.detail >= 0.75 ? 5 : 6;
    const n = Math.ceil((R * 2) / cell) + 1;
    this.hR = R;
    this.hCell = cell;
    this.hN = n;
    this.heights = new Float32Array(n * n);
    this.colors = new Float32Array(n * n * 3);
    const S = {};
    const c = new THREE.Color();
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        this.heights[j * n + i] = this.sampleGround(-R + i * cell, -R + j * cell, S, c);
        c.toArray(this.colors, (j * n + i) * 3);
      }
    }
    // Steep ground shows bare rock, in bands (strata) so slopes read as cliffs
    const H = this.heights;
    const { rock, rockDark } = this.gc;
    const strata = new THREE.Color();
    for (let j = 1; j < n - 1; j++) {
      for (let i = 1; i < n - 1; i++) {
        const k = j * n + i;
        const gx = (H[k + 1] - H[k - 1]) / (2 * cell);
        const gz = (H[k + n] - H[k - n]) / (2 * cell);
        const slope = Math.hypot(gx, gz);
        const t = THREE.MathUtils.smoothstep(slope, 0.55, 1.1);
        if (t <= 0 || H[k] < WATER_Y + 1) continue;
        const band = Math.sin(H[k] * 0.55) * 0.5 + 0.5;
        strata.copy(rock).lerp(rockDark, band * 0.7);
        c.fromArray(this.colors, k * 3).lerp(strata, t * 0.85).toArray(this.colors, k * 3);
      }
    }
  }

  /** Ground slope (rise over run) at (x, z). */
  slopeAt(x, z) {
    const e = this.hCell;
    return Math.hypot(this.heightAt(x + e, z) - this.heightAt(x - e, z), this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
  }

  /** Bilinear ground height (the same surface the terrain mesh shows). */
  heightAt(x, z) {
    const R = this.hR;
    const n = this.hN;
    const fx = THREE.MathUtils.clamp((x + R) / this.hCell, 0, n - 1.001);
    const fz = THREE.MathUtils.clamp((z + R) / this.hCell, 0, n - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const H = this.heights;
    const a = H[j * n + i];
    const b = H[j * n + i + 1];
    const c = H[(j + 1) * n + i];
    const d = H[(j + 1) * n + i + 1];
    // Match the mesh triangulation (diagonal from (i+1,j) to (i,j+1))
    if (u + v <= 1) return a + (b - a) * u + (c - a) * v;
    return d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }

  groundAt(x, z) {
    return Math.max(this.heightAt(x, z), WATER_Y);
  }

  // -------------------------------------------------------------- terrain

  buildTerrain() {
    const R = this.hR;
    const n = this.hN;
    const cell = this.hCell;
    const pos = new Float32Array(n * n * 3);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        let x = -R + i * cell;
        let z = -R + j * cell;
        const r = Math.hypot(x, z);
        // Outer vertices snap onto the rim, where the horizon ring picks up
        if (r > R) {
          x *= R / r;
          z *= R / r;
        }
        const k = (j * n + i) * 3;
        pos[k] = x;
        pos[k + 1] = this.heights[j * n + i];
        pos[k + 2] = z;
      }
    }
    const idx = [];
    const out = (i, j) => Math.hypot(-R + i * cell, -R + j * cell) > R + cell * 1.5;
    for (let j = 0; j + 1 < n; j++) {
      for (let i = 0; i + 1 < n; i++) {
        const a = j * n + i;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        if (out(i, j) && out(i + 1, j) && out(i, j + 1)) continue;
        idx.push(a, c, b);
        if (!(out(i + 1, j + 1) && out(i + 1, j) && out(i, j + 1))) idx.push(b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.terrain = new THREE.Mesh(this.track(g), this.terrainMaterial);
    this.terrain.receiveShadow = true;
    this.terrain.name = 'terrain';
    this.group.add(this.terrain);
  }

  /**
   * Land beyond the town, out to the horizon: coarse rings that carry on the
   * same fields (mountains, coasts), then melt into fog. Not walkable.
   */
  buildHorizon() {
    const R0 = this.hR - 2;
    const R1 = HORIZON_R;
    const rings = 28;
    const segs = this.quality.settings.detail >= 0.75 ? 160 : 112;
    const pos = [];
    const col = [];
    const S = {};
    const c = new THREE.Color();
    const fogFar = new THREE.Color(this.palette.plains);
    for (let k = 0; k <= rings; k++) {
      const t = k / rings;
      const r = R0 * Math.pow(R1 / R0, t);
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        let h = k === 0 ? this.heightAt(x, z) : this.sampleGround(x, z, S, c);
        if (k === 0) this.sampleGround(x, z, S, c);
        // Far away the land flattens out and drops a little (a hint of curvature)
        const far = THREE.MathUtils.smoothstep(r, R0 * 1.6, R1);
        h = THREE.MathUtils.lerp(h, Math.min(h, 3) - 25, far * far);
        pos.push(x, h, z);
        c.lerp(fogFar, far * 0.3);
        col.push(c.r, c.g, c.b);
      }
    }
    const idx = [];
    for (let k = 0; k < rings; k++) {
      for (let i = 0; i < segs; i++) {
        const a = k * segs + i;
        const b = k * segs + ((i + 1) % segs);
        idx.push(a, b + segs, b, a, a + segs, b + segs);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.horizon = new THREE.Mesh(this.track(g), this.terrainMaterial);
    this.horizon.receiveShadow = true;
    this.group.add(this.horizon);
  }

  /**
   * Water: depth-tinted (turquoise shallows to deep blue), rippling normals,
   * a foam line that laps at the shore, sun glint and a sky-coloured fresnel.
   * Lava worlds get a glowing, slowly churning surface instead.
   */
  buildWater() {
    const lava = !!this.look.water?.unlit;
    const n = this.hN;
    // Heights near the water as a byte texture: (h + 14) / 16 in 0..1
    const data = new Uint8Array(n * n);
    for (let i = 0; i < n * n; i++) data[i] = Math.max(0, Math.min(255, ((this.heights[i] + 14) / 16) * 255));
    const depthTex = this.track(new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.UnsignedByteType));
    depthTex.magFilter = THREE.LinearFilter;
    depthTex.minFilter = THREE.LinearFilter;
    depthTex.needsUpdate = true;
    const g = this.track(new THREE.CircleGeometry(HORIZON_R, 160));
    g.rotateX(-Math.PI / 2);
    const u = this.uniforms;
    this.waterUniforms = {
      uTime: u.uTime,
      uDepth: { value: depthTex },
      uDepthRect: { value: new THREE.Vector3(-this.hR, -this.hR, this.hR * 2) },
      uShallow: { value: new THREE.Color(lava ? 0xffc04a : this.palette.coast) },
      uMid: { value: new THREE.Color(lava ? 0xff7a1f : this.palette.ocean) },
      uDeep: { value: new THREE.Color(lava ? 0xc2350f : this.palette.ocean_deep) },
      uSky: { value: new THREE.Color(0xcfe4f4) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uSunI: { value: 1 },
      uLava: { value: lava ? 1 : 0 },
      uNight: u.uNight
    };
    const mat = this.track(
      new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
        vertexShader: `
          varying vec3 vWorld;
          #include <fog_pars_vertex>
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorld = wp.xyz;
            vec4 mvPosition = viewMatrix * wp;
            gl_Position = projectionMatrix * mvPosition;
            #include <fog_vertex>
          }`,
        fragmentShader: `
          uniform float uTime;
          uniform sampler2D uDepth;
          uniform vec3 uDepthRect;
          uniform vec3 uShallow;
          uniform vec3 uMid;
          uniform vec3 uDeep;
          uniform vec3 uSky;
          uniform vec3 uSunDir;
          uniform vec3 uSunColor;
          uniform float uSunI;
          uniform float uLava;
          uniform float uNight;
          varying vec3 vWorld;
          #include <fog_pars_fragment>
          float wave(vec2 p, vec2 d, float f, float s) { return sin(dot(p, d) * f + uTime * s); }
          void main() {
            vec2 p = vWorld.xz;
            vec2 uv = (p - uDepthRect.xy) / uDepthRect.z;
            bool inside = uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0;
            float ground = inside ? texture2D(uDepth, uv).r * 16.0 - 14.0 : -14.0;
            float depth = ${WATER_Y.toFixed(2)} - ground;
            // Ripples: a few travelling sine waves, derivatives -> normal
            float e = 0.35;
            float h0 = wave(p, vec2(0.8, 0.6), 0.55, 1.4) + wave(p, vec2(-0.5, 0.86), 0.8, 1.9) * 0.6 + wave(p, vec2(0.2, -0.98), 1.9, 2.6) * 0.25;
            float hx = wave(p + vec2(e, 0.0), vec2(0.8, 0.6), 0.55, 1.4) + wave(p + vec2(e, 0.0), vec2(-0.5, 0.86), 0.8, 1.9) * 0.6 + wave(p + vec2(e, 0.0), vec2(0.2, -0.98), 1.9, 2.6) * 0.25;
            float hz = wave(p + vec2(0.0, e), vec2(0.8, 0.6), 0.55, 1.4) + wave(p + vec2(0.0, e), vec2(-0.5, 0.86), 0.8, 1.9) * 0.6 + wave(p + vec2(0.0, e), vec2(0.2, -0.98), 1.9, 2.6) * 0.25;
            vec3 N = normalize(vec3((h0 - hx) * 0.12, 1.0, (h0 - hz) * 0.12));
            vec3 V = normalize(cameraPosition - vWorld);
            vec3 col = mix(uShallow, uMid, smoothstep(0.1, 3.0, depth));
            col = mix(col, uDeep, smoothstep(3.0, 12.0, depth));
            if (uLava > 0.5) {
              float churn = 0.5 + 0.5 * sin(p.x * 0.07 + uTime * 0.4) * sin(p.y * 0.05 - uTime * 0.3);
              col = mix(uDeep, uShallow, churn * 0.6 + h0 * 0.08);
              col += vec3(0.25, 0.08, 0.0) * smoothstep(0.5, 0.0, depth);
              gl_FragColor = vec4(col * 1.25, 1.0);
            } else {
              float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
              col = mix(col, uSky, fres * 0.55);
              vec3 L = normalize(uSunDir);
              float spec = pow(max(dot(reflect(-L, N), V), 0.0), 160.0) * uSunI;
              col += uSunColor * spec * 1.4;
              // Foam where the water meets the shore, pulsing in and out
              float lap = 0.55 + 0.25 * sin(uTime * 1.3 + p.x * 0.05 + p.y * 0.04);
              float foam = (1.0 - smoothstep(0.0, lap, depth)) * (0.65 + 0.35 * sin(p.x * 1.7 + p.y * 1.3 + uTime * 2.0));
              col = mix(col, vec3(0.97, 0.99, 1.0) * (0.35 + 0.65 * (1.0 - uNight * 0.7)), clamp(foam, 0.0, 1.0) * 0.85);
              float alpha = mix(0.5, 0.94, smoothstep(0.0, 2.5, depth));
              gl_FragColor = vec4(col * (1.0 - uNight * 0.72), alpha);
            }
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
            #include <fog_fragment>
          }`,
        transparent: !lava,
        depthWrite: lava,
        fog: true
      })
    );
    Object.assign(mat.uniforms, this.waterUniforms);
    this.water = new THREE.Mesh(g, mat);
    this.water.position.y = WATER_Y;
    this.water.renderOrder = 2;
    this.group.add(this.water);
  }

  /** Light and time for the shaders (called by the mode each frame). */
  setEnvironment({ time, night, sunDir, sunColor, sunIntensity, sky }) {
    this.uniforms.uTime.value = time;
    this.uniforms.uNight.value = night;
    if (this.waterUniforms) {
      this.waterUniforms.uSunDir.value.copy(sunDir);
      this.waterUniforms.uSunColor.value.copy(sunColor);
      this.waterUniforms.uSunI.value = sunIntensity / 2.5;
      this.waterUniforms.uSky.value.copy(sky);
    }
  }

  /** Crop rows on the farm plots (the plots themselves are painted on the ground). */
  buildFieldRows() {
    this.rows = [];
    for (const f of this.L.fields2 || []) {
      if (f.crop === 'plowed') continue;
      const ca = Math.cos(f.yaw);
      const sa = Math.sin(f.yaw);
      const asset = f.crop === 'wheat' ? 'wheat_row' : 'crop_row';
      for (let v = -f.d / 2 + 1.5; v < f.d / 2 - 1; v += 1.6) {
        for (let u = -f.w / 2 + 3; u < f.w / 2 - 2; u += 6.2) {
          const x = f.x + u * ca - v * sa;
          const z = f.z + u * sa + v * ca;
          this.rows.push({ asset, x, z, yaw: f.yaw, len: 6, tint: 0.95 + (((u * 7 + v * 13) % 10) / 100) });
        }
      }
    }
  }

  // -------------------------------------------------------------- instances

  /** LOD geometries + the matrix that brings a pack model to town scale. */
  /** How many modelled variants the town pack has for an asset (<name>_v0, _v1, ...). */
  variants(name) {
    let n = 0;
    while (this.townPack[`${name}_v${n}`]) n++;
    return n;
  }

  resolve(name, variant = 0) {
    const nv = this.variants(name);
    const key = nv ? `${name}_v${variant % nv}` : name;
    if (this.fitCache.has(key)) return this.fitCache.get(key);
    const spec = CATALOG[name] || { fb: name, fit: 'w', size: 4 };
    let lods = null;
    let native = false;
    if (this.townPack[key]) {
      lods = [0, 1, 2].map((l) => this.townPack[key][l]);
      native = true; // modelled in metres, front +Z, base at y=0
      if (spec.nativeSpan) {
        // Spans are modelled nativeSpan metres long along X: stretch per instance
        const res = { lods, fix: new THREE.Matrix4(), span: true, spanLength: spec.nativeSpan, spanHeight: 1, native, spec, key };
        this.fitCache.set(key, res);
        return res;
      }
    } else if (spec.proto) {
      if (!this.protoCache.has(spec.proto)) this.protoCache.set(spec.proto, this.track(protoGeometry(spec.proto)));
      const g = this.protoCache.get(spec.proto);
      lods = [g, g, g];
      native = true;
    } else if (spec.fb && this.planetPack[spec.fb]) {
      lods = [0, 1, 2].map((l) => this.planetPack[spec.fb][l]);
    }
    if (!lods || !lods.some(Boolean)) {
      this.fitCache.set(key, null);
      return null;
    }
    // Missing levels borrow the nearest one
    for (let l = 0; l < 3; l++) lods[l] = lods[l] || lods[1] || lods[0] || lods[2];
    const fix = new THREE.Matrix4();
    if (!native) {
      const g = lods[1];
      if (!g.boundingBox) g.computeBoundingBox();
      const size = new THREE.Vector3();
      g.boundingBox.getSize(size);
      const rot = spec.fwdX ? new THREE.Matrix4().makeRotationY(-Math.PI / 2) : new THREE.Matrix4();
      if (spec.fwdX) [size.x, size.z] = [size.z, size.x];
      let k;
      if (spec.fit === 'h') k = spec.size / size.y;
      else if (spec.fit === 'span') k = null;
      else k = spec.size / (spec.byLength ? size.z : Math.max(size.x, size.z));
      const minY = g.boundingBox.min.y;
      if (spec.fit === 'span') {
        // Spans are 1 unit long along X in the pack: X is scaled per instance
        fix.makeTranslation(0, -minY, 0);
        this.fitCache.set(key, { lods, fix, span: true, spanLength: 1, spanHeight: spec.size / Math.max(size.y, 1e-3), spec, key });
        return this.fitCache.get(key);
      }
      // Scale to size, stand on y = 0, face +Z
      fix.makeScale(k, k, k).multiply(new THREE.Matrix4().makeTranslation(0, -minY, 0)).multiply(rot);
    }
    const res = { lods, fix, spec, native, key };
    this.fitCache.set(key, res);
    return res;
  }

  buildInstances() {
    const L = this.L;
    const R = DIORAMA_R;
    const cellW = (R * 2) / CHUNKS;
    const chunkOf = (x, z) => {
      const i = THREE.MathUtils.clamp(Math.floor((x + R) / cellW), 0, CHUNKS - 1);
      const j = THREE.MathUtils.clamp(Math.floor((z + R) / cellW), 0, CHUNKS - 1);
      return j * CHUNKS + i;
    };
    this.chunks = Array.from({ length: CHUNKS * CHUNKS }, (_, k) => {
      const i = k % CHUNKS;
      const j = Math.floor(k / CHUNKS);
      const group = new THREE.Group();
      const levels = [0, 1, 2].map(() => new THREE.Group());
      levels.forEach((l) => group.add(l));
      this.group.add(group);
      return { cx: -R + (i + 0.5) * cellW, cz: -R + (j + 0.5) * cellW, group, levels, buckets: new Map(), level: -1 };
    });
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const add = (item, { scale = 1, span = null, y = null, shadow = true } = {}) => {
      const res = this.resolve(item.asset, item.variant ?? 0);
      if (!res) return;
      const h = y ?? (item.floating ? WATER_Y : this.heightAt(item.x, item.z));
      q.setFromEuler(e.set(0, -item.yaw, 0));
      if (res.span) {
        sc.set((span ?? item.len ?? 1) / res.spanLength, res.spanHeight, res.spanHeight);
        m.compose(v.set(item.x, h, item.z), q, sc).multiply(res.fix);
      } else {
        // Town-pack models are authored at their layout size
        m.compose(v.set(item.x, h, item.z), q, sc.setScalar(res.native && !res.spec.natural ? 1 : scale)).multiply(res.fix);
      }
      const k = chunkOf(item.x, item.z);
      const bucket = this.chunks[k].buckets;
      if (!bucket.has(res.key)) bucket.set(res.key, { res, items: [], shadow });
      bucket.get(res.key).items.push({ m: m.clone(), tint: item.tint ?? 1 });
    };
    for (const b of L.buildings) add(b, { scale: b.w / ((CATALOG[b.asset]?.size) || b.w) });
    for (const p of L.props) add(p);
    for (const t of L.trees) {
      // Layout sizes are canopy widths; trees in the catalogue are fitted by height (~5.5 m canopy)
      const spec = CATALOG[t.asset];
      const size = t.w / 0.7;
      const s = spec?.fit === 'h' ? size / 5.5 : size / (spec?.size || 4);
      add(t, { scale: THREE.MathUtils.clamp(s, 0.5, 2.5), shadow: size > 2.5 });
    }
    for (const w of L.walls) add({ ...w, tint: 1 }, { span: w.len * 1.06 });
    for (const d of L.docks) add({ ...d, tint: 1 }, { y: WATER_Y - 0.3 });
    for (const r of this.rows || []) add(r, { span: r.len, shadow: false });

    const shadows = this.quality.settings.shadows;
    const color = new THREE.Color();
    for (const chunk of this.chunks) {
      for (const [, { res, items, shadow }] of chunk.buckets) {
        for (let lvl = 0; lvl < 3; lvl++) {
          const inst = new THREE.InstancedMesh(res.lods[lvl], this.material, items.length);
          items.forEach((it, i) => {
            inst.setMatrixAt(i, it.m);
            if (Array.isArray(it.tint)) color.setRGB(it.tint[0], it.tint[1], it.tint[2]);
            else color.setScalar(it.tint);
            inst.setColorAt(i, color);
          });
          inst.instanceMatrix.needsUpdate = true;
          inst.computeBoundingSphere();
          inst.castShadow = shadows && shadow && lvl < 2;
          inst.receiveShadow = shadows && lvl === 0;
          chunk.levels[lvl].add(inst);
          this.disposables.push({ dispose: () => inst.dispose() });
        }
      }
      chunk.levels.forEach((l) => (l.visible = false));
    }
  }

  /** Per-chunk LOD by distance from the camera. */
  update(camera) {
    const p = camera.position;
    // Lower quality tiers switch to lighter models sooner
    const k = this.quality.settings.detail;
    const near = LOD_NEAR * k;
    const mid = LOD_MID * (0.5 + k * 0.5);
    for (const c of this.chunks) {
      const d = Math.max(0, Math.hypot(c.cx - p.x, c.cz - p.z, p.y * 0.5) - 110);
      // Hysteresis: a chunk only changes level once it is clearly past the line
      const h = c.level === -1 ? 1 : 0.12;
      let level = c.level;
      if (c.level === -1 || d < near * (1 - h) || (c.level === 0 && d > near * (1 + h)) || d > mid * (1 + h) || (c.level === 2 && d < mid * (1 - h))) {
        level = d < near ? 0 : d < mid ? 1 : 2;
      }
      if (level !== c.level) {
        c.level = level;
        c.levels.forEach((l, i) => (l.visible = i === level));
      }
    }
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose?.());
    this.disposables = [];
  }
}
