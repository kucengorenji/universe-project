import * as THREE from 'three';
import { mulberry32 } from '../../math/random.js';
import { createNoise3D } from '../../math/simplex3d.js';
import { createValleyMaterial } from '../render/valleyMaterial.js';
import { padDistance, polylineDistance } from './valleyGround.js';
import { insideSolid } from './scatter.js';
import PALETTE from '../valleyPalette.json';

// Grass tufts and flowers (docs/FARM_PLAN.md §2.1, §6 rule 4). Lessons from town groundCover:
// every tuft takes the colour painted under it and an upward normal, so it shades like the
// ground it grows from instead of reading as a sticker. Placement follows rules, not a uniform
// spray: thick along path edges, fences and walls, clumped in the open, never on paths or soil.

const UP = new THREE.Vector3(0, 1, 0);

function tuftGeometry(rng) {
  const pos = [], col = [], wind = [];
  const blades = 6;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + rng() * 0.6, r = 0.04 + rng() * 0.07;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, h = 0.22 + rng() * 0.2, w = 0.035 + rng() * 0.02;
    const lean = 0.06 + rng() * 0.08, tx = x + Math.cos(a) * lean, tz = z + Math.sin(a) * lean;
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    pos.push(x - px, 0, z - pz, x + px, 0, z + pz, tx, h, tz);
    col.push(0.78, 0.78, 0.72, 0.78, 0.78, 0.72, 1.25, 1.22, 1.05); // darker root, sunlit tip
    wind.push(0, 0, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('wind', new THREE.Float32BufferAttribute(wind, 1));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill([0, 1, 0]).flat(), 3));
  return g;
}

function flowerGeometry() {
  const pos = [], col = [], wind = [];
  const h = 0.3, petals = 5;
  // Stem: a thin upright triangle
  pos.push(-0.012, 0, 0, 0.012, 0, 0, 0, h, 0);
  col.push(0.35, 0.55, 0.25, 0.35, 0.55, 0.25, 0.45, 0.65, 0.3);
  wind.push(0, 0, 1);
  for (let p = 0; p < petals; p++) {
    const a0 = (p / petals) * Math.PI * 2, a1 = ((p + 0.5) / petals) * Math.PI * 2, a2 = ((p + 1) / petals) * Math.PI * 2;
    const r0 = 0.03, r1 = 0.075;
    pos.push(Math.cos(a0) * r0, h, Math.sin(a0) * r0, Math.cos(a1) * r1, h + 0.01, Math.sin(a1) * r1, Math.cos(a2) * r0, h, Math.sin(a2) * r0);
    col.push(1, 1, 1, 1, 1, 1, 1, 1, 1);
    pos.push(0, h + 0.012, 0, Math.cos(a0) * r0, h, Math.sin(a0) * r0, Math.cos(a2) * r0, h, Math.sin(a2) * r0);
    col.push(1.6, 1.3, 0.4, 1, 1, 1, 1, 1, 1); // warm centre
    wind.push(1, 1, 1, 1, 1, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('wind', new THREE.Float32BufferAttribute(wind, 1));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill([0, 1, 0]).flat(), 3));
  return g;
}

/**
 * Density (0..1) of grass at a point, from the placement rules. 0 where nothing may grow.
 */
export function grassDensity(ctx, x, z) {
  const { ground, layout } = ctx;
  if (Math.abs(x) > ground.half - 1 || Math.abs(z) > ground.half - 1) return 0;
  const h = ground.heightAt(x, z);
  if (h < ground.water + 0.3) return 0;
  let edge = Infinity;
  for (const p of ground.paths) {
    const d = polylineDistance(p.points, x, z) - p.width / 2;
    if (d < 0.05) return 0;
    edge = Math.min(edge, d);
  }
  for (const f of layout.fields) if (padDistance({ ...f, rot: 0 }, x, z) < 0.4) return 0;
  if (ground.deckAt(x, z)) return 0;
  // The packed earth of the square, and the walls and props of everything built
  for (const f of ground.features) if (f.placed && padDistance({ ...ground.pads.get(f.id), w: ground.pads.get(f.id).w - 4.4, d: ground.pads.get(f.id).d - 4.4 }, x, z) < 0) return 0;
  const solid = insideSolid(ctx.solids, x, z, 0.12);
  if (solid) return 0;
  let wall = Infinity;
  for (const s of ctx.solids) if (s.kind === 'rect') wall = Math.min(wall, padDistance(s, x, z));
  for (const s of layout.steps) if (Math.hypot(x - s[0], z - s[1]) < 0.5) return 0;
  let fenceD = Infinity;
  for (const f of layout.fences) fenceD = Math.min(fenceD, polylineDistance(f.points, x, z));
  // Open meadow: clumps
  let d = 0.25 + Math.max(0, ctx.noise(x * 0.12, 1.7, z * 0.12)) * 0.75;
  // Thick borders along paths, fences and walls
  d += Math.max(0, 1 - Math.abs(edge - 0.45) / 0.6) * 0.9;
  d += Math.max(0, 1 - fenceD / 0.7) * 0.9;
  d += Math.max(0, 1 - Math.abs(wall - 0.35) / 0.6) * 0.8;
  // Thins out up the hills and on the trampled ring by the door
  d *= 1 - Math.min(0.75, Math.max(0, h - 3) * 0.08);
  return Math.min(1, d);
}

