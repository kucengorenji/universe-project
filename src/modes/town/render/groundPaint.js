import * as THREE from 'three';
import { mulberry32 } from '../../../math/random.js';
import { pavementWidth } from '../scale.js';
import { PATH_PALETTE, streetPathStyle } from '../../../art/palette.js';

// Streets, pavements, paths, plazas and fields are painted into
// textures laid over the terrain instead of being separate ribbons: crossings
// merge into one surface (no z-fighting), and markings cost no geometry.
//
// Two layers: a sharp one over the town, a coarse one over the surroundings.
// Texel (i, j) covers world x = x0 + (i + 0.5) * m, z = z0 + (j + 0.5) * m
// (flipY off, so row 0 is the smallest z).

// Small soil lobes soften garden paths without exceeding the grass exclusion margin.
function gardenEdges(ctx, paths, color) {
  ctx.fillStyle = color;
  for (const p of paths || []) for (let i = 1; i < p.pts.length; i++) {
    const [ax, az] = p.pts[i - 1], [bx, bz] = p.pts[i];
    const dx = bx - ax, dz = bz - az, length = Math.hypot(dx, dz);
    if (!length) continue;
    for (let d = 0.8; d < length; d += 1.6) for (const side of [-1, 1]) {
      const t = d / length, offset = side * (p.w / 2 + 0.11);
      const x = ax + dx * t - dz / length * offset, z = az + dz * t + dx / length * offset;
      ctx.beginPath(); ctx.arc(x, z, 0.09 + 0.035 * Math.sin(x * 2.1 + z), 0, Math.PI * 2); ctx.fill();
    }
  }
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
    const path = (pts) => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    };

    if (detail) this.paintFields(ctx, m);
    for(const park of L.parks||[])if(park.access){
      ctx.save();ctx.globalAlpha=.55;ctx.fillStyle='#78934f';
      path(park.poly.map(p=>[p.x,p.z]));ctx.closePath();ctx.fill();ctx.restore();
    }
    // Ward ground: packed earth in the slums, paving by the merchants, grass in the rich quarter
    if (detail && L.wards) {
      const WARD_GROUND = { slum: ['#9a8763', 0.32], craftsmen: ['#a59676', 0.2], merchant: ['#b0a58f', 0.26], gate: ['#a8987a', 0.24], docks: ['#9d937d', 0.3], military: ['#a0957c', 0.28] };
      for (const w of L.wards) {
        const g = WARD_GROUND[w.ward];
        if (!g) continue;
        ctx.globalAlpha = g[1];
        ctx.fillStyle = g[0];
        path(w.poly);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Lot aprons under the buildings: paving (a darker kerb line) in modern towns, packed earth in old ones
    const APRON = { lot: [PATH_PALETTE.stone.fill, PATH_PALETTE.border], plaza: [PATH_PALETTE.brick.fill, PATH_PALETTE.border], yard: [PATH_PALETTE.earth.fill, PATH_PALETTE.earth.edge] };
    for (const a of L.aprons || []) {
      const [fill, edge] = APRON[a.kind] || APRON.lot;
      ctx.save();
      ctx.translate(a.x, a.z);
      ctx.rotate(a.yaw);
      ctx.fillStyle = fill;
      ctx.beginPath();ctx.roundRect(-a.hw, -a.hd, a.hw * 2, a.hd * 2, Math.min(.8,a.hw*.2,a.hd*.2));ctx.fill();
      ctx.strokeStyle = edge;
      ctx.lineWidth = L.modern ? 0.35 : 0.5;
      ctx.beginPath();ctx.roundRect(-a.hw + 0.2, -a.hd + 0.2, a.hw * 2 - 0.4, a.hd * 2 - 0.4, Math.min(.6,a.hw*.15,a.hd*.15));ctx.stroke();
      ctx.restore();
    }

    // Streets: kerb / pavement pass first for every street, then the surfaces,
    // so junctions merge into one clean shape.
    const order = L.modern ? ['road', 'residential', 'grid', 'collector', 'main'] : ['road', 'lane', 'ring', 'main'];
    const streets = [...L.streets].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    const kerb = pavementWidth(L);
    for (const s of streets) {
      const st = streetPathStyle(s.kind);
      path(s.pts);
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = PATH_PALETTE.verge;
      ctx.lineWidth = s.w + (s.kind === 'road' ? 1.2 : kerb * 2 + 0.4);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = s.kind === 'road' || s.kind === 'lane' ? st.edge : PATH_PALETTE.border;
      ctx.lineWidth = s.w + (s.kind === 'road' ? 0.8 : kerb * 2);
      ctx.stroke();
    }
    // Walkways are canonical paths, shared with grass exclusion and walkers.
    gardenEdges(ctx,L.paths,PATH_PALETTE.earth.edge);
    for(const p of L.paths||[]){
      path(p.pts);ctx.strokeStyle=PATH_PALETTE.earth.edge;ctx.lineWidth=p.w+.4;ctx.stroke();
      path(p.pts);ctx.strokeStyle=PATH_PALETTE.earth.fill;ctx.lineWidth=p.w;ctx.stroke();
    }
    for (const s of streets) {
      const st = streetPathStyle(s.kind);
      path(s.pts);
      ctx.strokeStyle = st.fill;
      ctx.lineWidth = s.w;
      ctx.stroke();
    }
    // Rivers over the streets they cross (bridges carry the streets): muddy banks, dark bed
    for (const r of L.rivers || []) {
      path(r.pts);
      ctx.strokeStyle = '#7c6a4c';
      ctx.lineWidth = r.w + 9;
      ctx.stroke();
      path(r.pts);
      ctx.strokeStyle = '#4e6f7a';
      ctx.lineWidth = r.w;
      ctx.stroke();
    }

    // Plaza (a polygon in ward-planned towns, a disc otherwise)
    if (L.plaza) {
      const p = L.plaza;
      ctx.save();
      ctx.beginPath();
      if (p.poly?.length > 2) {
        ctx.moveTo(p.poly[0][0], p.poly[0][1]);
        for (let i = 1; i < p.poly.length; i++) ctx.lineTo(p.poly[i][0], p.poly[i][1]);
        ctx.closePath();
      } else ctx.arc(p.x, p.z, p.r, 0, Math.PI * 2);
      ctx.fillStyle = PATH_PALETTE.brick.fill;
      ctx.fill();
      ctx.restore();
      if (detail && !p.poly) {
        // A darker ring of stones around the plaza edge
        ctx.beginPath();
        ctx.arc(p.x, p.z, p.r - 0.4, 0, Math.PI * 2);
        ctx.strokeStyle = PATH_PALETTE.border;
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
    // RGB weights identify earth / rounded stone / terracotta. Black keeps grass/fields.
    // Fine surface detail is sampled in world metres by the terrain shader,
    // so zooming or a larger town cannot turn stones into metre-wide circles.
    const mask=document.createElement('canvas');mask.width=mask.height=res;
    const mc=mask.getContext('2d');mc.fillStyle='#000';mc.fillRect(0,0,res,res);
    mc.setTransform(1/m,0,0,1/m,-x0/m,-z0/m);mc.lineCap='round';mc.lineJoin='round';
    const stroke=(pts,w,color)=>{mc.beginPath();mc.moveTo(...pts[0]);for(const p of pts.slice(1))mc.lineTo(...p);mc.strokeStyle=color;mc.lineWidth=w;mc.stroke();};
    for(const a of L.aprons||[]){mc.save();mc.translate(a.x,a.z);mc.rotate(a.yaw);mc.fillStyle=(a.kind==='yard'?PATH_PALETTE.earth:a.kind==='plaza'?PATH_PALETTE.brick:PATH_PALETTE.stone).mask;mc.beginPath();mc.roundRect(-a.hw,-a.hd,a.hw*2,a.hd*2,Math.min(.8,a.hw*.2,a.hd*.2));mc.fill();mc.restore();}
    for(const s of streets)stroke(s.pts,s.w+(s.kind==='road'?.8:kerb*2),s.kind==='road'||s.kind==='lane'?'#f00':'#0f0');
    for(const p of L.paths||[])stroke(p.pts,p.w+.4,PATH_PALETTE.earth.mask);
    gardenEdges(mc,L.paths,PATH_PALETTE.earth.mask);
    for(const s of streets)stroke(s.pts,s.w,streetPathStyle(s.kind).mask);
    if(L.plaza){const p=L.plaza;mc.beginPath();if(p.poly?.length>2){mc.moveTo(...p.poly[0]);for(const q of p.poly.slice(1))mc.lineTo(...q);mc.closePath();}else mc.arc(p.x,p.z,p.r,0,Math.PI*2);mc.fillStyle=PATH_PALETTE.brick.mask;mc.fill();}
    // The bridge mesh carries the path across water; a river must never acquire paving detail.
    for(const r of L.rivers||[])stroke(r.pts,r.w+9,'#000');
    const surface=new THREE.CanvasTexture(mask);surface.flipY=false;surface.anisotropy=4;
    return { tex, surface, x0, z0, size };
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
    this.near.surface.dispose();
    this.far.surface.dispose();
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
