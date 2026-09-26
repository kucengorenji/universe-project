import * as THREE from 'three';
import { mulberry32 } from '../../map/mapGenerator.js';

// Streets, pavements, road markings, plazas and fields are painted into
// textures laid over the terrain instead of being separate ribbons: crossings
// merge into one surface (no z-fighting), and markings cost no geometry.
//
// Two layers: a sharp one over the town, a coarse one over the surroundings.
// Texel (i, j) covers world x = x0 + (i + 0.5) * m, z = z0 + (j + 0.5) * m
// (flipY off, so row 0 is the smallest z).

const STREET_STYLE = {
  fantasy: {
    road: { fill: '#b8905a', edge: '#a07a48' },
    lane: { fill: '#c3a377', edge: '#b08e62' },
    ring: { fill: '#bba88b', edge: '#9e8f76' },
    main: { fill: '#aa9e8a', edge: '#857a69' }
  },
  modern: {
    road: { fill: '#5b5e64', edge: '#4a4c52' },
    grid: { fill: '#4d4f55', edge: '#c9c6bd' },
    main: { fill: '#46484e', edge: '#c9c6bd' }
  }
};

function cobblePattern(ctx, base, dark, scale) {
  const c = document.createElement('canvas');
  const n = Math.max(8, Math.round(24 * scale));
  c.width = c.height = n * 4;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, c.width, c.height);
  const rng = mulberry32(99);
  g.strokeStyle = dark;
  g.lineWidth = Math.max(1, scale * 1.2);
  // Staggered rows of rounded setts
  for (let row = 0; row < 8; row++) {
    const y = (row + 0.5) * (c.height / 8);
    const off = row % 2 ? n / 2 : 0;
    for (let x = -n; x < c.width + n; x += n) {
      const w = n * (0.8 + rng() * 0.15);
      g.beginPath();
      g.ellipse(x + off + n / 2, y, w / 2, c.height / 16 - 0.5, 0, 0, Math.PI * 2);
      g.stroke();
    }
  }
  return ctx.createPattern(c, 'repeat');
}

function tilePattern(ctx, base, line, px) {
  const c = document.createElement('canvas');
  const n = Math.max(4, Math.round(px));
  c.width = c.height = n;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, n, n);
  g.fillStyle = line;
  g.fillRect(0, 0, n, Math.max(1, n / 12));
  g.fillRect(0, 0, Math.max(1, n / 12), n);
  return ctx.createPattern(c, 'repeat');
}

export class GroundPaint {
  /**
   * @param layout town layout
   * @param opts.res texture size of the town layer
   */
  constructor(layout, { res = 2048, farRes = 1024, farRadius = 1100 }) {
    this.L = layout;
    const nearHalf = Math.min(620, Math.max(160, layout.cityR + 90));
    this.near = this.layer(-nearHalf, -nearHalf, nearHalf * 2, res, true);
    this.far = this.layer(-farRadius, -farRadius, farRadius * 2, farRes, false);
  }

  /** Paint one layer; `detail` adds markings, patterns and fields. */
  layer(x0, z0, size, res, detail) {
    const L = this.L;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = res;
    const ctx = canvas.getContext('2d');
    const m = size / res; // metres per texel
    const px = (v) => v / m;
    ctx.setTransform(1 / m, 0, 0, 1 / m, -x0 / m, -z0 / m); // draw in world metres
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const style = STREET_STYLE[L.modern ? 'modern' : 'fantasy'];
    const path = (pts) => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    };

    if (detail) this.paintFields(ctx, m);