export function buildGrass(ground, layout, terrain, { count = 16000, flowers = 700, solids = [] } = {}) {
  const rng = mulberry32(layout.seed + 71);
  const ctx = { ground, layout, solids, noise: createNoise3D(layout.seed + 3).noise };
  const material = createValleyMaterial({ vertexColors: true, wind: true, brush: 0.04, side: THREE.DoubleSide, noFlip: true, push: true, grass: true });
  const group = new THREE.Group();
  group.name = 'valley-grass';
  const variants = [0, 1, 2].map(() => tuftGeometry(rng));
  const meshes = variants.map((g) => new THREE.InstancedMesh(g, material, Math.ceil(count / variants.length) + 1));
  const used = meshes.map(() => 0);
  const spots = meshes.map(() => []); // (x, z) per instance, to take the ground's colour again each season
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), color = new THREE.Color();
  const reach = 46; // the walkable valley floor; the hills read as grass from the painted map alone
  let placed = 0;
  for (let tries = 0; tries < count * 6 && placed < count; tries++) {
    const x = (rng() * 2 - 1) * reach, z = (rng() * 2 - 1) * reach;
    if (rng() > grassDensity(ctx, x, z)) continue;
    const v = placed % meshes.length;
    if (used[v] >= meshes[v].count) continue;
    q.setFromAxisAngle(UP, rng() * Math.PI * 2);
    const k = 0.75 + rng() * 0.6;
    m.compose(p.set(x, ground.heightAt(x, z) - 0.02, z), q, s.set(k, k * (0.85 + rng() * 0.4), k));
    meshes[v].setMatrixAt(used[v], m);
    terrain.sampleGrass(x, z, color);
    meshes[v].setColorAt(used[v], color);
    spots[v].push(x, z);
    used[v]++;
    placed++;
  }
  meshes.forEach((mesh, i) => {
    mesh.count = used[i];
    mesh.receiveShadow = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  });

  // Flowers: drifts along path edges, the fence by the house, and a few meadow patches
  const kit = PALETTE.kit, hues = [kit.flowerRed, kit.flowerYellow, kit.flowerWhite, kit.flowerPink].map((h) => new THREE.Color(h));
  const flowerMesh = new THREE.InstancedMesh(flowerGeometry(), material, flowers);
  let f = 0;
  const blooms = []; // per flower: its matrix, its drift's colour index, and a rank for thinning out
  for (let tries = 0; tries < flowers * 40 && f < flowers; tries++) {
    const x = (rng() * 2 - 1) * reach, z = (rng() * 2 - 1) * reach;
    const d = grassDensity(ctx, x, z);
    if (d < 0.7 || rng() > (d - 0.6) * 1.2) continue;
    // Each drift keeps to one or two colours
    const drift = Math.floor((ctx.noise(x * 0.18, 9, z * 0.18) * 0.5 + 0.5) * hues.length * 0.999);
    q.setFromAxisAngle(UP, rng() * Math.PI * 2);
    const k = 0.8 + rng() * 0.5;
    m.compose(p.set(x, ground.heightAt(x, z) - 0.02, z), q, s.set(k, k, k));
    flowerMesh.setMatrixAt(f, m);
    const hue = rng() < 0.8 ? drift : (drift + 1) % hues.length;
    flowerMesh.setColorAt(f, hues[hue]);
    blooms.push({ m: m.clone(), hue, rank: rng() });
    f++;
  }
  flowerMesh.count = f;
  flowerMesh.instanceColor.needsUpdate = true;
  flowerMesh.receiveShadow = true;
  flowerMesh.computeBoundingSphere();
  group.add(flowerMesh);
  /** A new season: tufts take the repainted ground's colour; only a share of flowers blooms, in season colours. */
  const setSeason = (season, terrainNow) => {
    meshes.forEach((mesh, v) => {
      for (let k = 0; k < used[v]; k++) mesh.setColorAt(k, terrainNow.sampleGrass(spots[v][k * 2], spots[v][k * 2 + 1], color));
      mesh.instanceColor.needsUpdate = true;
    });
    const colours = season.flowers.colors.map((h) => new THREE.Color(h)), hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    blooms.forEach((b, k) => {
      flowerMesh.setMatrixAt(k, b.rank < season.flowers.share ? b.m : hidden);
      flowerMesh.setColorAt(k, colours[b.hue % colours.length]);
    });
    flowerMesh.instanceMatrix.needsUpdate = true;
    flowerMesh.instanceColor.needsUpdate = true;
    return blooms.filter((b) => b.rank < season.flowers.share).length;
  };
  return { group, tufts: placed, flowers: f, setSeason, dispose: () => { variants.forEach((g) => g.dispose()); flowerMesh.geometry.dispose(); material.dispose(); } };
}
