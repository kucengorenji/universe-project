import { MAP_COLORS as C } from '../../../art/palette.js';
import { townSurfaceHeight } from '../../../world/townRelief.js';
import { mulberry32 } from '../../../math/random.js';

// Top-down plan of a town layout on a 2D canvas, in the manner of Watabou's
// village maps: painted terrain with shoreline rings and dotted contours,
// ploughed fields, cream roads, hatched roofs with drop shadows and scalloped
// tree canopies. It reads the same layout data the 3D town is built from, so
// what the player approves here is what they walk through (roof colours
// included: b.roof).

const CONIFER = /^t_(pine|spruce|cypress)/;
const MODERN_ROOF = '#b7b2a8';
const LANDMARK_ROOF = { f_castle: '#4d6a96', f_temple: '#b0573d', f_tower: '#5f6671' };

/** Metres shown from the centre to each edge of the plan. */
export function planExtent(L) {
  // The settlement and its first ring of fields, as in the reference village maps
  return Math.min(L.dioramaR, Math.max(170, L.cityR * 1.3 + 80));
}

/**
 * Draw layout L into ctx (a square of `size` CSS pixels, already scaled for
 * device pixels). footprints: pack bounding boxes per asset, as used by the layout.
 */
export function drawTownMap(ctx, L, { size, footprints = {}, title = '', subtitle = '' }) {
  const R = planExtent(L);
  const k = size / (2 * R); // px per metre
  const X = (x) => (x + R) * k;
  const Y = (z) => (z + R) * k;
  ctx.save();
  ctx.clearRect(0, 0, size, size);
  drawTerrain(ctx, L, R, size);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  drawFields(ctx, L, X, Y, k);
  drawWater(ctx, L, X, Y, k);
  drawParks(ctx, L, X, Y);
  drawRoads(ctx, L, X, Y, k);
  drawDocks(ctx, L, X, Y, k);
  drawWalls(ctx, L, X, Y, k);
  drawBuildings(ctx, L, X, Y, k, footprints);
  drawTrees(ctx, L, X, Y, k, R);
  drawLegend(ctx, L, size, k, title, subtitle);
  ctx.restore();
}

// ---------------------------------------------------------------- terrain

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const smooth = (x, a, b) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Painted ground raster, then shoreline rings and dotted contours traced on the same grid. */
function drawTerrain(ctx, L, R, size) {
  const N = 180;
  const cell = (2 * R) / N;
  const S = {};
  const land = new Float32Array((N + 1) * (N + 1));
  const height = new Float32Array((N + 1) * (N + 1));
  const img = new ImageData(N, N);
  const meadow = rgb(C.meadow), light = rgb(C.meadowLight), dark = rgb(C.meadowDark);
  const sand = rgb(C.sand), shallow = rgb(C.waterShallow), deep = rgb(C.waterDeep);
  const rock = [150, 142, 128], snow = [236, 240, 238], desert = [222, 196, 142];
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const x = -R + i * cell, z = -R + j * cell;
      const s = L.fields.sample(x, z, S);
      land[j * (N + 1) + i] = s.land;
      height[j * (N + 1) + i] = townSurfaceHeight(L.relief, x, z, s.land) + s.mountain * 26;
      if (i === N || j === N) continue;
      let c;
      if (s.land < 0.5) c = mix(deep, shallow, smooth(s.land, 0.12, 0.49));
      else if (s.land < 0.56 && s.beach + s.desert > 0.2) c = sand;
      else {
        // A soft light in the middle of the plan, like the reference maps
        const glow = 1 - Math.min(1, Math.hypot(x, z) / (R * 1.1));
        c = mix(dark, meadow, 0.55 + glow * 0.45);
        c = mix(c, light, glow * 0.35 * (1 - s.forest));
        c = mix(c, dark, s.forest * 0.45);
        c = mix(c, rock, Math.min(1, s.mountain * 0.9));
        c = mix(c, desert, s.desert * 0.8);
        c = mix(c, snow, s.tundra * 0.85);
        if (s.land < 0.54) c = mix(c, sand, 0.5);
      }
      const o = (j * N + i) * 4;
      img.data[o] = c[0];
      img.data[o + 1] = c[1];
      img.data[o + 2] = c[2];
      img.data[o + 3] = 255;
    }
  }
  const off = document.createElement('canvas');
  off.width = off.height = N;
  off.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(off, 0, 0, size, size);

  const px = size / N;
  const trace = (field, level) => isoLines(field, N, level).map((seg) => seg.map(([i, j]) => [i * px, j * px]));
  // Shore: one firm outline plus fainter rings out in the water
  ctx.lineWidth = Math.max(1, size / 700);
  ctx.strokeStyle = 'rgba(40, 70, 72, 0.55)';
  strokeSegments(ctx, trace(land, 0.5));
  ctx.strokeStyle = C.waterLine;
  for (const [level, alpha] of [[0.47, 0.8], [0.43, 0.45], [0.37, 0.25]]) {
    ctx.globalAlpha = alpha;
    strokeSegments(ctx, trace(land, level));
  }
  ctx.globalAlpha = 1;
  // Dotted contours every 3 m of relief on dry land
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < height.length; i++) if (land[i] > 0.55) { lo = Math.min(lo, height[i]); hi = Math.max(hi, height[i]); }
  if (hi - lo > 2) {
    ctx.strokeStyle = C.contour;
    ctx.setLineDash([1, size / 250]);
    ctx.lineWidth = Math.max(1, size / 600);
    for (let h = Math.ceil(lo / 3) * 3; h < hi; h += 3) {
      strokeSegments(ctx, trace(height, h).filter((seg) => {
        const [i, j] = [Math.round(seg[0][0] / px), Math.round(seg[0][1] / px)];
        return land[Math.min(N, j) * (N + 1) + Math.min(N, i)] > 0.55;
      }));
    }
    ctx.setLineDash([]);
  }
}

