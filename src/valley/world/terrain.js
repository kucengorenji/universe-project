import * as THREE from 'three';
import { createNoise3D } from '../../math/simplex3d.js';
import { mulberry32 } from '../../math/random.js';
import { createValleyMaterial } from '../render/valleyMaterial.js';
import { polylineDistance } from './valleyGround.js';
import { FOOTPRINTS } from './scatter.js';
import PALETTE from '../valleyPalette.json';

// Terrain mesh plus its painted ground (docs/FARM_PLAN.md §5.1): one 2048 px map over the whole
// valley (~8 cm per texel). The base is painted per pixel at 1024 (grass patches, hills, banks),
// then paths and the field are drawn on top as vector strokes with ragged edges.
// Canvas row 0 is z = -half, so the map lines up with the plane's UVs under flipY.

const S = PALETTE.surface;
const rgb = (hex) => new THREE.Color(hex).convertLinearToSRGB(); // Color() stores linear; canvases want sRGB
const mixInto = (out, a, b, t) => {
  out[0] = a.r + (b.r - a.r) * t; out[1] = a.g + (b.g - a.g) * t; out[2] = a.b + (b.b - a.b) * t;
};
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function buildTerrain(ground, layout, { mapSize = 2048, objects = [], surface = null } = {}) {
  const { size, half, n, heights } = ground;
  const geometry = new THREE.PlaneGeometry(size, size, n - 1, n - 1);
  geometry.rotateX(-Math.PI / 2);
  const pos = geometry.attributes.position;
  // PlaneGeometry rows run from +y (becomes -z) downward: row r of the plane is z = -half + r
  for (let k = 0; k < pos.count; k++) {
    const i = Math.round(pos.getX(k) + half), j = Math.round(pos.getZ(k) + half);
    pos.setY(k, heights[j * n + i]);
  }
  geometry.computeVertexNormals();
  const ground2d = paintGround(ground, layout, mapSize, objects, { ...S, ...surface });
  const map = new THREE.CanvasTexture(ground2d.canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const mesh = new THREE.Mesh(geometry, createValleyMaterial({ map, brush: 0.12 }));
  mesh.receiveShadow = true;
  mesh.name = 'valley-terrain';
  const out = { mesh, map, sample: ground2d.sample, sampleGrass: ground2d.sampleGrass, isPath: ground2d.isPath };
  /** Paint the ground again with a season's surface colours (V5). */
  out.repaint = (seasonSurface) => {
    const next = paintGround(ground, layout, mapSize, objects, { ...S, ...seasonSurface });
    map.image = next.canvas;
    map.needsUpdate = true;
    Object.assign(out, { sample: next.sample, sampleGrass: next.sampleGrass });
  };
  return out;
}

function paintGround(ground, layout, mapSize, objects, S) {
  const { size, half, heightAt, riverDistance, water } = ground;
  const noise = createNoise3D(layout.seed + 11).noise;
  const c = Object.fromEntries(Object.entries(S).map(([k, v]) => [k, rgb(v)]));
  const base = 1024, img = new ImageData(base, base), px = img.data, tmp = [0, 0, 0];
  const metres = size / base;
  for (let j = 0; j < base; j++) for (let i = 0; i < base; i++) {
    const x = -half + (i + 0.5) * metres, z = -half + (j + 0.5) * metres;
    const h = heightAt(x, z);
    const slope = Math.hypot(heightAt(x + 0.5, z) - heightAt(x - 0.5, z), heightAt(x, z + 0.5) - heightAt(x, z - 0.5));
    // Grass: broad light/dark patches plus a finer mottling, like layered washes
    const broad = noise(x * 0.045, 0, z * 0.045), fine = noise(x * 0.22, 5, z * 0.22);
    mixInto(tmp, c.grass, broad > 0 ? c.grassLight : c.grassDark, Math.min(1, Math.abs(broad) * 1.8));
    let r = tmp[0], g = tmp[1], b = tmp[2];
    const f = 1 + fine * 0.07;
    r *= f; g *= f; b *= f;
    // Hills drift towards a cooler, lighter green with height (aerial perspective)
    const up = smooth(1.5, 14, h);
    r += (c.hill.r - r) * up * 0.6; g += (c.hill.g - g) * up * 0.6; b += (c.hill.b - b) * up * 0.6;
    const far = smooth(10, 20, h);
    r += (c.hillFar.r - r) * far * 0.45; g += (c.hillFar.g - g) * far * 0.45; b += (c.hillFar.b - b) * far * 0.45;
    // Steeper ground darkens a little; the river bank turns to sand, wet just above the water line
    const steep = 1 - Math.min(0.18, slope * 0.25);
    r *= steep; g *= steep; b *= steep;
    const bank = 1 - smooth(water + 0.45, water + 1.0, h);
    const nearRiver = 1 - smooth(layout.river.width / 2 + 1.2, layout.river.width / 2 + 3.5, riverDistance(x, z));
    const k = bank * nearRiver;
    r += (c.bank.r - r) * k; g += (c.bank.g - g) * k; b += (c.bank.b - b) * k;
    const wet = (1 - smooth(water, water + 0.22, h)) * nearRiver;
    r *= 1 - wet * 0.25; g *= 1 - wet * 0.2; b *= 1 - wet * 0.12;
    const o = (j * base + i) * 4;
    px[o] = r * 255; px[o + 1] = g * 255; px[o + 2] = b * 255; px[o + 3] = 255;
  }
  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = baseCanvas.height = base;
  baseCanvas.getContext('2d').putImageData(img, 0, 0);

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = mapSize;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(baseCanvas, 0, 0, mapSize, mapSize);
  // From here on, draw in metres
  ctx.setTransform(mapSize / size, 0, 0, mapSize / size, half * mapSize / size, half * mapSize / size);
  const rng = mulberry32(layout.seed + 29);
  const css = (hex, a = 1) => {
    const col = new THREE.Color(hex).convertLinearToSRGB();
    return `rgba(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)},${a})`;
  };

  // Worn soil around the house: a soft halo, darkest at the door
  const halo = (x, z, r, alpha = 0.55) => {
    const glow = ctx.createRadialGradient(x, z, 0.5, x, z, r);
    glow.addColorStop(0, css(S.dirt, alpha));
    glow.addColorStop(1, css(S.dirt, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(x - r, z - r, r * 2, r * 2);
  };
  const house = ground.pads.get('house');
  if (house) halo(house.x - 1.3, house.z + house.d / 2, 4.5);
  for (const id of ['barn', 'coop']) {
    const pad = ground.pads.get(id);
    if (pad) halo(pad.x, pad.z + pad.d / 2, id === 'barn' ? 5 : 3, 0.5);
  }

  // Village square: packed earth with a lighter middle and scattered cobbles, ragged at the rim
  for (const f of ground.features.filter((f) => f.placed)) {
    const pad = ground.pads.get(f.id), rx = pad.w / 2 - 2.5, rz = pad.d / 2 - 2.5;
    ctx.fillStyle = css(S.dirtDark, 0.45);
    ctx.beginPath();
    ctx.ellipse(pad.x, pad.z, rx + 0.4, rz + 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let k = 0; k < 140; k++) {
      const a = (k / 140) * Math.PI * 2, r = 0.25 + rng() * 0.45;
      ctx.fillStyle = css(S.dirt);
      ctx.beginPath();
      ctx.ellipse(pad.x + Math.cos(a) * (rx + 0.2), pad.z + Math.sin(a) * (rz + 0.2), r * 1.3, r, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = css(S.dirt);
    ctx.beginPath();
    ctx.ellipse(pad.x, pad.z, rx, rz, 0, 0, Math.PI * 2);
    ctx.fill();
    const mid = ctx.createRadialGradient(pad.x, pad.z, 0, pad.x, pad.z, Math.max(rx, rz));
    mid.addColorStop(0, css(S.dirtLight, 0.6));
    mid.addColorStop(1, css(S.dirtLight, 0));
    ctx.fillStyle = mid;
    ctx.fillRect(pad.x - rx, pad.z - rz, rx * 2, rz * 2);
    for (let k = 0; k < 900; k++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng());
      ctx.fillStyle = rng() < 0.5 ? css(S.dirtLight, 0.9) : css(S.dirtDark, 0.55);
      ctx.beginPath();
      ctx.ellipse(pad.x + Math.cos(a) * r * rx * 0.95, pad.z + Math.sin(a) * r * rz * 0.95, 0.08 + rng() * 0.12, 0.06 + rng() * 0.09, rng() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Painted occlusion: the ground darkens softly at the foot of trees, buildings and rocks
  // (the baked look of the reference; the shadow map adds the sun's shadow on top)
  ctx.globalCompositeOperation = 'multiply';
  const darken = (x, z, rx, rz, strength) => {
    ctx.save();
    ctx.translate(x, z);
    ctx.scale(1, rz / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, `rgba(96,84,112,${strength})`);
    g.addColorStop(1, 'rgba(96,84,112,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
    ctx.restore();
  };
  for (const o of objects) {
    const s = o.s || 1;
    if (o.kit.startsWith('tree_')) darken(o.x, o.z, 1.9 * s, 1.9 * s, 0.55);
    else if (o.kit.startsWith('bush')) darken(o.x, o.z, 0.9 * s, 0.9 * s, 0.5);
    else if (o.kit.startsWith('rock')) darken(o.x, o.z, 1.0 * s, 1.0 * s, 0.45);
    else if (FOOTPRINTS[o.kit]) {
      const [w, d] = FOOTPRINTS[o.kit];
      const a = (o.rot || 0) * Math.PI / 180, horizontal = Math.abs(Math.sin(a)) > 0.7;
      darken(o.x, o.z, (horizontal ? d : w) / 2 + 1.4, (horizontal ? w : d) / 2 + 1.4, 0.5);
    }
  }
  ctx.globalCompositeOperation = 'source-over';

  // Field: tilled soil with furrows every 0.5 m and a soft lip
  for (const f of layout.fields) {
    ctx.fillStyle = css(S.dirtDark, 0.5);
    roundRect(ctx, f.x - f.w / 2 - 0.35, f.z - f.d / 2 - 0.35, f.w + 0.7, f.d + 0.7, 0.6);
    ctx.fill();
    // Untilled: flat soil with a few clods; the hoe raises tilled mounds on top (world/fieldView.js)
    ctx.fillStyle = css(S.dirtDark);
    roundRect(ctx, f.x - f.w / 2, f.z - f.d / 2, f.w, f.d, 0.35);
    ctx.fill();
    for (let k = 0; k < 260; k++) {
      ctx.fillStyle = rng() < 0.5 ? css(S.field, 0.6) : css(S.dirt, 0.5);
      ctx.beginPath();
      ctx.ellipse(f.x + (rng() - 0.5) * f.w * 0.95, f.z + (rng() - 0.5) * f.d * 0.95, 0.06 + rng() * 0.09, 0.04 + rng() * 0.06, rng() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Paths: a darker underlay, ragged lobes along both edges, the dirt itself, then pebbles
  ctx.lineCap = ctx.lineJoin = 'round';
  // A path rerouted over a bridge is painted in two pieces: nothing on the river bed under the deck
  const pieces = ground.paths.flatMap((p) => (p.deck === undefined ? [p] : [{ ...p, points: p.points.slice(0, p.deck + 1) }, { ...p, points: p.points.slice(p.deck + 1) }]));
  for (const p of pieces) {
    stroke(ctx, p.points, p.width + 0.35, css(S.dirtDark, 0.55));
    lobes(ctx, p, rng, css(S.dirt));
    stroke(ctx, p.points, p.width, css(S.dirt));
    stroke(ctx, p.points, p.width * 0.45, css(S.dirtLight, 0.45));
    for (let i = 0; i < p.width * 60; i++) dots(ctx, p, rng, rng() < 0.5 ? css(S.dirtLight, 0.8) : css(S.dirtDark, 0.6));
  }

  const sampleCtx = canvas.getContext('2d', { willReadFrequently: true });
  const data = sampleCtx.getImageData(0, 0, mapSize, mapSize).data;
  /** Painted ground colour (linear) under a point. */
  const sample = (x, z, out = new THREE.Color()) => {
    const i = Math.min(mapSize - 1, Math.max(0, Math.floor((x + half) / size * mapSize)));
    const j = Math.min(mapSize - 1, Math.max(0, Math.floor((z + half) / size * mapSize)));
    const o = (j * mapSize + i) * 4;
    return out.setRGB(data[o] / 255, data[o + 1] / 255, data[o + 2] / 255, THREE.SRGBColorSpace);
  };
  /** The grass colour before paths and soil were drawn: what a tuft at the edge should take. */
  const sampleGrass = (x, z, out = new THREE.Color()) => {
    const i = Math.min(base - 1, Math.max(0, Math.floor((x + half) / size * base)));
    const j = Math.min(base - 1, Math.max(0, Math.floor((z + half) / size * base)));
    const o = (j * base + i) * 4;
    return out.setRGB(px[o] / 255, px[o + 1] / 255, px[o + 2] / 255, THREE.SRGBColorSpace);
  };
  const isPath = (x, z, pad = 0) => ground.paths.some((p) => polylineDistance(p.points, x, z) < p.width / 2 + pad);
  return { canvas, sample, sampleGrass, isPath };
}

function stroke(ctx, points, width, style) {
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.beginPath();
  points.forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)));
  ctx.stroke();
}

/** Walk along a path, calling fn(x, z, nx, nz) every `step` metres (n = left normal). */
function walk(points, step, fn) {
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1], [bx, bz] = points[i];
    const len = Math.hypot(bx - ax, bz - az);
    for (let d = 0; d < len; d += step) {
      const t = d / len;
      fn(ax + (bx - ax) * t, az + (bz - az) * t, -(bz - az) / len, (bx - ax) / len);
    }
  }
}

/** Ragged edge: small dirt lobes bulging out of both sides (dense grass tufts cover the rest). */
function lobes(ctx, p, rng, style) {
  walk(p.points, 0.45, (x, z, nx, nz) => {
    for (const side of [-1, 1]) {
      if (rng() < 0.35) continue;
      const r = 0.08 + rng() * 0.16;
      const off = side * (p.width / 2 + r * 0.1);
      const cx = x + nx * off + (rng() - 0.5) * 0.3, cz = z + nz * off + (rng() - 0.5) * 0.3;
      ctx.beginPath();
      ctx.ellipse(cx, cz, r * 1.4, r * 0.8, Math.atan2(nz, nx) + Math.PI / 2, 0, Math.PI * 2);
      ctx.fillStyle = style;
      ctx.fill();
    }
  });
}

function dots(ctx, p, rng, style) {
  const seg = 1 + Math.floor(rng() * (p.points.length - 1));
  const [ax, az] = p.points[seg - 1], [bx, bz] = p.points[seg];
  const t = rng(), len = Math.hypot(bx - ax, bz - az) || 1;
  const nx = -(bz - az) / len, nz = (bx - ax) / len, off = (rng() - 0.5) * p.width * 0.85;
  ctx.fillStyle = style;
  ctx.beginPath();
  ctx.ellipse(ax + (bx - ax) * t + nx * off, az + (bz - az) * t + nz * off, 0.03 + rng() * 0.05, 0.02 + rng() * 0.04, rng() * 3, 0, Math.PI * 2);
  ctx.fill();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
