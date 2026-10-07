import { HALF, SIZE, lineDist } from './generateField.js';
import { mulberry32 } from '../../math/random.js';

// The battlefield's ground as a painted texture (canvas 2D): grass, fields, roads, the river
// banks, the trench spoil and camp ground. The 3D terrain wears it; the flat prep map draws
// its own stylised version from the same field data.

export const GROUND = {
  grass: '#8fa35c',
  grassDark: '#74894a',
  meadow: '#a3b064',
  wheat: '#d2b766',
  wheatDark: '#b99c4f',
  plough: '#8c6d4a',
  ploughDark: '#6f5438',
  road: '#c4ad84',
  roadDark: '#a48f68',
  mud: '#7c6a4c',
  plaza: '#b9ad94',
  camp: '#a69568'
};

/** Paint the ground of a field onto a square canvas of `px` pixels (one texel = SIZE / px metres). */
export function paintGround(field, px = 2048) {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(px, px) : Object.assign(document.createElement('canvas'), { width: px, height: px });
  const g = canvas.getContext('2d');
  const k = px / SIZE;
  const X = (x) => (x + HALF) * k;
  const rng = mulberry32(field.seed ^ 0x51ed);

  // grass with soft blotches
  g.fillStyle = GROUND.grass;
  g.fillRect(0, 0, px, px);
  for (let i = 0; i < 900; i++) {
    const x = rng() * px, y = rng() * px, r = (2 + rng() * 9) * k;
    g.fillStyle = rng() < 0.5 ? GROUND.grassDark : GROUND.meadow;
    g.globalAlpha = 0.18 + rng() * 0.18;
    g.beginPath();
    g.ellipse(x, y, r, r * (0.5 + rng() * 0.6), rng() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;

  // fields: furrows run along each field's long side
  for (const f of field.fields) {
    g.save();
    g.translate(X(f.x), X(f.z));
    g.rotate(-f.yaw);
    const w = f.w * k, d = f.d * k;
    const base = f.kind === 'wheat' ? GROUND.wheat : f.kind === 'plough' ? GROUND.plough : GROUND.meadow;
    const dark = f.kind === 'wheat' ? GROUND.wheatDark : f.kind === 'plough' ? GROUND.ploughDark : GROUND.grass;
    g.fillStyle = base;
    g.fillRect(-w / 2, -d / 2, w, d);
    g.strokeStyle = dark;
    g.globalAlpha = f.kind === 'meadow' ? 0.25 : 0.55;
    g.lineWidth = Math.max(1, 0.35 * k);
    for (let v = -d / 2 + 1.2 * k; v < d / 2; v += 1.2 * k) {
      g.beginPath();
      g.moveTo(-w / 2, v);
      g.lineTo(w / 2, v);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.restore();
  }

  const stroke = (pts, width, color, alpha = 1) => {
    g.globalAlpha = alpha;
    g.strokeStyle = color;
    g.lineWidth = width * k;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), X(z)) : g.moveTo(X(x), X(z))));
    g.stroke();
    g.globalAlpha = 1;
  };

  // river banks: mud under and beside the water
  if (field.river) {
    stroke(field.river.pts, field.river.width + 7, GROUND.grassDark, 0.6);
    stroke(field.river.pts, field.river.width + 3, GROUND.mud);
  }
  // the village square and camp ground
  for (const c of field.camps) {
    g.fillStyle = c.side ? GROUND.camp : GROUND.plaza;
    g.beginPath();
    g.arc(X(c.x), X(c.z), (c.r + (c.side ? 6 : 3)) * k, 0, Math.PI * 2);
    g.fill();
  }
  // roads: verge, dirt, wheel ruts
  for (const r of field.roads) stroke(r.pts, r.width + 1.4, GROUND.roadDark, 0.5);
  for (const r of field.roads) stroke(r.pts, r.width, GROUND.road);
  for (const r of field.roads) {
    for (const side of [-1, 1]) {
      const off = r.width * 0.22 * side;
      const pts = r.pts.map((p, i) => {
        const q = r.pts[Math.min(i + 1, r.pts.length - 1)], o = r.pts[Math.max(i - 1, 0)];
        const tx = q[0] - o[0], tz = q[1] - o[1];
        const L = Math.hypot(tx, tz) || 1;
        return [p[0] - (tz / L) * off, p[1] + (tx / L) * off];
      });
      stroke(pts, 0.45, GROUND.roadDark, 0.7);
    }
  }
  // trench spoil: churned earth either side of the cut
  for (const t of field.trenches) {
    stroke(t.pts, t.width + 4, GROUND.mud, 0.75);
    stroke(t.pts, t.width, GROUND.ploughDark);
  }
  // fine speckle so close-ups are not flat
  const img = g.getImageData(0, 0, px, px);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * 14;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n * 0.8;
  }
  g.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Which painted surface the ground wears, for close-up detail (fieldBuilder samples the matching
 * tiles of envKit.js): R road and bare earth, G wheat, B ploughed land; grass where all are zero.
 */
export function paintGroundClasses(field, px = 1024) {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(px, px) : Object.assign(document.createElement('canvas'), { width: px, height: px });
  const g = canvas.getContext('2d');
  const k = px / SIZE;
  const X = (x) => (x + HALF) * k;
  g.fillStyle = '#000';
  g.fillRect(0, 0, px, px);
  for (const f of field.fields) {
    if (f.kind === 'meadow') continue;
    g.save();
    g.translate(X(f.x), X(f.z));
    g.rotate(-f.yaw);
    g.fillStyle = f.kind === 'wheat' ? '#00ff00' : '#0000ff';
    g.fillRect((-f.w / 2) * k, (-f.d / 2) * k, f.w * k, f.d * k);
    g.restore();
  }
  const stroke = (pts, width) => {
    g.strokeStyle = '#ff0000';
    g.lineWidth = width * k;
    g.lineCap = g.lineJoin = 'round';
    g.beginPath();
    pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), X(z)) : g.moveTo(X(x), X(z))));
    g.stroke();
  };
  if (field.river) stroke(field.river.pts, field.river.width + 3);
  for (const c of field.camps) {
    g.fillStyle = '#ff0000';
    g.beginPath();
    g.arc(X(c.x), X(c.z), (c.r + (c.side ? 6 : 3)) * k, 0, Math.PI * 2);
    g.fill();
  }
  for (const r of field.roads) stroke(r.pts, r.width);
  for (const t of field.trenches) stroke(t.pts, t.width + 4);
  return canvas;
}

/** Is (x, z) inside a polygon [[x, z], ...]? */
export function inPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export { lineDist };
