import * as THREE from 'three';
import { townSurfaceHeight } from '../../../world/townRelief.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createToonMaterial, wrapGeometry } from '../../../render/assetLibrary.js';
import { createNoise3D } from '../../../math/simplex3d.js';
import { PLANET_TYPES, TERRAN_PALETTE } from '../../../world/planetTypes.js';
import { GroundPaint, detailNoiseTexture } from './groundPaint.js';
import { roadMarkings } from './roadMarkings.js';
import { GroundCover } from './groundCover.js';
import { FarTrees } from './farTrees.js';
import { applySurfaceCoordinates } from '../../../render/townSurfaces.js';
import { patchTownPaintedProps, patchTownPaintedGround } from './paintedStyle.js';
import { refineTownModel } from './modelRefinements.js';
import { WATER_Y, HORIZON_R } from '../scale.js';
import { ENVIRONMENT } from './environmentKit.js';

// Turns a town layout into a tabletop diorama: one terrain disc (heights and
// colours from the blended hex fields), street ribbons, water, a soil skirt
// around the rim, and every building / tree / prop as instanced meshes split
// into spatial chunks, each item at its own level of detail.

const CHUNKS = 6;
// LOD by size on screen (model radius / distance, at a 55 degree lens): full detail above
// the first, the middle level above the second, the lightest model below it. The lightest
// models lose the leaf cut-outs and timber framing, so they only stand in for specks.
const LOD_SIZE = [0.065, 0.008];
const AUTUMN = new THREE.Color(1.7, 0.85, 0.38);

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
  // Streetscape (layout v4): terraces, a plaza fountain, kiosks, bus stops, kerbside details
  g_cafe_a: { proto: 'cafe_a' },
  g_cafe_b: { proto: 'cafe_b' },
  g_fountain: { proto: 'fountain' },
  g_kiosk: { proto: 'kiosk' },
  g_bus_stop: { proto: 'bus_stop' },
  g_hydrant: { proto: 'hydrant' },
  g_bin: { proto: 'bin' },
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
  cactus: { fb: 'cactus', fit: 'h', size: 4, natural: true },
  // Town-pack nature (metre scale, several species with variants); fallbacks from the planet pack
  t_oak: { fb: 'tree_round', fit: 'h', size: 9, natural: true },
  t_birch: { fb: 'tree_round_b', fit: 'h', size: 9, natural: true },
  t_pine: { fb: 'tree_pine', fit: 'h', size: 12, natural: true },
  t_spruce: { fb: 'tree_pine_b', fit: 'h', size: 13, natural: true },
  t_cypress: { fb: 'tree_pine_b', fit: 'h', size: 9, natural: true },
  t_palm: { fb: 'tree_palm', fit: 'h', size: 9, natural: true },
  t_fruit: { fb: 'tree_round', fit: 'h', size: 6, natural: true },
  t_acacia: { fb: 'tree_acacia', fit: 'h', size: 7, natural: true },
  b_bush: { fb: 'bush', fit: 'w', size: 2.2, natural: true },
  b_flowers: { fb: 'grass_tuft', fit: 'w', size: 2, natural: true },
  r_rock: { fb: 'rock', fit: 'w', size: 3, natural: true },
  g_tuft: { fb: 'grass_tuft', fit: 'w', size: 1.1, natural: true },
  f_fence: { fb: 'fence_segment', fit: 'w', size: 2 }
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
    // Newly authored replacements for runtime proxies must keep their old
    // nominal placement rules, too. Only original pack parcels are measured.
    if (g.userData.townAssetRevision && !g.userData.layoutFootprint) continue;
    if (!g.boundingBox) g.computeBoundingBox();
    const b = g.boundingBox;
    const authored = g.userData.layoutFootprint;
    const name = key.replace(/_v\d+$/, '');
    const f = (out[name] ||= { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, maxY: 0 });
    f.maxY = Math.max(f.maxY, authored?.maxY ?? b.max.y);
    f.minX = Math.min(f.minX, authored?.minX ?? b.min.x);
    f.maxX = Math.max(f.maxX, authored?.maxX ?? b.max.x);
    f.minZ = Math.min(f.minZ, authored?.minZ ?? b.min.z);
    f.maxZ = Math.max(f.maxZ, authored?.maxZ ?? b.max.z);
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
  } else if (kind === 'cafe_a' || kind === 'cafe_b') {
    // A terrace table under a parasol, two chairs
    const canopy = kind === 'cafe_a' ? 0xd8643f : 0x2f8f8a;
    parts.push(colored(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 10), 0xf2efe6, T(0, 0.74, 0)));
    parts.push(colored(new THREE.CylinderGeometry(0.04, 0.04, 0.72, 6), 0x3b3d42, T(0, 0.37, 0)));
    parts.push(colored(new THREE.CylinderGeometry(0.22, 0.26, 0.04, 8), 0x3b3d42, T(0, 0.02, 0)));
    for (const s of [-1, 1]) {
      parts.push(colored(new THREE.BoxGeometry(0.42, 0.05, 0.42), 0x6b4a2e, T(s * 0.72, 0.46, 0)));
      parts.push(colored(new THREE.BoxGeometry(0.05, 0.46, 0.42), 0x6b4a2e, T(s * 0.92, 0.7, 0)));
      for (const dz of [-0.17, 0.17]) parts.push(colored(new THREE.BoxGeometry(0.04, 0.46, 0.04), 0x3b3d42, T(s * 0.72, 0.23, dz)));
    }
    parts.push(colored(new THREE.CylinderGeometry(0.03, 0.03, 2.3, 6), 0xd8d5cc, T(0, 1.15, 0)));
    parts.push(colored(new THREE.ConeGeometry(1.35, 0.45, 8), canopy, T(0, 2.38, 0)));
    parts.push(colored(new THREE.CylinderGeometry(1.35, 1.35, 0.08, 8), 0xf2efe6, T(0, 2.13, 0)));
  } else if (kind === 'fountain') {
    // Round basin, water, a column with a bowl
    parts.push(colored(new THREE.CylinderGeometry(3.2, 3.35, 0.6, 16), 0xcfc9bb, T(0, 0.3, 0)));
    parts.push(colored(new THREE.CylinderGeometry(2.85, 2.85, 0.1, 16), 0x4f9fc4, T(0, 0.52, 0)));
    parts.push(colored(new THREE.CylinderGeometry(0.4, 0.55, 1.8, 8), 0xcfc9bb, T(0, 1.2, 0)));
    parts.push(colored(new THREE.CylinderGeometry(1.2, 0.35, 0.35, 12), 0xcfc9bb, T(0, 2.1, 0)));
    parts.push(colored(new THREE.CylinderGeometry(1.05, 1.05, 0.06, 12), 0x6fb8d8, T(0, 2.26, 0)));
    parts.push(colored(new THREE.ConeGeometry(0.25, 0.9, 6), 0x9fd6ea, T(0, 2.7, 0)));
  } else if (kind === 'kiosk') {
    // A news / flower kiosk: counter, back wall, striped awning
    parts.push(colored(new THREE.BoxGeometry(2.4, 1.1, 1.6), 0x2f6f5a, T(0, 0.55, 0)));
    parts.push(colored(new THREE.BoxGeometry(2.4, 1.2, 0.2), 0x2f6f5a, T(0, 1.7, -0.7)));
    parts.push(colored(new THREE.BoxGeometry(2.3, 0.1, 1.4), 0xe8e2d2, T(0, 1.13, 0.05)));
    for (let i = 0; i < 4; i++) parts.push(colored(new THREE.BoxGeometry(0.62, 0.08, 1.2), i % 2 ? 0xf2efe6 : 0xc9463a, T(-0.93 + i * 0.62, 2.45, 0.25, 0, 1, 1, 1).multiply(new THREE.Matrix4().makeRotationX(0.25))));
    for (const x of [-1.1, 1.1]) parts.push(colored(new THREE.BoxGeometry(0.08, 1.3, 0.08), 0x3b3d42, T(x, 1.8, 0.75)));
    parts.push(colored(new THREE.BoxGeometry(2.0, 0.35, 0.05), 0xf2d04a, T(0, 2.95, -0.62)));
  } else if (kind === 'bus_stop') {
    // Shelter: glass back and side, a roof, a bench and a sign post
    parts.push(colored(new THREE.BoxGeometry(3.2, 0.1, 1.5), 0x4a4e56, T(0, 2.45, 0)));
    parts.push(colored(new THREE.BoxGeometry(3.0, 1.9, 0.06), 0x9fc3d6, T(0, 1.35, -0.68)));
    parts.push(colored(new THREE.BoxGeometry(0.06, 1.9, 1.2), 0x9fc3d6, T(-1.5, 1.35, -0.1)));
    for (const x of [-1.55, 1.55]) parts.push(colored(new THREE.BoxGeometry(0.08, 2.45, 0.08), 0x4a4e56, T(x, 1.22, -0.68)));
    parts.push(colored(new THREE.BoxGeometry(2.0, 0.08, 0.4), 0x8a5a33, T(0.3, 0.48, -0.42)));
    parts.push(colored(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6), 0x4a4e56, T(1.9, 1.3, 0.6)));
    parts.push(colored(new THREE.BoxGeometry(0.5, 0.5, 0.05), 0x2a62b8, T(1.9, 2.55, 0.6)));
  } else if (kind === 'hydrant') {
    parts.push(colored(new THREE.CylinderGeometry(0.16, 0.2, 0.7, 8), 0xc8352b, T(0, 0.35, 0)));
    parts.push(colored(new THREE.SphereGeometry(0.17, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0xc8352b, T(0, 0.7, 0)));
    parts.push(colored(new THREE.CylinderGeometry(0.07, 0.07, 0.42, 6), 0xd8d5cc, T(0, 0.45, 0).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2))));
  } else if (kind === 'bin') {
    parts.push(colored(new THREE.CylinderGeometry(0.26, 0.23, 0.85, 8), 0x3f6b4f, T(0, 0.43, 0)));
    parts.push(colored(new THREE.CylinderGeometry(0.29, 0.29, 0.06, 8), 0x2c2e33, T(0, 0.88, 0)));
  }
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- builder