    // Streets: kerb / pavement pass first for every street, then the surfaces,
    // so junctions merge into one clean shape.
    const order = L.modern ? ['road', 'grid', 'main'] : ['road', 'lane', 'ring', 'main'];
    const streets = [...L.streets].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    const kerb = L.modern ? 2.4 : 0.6;
    for (const s of streets) {
      const st = style[s.kind] || style.road;
      path(s.pts);
      ctx.strokeStyle = st.edge;
      ctx.lineWidth = s.w + (s.kind === 'road' ? 0.8 : kerb * 2);
      ctx.stroke();
    }
    for (const s of streets) {
      const st = style[s.kind] || style.road;
      path(s.pts);
      ctx.strokeStyle = st.fill;
      ctx.lineWidth = s.w;
      ctx.stroke();
    }
    if (detail && !L.modern) {
      // Cobbles on the main streets: pattern masked by the street shape
      const mask = document.createElement('canvas');
      mask.width = mask.height = canvas.width;
      const mc = mask.getContext('2d');
      mc.setTransform(1 / m, 0, 0, 1 / m, -x0 / m, -z0 / m);
      mc.lineCap = 'round';
      mc.lineJoin = 'round';
      mc.strokeStyle = '#fff';
      for (const s of streets) {
        if (s.kind !== 'main' && s.kind !== 'ring') continue;
        mc.beginPath();
        mc.moveTo(s.pts[0][0], s.pts[0][1]);
        for (let i = 1; i < s.pts.length; i++) mc.lineTo(s.pts[i][0], s.pts[i][1]);
        mc.lineWidth = s.w - 0.4;
        mc.stroke();
      }
      mc.setTransform(1, 0, 0, 1, 0, 0);
      mc.globalCompositeOperation = 'source-in';
      mc.fillStyle = cobblePattern(mc, '#aa9e8a', 'rgba(90, 80, 66, 0.55)', Math.max(0.25, 0.25 / m));
      mc.fillRect(0, 0, mask.width, mask.height);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(mask, 0, 0);
      ctx.restore();
    }
    if (detail && L.modern) this.paintMarkings(ctx, streets, m);

    // Plaza
    if (L.plaza) {
      const p = L.plaza;
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.z, p.r, 0, Math.PI * 2);
      ctx.fillStyle = L.modern ? '#d4d0c6' : '#b3a792';
      ctx.fill();
      if (detail) {
        ctx.clip();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = L.modern ? tilePattern(ctx, '#d6d2c8', 'rgba(120,115,105,0.35)', 2 / m) : cobblePattern(ctx, '#b3a792', 'rgba(95,82,66,0.5)', Math.max(0.25, 0.25 / m));
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.restore();
      if (detail) {
        // A darker ring of stones around the plaza edge
        ctx.beginPath();
        ctx.arc(p.x, p.z, p.r - 0.4, 0, Math.PI * 2);
        ctx.strokeStyle = L.modern ? '#b8b4aa' : '#8f826d';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
    }
    void px;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    tex.anisotropy = 8;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    return { tex, x0, z0, size };
  }

