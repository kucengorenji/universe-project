import * as THREE from 'three';
import { generateHexasphere } from '../math/hexasphere.js';
import { MapGenerator, BIOMES, isWater, mulberry32 } from '../map/mapGenerator.js';
import { createNoise3D } from '../math/simplex3d.js';
import { PLANET_TYPES, TERRAN_PALETTE } from './planetTypes.js';

// Bakes the space-view textures of a whole star system off the main thread.
// Rocky planets are coloured from the SAME tile map the globe view builds
// (nearest hex tile per pixel), so a planet seen from orbit and the globe you
// land on show the same continents in the same place.
//
// Texel layout matches THREE.SphereGeometry UVs with a DataTexture (flipY off):
// row r -> v = 1 - (r + 0.5) / H, column c -> u = (c + 0.5) / W.
// RGB = albedo (sRGB), A = self-illumination mask (city lights, lava).

const GROUND = { fantasy: 0xcbb68c, modern: 0xa9a8a0, farm: 0xc9a650 };
const MOUNTAIN = { rock: 0x9a8672, rockDark: 0x6e5f52, snow: 0xf5f8fb };

function colorOf(hex) {
  return new THREE.Color(hex);
}

/** Direction on the unit sphere for a texel. */
function texelDir(c, r, W, H, out) {
  const u = (c + 0.5) / W;
  const v = 1 - (r + 0.5) / H;
  const phi = u * Math.PI * 2;
  const theta = v * Math.PI;
  return out.set(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
}

function locate(tileMap, dir, hint) {
  let cur = hint;
  let best = cur.center.dot(dir);
  for (;;) {
    let next = null;
    for (const id of cur.neighbors) {
      const t = tileMap.get(id);
      const d = t.center.dot(dir);
      if (d > best) {
        best = d;
        next = t;
      }
    }
    if (!next) return cur;
    cur = next;
  }
}

function bakeRocky(hs, job, W, H) {
  const type = PLANET_TYPES[job.type] || PLANET_TYPES.terran;
  const look = type.look || {};
  const palette = { ...TERRAN_PALETTE, ...(look.palette || {}) };
  const pal = Object.fromEntries(Object.entries(palette).map(([k, v]) => [k, colorOf(v)]));
  const mtn = { ...MOUNTAIN, ...(look.mountain || {}) };
  const rock = colorOf(mtn.rock);
  const rockDark = colorOf(mtn.rockDark);
  const snow = colorOf(mtn.snow);
  const ground = { fantasy: colorOf(GROUND.fantasy), modern: colorOf(GROUND.modern), farm: colorOf(GROUND.farm) };
  const lava = look.water?.unlit;
  const noise = createNoise3D(job.seed + 99);
  const out = new Uint8ClampedArray(W * H * 4);
  const dir = new THREE.Vector3();
  const c = new THREE.Color();
  const tileMap = hs.tileMap;
  let rowHint = hs.tiles[0];
  for (let r = 0; r < H; r++) {
    let hint = rowHint;
    for (let x = 0; x < W; x++) {
      texelDir(x, r, W, H, dir);
      const t = locate(tileMap, dir, hint);
      hint = t;
      if (x === 0) rowHint = t;
      const n = noise.fbm(dir.x * 9, dir.y * 9, dir.z * 9, 3, 2.0, 0.5); // -1..1
      let glow = 0;
      if (t.cityIndex !== null && t.cityIndex !== undefined) {
        c.copy(job.modern?.[t.cityIndex] ? ground.modern : ground.fantasy);
        // Street lights: a sparkle pattern rather than a flat blob
        glow = n > -0.25 ? 0.55 + n * 0.45 : 0.15;
      } else if (t.farmIndex !== null && t.farmIndex !== undefined) {
        c.copy(ground.farm);
      } else if (t.biome === BIOMES.MOUNTAIN) {
        const h = Math.max(0, t.elevation);
        c.copy(rock).lerp(rockDark, Math.min(1, 0.3 + n * 0.5));
        const absLat = Math.abs(dir.y);
        if (h > 0.5 - absLat * 0.3 || look.mountain?.snow === 0xff8a3d) {
          // Snow caps (glowing caldera on lava worlds)
          if (n > -0.1) c.lerp(snow, 0.75);
          if (lava) glow = n > 0.1 ? 0.5 : 0;
        }
      } else {
        c.copy(pal[t.biome] ?? pal.plains);
        if (isWater(t) && lava) glow = t.biome === BIOMES.COAST ? 0.25 : 0.85;
      }
      // Low-frequency paint drift so large areas do not look flat
      const shade = isWater(t) ? n * 0.035 : n * 0.07;
      c.offsetHSL(0, 0, shade);
      if (look.floes && isWater(t) && n > 0.55) c.lerp(pal.tundra, 0.8);
      const o = (r * W + x) * 4;
      c.convertLinearToSRGB?.();
      out[o] = c.r * 255;
      out[o + 1] = c.g * 255;
      out[o + 2] = c.b * 255;
      out[o + 3] = glow * 255;
    }
  }
  return out;
}

/** Gas giant: latitude bands warped by turbulence, plus a storm eye or two. */
function bakeGas(job, W, H) {
  const rng = mulberry32(job.seed);
  const warm = job.bands[0] < 0.6;
  const base = warm
    ? [0xe8cfa4, 0xc98f5a, 0xf1e2c4, 0xa9683f, 0xd9b27c, 0x8f5a3a]
    : [0xa9d3e6, 0x5e93c4, 0xd7ecf2, 0x3f6fa8, 0x8cc2d6, 0x2f5588];
  const cols = base.map(colorOf);
  const noise = createNoise3D(job.seed);
  const out = new Uint8ClampedArray(W * H * 4);
  const dir = new THREE.Vector3();
  const c = new THREE.Color();
  const storm = new THREE.Vector3(rng() - 0.5, (rng() - 0.5) * 0.8, rng() - 0.5).normalize();
  const freq = 5 + job.bands[1] * 6;
  for (let r = 0; r < H; r++) {
    for (let x = 0; x < W; x++) {
      texelDir(x, r, W, H, dir);
      const warp = noise.fbm(dir.x * 3, dir.y * 3, dir.z * 3, 4, 2.0, 0.5);
      const lat = dir.y + warp * 0.08 + noise.noise(dir.x * 12, dir.y * 30, dir.z * 12) * 0.01;
      const b = (Math.sin(lat * freq * Math.PI) * 0.5 + 0.5) * (cols.length - 1);
      const i = Math.floor(b);
      c.copy(cols[i]).lerp(cols[Math.min(cols.length - 1, i + 1)], b - i);
      // Great storm: a pale oval with a dark rim
      const d = dir.distanceTo(storm);
      if (d < 0.22) {
        const k = 1 - d / 0.22;
        c.lerp(cols[warm ? 3 : 5], Math.min(1, k * 1.6) * 0.5);
        c.lerp(cols[2], Math.max(0, k * 2 - 1));
      }
      c.offsetHSL(0, 0, warp * 0.04);
      c.convertLinearToSRGB?.();
      const o = (r * W + x) * 4;
      out[o] = c.r * 255;
      out[o + 1] = c.g * 255;
      out[o + 2] = c.b * 255;
      out[o + 3] = 0;
    }
  }
  return out;
}

/** One shared cloud map (alpha only in R), tinted and spun per planet at runtime. */
function bakeClouds(W, H) {
  const noise = createNoise3D(20260926);
  const out = new Uint8ClampedArray(W * H * 4);
  const dir = new THREE.Vector3();
  for (let r = 0; r < H; r++) {
    for (let x = 0; x < W; x++) {
      texelDir(x, r, W, H, dir);
      const n = noise.fbm(dir.x * 3.2, dir.y * 5.5, dir.z * 3.2, 5, 2.1, 0.52);
      const a = Math.max(0, Math.min(1, (n - 0.05) * 2.6));
      const o = (r * W + x) * 4;
      out[o] = out[o + 1] = out[o + 2] = 255;
      out[o + 3] = a * 235;
    }
  }
  return out;
}

self.onmessage = (e) => {
  const { subdivision, radius, jobs, width } = e.data;
  const W = width;
  const H = width / 2;
  let hs = null;
  let gen = null;
  const clouds = bakeClouds(W / 2, H / 2);
  self.postMessage({ clouds: true, width: W / 2, height: H / 2, data: clouds.buffer }, [clouds.buffer]);
  for (const job of jobs) {
    let data;
    if (job.type === 'gas') {
      data = bakeGas(job, W / 2, H / 2);
      self.postMessage({ index: job.index, width: W / 2, height: H / 2, data: data.buffer }, [data.buffer]);
      continue;
    }
    hs ||= generateHexasphere(subdivision, radius);
    gen ||= new MapGenerator(hs);
    if (job.biomes) {
      // Home world: the saved map is authoritative
      for (const t of hs.tiles) {
        t.biome = job.biomes[t.id];
        t.elevation = job.elevation[t.id];
        t.cityIndex = job.city[t.id] >= 0 ? job.city[t.id] : null;
        t.farmIndex = job.farm[t.id] ? 1 : null;
      }
    } else {
      const type = PLANET_TYPES[job.type];
      const map = gen.generate(job.seed, { ...type.gen, planetType: job.type, inhabited: type.inhabited, capitalNames: job.capitalNames });
      job.modern = map.cities.map((c) => c.style === 'modern');
    }
    data = bakeRocky(hs, job, W, H);
    self.postMessage({ index: job.index, width: W, height: H, data: data.buffer }, [data.buffer]);
  }
  self.postMessage({ done: true });
};