/** Marching squares: segments where a (N+1)² grid field crosses `level`, in grid units. */
function isoLines(f, N, level) {
  const out = [];
  const W = N + 1;
  const lerp = (a, b) => (level - a) / (b - a || 1e-6);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = f[j * W + i], b = f[j * W + i + 1], c = f[(j + 1) * W + i + 1], d = f[(j + 1) * W + i];
      const idx = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const top = [i + lerp(a, b), j], right = [i + 1, j + lerp(b, c)], bottom = [i + lerp(d, c), j + 1], left = [i, j + lerp(a, d)];
      const cases = {
        1: [[left, bottom]], 2: [[bottom, right]], 3: [[left, right]], 4: [[top, right]], 5: [[left, top], [bottom, right]],
        6: [[top, bottom]], 7: [[left, top]], 8: [[left, top]], 9: [[top, bottom]], 10: [[top, right], [left, bottom]],
        11: [[top, right]], 12: [[left, right]], 13: [[bottom, right]], 14: [[left, bottom]]
      };
      out.push(...cases[idx]);
    }
  }
  return out;
}

function strokeSegments(ctx, segs) {
  ctx.beginPath();
  for (const [a, b] of segs) {
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
  }
  ctx.stroke();
}

// ---------------------------------------------------------------- shapes

const pathOf = (ctx, pts, X, Y) => {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = Array.isArray(p) ? p[0] : p.x, z = Array.isArray(p) ? p[1] : p.z;
    i ? ctx.lineTo(X(x), Y(z)) : ctx.moveTo(X(x), Y(z));
  });
};

/** Corners of a rotated rectangle, layout convention: local X = (cos yaw, sin yaw). */
function rectCorners(cx, cz, hw, hd, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => [cx + u * c - v * s, cz + u * s + v * c]);
}