export class TownBuilder {
  constructor(layout, { planetPack, townPack, sceneryPack, environmentPack, surfaceAtlas, paintedSurfaces, quality, planetType }) {
    this.L = layout;
    this.planetPack = planetPack || {};
    this.townPack = townPack || {};
    this.sceneryPack = sceneryPack || {};
    this.environmentPack = environmentPack || {};
    this.surfaceAtlas = surfaceAtlas;
    this.paintedSurfaces = paintedSurfaces;
    this.detailBudget = { lod: 1, shadow: 1, vegetation: 1 };
    this.foliageMaterials = new Map();
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
    this.indexRivers();
    this.indexFoundations();
    this.buildHeights();
    this.bridges = [];
    const detail = quality.settings.detail;
    // Streets are painted into the ground texture: at street level 2048 px over the town
    // (~0.28 m a texel) shows stepped kerbs and crossings, so the high tier doubles it
    this.paint = new GroundPaint(layout, { res: detail >= 1 ? 4096 : detail >= 0.75 ? 2048 : 1536, farRes: detail >= 0.75 ? 1024 : 512 });
    this.disposables.push(this.paint);
    this.detailTex = this.track(detailNoiseTexture());
    this.material = this.track(this.makePropMaterial());
    this.terrainMaterial = this.track(this.makeTerrainMaterial());
    this.buildTerrain();
    this.buildHorizon();
    this.buildWater();
    this.buildFieldRows();
    this.buildInstances();
    this.buildBridges();
    if(layout.modern){const markings=roadMarkings(layout,(x,z)=>this.surfaceAt(x,z),WATER_Y+.1);this.group.add(markings.mesh);this.disposables.push(markings);}
    // Grass, flowers, ferns, reeds and pebbles: one instanced sprite mesh
    const cover = detail >= 1 ? 72000 : detail >= 0.75 ? 36000 : 14000;
    this.groundCover = new GroundCover(this, { count: cover });
    this.disposables.push(this.groundCover);
    this.group.add(this.groundCover.mesh);
    // Forests out toward the horizon, as billboards
    const far = detail >= 1 ? 14000 : detail >= 0.75 ? 7000 : 0;
    if (far) {
      this.farTrees = new FarTrees(this, { count: far });
      this.disposables.push(this.farTrees);
      this.group.add(this.farTrees.mesh);
    }
  }

  // -------------------------------------------------------------- rivers and bridges

  indexFoundations() {
    this.foundationGrid = new Map();
    if (!this.L.relief?.enabled) return;
    for (const b of this.L.buildings) {
      const pad = { ...b, y: townSurfaceHeight(this.L.relief, b.x, b.z, this.L.fields.sample(b.x,b.z).land) };
      const r = Math.hypot(b.w,b.d)/2+6;
      for(let i=Math.floor((b.x-r)/32);i<=Math.floor((b.x+r)/32);i++) for(let j=Math.floor((b.z-r)/32);j<=Math.floor((b.z+r)/32);j++) {
        const key=`${i},${j}`;
        if(!this.foundationGrid.has(key))this.foundationGrid.set(key,[]);
        this.foundationGrid.get(key).push(pad);
      }
    }
  }

  foundationHeight(x,z,height) {
    const pads=this.foundationGrid.get(`${Math.floor(x/32)},${Math.floor(z/32)}`);
    if(!pads)return height;
    let nearest=null,best=Infinity;
    for(const p of pads){
      const c=Math.cos(p.yaw),s=Math.sin(p.yaw),dx=x-p.x,dz=z-p.z;
      const distance=Math.max(Math.abs(dx*c+dz*s)-p.w/2,Math.abs(-dx*s+dz*c)-p.d/2);
      if(distance<best){best=distance;nearest=p;}
    }
    return nearest ? THREE.MathUtils.lerp(nearest.y,height,THREE.MathUtils.smoothstep(best,0,6)) : height;
  }