  /** Lane lines, stop lines and zebra crossings (modern towns). */
  paintMarkings(ctx, streets, m) {
    const L = this.L;
    ctx.save();
    ctx.lineCap = 'butt';
    for (const s of streets) {
      if (s.kind === 'road') continue;
      ctx.beginPath();
      ctx.moveTo(s.pts[0][0], s.pts[0][1]);
      for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i][0], s.pts[i][1]);
      ctx.setLineDash(s.kind === 'main' ? [] : [3, 4]);
      ctx.strokeStyle = s.kind === 'main' ? 'rgba(240, 200, 70, 0.9)' : 'rgba(245, 245, 240, 0.85)';
      ctx.lineWidth = Math.max(0.18, m * 0.9);
      ctx.stroke();
      if (s.kind === 'main') {
        // Double yellow line
        ctx.lineWidth = Math.max(0.12, m * 0.7);
        for (const off of [-0.3, 0.3]) {
          ctx.beginPath();
          for (let i = 0; i < s.pts.length; i++) {
            const a = s.pts[Math.max(0, i - 1)];
            const b = s.pts[Math.min(s.pts.length - 1, i + 1)];
            const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
            const nx = -(b[1] - a[1]) / len;
            const nz = (b[0] - a[0]) / len;
            const x = s.pts[i][0] + nx * off;
            const z = s.pts[i][1] + nz * off;
            if (i === 0) ctx.moveTo(x, z);
            else ctx.lineTo(x, z);
          }
          ctx.stroke();
        }
      }
    }
    ctx.setLineDash([]);
    // Junctions of the street grid: clear the markings, paint zebra crossings
    const g = L.grid;
    if (g) {
      const ca = Math.cos(g.axis);
      const sa = Math.sin(g.axis);
      const n = Math.ceil((L.cityR + g.pitch) / g.pitch) + 1;
      for (let i = -n; i <= n; i++) {
        for (let j = -n; j <= n; j++) {
          const u = i * g.pitch - g.pitch / 2;
          const v = j * g.pitch - g.pitch / 2;
          const x = u * ca - v * sa;
          const z = u * sa + v * ca;
          if (Math.hypot(x, z) > L.cityR + 20) continue;
          const w = i === 0 || j === 0 ? 18 : g.road;
          ctx.save();
          ctx.translate(x, z);
          ctx.rotate(g.axis);
          ctx.fillStyle = '#4b4d53';
          ctx.fillRect(-w / 2, -w / 2, w, w);
          ctx.fillStyle = 'rgba(245, 245, 240, 0.9)';
          for (let side = 0; side < 4; side++) {
            ctx.save();
            ctx.rotate((side * Math.PI) / 2);
            for (let k = -w / 2 + 0.6; k < w / 2 - 0.6; k += 1.2) ctx.fillRect(k, w / 2 + 0.4, 0.6, 2.6);
            ctx.restore();
          }
          ctx.restore();
        }
      }
    }
    ctx.restore();
  }

  /** Farm plots: soil colour with furrows along the plot. */
  paintFields(ctx, m) {
    const COLORS = { wheat: ['#d6b34a', '#b8942f'], crop: ['#6f9b3d', '#557f2c'], plowed: ['#9a7447', '#7d5b36'] };
    for (const f of this.L.fields2 || []) {
      const [a, b] = COLORS[f.crop] || COLORS.plowed;
      ctx.save();
      ctx.translate(f.x, f.z);
      ctx.rotate(f.yaw);
      ctx.fillStyle = a;
      ctx.fillRect(-f.w / 2, -f.d / 2, f.w, f.d);
      ctx.fillStyle = b;
      const step = Math.max(1.2, m * 3);
      for (let v = -f.d / 2 + step / 2; v < f.d / 2; v += step) ctx.fillRect(-f.w / 2, v, f.w, step * 0.35);
      ctx.strokeStyle = 'rgba(90, 70, 40, 0.5)';
      ctx.lineWidth = Math.max(0.3, m);
      ctx.strokeRect(-f.w / 2, -f.d / 2, f.w, f.d);
      ctx.restore();
    }
  }

  dispose() {
    this.near.tex.dispose();
    this.far.tex.dispose();
  }
}

/** Tiling grey noise for micro variation on the ground (grass, sand, soil). */
export function detailNoiseTexture() {
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d');
  const img = g.createImageData(n, n);
  const rng = mulberry32(1234);
  // Value noise at two scales, wrapped so the tile repeats seamlessly
  const grid = (cells) => {
    const v = Array.from({ length: cells * cells }, () => rng());
    return (x, y) => {
      const fx = (x / n) * cells;
      const fy = (y / n) * cells;
      const i = Math.floor(fx);
      const j = Math.floor(fy);
      const tx = fx - i;
      const ty = fy - j;
      const s = (a) => a * a * (3 - 2 * a);
      const at = (a, b) => v[((b + cells) % cells) * cells + ((a + cells) % cells)];
      const top = at(i, j) * (1 - s(tx)) + at(i + 1, j) * s(tx);
      const bot = at(i, j + 1) * (1 - s(tx)) + at(i + 1, j + 1) * s(tx);
      return top * (1 - s(ty)) + bot * s(ty);
    };
  };
  const a = grid(8);
  const b = grid(32);
  const c2 = grid(64);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = a(x, y) * 0.5 + b(x, y) * 0.3 + c2(x, y) * 0.2;
      const o = (y * n + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v * 255;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}