function drawFields(ctx, L, X, Y, k) {
  const rng = mulberry32(L.seed + 91);
  const furrows = (poly, yaw, fill) => {
    ctx.save();
    pathOf(ctx, poly, X, Y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = C.fieldLine;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = Math.max(0.7, k * 0.3);
    const xs = poly.map((p) => (Array.isArray(p) ? p[0] : p.x)), zs = poly.map((p) => (Array.isArray(p) ? p[1] : p.z));
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const r = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
    const c = Math.cos(yaw), s = Math.sin(yaw);
    ctx.beginPath();
    for (let o = -r; o <= r; o += 4.2) {
      ctx.moveTo(X(cx - s * o - c * r), Y(cz + c * o - s * r));
      ctx.lineTo(X(cx - s * o + c * r), Y(cz + c * o + s * r));
    }
    ctx.stroke();
    ctx.restore();
    pathOf(ctx, poly, X, Y);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(60, 45, 38, 0.45)';
    ctx.lineWidth = Math.max(0.8, k * 0.35);
    ctx.stroke();
  };
  for (const cell of L.farmCells || []) furrows(cell.poly, rng() * Math.PI, rng() < 0.3 ? C.fieldGreen : C.field);
  for (const f of L.fields2 || []) furrows(rectCorners(f.x, f.z, f.w / 2, f.d / 2, f.yaw), f.yaw, f.crop === 'wheat' ? '#b39a6a' : C.field);
}

function drawWater(ctx, L, X, Y, k) {
  for (const r of L.rivers || []) {
    pathOf(ctx, r.pts, X, Y);
    ctx.strokeStyle = 'rgba(40, 70, 72, 0.55)';
    ctx.lineWidth = (r.w + 1.6) * k;
    ctx.stroke();
    ctx.strokeStyle = C.waterShallow;
    ctx.lineWidth = r.w * k;
    ctx.stroke();
    ctx.strokeStyle = C.waterLine;
    ctx.lineWidth = Math.max(1, k * 0.5);
    ctx.stroke();
  }
}

function drawParks(ctx, L, X, Y) {
  ctx.fillStyle = C.meadowLight;
  for (const p of L.parks || []) {
    if (!p.poly) continue;
    pathOf(ctx, p.poly, X, Y);
    ctx.closePath();
    ctx.fill();
  }
}

function drawRoads(ctx, L, X, Y, k) {
  const streets = L.streets || [];
  const width = (s) => Math.max(1.2, s.w * k);
  // Outline pass, then the surface, so junctions merge into one network
  ctx.strokeStyle = C.roadEdge;
  for (const s of streets) {
    pathOf(ctx, s.pts, X, Y);
    ctx.lineWidth = width(s) + Math.max(1.2, k * 1.1);
    ctx.stroke();
  }
  if (L.plaza?.poly) {
    pathOf(ctx, L.plaza.poly, X, Y);
    ctx.closePath();
    ctx.fillStyle = C.plaza;
    ctx.fill();
    ctx.lineWidth = Math.max(1, k * 0.6);
    ctx.stroke();
  } else if (L.plaza?.r) {
    ctx.beginPath();
    ctx.arc(X(L.plaza.x), Y(L.plaza.z), L.plaza.r * k, 0, Math.PI * 2);
    ctx.fillStyle = C.plaza;
    ctx.fill();
    ctx.lineWidth = Math.max(1, k * 0.6);
    ctx.stroke();
  }
  for (const s of streets) {
    pathOf(ctx, s.pts, X, Y);
    ctx.strokeStyle = L.modern && s.kind !== 'road' ? '#8f9094' : C.road;
    ctx.lineWidth = width(s);
    ctx.stroke();
  }
  // Footpaths: thin and dotted, as in the reference maps
  ctx.strokeStyle = C.path;
  ctx.setLineDash([k * 1.6, k * 1.4]);
  for (const p of L.paths || []) {
    if (!p.pts) continue;
    pathOf(ctx, p.pts, X, Y);
    ctx.lineWidth = Math.max(1, (p.w || 1.5) * k * 0.8);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function drawDocks(ctx, L, X, Y, k) {
  for (const d of L.docks || []) {
    const len = d.len || 20, w = d.asset === 'm_dock' ? 6 : 3.2;
    const c = Math.cos(d.yaw), s = Math.sin(d.yaw);
    const pts = rectCorners(d.x, d.z, len / 2, w / 2, d.yaw);
    pathOf(ctx, pts, X, Y);
    ctx.closePath();
    ctx.fillStyle = C.dock;
    ctx.fill();
    ctx.strokeStyle = C.outline;
    ctx.lineWidth = Math.max(1, k * 0.35);
    ctx.stroke();
    ctx.beginPath();
    for (let t = -len / 2 + 0.7; t < len / 2; t += 1.4) {
      ctx.moveTo(X(d.x + c * t - s * w / 2), Y(d.z + s * t + c * w / 2));
      ctx.lineTo(X(d.x + c * t + s * w / 2), Y(d.z + s * t - c * w / 2));
    }
    ctx.globalAlpha = 0.45;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawWalls(ctx, L, X, Y, k) {
  for (const w of L.walls || []) {
    const c = Math.cos(w.yaw) * w.len / 2, s = Math.sin(w.yaw) * w.len / 2;
    ctx.beginPath();
    ctx.moveTo(X(w.x - c), Y(w.z - s));
    ctx.lineTo(X(w.x + c), Y(w.z + s));
    const thick = w.asset === 'f_palisade' ? 0.9 : 2.2;
    ctx.strokeStyle = C.outline;
    ctx.lineWidth = (thick + 0.8) * k;
    ctx.stroke();
    ctx.strokeStyle = w.asset === 'f_palisade' ? '#8a6a48' : C.wall;
    ctx.lineWidth = thick * k;
    ctx.stroke();
  }  // Field fences (hedges draw as bushes with the trees)
  ctx.strokeStyle = '#7a5a3a';
  ctx.lineWidth = Math.max(0.8, k * 0.3);
  ctx.setLineDash([Math.max(2, k * 1.2), Math.max(1, k * 0.5)]);
  ctx.beginPath();
  for (const h of L.hedges || []) {
    if (h.kind !== 'fence') continue;
    ctx.moveTo(X(h.ax), Y(h.az));
    ctx.lineTo(X(h.bx), Y(h.bz));
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

// ---------------------------------------------------------------- buildings

function footprintRect(b, footprints) {
  const f = footprints[b.asset];
  const sx = b.sx ?? 1, sz = b.sz ?? 1;
  // Without a measured footprint, b.w / b.d are already the placed (stretched) size
  if (!f || !Number.isFinite(f.minX)) return { x: b.x, z: b.z, hw: b.w / 2, hd: b.d / 2, yaw: b.yaw };
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  const cx = ((f.maxX + f.minX) / 2) * sx, cz = ((f.maxZ + f.minZ) / 2) * sz;
  return { x: b.x + c * cx - s * cz, z: b.z + s * cx + c * cz, hw: ((f.maxX - f.minX) / 2) * sx, hd: ((f.maxZ - f.minZ) / 2) * sz, yaw: b.yaw };
}

function drawBuildings(ctx, L, X, Y, k, footprints) {
  const items = [
    ...L.buildings.map((b) => ({ b, r: footprintRect(b, footprints) })),
    ...L.props.filter((p) => /^(f_wall_tower|f_gate|f_well|f_market_stall)$/.test(p.asset)).map((b) => ({ b, r: footprintRect(b, footprints) }))
  ];
  const shadow = 1.6; // metres, toward the lower right
  ctx.fillStyle = C.shadow;
  for (const { r } of items) {
    pathOf(ctx, rectCorners(r.x + shadow, r.z + shadow, r.hw, r.hd, r.yaw), X, Y);
    ctx.closePath();
    ctx.fill();
  }
  for (const { b, r } of items) {
    const round = b.asset === 'f_wall_tower' || b.asset === 'f_well' || b.asset === 'f_tower';
    const fill = b.roof || LANDMARK_ROOF[b.asset] || (b.asset === 'f_market_stall' ? '#c9b48a' : L.modern ? MODERN_ROOF : '#a0583e');
    ctx.fillStyle = fill;
    ctx.strokeStyle = C.outline;
    ctx.lineWidth = Math.max(0.8, k * 0.35);
    if (round) {
      ctx.beginPath();
      ctx.arc(X(r.x), Y(r.z), Math.max(r.hw, r.hd) * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      continue;
    }
    const pts = rectCorners(r.x, r.z, r.hw, r.hd, r.yaw);
    pathOf(ctx, pts, X, Y);
    ctx.closePath();
    ctx.fill();
    const small = Math.min(r.hw, r.hd) * 2 * k < 9; // too small on screen for ridge and planks
    if (small) {
      ctx.lineWidth = 0.6;
      ctx.stroke();
      continue;
    }
    if (/^m_/.test(b.asset)) {
      // Flat roofs: a parapet line and a plant room
      const inset = rectCorners(r.x, r.z, Math.max(0.5, r.hw - 1), Math.max(0.5, r.hd - 1), r.yaw);
      pathOf(ctx, inset, X, Y);
      ctx.closePath();
      ctx.globalAlpha = 0.35;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.stroke();
      pathOf(ctx, pts, X, Y);
      ctx.closePath();
      ctx.stroke();
      continue;
    }
    // Pitched roof: ridge along the long side, plank hatching down each slope
    const alongX = r.hw >= r.hd;
    const c = Math.cos(r.yaw), s = Math.sin(r.yaw);
    const ax = alongX ? [c, s] : [-s, c]; // ridge direction
    const nx = alongX ? [-s, c] : [c, s]; // across the ridge
    const half = alongX ? r.hw : r.hd, depth = alongX ? r.hd : r.hw;
    ctx.save();
    pathOf(ctx, pts, X, Y);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.16)'; // the slope away from the light
    ctx.beginPath();
    const q = (u, v) => [X(r.x + ax[0] * u + nx[0] * v), Y(r.z + ax[1] * u + nx[1] * v)];
    ctx.moveTo(...q(-half, 0));
    ctx.lineTo(...q(half, 0));
    ctx.lineTo(...q(half, depth));
    ctx.lineTo(...q(-half, depth));
    ctx.fill();
    ctx.strokeStyle = 'rgba(30, 25, 22, 0.45)';
    ctx.lineWidth = Math.max(0.6, k * 0.18);
    ctx.beginPath();
    for (let u = -half + 0.9; u < half; u += 1.1) {
      ctx.moveTo(...q(u, -depth));
      ctx.lineTo(...q(u, depth));
    }
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(...q(-half, 0));
    ctx.lineTo(...q(half, 0));
    ctx.strokeStyle = C.outline;
    ctx.lineWidth = Math.max(0.8, k * 0.3);
    ctx.stroke();
    pathOf(ctx, pts, X, Y);
    ctx.closePath();
    ctx.lineWidth = Math.max(0.8, k * 0.35);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------- trees

function canopy(ctx, x, y, r, rng) {
  // Scalloped outline: a ring of bumps around a full disc
  const n = 7;
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r * 0.78, 0, Math.PI * 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.3;
    const bx = x + Math.cos(a) * r * 0.62, by = y + Math.sin(a) * r * 0.62;
    ctx.moveTo(bx + r * 0.42, by);
    ctx.arc(bx, by, r * 0.42, 0, Math.PI * 2);
  }
}

function drawTrees(ctx, L, X, Y, k, R) {
  const rng = mulberry32(L.seed + 17);
  const trees = (L.trees || []).filter((t) => Math.abs(t.x) < R + 10 && Math.abs(t.z) < R + 10 && !/^(b_flowers|g_)/.test(t.asset));
  trees.sort((a, b) => a.z - b.z);
  // Canopies drawn a little larger than the trunk spacing so groves merge into masses
  const radius = (t) => (t.asset.startsWith('b_') ? Math.max(1, (t.w || 2) * 0.55) : Math.min(7, Math.max(2.4, (t.w || 3) * 0.95)));
  ctx.fillStyle = C.shadow;
  ctx.beginPath();
  for (const t of trees) {
    if (t.asset.startsWith('r_')) continue;
    const r = radius(t) * k;
    ctx.moveTo(X(t.x) + r * 0.45 + r, Y(t.z) + r * 0.45);
    ctx.arc(X(t.x) + r * 0.45, Y(t.z) + r * 0.45, r, 0, Math.PI * 2);
  }
  ctx.fill();
  for (const t of trees) {
    const x = X(t.x), y = Y(t.z), r = radius(t) * k;
    const lw = Math.min(Math.max(0.5, k * 0.28), r * 0.14);
    if (t.asset.startsWith('r_')) {
      ctx.beginPath();
      ctx.ellipse(x, y, r * 0.8, r * 0.6, t.yaw || 0, 0, Math.PI * 2);
      ctx.fillStyle = '#9b958a';
      ctx.fill();
      ctx.strokeStyle = C.outline;
      ctx.lineWidth = lw;
      ctx.stroke();
      continue;
    }
    const conifer = CONIFER.test(t.asset);
    const autumn = (t.asset === 't_oak' && t.variant === 2) || (t.asset === 't_birch' && t.variant === 1);
    const base = autumn ? '#b8773f' : conifer ? C.treeDark : t.asset.startsWith('b_') ? '#5f8c60' : C.tree;
    ctx.beginPath();
    canopy(ctx, x, y, r, rng);
    ctx.fillStyle = base;
    ctx.fill();
    ctx.strokeStyle = C.outline;
    ctx.lineWidth = lw;
    ctx.stroke();
    // Light from the upper left, a dab of highlight
    if (r < 2.5) continue;
    ctx.beginPath();
    ctx.arc(x - r * 0.25, y - r * 0.28, r * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = autumn ? '#d49a55' : conifer ? '#40705a' : C.treeLight;
    ctx.globalAlpha = 0.7;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------- legend

function drawLegend(ctx, L, size, k, title, subtitle) {
  const pad = size * 0.03;
  ctx.fillStyle = C.label;
  ctx.textBaseline = 'top';
  ctx.font = `500 ${Math.round(size * 0.042)}px "Barlow Condensed", "Archivo Narrow", sans-serif`;
  ctx.fillText(title.toUpperCase(), pad, pad);
  ctx.font = `400 ${Math.round(size * 0.022)}px "Barlow Condensed", "Archivo Narrow", sans-serif`;
  if (subtitle) ctx.fillText(subtitle.toUpperCase(), pad, pad + size * 0.045);
  // Scale bar: 50 m
  const m = 50 * k;
  const x0 = pad, y0 = size - pad;
  ctx.strokeStyle = C.label;
  ctx.lineWidth = Math.max(1.5, size / 500);
  ctx.beginPath();
  ctx.moveTo(x0, y0 - 6);
  ctx.lineTo(x0, y0);
  ctx.lineTo(x0 + m, y0);
  ctx.lineTo(x0 + m, y0 - 6);
  ctx.stroke();
  ctx.textBaseline = 'bottom';
  ctx.fillText('50 m', x0 + m + 6, y0 + 2);
}