  /** River segments in a coarse grid, for fast distance queries while carving. */
  indexRivers() {
    this.riverGrid = new Map();
    this.riverCell = 40;
    const c = this.riverCell;
    for (const r of this.L.rivers || []) {
      for (let i = 0; i + 1 < r.pts.length; i++) {
        const [ax, az] = r.pts[i];
        const [bx, bz] = r.pts[i + 1];
        const seg = { ax, az, bx, bz, hw: r.w / 2 };
        const pad = r.w / 2 + 12;
        for (let gi = Math.floor((Math.min(ax, bx) - pad) / c); gi <= Math.floor((Math.max(ax, bx) + pad) / c); gi++) {
          for (let gj = Math.floor((Math.min(az, bz) - pad) / c); gj <= Math.floor((Math.max(az, bz) + pad) / c); gj++) {
            const k = `${gi},${gj}`;
            if (!this.riverGrid.has(k)) this.riverGrid.set(k, []);
            this.riverGrid.get(k).push(seg);
          }
        }
      }
    }
  }

  /** Distance to the nearest river bank (< 0 in the water), Infinity when far from any. */
  riverDist(x, z) {
    const segs = this.riverGrid.get(`${Math.floor(x / this.riverCell)},${Math.floor(z / this.riverCell)}`);
    if (!segs) return Infinity;
    let best = Infinity;
    for (const s of segs) {
      const dx = s.bx - s.ax;
      const dz = s.bz - s.az;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz || 1)));
      best = Math.min(best, Math.hypot(x - s.ax - dx * t, z - s.az - dz * t) - s.hw);
    }
    return best;
  }

  /** Bridges where streets cross rivers: a deck and parapets, stone or concrete. */
  buildBridges() {
    const geos = [];
    const colors = this.L.modern
      ? { deck: 0xb9b6ad, road: 0x4a4b50, walk: 0xcfcbc1, side: 0xd5d2ca, beam: 0xa9a59b, pier: 0x9d9a92, rail: 0x6f757d }
      : { deck: 0x9c8f7a, road: 0x8d806a, walk: 0xa99b80, side: 0xb5a88f, beam: 0x94876f, pier: 0x8a7e6a, rail: 0x7d705a, cope: 0xc4b89d };
    const box = (cx, cy, cz, sx, sy, sz, yaw, hex) => {
      const g = new THREE.BoxGeometry(sx, sy, sz);
      g.rotateY(-yaw);
      g.translate(cx, cy, cz);
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      const c = new THREE.Color(hex);
      for (let i = 0; i < n; i++) c.toArray(col, i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('emissive', new THREE.BufferAttribute(new Float32Array(n), 1));
      g.deleteAttribute('uv');
      applySurfaceCoordinates(g, this.L.modern ? 15 : 4);
      geos.push(g);
    };
    const addColored = (g, hex) => {
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      const c = new THREE.Color(hex);
      for (let k = 0; k < n; k++) c.toArray(col, k * 3);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('emissive', new THREE.BufferAttribute(new Float32Array(n), 1));
      applySurfaceCoordinates(g, this.L.modern ? 15 : 4);
      geos.push(g);
    };
    /**
     * A strip along the deck: cross-section corners (across, up above the deck) at each
     * station, flat shaded. `section` may be a function of the station for varying shapes.
     */
    const loft = (b, stations, section, hex) => {
      const pts = stations.map((t) => {
        const y = this.bridgeHeight(b, t);
        const sec = typeof section === 'function' ? section(t, y) : section;
        return sec.map(([a, h]) => new THREE.Vector3(b.x + b.c * t - b.s * a, y + h, b.z + b.s * t + b.c * a));
      });
      const pos = [];
      const quad = (p, q, r, s2) => pos.push(...p.toArray(), ...q.toArray(), ...r.toArray(), ...p.toArray(), ...r.toArray(), ...s2.toArray());
      const m = section.length;
      for (let k = 0; k + 1 < pts.length; k++) for (let e = 0; e < m; e++) quad(pts[k][e], pts[k + 1][e], pts[k + 1][(e + 1) % m], pts[k][(e + 1) % m]);
      for (const [ring, flip] of [[pts[0], true], [pts[pts.length - 1], false]]) {
        for (let e = 1; e + 1 < m; e++) {
          const tri = flip ? [ring[0], ring[e + 1], ring[e]] : [ring[0], ring[e], ring[e + 1]];
          tri.forEach((v) => pos.push(...v.toArray()));
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      addColored(g, hex);
    };
    const modern = this.L.modern;
    for (const b of this.L.bridges || []) {
      const span = this.bridgeSpan(b);
      this.bridges.push(span);
      const len = span.tB - span.tA;
      const steps = Math.max(12, Math.ceil(len / 0.8));
      const along = (t0, t1, n = steps) => Array.from({ length: n + 1 }, (_, k) => t0 + ((t1 - t0) * k) / n);
      const hw = b.w / 2;
      const walk = modern ? Math.min(2.2, hw * 0.28) : 0; // raised pavements each side
      const rect = (a0, a1, h0, h1) => [[a0, h1], [a1, h1], [a1, h0], [a0, h0]];
      // Deck slab under everything, then the road surface and the pavements on top
      loft(span, along(span.tA, span.tB), rect(-hw, hw, -0.6, -0.02), colors.deck);
      loft(span, along(span.tA, span.tB), rect(-hw + walk, hw - walk, -0.05, 0), colors.road);
      if (walk) for (const s of [-1, 1]) loft(span, along(span.tA, span.tB), s < 0 ? rect(-hw, -hw + walk, -0.05, 0.16) : rect(hw - walk, hw, -0.05, 0.16), colors.walk);
      // Railings on the raised part (the ramps meet the street open)
      const p0 = span.tA + span.ramp * 0.55;
      const p1 = span.tB - span.ramp * 0.55;
      if (p1 > p0) {
        for (const s of [-1, 1]) {
          const out = s * (hw - 0.02);
          const inn = s * (hw - (modern ? 0.14 : 0.45));
          const [lo, hi] = s < 0 ? [out, inn] : [inn, out];
          if (modern) {
            // Steel railing: a top rail and a mid rail on posts every 2.5 m
            loft(span, along(p0, p1), rect(lo, hi, 1.02, 1.1), colors.rail);
            loft(span, along(p0, p1), rect(lo, hi, 0.55, 0.6), colors.rail);
            for (let t = p0; t <= p1 + 0.01; t += (p1 - p0) / Math.max(1, Math.round((p1 - p0) / 2.5))) loft(span, [t - 0.06, t + 0.06], rect(lo, hi, 0.1, 1.1), colors.rail);
          } else {
            // Stone parapet with a coping course and a lip over the deck edge
            loft(span, along(p0, p1), rect(lo, hi, -0.05, 0.8), colors.side);
            loft(span, along(p0, p1), s < 0 ? rect(out - 0.08, inn + 0.06, 0.8, 0.95) : rect(inn - 0.06, out + 0.08, 0.8, 0.95), colors.cope);
            loft(span, along(span.tA, span.tB), s < 0 ? rect(-hw - 0.12, -hw + 0.05, -0.75, -0.55) : rect(hw - 0.05, hw + 0.12, -0.75, -0.55), colors.cope);
          }
        }
      }
      // Under the deck: stone arches, or concrete girders on piers
      const floor = WATER_Y - 1.5;
      const bank = (span.tB - span.tA) * 0.5;
      const mid = (span.tA + span.tB) / 2;
      if (!modern) {
        // The arch spans the river itself (its width is what the layout sized the bridge for),
        // springing from the water line so the opening reads under the deck
        const river = Math.max(4, b.len - 7);
        const arches = river > 22 ? 2 : 1;
        const width = Math.min(bank * 2 * 0.86, river + 3) / arches;
        const archU = (t) => {
          // Distance into the nearest arch opening, -1..1 across it
          const k = Math.floor(((t - mid) / width) + arches / 2);
          const c = mid + (k + 0.5 - arches / 2) * width;
          return (t - c) / (width * 0.5);
        };
        loft(span, along(span.tA, span.tB, steps * 2), (t, y) => {
          const u = archU(t);
          const spring = WATER_Y - 0.2;
          const bottom = Math.abs(u) < 1 ? spring + (y - 0.95 - spring) * Math.sqrt(1 - u * u) : floor; // the arch intrados
          return rect(-hw + 0.1, hw - 0.1, bottom - y, -0.6);
        }, colors.beam);
        // Abutments where the bridge lands on each bank
        for (const t of [span.tA + 1.5, span.tB - 1.5]) loft(span, [t - 1.6, t + 1.6], (t2, y) => rect(-hw - 0.2, hw + 0.2, floor - y, -0.55), colors.pier);
      } else {
        // Edge girders the length of the span, piers where it is long
        for (const s of [-1, 1]) loft(span, along(span.tA, span.tB), s < 0 ? rect(-hw, -hw + 0.5, -1.25, -0.6) : rect(hw - 0.5, hw, -1.25, -0.6), colors.beam);
        const piers = len > 42 ? [-len / 6, len / 6] : len > 18 ? [0] : [];
        for (const tp of piers) {
          const t = mid + tp;
          for (const s of [-1, 1]) loft(span, [t - 0.6, t + 0.6], (t2, y) => rect(s * hw * 0.55 - 0.6, s * hw * 0.55 + 0.6, floor - y, -1.2), colors.pier);
          loft(span, [t - 0.7, t + 0.7], rect(-hw * 0.8, hw * 0.8, -1.7, -1.2), colors.pier); // pier cap
        }
      }
    }
    if (!geos.length) return;
    const flat = geos.map((g) => (g.index ? g.toNonIndexed() : g));
    const merged = this.track(mergeGeometries(flat));
    flat.forEach((g) => !geos.includes(g) && g.dispose());
    geos.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(merged, this.material);
    mesh.castShadow = this.quality.settings.shadows;
    mesh.userData.townShadow = true;
    mesh.receiveShadow = this.quality.settings.shadows;
    this.group.add(mesh);
  }

  /**
   * Where a bridge meets dry ground along its street, and how it rises: flush with the
   * street at both ends, easing up to a level span that clears the water.
   */
  bridgeSpan(b) {
    const c = Math.cos(b.yaw);
    const s = Math.sin(b.yaw);
    const dryAt = (k) => {
      // Walk out from the crossing until the ground is well above the water, then a little further
      let t = 0;
      while (t < 60 && this.heightAt(b.x + c * k * t, b.z + s * k * t) < WATER_Y + 0.7) t += 0.5;
      return Math.max(b.len * 0.5, t + 2.5) * k;
    };
    const tA = dryAt(-1);
    const tB = dryAt(1);
    const hA = this.heightAt(b.x + c * tA, b.z + s * tA) + 0.04;
    const hB = this.heightAt(b.x + c * tB, b.z + s * tB) + 0.04;
    // Stone bridges hump over their arch; modern decks stay level with the street
    const top = this.L.modern ? Math.max(hA, hB, WATER_Y + 1.3) : Math.max(hA, hB, WATER_Y + 2.4) + ((tB - tA) > 20 ? 0.9 : 0.5);
    const ramp = Math.min(this.L.modern ? 9 : 12, (tB - tA) * (this.L.modern ? 0.3 : 0.4));
    return { x: b.x, z: b.z, c, s, tA, tB, hA, hB, top, ramp, hl: Math.max(-tA, tB), hw: b.w / 2 };
  }

  /** Deck height at distance t along a bridge (from its crossing point). */
  bridgeHeight(b, t) {
    const ease = (x) => x * x * (3 - 2 * x);
    if (t < b.tA + b.ramp) return b.hA + (b.top - b.hA) * ease(THREE.MathUtils.clamp((t - b.tA) / b.ramp, 0, 1));
    if (t > b.tB - b.ramp) return b.hB + (b.top - b.hB) * ease(THREE.MathUtils.clamp((b.tB - t) / b.ramp, 0, 1));
    return b.top;
  }

  track(o) {
    this.disposables.push(o);
    return o;
  }

  // -------------------------------------------------------------- materials

  /** Buildings and props: toon shading, and glass or lamps that glow at night. */
  makePropMaterial() {
    const m = createToonMaterial({ vertexColors: true });
    // aRoof < 0: no palette roof on this instance, keep the authored colour
    m.defaultAttributeValues = { surface: [0, 0, 0], paint: [0], aPaint: [1, 1, 1], emissive: [0], roof: [0], aRoof: [-1, -1, -1] };
    const u = this.uniforms;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uNight = u.uNight;
      if (this.surfaceAtlas && !this.paintedSurfaces) {
        shader.uniforms.uSurfaceAtlas = { value: this.surfaceAtlas };
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 surface;\nvarying vec3 vSurface;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurface=surface;');
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uSurfaceAtlas;\nvarying vec3 vSurface;')
          .replace('#include <color_fragment>', `#include <color_fragment>
            vec2 cell=vec2(mod(floor(vSurface.z+.5),4.0),3.0-floor((vSurface.z+.5)/4.0));
            vec2 uv=(cell+vec2(.012)+fract(vSurface.xy)*.976)/4.0;
            if(vSurface.z>.5)diffuseColor.rgb*=texture2D(uSurfaceAtlas,uv).rgb;`);
      }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float emissive;\nattribute float paint;\nattribute vec3 aPaint;\nattribute float roof;\nattribute vec3 aRoof;\nvarying float vEmissive;\nvarying float vLit;\nvarying vec3 vWin;')
        // Paint: vehicle bodies and horses take their colour per instance (other models have paint = 0).
        // Roofs take the town palette colour chosen in the layout (b.roof), ridges a shade darker.
        .replace('#include <color_vertex>', '#include <color_vertex>\nvColor.rgb *= mix(vec3(1.0), aPaint, paint);\nif (roof > 0.5 && aRoof.r >= 0.0) vColor.rgb = aRoof * (roof > 1.5 ? 0.8 : 1.0);')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vEmissive = emissive;
          vWin = transformed; // model space (metres): floors and window columns stay put per building
          #ifdef USE_INSTANCING
            // Some buildings keep their lights off: a stable hash of the instance position
            vLit = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
          #else
            vLit = 1.0;
          #endif`
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying float vEmissive;\nvarying float vLit;\nvarying vec3 vWin;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          if (vEmissive > 0.5 && vEmissive < 0.99) {
            // Glass by day: darker than the walls it sits in, one tone per pane. Curtain
            // walls (0.72) also get mullions and floor bands, or they read as blank boxes.
            vec2 gw = vec2((vWin.x + vWin.z) / 2.3, vWin.y / 3.1);
            vec2 fw = fract(gw);
            float pr = fract(sin(dot(floor(gw) + vLit * 37.0, vec2(12.9898, 78.233))) * 43758.5453);
            float dayGlass = 0.5 + pr * 0.14;
            if (vEmissive > 0.71) {
              float frame = 1.0 - step(0.05, fw.x) * step(fw.x, 0.95) * step(0.08, fw.y) * step(fw.y, 0.92);
              dayGlass = mix(dayGlass, 0.3, frame);
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.57, 0.6), (1.0 - step(0.14, fw.y)) * 0.8);
            }
            diffuseColor.rgb *= mix(dayGlass, 1.0, uNight);
          }`
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          vec3 warm = vec3(1.0, 0.76, 0.42);
          vec3 glowCol = warm;
          float glow = 1.0;
          if (vEmissive < 0.99) {
            // Glass: a grid of rooms, some lit (warm or cool), most dark, varying per building
            vec2 g = vec2((vWin.x + vWin.z) / 2.3, vWin.y / 3.1);
            vec2 cell = floor(g);
            vec2 f = fract(g);
            float r = fract(sin(dot(cell + vLit * 37.0, vec2(12.9898, 78.233))) * 43758.5453);
            float pane = step(0.12, f.x) * step(f.x, 0.9) * step(0.2, f.y) * step(f.y, 0.85);
            float on = step(0.5, r) * pane;
            glowCol = mix(warm, vec3(0.78, 0.88, 1.0), step(0.86, r));
            glow = vEmissive * mix(0.04, 1.25, on) * step(0.25, vLit);
          }
          totalEmissiveRadiance += glowCol * glow * uNight * 1.35;`
        );
    };
    const previousCompile = m.onBeforeCompile;
    m.onBeforeCompile = shader => { previousCompile(shader); patchTownPaintedProps(shader, this.paintedSurfaces); };
    m.customProgramCacheKey = () => `town-props-roofs-glass-${!!this.surfaceAtlas}-${!!this.paintedSurfaces}`;
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
    if(this.surfaceAtlas&&!this.paintedSurfaces)Object.assign(uni,{uGroundAtlas:{value:this.surfaceAtlas},uSurfaceNear:{value:near.surface},uSurfaceFar:{value:far.surface}});
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uni);
      if(this.surfaceAtlas&&!this.paintedSurfaces){
        shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
          uniform sampler2D uGroundAtlas;
          uniform sampler2D uSurfaceNear;
          uniform sampler2D uSurfaceFar;
          float groundTile(vec2 p,float tile,float span){
            vec2 cell=vec2(mod(tile,4.0),3.0-floor(tile/4.0));
            return texture2D(uGroundAtlas,(cell+.012+fract(p/span)*.976)/4.0).r;
          }`);
      }
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
          diffuseColor.rgb = mix(diffuseColor.rgb, paint.rgb * (0.94 + g * 0.1), paint.a);
          ${this.surfaceAtlas&&!this.paintedSurfaces?`float paving=0.0;
          // Most of the disc is unpainted grass: skip the six paving lookups there
          if(paint.a>.004){
            vec3 surface=(pn.a>.02?texture2D(uSurfaceNear,un):texture2D(uSurfaceFar,uf)).rgb;
            float earth=max(0.0,1.0-surface.r-surface.g-surface.b);
            paving=mix(groundTile(vGround.xz,15.0,3.2),groundTile(vGround.xz,11.0,1.1),.35)*surface.r+groundTile(vGround.xz,9.0,2.4)*surface.g+
              groundTile(vGround.xz,10.0,4.0)*surface.b+groundTile(vGround.xz,11.0,2.4)*earth;
          }
          float turf=groundTile(vGround.xz,12.0,2.0);
          diffuseColor.rgb*=mix(.8+turf*.24,.42+paving*.66,paint.a);`:''}`
        );
    };
      const previousCompile = m.onBeforeCompile;
      m.onBeforeCompile = shader => { previousCompile(shader); patchTownPaintedGround(shader, this.paintedSurfaces, { near, far, modern: this.L.modern }); };
    m.customProgramCacheKey = () => `town-ground-surfaces-${!!this.surfaceAtlas}-${!!this.paintedSurfaces}`;
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
    const ridged = 1 - Math.abs(noise.noise(x * 0.003, z * 0.003, 3));
    // Broad foothills and rounded ridges, rather than near-vertical isolated
    // tile peaks. High frequency detail belongs in the material, not height.
    const mountain = Math.pow(s.mountain, .78) * (18 + ridged * ridged * 36 + noise.noise(x * 0.008, z * 0.008, 4) * 2);
    const town = smooth(s.city + s.otherCity * 0.8, 0.12, 0.5);
    let h = 1.3 + gentle * (1 - town) + mountain * (1 - town);
    h = THREE.MathUtils.lerp(-4 - s.deep * 7 + gentle * 0.5, h, land);
    h = THREE.MathUtils.lerp(h, townSurfaceHeight(L.relief,x,z,s.land), town * land);
    if (town > 0.5 && land > 0.9) h = this.foundationHeight(x,z,h);
    // River channel: a bed below the water line and banks that ease back up
    const rd = this.riverDist(x, z);
    const bank = rd < 8 ? 1 - smooth(rd, -1, 8) : 0;
    if (rd < 8) h = Math.min(h, THREE.MathUtils.lerp(h, WATER_Y - 1.7, smooth(-rd, -8, 3)));
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
    if (bank > 0 && h >= WATER_Y + 0.4) c.lerp(soil, bank * 0.55); // muddy banks
    c.offsetHSL(0, 0, noise.noise(x * 0.03, z * 0.03, 5) * 0.035);
    return h;
  }

  /** Heights on a regular grid over the playable disc (also used by walkers and vehicles). */
  buildHeights() {
    const R = this.L.dioramaR + 40; // a margin so the horizon ring stitches onto real heights
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

  surfaceAt(x, z) {
    const g = this.heightAt(x, z);
    for (const d of this.L.docks) {
      const c=Math.cos(d.yaw),s=Math.sin(d.yaw),dx=x-d.x,dz=z-d.z;
      if(Math.abs(dx*c+dz*s)<(this.L.modern?3.5:2) && Math.abs(-dx*s+dz*c)<d.len/2) return Math.max(g,WATER_Y+0.65);
    }
    // Bridge decks carry walkers and cars over the river
    for (const b of this.bridges) {
      const dx = x - b.x;
      const dz = z - b.z;
      const t = dx * b.c + dz * b.s;
      if (t > b.tA && t < b.tB && Math.abs(-dx * b.s + dz * b.c) < b.hw) return Math.max(g, this.bridgeHeight(b, t));
    }
    return g;
  }

  groundAt(x,z) { return Math.max(this.surfaceAt(x,z),WATER_Y); }

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
   * Ground height anywhere out to the horizon, as the horizon ring draws it:
   * the real heights on the disc, then the planet's fields flattening and
   * dropping a little far away (a hint of curvature). Also fills `c` with the colour.
   */
  farHeight(x, z, S, c, rim = false) {
    const R0 = this.hR - 2;
    const r = Math.hypot(x, z);
    if (rim || r <= R0) {
      this.sampleGround(x, z, S, c);
      return this.heightAt(x, z);
    }
    const h = this.sampleGround(x, z, S, c);
    const far = THREE.MathUtils.smoothstep(r, R0 * 1.6, HORIZON_R);
    return THREE.MathUtils.lerp(h, Math.min(h, 3) - 25, far * far);
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
        const h = this.farHeight(x, z, S, c, k === 0);
        const far = THREE.MathUtils.smoothstep(r, R0 * 1.6, R1);
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
    // Beyond the disc: a coarse depth map out to the horizon, from the same
    // heights the horizon ring uses (without it the near map's square edge showed)
    const fn = 200;
    const fStep = (HORIZON_R * 2) / fn;
    const farData = new Uint8Array(fn * fn);
    const S = {};
    const c = new THREE.Color();
    for (let j = 0; j < fn; j++) {
      for (let i = 0; i < fn; i++) {
        const h = this.farHeight(-HORIZON_R + (i + 0.5) * fStep, -HORIZON_R + (j + 0.5) * fStep, S, c);
        farData[j * fn + i] = Math.max(0, Math.min(255, ((h + 14) / 16) * 255));
      }
    }
    const farTex = this.track(new THREE.DataTexture(farData, fn, fn, THREE.RedFormat, THREE.UnsignedByteType));
    farTex.magFilter = THREE.LinearFilter;
    farTex.minFilter = THREE.LinearFilter;
    farTex.needsUpdate = true;
    const g = this.track(new THREE.CircleGeometry(HORIZON_R, 160));
    g.rotateX(-Math.PI / 2);
    const u = this.uniforms;
    this.waterUniforms = {
      uTime: u.uTime,
      uDepth: { value: depthTex },
      uDepthRect: { value: new THREE.Vector3(-this.hR, -this.hR, this.hR * 2) },
      uDepthFar: { value: farTex },
      uFarRect: { value: new THREE.Vector3(-HORIZON_R, -HORIZON_R, HORIZON_R * 2) },
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
          uniform sampler2D uDepthFar;
          uniform vec3 uFarRect;
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
            float farGround = texture2D(uDepthFar, (p - uFarRect.xy) / uFarRect.z).r * 16.0 - 14.0;
            float nearGround = texture2D(uDepth, clamp(uv, 0.0, 1.0)).r * 16.0 - 14.0;
            // Sharp map on the disc, blending into the coarse one toward its rim
            float rim = uDepthRect.z * 0.5;
            float ground = mix(nearGround, farGround, smoothstep(rim * 0.9, rim, length(p)));
            float depth = ${WATER_Y.toFixed(2)} - ground;
            if (depth < -0.04) discard;
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
              col += uSunColor * spec * 0.65;
              // Moving shallow-water caustics; cheap analytic pattern, no texture download.
              float cellA=sin(p.x*.9+sin(p.y*.7+uTime*.4)*1.3);
              float cellB=sin(p.y*.95+cos(p.x*.6-uTime*.3)*1.2);
              float caustic=1.0-smoothstep(.025,.12,abs(cellA+cellB*.65));
              col += vec3(0.12, 0.23, 0.17) * caustic * (1.0 - smoothstep(0.5, 4.5, depth)) * uSunI;
              // Foam where the water meets the shore, pulsing in and out
              float lap = 0.55 + 0.25 * sin(uTime * 1.3 + p.x * 0.05 + p.y * 0.04);
              float foam = (1.0 - smoothstep(0.0, lap, depth)) * (0.65 + 0.35 * sin(p.x * 1.7 + p.y * 1.3 + uTime * 2.0));
              float breaker = pow(max(0.0, sin(depth * 6.5 - uTime * 1.6 + h0 * 0.3)), 12.0);
              foam += breaker * smoothstep(0.05, 0.3, depth) * (1.0 - smoothstep(0.4, 1.6, depth)) * 0.5;
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
    this.farTrees?.setEnvironment(sunIntensity, night);
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

  /** An environment-kit model for this item, picked by position so a clump mixes shapes. */
  resolveEnvironment(item) {
    const variants = this.variants(item.asset);
    const key = variants ? `${item.asset}_v${(item.variant ?? 0) % variants}` : item.asset;
    if (this.townPack[key]?.[0]?.userData.townAssetRevision) return null;
    const env = ENVIRONMENT[item.asset];
    if (!env || env.keep?.(item.variant ?? 0)) return null;
    const pick = env.models[Math.abs(Math.floor(item.x * 7.13 + item.z * 3.71)) % env.models.length];
    const parts = this.environmentPack[pick];
    if (!parts?.[0]) return null;
    const envKey = `env:${item.asset}:${pick}`;
    if (!this.fitCache.has(envKey)) {
      for (let l = 0; l < 3; l++) parts[l] ||= parts[l - 1] || parts[0];
      const box = new THREE.Box3();
      for (const part of parts[0]) {
        part.geometry.boundingBox || part.geometry.computeBoundingBox();
        box.union(part.geometry.boundingBox);
      }
      const size = box.getSize(new THREE.Vector3());
      const k = env.height ? env.height / size.y : env.width ? env.width / Math.max(size.x, size.z) : 1;
      this.fitCache.set(envKey, { parts, fix: new THREE.Matrix4().makeScale(k, k, k), native: true, spec: { natural: !!CATALOG[item.asset]?.natural }, key: envKey });
    }
    return this.fitCache.get(envKey);
  }

  resolve(name, variant = 0) {
    const nv = this.variants(name);
    const key = nv ? `${name}_v${variant % nv}` : name;
    const texturedName = this.sceneryPack[`${name}_v1`] && variant % 2 ? `${name}_v1` : name;
    if (!this.townPack[key]?.[0]?.userData.townAssetRevision && this.sceneryPack[texturedName]) {
      const key = `textured:${texturedName}`;
      if (!this.fitCache.has(key)) this.fitCache.set(key, {
        parts: this.sceneryPack[texturedName], fix: new THREE.Matrix4(), native: true,
        spec: { natural: !!CATALOG[name]?.natural }, key
      });
      return this.fitCache.get(key);
    }
    if (this.fitCache.has(key)) return this.fitCache.get(key);
    const spec = CATALOG[name] || { fb: name, fit: 'w', size: 4 };
    let lods = null;
    let native = false;
    if (this.townPack[key]) {
      lods = [0, 1, 2].map(l => {
        const original = this.townPack[key][l];
        const refined = refineTownModel(key, original, l);
        return refined !== original ? this.track(refined) : original;
      });
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
    const R = this.L.dioramaR;
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
      this.group.add(group);
      return { cx: -R + (i + 0.5) * cellW, cz: -R + (j + 0.5) * cellW, group, buckets: new Map(), sets: [] };
    });
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const add = (item, { scale = 1, span = null, y = null, shadow = true } = {}) => {
      const res = this.resolveEnvironment(item) || this.resolve(item.asset, item.variant ?? 0);
      if (!res) return;
      const h = (y ?? (item.deck ? this.surfaceAt(item.x,item.z) : item.floating ? WATER_Y : this.heightAt(item.x, item.z))) - (item.sink ?? 0);
      // Tilt (rocks tumble on every axis), then the heading
      q.setFromEuler(e.set(item.tiltX ?? 0, -item.yaw, item.tiltZ ?? 0, 'YXZ'));
      if (res.span) {
        sc.set((span ?? item.len ?? 1) / res.spanLength, res.spanHeight, res.spanHeight);
        m.compose(v.set(item.x, h, item.z), q, sc).multiply(res.fix);
      } else {
        // Town-pack models are authored at their layout size; lots stretch them a little per axis
        const s = res.native && !res.spec.natural ? 1 : scale;
        m.compose(v.set(item.x, h, item.z), q, sc.set(s * (item.sx ?? 1), s * (item.sy ?? 1), s * (item.sz ?? 1))).multiply(res.fix);
      }
      const k = chunkOf(item.x, item.z);
      const bucket = this.chunks[k].buckets;
      if (!bucket.has(res.key)) bucket.set(res.key, { res, items: [], shadow });
      bucket.get(res.key).items.push({ m: m.clone(), tint: item.tint ?? 1, roof: item.roof ?? null, autumn: item.asset==='t_oak'&&item.variant===2 || item.asset==='t_birch'&&item.variant===1 });
    };
    for (const b of L.buildings) add(b, { scale: b.w / (b.sx ?? 1) / ((CATALOG[b.asset]?.size) || b.w) });
    for (const p of L.props) if (!p.parked) add(p); // parked vehicles belong to the fleet (enterable)
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
    for (const chunk of this.chunks) {
      for (const [, { res, items, shadow }] of chunk.buckets) chunk.sets.push(this.instanceSet(chunk, res, items, shadow, shadows));
    }
    this.lodView = null;
  }

  /**
   * One asset in one chunk: an InstancedMesh per LOD level (and per material part), all
   * sized for every item. update() sorts the items into the levels by how large each one
   * is on screen, so only nearby models are drawn at full detail; the chunk's bounding
   * sphere still culls what is out of view.
   */
  instanceSet(chunk, res, items, cast, shadows) {
    const n = items.length;
    const lodParts = (lvl) => res.parts?.[lvl] || [{ geometry: res.lods[lvl], material: this.material }];
    const same = (a, b) => a.length === b.length && a.every((p, i) => p.geometry === b[i].geometry);
    // Levels that reuse the same models collapse into one: nothing to sort
    const levels = same(lodParts(0), lodParts(1)) && same(lodParts(1), lodParts(2)) ? 1 : 3;
    const matrices = new Float32Array(n * 16);
    const colors = new Float32Array(n * 3);
    const autumn = items.some((it) => it.autumn) ? new Float32Array(n * 3) : null;
    const roofs = items.some((it) => it.roof) ? new Float32Array(n * 3).fill(-1) : null;
    const where = new Float32Array(n * 4); // x, y, z and the model's radius at its scale
    let radius = 0;
    for (const part of lodParts(0)) {
      part.geometry.boundingSphere || part.geometry.computeBoundingSphere();
      radius = Math.max(radius, part.geometry.boundingSphere.radius);
    }
    const color = new THREE.Color();
    items.forEach((it, i) => {
      it.m.toArray(matrices, i * 16);
      if (Array.isArray(it.tint)) color.setRGB(it.tint[0], it.tint[1], it.tint[2]);
      else color.setScalar(it.tint);
      color.toArray(colors, i * 3);
      if (autumn) (it.autumn ? color.multiply(AUTUMN) : color).toArray(autumn, i * 3);
      if (roofs && it.roof) color.set(it.roof).toArray(roofs, i * 3);
      where.set([it.m.elements[12], it.m.elements[13], it.m.elements[14], radius * it.m.getMaxScaleOnAxis()], i * 4);
    });
    const all = new THREE.InstancedBufferAttribute(matrices, 16);
    const set = { n, levels, matrices, colors, autumn, roofs, where, level: new Int8Array(n).fill(-1), lods: [] };
    for (let lvl = 0; lvl < levels; lvl++) {
      const lod = {
        matrix: new THREE.InstancedBufferAttribute(levels > 1 ? new Float32Array(n * 16) : matrices, 16),
        color: new THREE.InstancedBufferAttribute(levels > 1 ? new Float32Array(n * 3) : colors, 3),
        autumn: autumn ? new THREE.InstancedBufferAttribute(levels > 1 ? new Float32Array(n * 3) : autumn, 3) : null,
        roof: roofs ? new THREE.InstancedBufferAttribute(levels > 1 ? new Float32Array(n * 3) : roofs, 3) : null,
        meshes: []
      };
      if (levels > 1) [lod.matrix, lod.color, lod.autumn, lod.roof].forEach((a) => a?.setUsage(THREE.DynamicDrawUsage));
      for (const part of lodParts(lvl)) {
        const foliage = part.material.name === 'Foliage_cutout' || part.material.name.startsWith('ENV_leaf');
        // Palette roofs: a wrapper shares the pack buffers and carries one colour per instance
        const roofed = roofs && part.material === this.material;
        const geometry = roofed ? wrapGeometry(part.geometry) : part.geometry;
        if (roofed) geometry.setAttribute('aRoof', lod.roof);
        const inst = new THREE.InstancedMesh(geometry, foliage ? this.foliageMaterial(part.material) : part.material, n);
        inst.instanceMatrix = all;
        inst.computeBoundingSphere(); // over every item, whatever level each one is drawn at
        inst.instanceMatrix = lod.matrix;
        inst.instanceColor = foliage && lod.autumn ? lod.autumn : lod.color;
        inst.castShadow = cast && shadows;
        inst.userData.townShadow = cast;
        inst.userData.townLod = lvl;
        inst.receiveShadow = shadows && lvl < 2;
        inst.count = levels > 1 ? 0 : n;
        inst.visible = levels === 1;
        chunk.group.add(inst);
        lod.meshes.push(inst);
        // The builder owns the wrapper and its roof buffer; the pack geometry stays cached
        this.disposables.push({ dispose: () => { inst.dispose(); if (roofed) geometry.dispose(); } });
      }
      set.lods.push(lod);
    }
    return set;
  }

  /** Sort a set's items into its LOD levels; uploads only when an item changed level. */
  sortSet(set, view) {
    const { n, where, level } = set;
    const { x, y, z, orbit, zoom2, k } = view;
    // Size on screen ~ radius / distance, scaled for the field of view and the quality tier
    const classify = (s) => (s > LOD_SIZE[0] ? 0 : s > LOD_SIZE[1] ? 1 : 2);
    let changed = false;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const dx = where[o] - x;
      const dz = where[o + 2] - z;
      // From the table: distance to the point it circles, so orbiting never swaps levels
      const d = orbit ? Math.sqrt(zoom2 + dx * dx + dz * dz) : Math.hypot(dx, where[o + 1] - y, dz);
      const budget = 1 - (1 - this.detailBudget.lod) * THREE.MathUtils.smoothstep(d, 35, 110);
      const s = (where[o + 3] * k * budget) / Math.max(d, 1);
      let lvl = classify(s);
      const cur = level[i];
      // Hysteresis: only move once clearly past the line
      if (cur >= 0 && lvl !== cur && classify(lvl < cur ? s / 1.15 : s * 1.15) === cur) lvl = cur;
      if (lvl !== cur) {
        level[i] = lvl;
        changed = true;
      }
    }
    if (!changed) return;
    const counts = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const lod = set.lods[level[i]];
      const j = counts[level[i]]++;
      lod.matrix.array.set(set.matrices.subarray(i * 16, i * 16 + 16), j * 16);
      lod.color.array.set(set.colors.subarray(i * 3, i * 3 + 3), j * 3);
      lod.autumn?.array.set(set.autumn.subarray(i * 3, i * 3 + 3), j * 3);
      lod.roof?.array.set(set.roofs.subarray(i * 3, i * 3 + 3), j * 3);
    }
    set.lods.forEach((lod, lvl) => {
      const c = counts[lvl];
      for (const [a, size] of [[lod.matrix, 16], [lod.color, 3], [lod.autumn, 3], [lod.roof, 3]]) {
        if (!a || !c) continue;
        a.clearUpdateRanges();
        a.addUpdateRange(0, c * size);
        a.needsUpdate = true;
      }
      for (const m of lod.meshes) {
        m.count = c;
        m.visible = c > 0;
      }
    });
  }

  foliageMaterial(source) {
    if(this.foliageMaterials.has(source))return this.foliageMaterials.get(source);
    const m=this.track(source.clone());
    m.alphaTest=.45;m.transparent=false;m.depthWrite=true;m.side=THREE.DoubleSide;
    m.onBeforeCompile=shader=>{
      shader.uniforms.uWindTime=this.uniforms.uTime;
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform float uWindTime;')
        .replace('#include <begin_vertex>',`#include <begin_vertex>
          float phase=0.0;
          #ifdef USE_INSTANCING
            phase=dot(instanceMatrix[3].xz,vec2(.13,.21));
          #endif
          transformed.x+=sin(uWindTime*1.3+phase+position.y*.7)*.065*clamp(position.y*.2,0.0,1.0);
          transformed.z+=sin(uWindTime*.8+phase)*.04*clamp(position.y*.2,0.0,1.0);`);
    };
    m.customProgramCacheKey=()=> 'living-foliage-v1';
    this.foliageMaterials.set(source,m);return m;
  }

  /**
   * Per-instance LOD. From the diorama (orbit = the point it circles around) the
   * distance is measured so that it does not change while orbiting: otherwise the
   * near and far sides swap levels on every turn of the table and the town flickers.
   * Items are only re-sorted once the view has moved a little.
   */
  update(camera, orbit = null, budget = this.detailBudget) {
    const p = camera.position;
    this.detailBudget = budget;
    this.groundCover?.update(camera, orbit, budget.vegetation);
    this.farTrees?.update(camera, orbit, budget.vegetation);
    const zoom = orbit ? p.distanceTo(orbit) : 0;
    const at = orbit || p;
    // Lower quality tiers switch to lighter models sooner; a narrow lens keeps detail further out
    const k = this.quality.settings.detail * (Math.tan(THREE.MathUtils.degToRad(27.5)) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    const v = this.lodView;
    const shadows = this.quality.settings.shadows;
    for (const mesh of this.groundCover?.meshes || []) mesh.receiveShadow = shadows;
    if (this.liveShadows !== shadows) {
      this.group.traverse(mesh => {
        if (mesh.isMesh && !mesh.isInstancedMesh && mesh.userData.townShadow !== undefined) {
          mesh.castShadow = shadows && mesh.userData.townShadow;
          mesh.receiveShadow = shadows;
        }
      });
      this.liveShadows = shadows;
    }
    if (v && v.shadows === shadows && v.budget === budget.lod && v.shadow === budget.shadow && !!v.orbit === !!orbit && Math.abs(v.x - at.x) < 1.5 && Math.abs(v.y - at.y) < 1.5 && Math.abs(v.z - at.z) < 1.5 && Math.abs(v.zoom - zoom) < Math.max(1.5, zoom * 0.02) && Math.abs(v.k - k) < 0.01) return;
    this.lodView = { x: at.x, y: at.y, z: at.z, orbit: !!orbit, zoom, zoom2: zoom * zoom, k, budget: budget.lod, shadow: budget.shadow, shadows };
    for (const chunk of this.chunks) for (const set of chunk.sets) for (const lod of set.lods) for (const mesh of lod.meshes) {
      mesh.castShadow = shadows && mesh.userData.townShadow && (budget.shadow >= 0.9 || mesh.userData.townLod < 2);
      mesh.receiveShadow = shadows && mesh.userData.townLod < 2;
    }
    for (const c of this.chunks) for (const set of c.sets) if (set.levels > 1) this.sortSet(set, this.lodView);
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose?.());
    this.disposables = [];
  }
}
