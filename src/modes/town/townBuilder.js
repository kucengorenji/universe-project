import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createToonMaterial } from '../../render/assetLibrary.js';
import { createNoise3D } from '../../math/simplex3d.js';
import { PLANET_TYPES, TERRAN_PALETTE } from '../../world/planetTypes.js';
import { DIORAMA_R } from './townLayout.js';

// Turns a town layout into a tabletop diorama: one terrain disc (heights and
// colours from the blended hex fields), street ribbons, water, a soil skirt
// around the rim, and every building / tree / prop as instanced meshes split
// into spatial chunks with per-chunk LOD.

export const WATER_Y = -0.8;
const SKIRT_BOTTOM = -46;
const CHUNKS = 6;
const LOD_NEAR = 170;
const LOD_MID = 430;

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
    this.material = createToonMaterial({ vertexColors: true });
    this.disposables.push(this.material);
    this.noise = createNoise3D(layout.seed + 7);
    this.fitCache = new Map();
    this.protoCache = new Map();
    this.chunks = [];
    this.buildHeights();
    this.buildTerrain();
    this.buildSkirt();
    this.buildWater();
    this.buildStreets();
    this.buildFields();
    this.buildInstances();
  }

  track(o) {
    this.disposables.push(o);
    return o;
  }

  // -------------------------------------------------------------- height field

  /** Heights on a regular grid (also used by the avatar and vehicles). */
  buildHeights() {
    const L = this.L;
    const R = DIORAMA_R;
    const cell = this.quality.settings.detail >= 1 ? 4 : this.quality.settings.detail >= 0.75 ? 5 : 6;
    const n = Math.ceil((R * 2) / cell) + 1;
    this.hCell = cell;
    this.hN = n;
    this.heights = new Float32Array(n * n);
    this.colors = new Float32Array(n * n * 3);
    const S = {};
    const c = new THREE.Color();
    const pal = Object.fromEntries(Object.entries(this.palette).map(([k, v]) => [k, new THREE.Color(v)]));
    const mtn = { rock: 0x9a8672, rockDark: 0x6e5f52, snow: 0xf5f8fb, ...(this.look.mountain || {}) };
    const rock = new THREE.Color(mtn.rock);
    const rockDark = new THREE.Color(mtn.rockDark);
    const snow = new THREE.Color(mtn.snow);
    // Inside town: trodden lawns and yards (streets and plazas are drawn on top)
    const cityGround = new THREE.Color(this.palette.plains).lerp(new THREE.Color(L.modern ? 0xa9ad9a : 0xb3a47a), L.modern ? 0.35 : 0.42);
    const soil = new THREE.Color(0x9a7447);
    const noise = this.noise;
    const smooth = THREE.MathUtils.smoothstep;
    const tmp = new THREE.Color();
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -R + i * cell;
        const z = -R + j * cell;
        const s = L.fields.sample(x, z, S);
        const land = smooth(s.land, 0.36, 0.64);
        const gentle = noise.noise(x * 0.004, z * 0.004, 1) * 3.2 + noise.noise(x * 0.018, z * 0.018, 2) * 0.9;
        const ridged = 1 - Math.abs(noise.noise(x * 0.005, z * 0.005, 3));
        const mountain = Math.pow(s.mountain, 1.4) * (30 + ridged * ridged * 70 + noise.noise(x * 0.02, z * 0.02, 4) * 6);
        const town = smooth(s.city + s.otherCity * 0.8, 0.12, 0.5);
        let h = 1.3 + gentle * (1 - town) + mountain * (1 - town);
        h = THREE.MathUtils.lerp(-4 - s.deep * 7 + gentle * 0.5, h, land);
        h = THREE.MathUtils.lerp(h, 1.1, town * land);
        this.heights[j * n + i] = h;

        // Colour: blend of the biome palette by field weight
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
        c.toArray(this.colors, (j * n + i) * 3);
      }
    }
  }

  /** Bilinear ground height (the same surface the terrain mesh shows). */
  heightAt(x, z) {
    const R = DIORAMA_R;
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
    const R = DIORAMA_R;
    const n = this.hN;
    const cell = this.hCell;
    const pos = new Float32Array(n * n * 3);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        let x = -R + i * cell;
        let z = -R + j * cell;
        const r = Math.hypot(x, z);
        // Vertices outside the disc snap onto its rim: a clean round edge
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
    this.terrain = new THREE.Mesh(this.track(g), this.material);
    this.terrain.receiveShadow = true;
    this.terrain.name = 'terrain';
    this.group.add(this.terrain);
  }

  /** Cut edge of the diorama: soil strata down to a flat base. */
  buildSkirt() {
    const R = DIORAMA_R;
    const segs = 360;
    const bands = [
      [0, new THREE.Color(this.look.skirt?.[0] ?? 0x9b7a52)],
      [0.35, new THREE.Color(this.look.skirt?.[0] ?? 0x9b7a52).multiplyScalar(0.85)],
      [0.36, new THREE.Color(this.look.skirt?.[1] ?? 0x7a5c3c)],
      [1, new THREE.Color(this.look.skirt?.[1] ?? 0x7a5c3c).multiplyScalar(0.7)]
    ];
    const pos = [];
    const col = [];
    const colorAt = (t) => {
      for (let i = 1; i < bands.length; i++) if (t <= bands[i][0]) return bands[i - 1][1].clone().lerp(bands[i][1], (t - bands[i - 1][0]) / (bands[i][0] - bands[i - 1][0] || 1));
      return bands[bands.length - 1][1];
    };
    const rows = [0, 0.02, 0.35, 0.36, 0.7, 1];
    for (let s = 0; s < segs; s++) {
      const a0 = (s / segs) * Math.PI * 2;
      const a1 = ((s + 1) / segs) * Math.PI * 2;
      const top0 = this.groundAt(Math.cos(a0) * R, Math.sin(a0) * R);
      const top1 = this.groundAt(Math.cos(a1) * R, Math.sin(a1) * R);
      for (let r = 0; r + 1 < rows.length; r++) {
        const ya0 = THREE.MathUtils.lerp(top0, SKIRT_BOTTOM, rows[r]);
        const yb0 = THREE.MathUtils.lerp(top0, SKIRT_BOTTOM, rows[r + 1]);
        const ya1 = THREE.MathUtils.lerp(top1, SKIRT_BOTTOM, rows[r]);
        const yb1 = THREE.MathUtils.lerp(top1, SKIRT_BOTTOM, rows[r + 1]);
        const P = (a, y) => [Math.cos(a) * R, y, Math.sin(a) * R];
        const quad = [P(a0, ya0), P(a0, yb0), P(a1, ya1), P(a1, ya1), P(a0, yb0), P(a1, yb1)];
        const ts = [rows[r], rows[r + 1], rows[r], rows[r], rows[r + 1], rows[r + 1]];
        quad.forEach((p, i) => {
          pos.push(...p);
          const c = r === 0 && top0 < WATER_Y + 0.1 ? new THREE.Color(this.palette.ocean) : colorAt(ts[i]);
          col.push(c.r, c.g, c.b);
        });
      }
    }
    // Base cap
    const baseC = new THREE.Color(this.look.skirt?.[1] ?? 0x7a5c3c).multiplyScalar(0.5);
    for (let s = 0; s < 96; s++) {
      const a0 = (s / 96) * Math.PI * 2;
      const a1 = ((s + 1) / 96) * Math.PI * 2;
      pos.push(0, SKIRT_BOTTOM, 0, Math.cos(a1) * R, SKIRT_BOTTOM, Math.sin(a1) * R, Math.cos(a0) * R, SKIRT_BOTTOM, Math.sin(a0) * R);
      for (let i = 0; i < 3; i++) col.push(baseC.r, baseC.g, baseC.b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const mat = this.track(createToonMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    const mesh = new THREE.Mesh(this.track(g), mat);
    this.group.add(mesh);
  }

  buildWater() {
    const R = DIORAMA_R;
    const lava = !!this.look.water?.unlit;
    const g = this.track(new THREE.CircleGeometry(R, 128));
    g.rotateX(-Math.PI / 2);
    const mat = this.track(
      lava
        ? new THREE.MeshBasicMaterial({ color: this.palette.ocean, transparent: true, opacity: 0.95 })
        : new THREE.MeshPhongMaterial({ color: this.palette.ocean, transparent: true, opacity: 0.72, shininess: 80, specular: 0x6fa8d6, depthWrite: false })
    );
    this.water = new THREE.Mesh(g, mat);
    this.water.position.y = WATER_Y;
    this.water.renderOrder = 2;
    this.water.receiveShadow = !lava;
    this.group.add(this.water);
  }

  // -------------------------------------------------------------- streets

  ribbon(pts, width, lift, color, { edge = null, edgeW = 0 } = {}) {
    // Resample so the ribbon drapes over the ground
    const dense = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.ceil(len / 3));
      for (let s = 0; s < steps; s++) dense.push([ax + ((bx - ax) * s) / steps, az + ((bz - az) * s) / steps]);
    }
    dense.push(pts[pts.length - 1]);
    const pos = [];
    const col = [];
    const cMain = new THREE.Color(color);
    const cEdge = edge !== null ? new THREE.Color(edge) : null;
    const strips = cEdge ? [[-width / 2 - edgeW, -width / 2, cEdge], [-width / 2, width / 2, cMain], [width / 2, width / 2 + edgeW, cEdge]] : [[-width / 2, width / 2, cMain]];
    for (let i = 0; i + 1 < dense.length; i++) {
      const [ax, az] = dense[i];
      const [bx, bz] = dense[i + 1];
      const dirA = i > 0 ? Math.atan2(bz - dense[i - 1][1], bx - dense[i - 1][0]) : Math.atan2(bz - az, bx - ax);
      const dirB = i + 2 < dense.length ? Math.atan2(dense[i + 2][1] - az, dense[i + 2][0] - ax) : Math.atan2(bz - az, bx - ax);
      const na = [-Math.sin(dirA), Math.cos(dirA)];
      const nb = [-Math.sin(dirB), Math.cos(dirB)];
      for (const [o0, o1, c] of strips) {
        const p = (x, z, nrm, o) => {
          const px = x + nrm[0] * o;
          const pz = z + nrm[1] * o;
          return [px, Math.max(this.heightAt(px, pz), WATER_Y + 0.3) + lift, pz];
        };
        const q = [p(ax, az, na, o0), p(ax, az, na, o1), p(bx, bz, nb, o0), p(bx, bz, nb, o1)];
        // Counter-clockwise seen from above (the ribbon faces up)
        for (const k of [0, 1, 2, 2, 1, 3]) {
          pos.push(...q[k]);
          col.push(c.r, c.g, c.b);
        }
      }
    }
    return { pos, col };
  }

  buildStreets() {
    const L = this.L;
    const pos = [];
    const col = [];
    const push = (r) => {
      pos.push(...r.pos);
      col.push(...r.col);
    };
    // Where streets cross, the more important one lies on top (no z-fighting)
    const LIFT = { road: 0.05, lane: 0.08, grid: 0.1, ring: 0.11, main: 0.14 };
    for (const s of L.streets) {
      const lift = LIFT[s.kind] ?? 0.08;
      if (L.modern) {
        const asphalt = s.kind === 'road' ? 0x5d6066 : 0x4f5157;
        push(this.ribbon(s.pts, s.w, lift, asphalt, s.kind === 'road' ? {} : { edge: 0xc9c6bd, edgeW: 2.4 }));
      } else {
        // Cobbled main streets with a darker kerb, packed-earth lanes and roads
        if (s.kind === 'main') push(this.ribbon(s.pts, s.w, lift, 0xa89c88, { edge: 0x857a69, edgeW: 0.5 }));
        else push(this.ribbon(s.pts, s.w, lift, s.kind === 'road' ? 0xb8905a : 0xc0a074));
      }
    }
    // Plaza: a paved disc
    if (L.plaza) {
      const c = new THREE.Color(L.modern ? 0xd4d0c6 : 0xb0a592);
      const r = L.plaza.r;
      const seg = 40;
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2;
        const a1 = ((i + 1) / seg) * Math.PI * 2;
        const P = (a, rr) => {
          const x = L.plaza.x + Math.cos(a) * rr;
          const z = L.plaza.z + Math.sin(a) * rr;
          return [x, this.heightAt(x, z) + 0.17, z];
        };
        pos.push(...P(0, 0), ...P(a1, r), ...P(a0, r));
        for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
      }
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const mat = this.track(createToonMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    const mesh = new THREE.Mesh(this.track(g), mat);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /** Farm plots: coloured soil patches with crop rows on top (rows are instanced props). */
  buildFields() {
    const L = this.L;
    const pos = [];
    const col = [];
    const SOIL = { wheat: 0xd6b34a, crop: 0x6f9b3d, plowed: 0x9a7447 };
    this.rows = [];
    for (const f of L.fields2 || []) {
      const c = new THREE.Color(SOIL[f.crop]);
      const ca = Math.cos(f.yaw);
      const sa = Math.sin(f.yaw);
      const P = (u, v) => {
        const x = f.x + u * ca - v * sa;
        const z = f.z + u * sa + v * ca;
        return [x, this.heightAt(x, z) + 0.1, z];
      };
      const nu = Math.ceil(f.w / 6);
      const nv = Math.ceil(f.d / 6);
      for (let i = 0; i < nu; i++) {
        for (let j = 0; j < nv; j++) {
          const u0 = -f.w / 2 + (i * f.w) / nu;
          const u1 = -f.w / 2 + ((i + 1) * f.w) / nu;
          const v0 = -f.d / 2 + (j * f.d) / nv;
          const v1 = -f.d / 2 + ((j + 1) * f.d) / nv;
          const q = [P(u0, v0), P(u1, v0), P(u0, v1), P(u1, v1)];
          for (const k of [0, 2, 1, 1, 2, 3]) {
            pos.push(...q[k]);
            col.push(c.r, c.g, c.b);
          }
        }
      }
      if (f.crop === 'plowed') continue;
      const asset = f.crop === 'wheat' ? 'wheat_row' : 'crop_row';
      for (let v = -f.d / 2 + 1.5; v < f.d / 2 - 1; v += 1.6) {
        for (let u = -f.w / 2 + 3; u < f.w / 2 - 2; u += 6.2) {
          const x = f.x + u * ca - v * sa;
          const z = f.z + u * sa + v * ca;
          this.rows.push({ asset, x, z, yaw: f.yaw, len: 6, tint: 0.95 + (((u * 7 + v * 13) % 10) / 100) });
        }
      }
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const mat = this.track(createToonMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    const mesh = new THREE.Mesh(this.track(g), mat);
    mesh.receiveShadow = true;
    this.group.add(mesh);
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
      const level = d < near ? 0 : d < mid ? 1 : 2;
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
