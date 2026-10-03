import { HALF, SIZE, walk } from '../battlefield/generateField.js';
import { CLASSES, FACTIONS } from '../units/soldierLook.js';
import { mulberry32 } from '../../math/random.js';

// The flat tactical map (Preparation and Command Mode): the battlefield drawn as an ink-and-wash
// field map on paper, from the same field data as the 3D scene. The static map is drawn once
// per field into an offscreen canvas; units, camps, deploy slots and the selection are drawn
// on top every frame. Wheel zooms about the cursor, dragging pans, a click picks.

const PX = 10; // static map pixels per metre
const INK = '#2a2119';
const PAPER = '#efe6d2';
export const SIDE_COLOR = { fed: FACTIONS.fed.flag, imp: FACTIONS.imp.flag };
const SHORT = { ...Object.fromEntries(Object.entries(CLASSES).map(([k, v]) => [k, v.short])), tank: 'TK', bunker: 'BK' };

export class TacticalMap {
  constructor(canvas, { onPick } = {}) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.onPick = onPick;
    this.view = { x: 0, z: 0, scale: 3 }; // world centre and screen pixels per metre
    this.overlay = {};
    this.time = 0;
    this.listen();
  }

  listen() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const before = this.toWorld(e.offsetX, e.offsetY);
      this.view.scale = Math.min(14, Math.max(this.minScale(), this.view.scale * Math.exp(-e.deltaY * 0.0015)));
      const after = this.toWorld(e.offsetX, e.offsetY);
      this.view.x += before[0] - after[0];
      this.view.z += before[1] - after[1];
      this.clampView();
    }, { passive: false });
    c.addEventListener('pointerdown', (e) => {
      drag = { x: e.offsetX, y: e.offsetY, vx: this.view.x, vz: this.view.z, moved: false };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      this.hover = this.toWorld(e.offsetX, e.offsetY);
      if (!drag) return;
      const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
      if (Math.hypot(dx, dy) > 5) drag.moved = true;
      if (drag.moved) {
        this.view.x = drag.vx - dx / this.view.scale;
        this.view.z = drag.vz - dy / this.view.scale;
        this.clampView();
      }
    });
    c.addEventListener('pointerup', (e) => {
      if (drag && !drag.moved) this.onPick?.(...this.toWorld(e.offsetX, e.offsetY), e);
      drag = null;
    });
    c.addEventListener('pointerleave', () => (this.hover = null));
  }

  get width() {
    return this.canvas.clientWidth;
  }

  get height() {
    return this.canvas.clientHeight;
  }

  minScale() {
    return Math.min(this.width, this.height) / (SIZE + 20);
  }

  fit() {
    this.view = { x: 0, z: 0, scale: this.minScale() };
  }

  clampView() {
    const m = HALF + 10;
    this.view.x = Math.max(-m, Math.min(m, this.view.x));
    this.view.z = Math.max(-m, Math.min(m, this.view.z));
  }

  toWorld(sx, sy) {
    return [this.view.x + (sx - this.width / 2) / this.view.scale, this.view.z + (sy - this.height / 2) / this.view.scale];
  }

  toScreen(x, z) {
    return [this.width / 2 + (x - this.view.x) * this.view.scale, this.height / 2 + (z - this.view.z) * this.view.scale];
  }

  /** Draw the static map of a field (once per field). */
  setField(field, arena = null) {
    this.field = field;
    const n = SIZE * PX;
    const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(n, n) : Object.assign(document.createElement('canvas'), { width: n, height: n });
    drawStatic(cv.getContext('2d'), field, arena);
    this.base = cv;
  }

  /** Resize the backing store to the element (device pixels). */
  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(this.width * dpr)), h = Math.max(1, Math.round(this.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.dpr = dpr;
    if (this.view.scale < this.minScale()) this.fit();
  }

  /**
   * Draw a frame. o: { units, camps, selected (unit id), slots ([{x, z, taken}]), pickable (Set of ids),
   * range ({ x, z, r }) }.
   */
  draw(dt, o = {}) {
    this.resize();
    this.time += dt;
    const g = this.g;
    const { scale } = this.view;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = PAPER;
    g.fillRect(0, 0, this.width, this.height);
    if (!this.base) return;
    const [ox, oy] = this.toScreen(-HALF, -HALF);
    g.imageSmoothingQuality = 'high';
    g.drawImage(this.base, ox, oy, SIZE * scale, SIZE * scale);
    const S = (x, z) => this.toScreen(x, z);
    const R = (m) => m * scale;

    if (o.range) {
      const [x, y] = S(o.range.x, o.range.z);
      g.strokeStyle = 'rgba(42,33,25,0.5)';
      g.setLineDash([6, 5]);
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y, R(o.range.r), 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }
    for (const s of o.slots || []) {
      const [x, y] = S(s.x, s.z);
      g.strokeStyle = SIDE_COLOR.fed;
      g.setLineDash([4, 4]);
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y, Math.max(9, R(1.6)), 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }
    for (const c of o.camps || []) this.drawCamp(c);
    const units = [...(o.units || [])].sort((a, b) => (a.state === 'ok') - (b.state === 'ok'));
    for (const u of units) this.drawUnit(u, u.id === o.selected, o.pickable?.has(u.id));
    // compass and scale bar
    g.save();
    g.translate(this.width - 44, this.height - 54);
    g.fillStyle = INK;
    g.font = '600 15px "Barlow Condensed", sans-serif';
    g.textAlign = 'center';
    g.fillText('U', 0, -22);
    g.beginPath();
    g.moveTo(0, -16);
    g.lineTo(7, 10);
    g.lineTo(0, 4);
    g.lineTo(-7, 10);
    g.closePath();
    g.fill();
    g.restore();
    const bar = 20 * scale;
    g.fillStyle = INK;
    g.fillRect(20, this.height - 24, bar, 3);
    g.font = '500 13px "Barlow Condensed", sans-serif';
    g.textAlign = 'left';
    g.fillText('20 m', 24 + bar, this.height - 19);
  }

  drawCamp(c) {
    const g = this.g;
    const [x, y] = this.toScreen(c.x, c.z);
    const s = Math.max(1, this.view.scale / 3);
    g.strokeStyle = INK;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x, y - 26 * s);
    g.stroke();
    g.fillStyle = c.owner ? SIDE_COLOR[c.owner] : '#e8e0c8';
    g.beginPath();
    g.moveTo(x, y - 26 * s);
    g.lineTo(x + 18 * s, y - 21 * s);
    g.lineTo(x, y - 15 * s);
    g.closePath();
    g.fill();
    g.stroke();
    g.beginPath();
    g.arc(x, y, 3 * this.view.scale, 0, Math.PI * 2);
    g.setLineDash([3, 4]);
    g.lineWidth = 1;
    g.stroke();
    g.setLineDash([]);
  }

  drawUnit(u, selected, pickable) {
    const g = this.g;
    const [x, y] = this.toScreen(u.x, u.z);
    const big = u.kind !== 'infantry';
    const r = Math.max(big ? 13 : 10, this.view.scale * (big ? 2.4 : 1.3));
    if (u.state === 'evac') return;
    if (u.state === 'dead') {
      g.strokeStyle = 'rgba(42,33,25,0.55)';
      g.lineWidth = 2;
      const k = r * 0.5;
      g.beginPath();
      g.moveTo(x - k, y - k);
      g.lineTo(x + k, y + k);
      g.moveTo(x + k, y - k);
      g.lineTo(x - k, y + k);
      g.stroke();
      return;
    }
    if (selected || pickable) {
      const pulse = selected ? 1 + 0.15 * Math.sin(this.time * 6) : 1;
      g.strokeStyle = selected ? '#d9a62e' : 'rgba(42,33,25,0.6)';
      g.lineWidth = selected ? 3 : 1.5;
      g.beginPath();
      g.arc(x, y, (r + 5) * pulse, 0, Math.PI * 2);
      g.stroke();
    }
    // facing
    g.strokeStyle = INK;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x + Math.sin(u.yaw) * r, y + Math.cos(u.yaw) * r);
    g.lineTo(x + Math.sin(u.yaw) * (r + 7), y + Math.cos(u.yaw) * (r + 7));
    g.stroke();
    g.fillStyle = u.state === 'down' ? '#8a8378' : SIDE_COLOR[u.side];
    g.beginPath();
    if (big) g.roundRect(x - r, y - r * 0.8, r * 2, r * 1.6, 4);
    else g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 2;
    g.stroke();
    // health
    const f = u.hp / u.maxHp;
    g.strokeStyle = f > 0.5 ? '#6f9a4a' : f > 0.25 ? '#d9a62e' : '#c0392b';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(x, y, r + 2.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f);
    g.stroke();
    g.fillStyle = '#fff';
    g.font = `600 ${Math.round(r * 0.95)}px "Barlow Condensed", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(u.state === 'down' ? `${u.downTurns}` : SHORT[u.cls] || '?', x, y + 1);
    if (u.leader) {
      g.fillStyle = '#d9a62e';
      star(g, x + r * 0.8, y - r * 0.8, r * 0.45);
    }
    g.textBaseline = 'alphabetic';
  }
}

function star(g, x, y, r) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 1;
  g.stroke();
}

// ---------------------------------------------------------------- the static map
function drawStatic(g, field, arena) {
  const n = SIZE * PX;
  const X = (x) => (x + HALF) * PX;
  const rng = mulberry32(field.seed ^ 0x3a9);
  g.fillStyle = PAPER;
  g.fillRect(0, 0, n, n);
  // a light wash for the ground, darker in the hollows
  const H = field.heights, N = field.n, step = field.res * PX;
  for (let j = 0; j < N - 1; j++) {
    for (let i = 0; i < N - 1; i++) {
      const h = H[j * N + i];
      const v = Math.max(0, Math.min(1, (h + 2) / 7));
      g.fillStyle = `rgba(${Math.round(150 + v * 40)}, ${Math.round(165 + v * 30)}, ${Math.round(110 + v * 20)}, 0.35)`;
      g.fillRect(i * step, j * step, step + 1, step + 1);
    }
  }
  // contour lines every 1.5 m (marching squares)
  g.strokeStyle = 'rgba(122, 96, 60, 0.35)';
  g.lineWidth = 1.5;
  g.beginPath();
  for (let level = -6; level < 12; level += 1.5) {
    for (let j = 0; j < N - 1; j++) {
      for (let i = 0; i < N - 1; i++) {
        const a = H[j * N + i], b = H[j * N + i + 1], c = H[(j + 1) * N + i + 1], d = H[(j + 1) * N + i];
        const pts = [];
        const edge = (p, q, x0, y0, x1, y1) => {
          if ((p < level) !== (q < level)) {
            const t = (level - p) / (q - p);
            pts.push([(x0 + (x1 - x0) * t) * step, (y0 + (y1 - y0) * t) * step]);
          }
        };
        edge(a, b, i, j, i + 1, j);
        edge(b, c, i + 1, j, i + 1, j + 1);
        edge(c, d, i + 1, j + 1, i, j + 1);
        edge(d, a, i, j + 1, i, j);
        for (let k = 0; k + 1 < pts.length; k += 2) {
          g.moveTo(...pts[k]);
          g.lineTo(...pts[k + 1]);
        }
      }
    }
  }
  g.stroke();
  // fields
  for (const f of field.fields) {
    g.save();
    g.translate(X(f.x), X(f.z));
    g.rotate(-f.yaw);
    const w = f.w * PX, d = f.d * PX;
    g.fillStyle = f.kind === 'wheat' ? 'rgba(214, 186, 104, 0.55)' : f.kind === 'plough' ? 'rgba(150, 112, 74, 0.35)' : 'rgba(160, 176, 100, 0.3)';
    g.fillRect(-w / 2, -d / 2, w, d);
    g.strokeStyle = 'rgba(42, 33, 25, 0.18)';
    g.lineWidth = 1;
    for (let v = -d / 2; v < d / 2; v += f.kind === 'meadow' ? 30 : 14) {
      g.beginPath();
      g.moveTo(-w / 2, v);
      g.lineTo(w / 2, v);
      g.stroke();
    }
    g.restore();
  }
  // tall grass: stipple
  g.fillStyle = 'rgba(80, 96, 40, 0.5)';
  for (const p of field.grass) {
    const xs = p.poly.map((q) => q[0]), zs = p.poly.map((q) => q[1]);
    for (let k = 0; k < 120; k++) {
      const x = Math.min(...xs) + rng() * (Math.max(...xs) - Math.min(...xs)), z = Math.min(...zs) + rng() * (Math.max(...zs) - Math.min(...zs));
      if (inside(x, z, p.poly)) g.fillRect(X(x), X(z), 3, 6);
    }
  }
  const line = (pts, w, color, dash = null) => {
    g.strokeStyle = color;
    g.lineWidth = w;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.setLineDash(dash || []);
    g.beginPath();
    pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), X(z)) : g.moveTo(X(x), X(z))));
    g.stroke();
    g.setLineDash([]);
  };
  if (field.river) {
    line(field.river.pts, field.river.width * PX + 6, INK);
    line(field.river.pts, field.river.width * PX, '#8fb1bd');
    line(field.river.pts, field.river.width * PX * 0.3, 'rgba(255,255,255,0.25)');
  }
  for (const r of field.roads) {
    line(r.pts, r.width * PX + 5, INK);
    line(r.pts, r.width * PX, '#e2d2ae');
  }
  for (const b of field.bridges) {
    g.save();
    g.translate(X(b.x), X(b.z));
    g.rotate(-b.yaw);
    g.fillStyle = '#cfc4ad';
    g.strokeStyle = INK;
    g.lineWidth = 3;
    g.fillRect((-b.width / 2) * PX, (-b.length / 2 - 2) * PX, b.width * PX, (b.length + 4) * PX);
    g.strokeRect((-b.width / 2) * PX, (-b.length / 2 - 2) * PX, b.width * PX, (b.length + 4) * PX);
    g.restore();
  }
  for (const t of field.trenches) {
    line(t.pts, t.width * PX + 8, '#7c6a4c');
    line(t.pts, 3, INK);
    for (const s of walk(t.pts, 2)) {
      g.beginPath();
      g.moveTo(X(s.x), X(s.z));
      g.lineTo(X(s.x - s.tz * 1.6), X(s.z + s.tx * 1.6));
      g.stroke();
    }
  }
  for (const h of field.hedges) line(h.pts, 14, 'rgba(74, 110, 54, 0.75)', [10, 6]);
  for (const t of field.trees) {
    g.fillStyle = t.kind === 't_pine' || t.kind === 't_spruce' ? '#5e7e4a' : '#7d9a55';
    g.strokeStyle = INK;
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(X(t.x), X(t.z), 2.6 * PX * (t.s || 1), 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  // buildings: dark blocks with hatching, as on a field map
  for (const h of field.houses) {
    g.save();
    g.translate(X(h.x), X(h.z));
    g.rotate(-h.yaw);
    const w = h.w * PX, d = h.d * PX;
    if (h.ruined) {
      g.strokeStyle = INK;
      g.lineWidth = 3;
      g.setLineDash([12, 8]);
      g.strokeRect(-w / 2, -d / 2, w, d);
      g.setLineDash([]);
    } else {
      g.fillStyle = '#8e7764';
      g.fillRect(-w / 2, -d / 2, w, d);
      g.strokeStyle = 'rgba(42,33,25,0.45)';
      g.lineWidth = 1;
      g.beginPath();
      for (let k = -w; k < w + d; k += 8) {
        g.moveTo(-w / 2 + k, -d / 2);
        g.lineTo(-w / 2 + k - d, d / 2);
      }
      g.save();
      g.clip(new Path2D(`M${-w / 2} ${-d / 2}h${w}v${d}h${-w}z`));
      g.stroke();
      g.restore();
      g.strokeStyle = INK;
      g.lineWidth = 3;
      g.strokeRect(-w / 2, -d / 2, w, d);
    }
    g.restore();
  }
  if (field.windmill) {
    const w = field.windmill;
    g.fillStyle = '#d8ccb0';
    g.strokeStyle = INK;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(X(w.x), X(w.z), 2.6 * PX, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.beginPath();
    for (let k = 0; k < 4; k++) {
      const a = w.yaw + (k * Math.PI) / 2 + 0.4;
      g.moveTo(X(w.x), X(w.z));
      g.lineTo(X(w.x) + Math.cos(a) * 6 * PX, X(w.z) + Math.sin(a) * 6 * PX);
    }
    g.stroke();
  }
  // cover
  for (const c of field.cover) {
    g.save();
    g.translate(X(c.x), X(c.z));
    g.rotate(-c.yaw);
    g.strokeStyle = INK;
    g.lineWidth = 2;
    if (c.type === 'wire') {
      g.beginPath();
      for (let u = -14; u < 14; u += 4) {
        g.moveTo(u, -3);
        g.lineTo(u + 4, 3);
        g.moveTo(u, 3);
        g.lineTo(u + 4, -3);
      }
      g.stroke();
    } else if (c.type === 'hedgehog') {
      g.beginPath();
      g.moveTo(-6, -6);
      g.lineTo(6, 6);
      g.moveTo(6, -6);
      g.lineTo(-6, 6);
      g.stroke();
    } else if (c.type === 'sandbag_arc') {
      g.fillStyle = '#b6a276';
      g.beginPath();
      g.arc(0, -18, 18, Math.PI * 0.25, Math.PI * 0.75);
      g.lineWidth = 7;
      g.strokeStyle = '#b6a276';
      g.stroke();
      g.lineWidth = 1.5;
      g.strokeStyle = INK;
      g.stroke();
    } else {
      const size = { sandbag_wall: [24, 7, '#b6a276'], barricade: [25, 6, '#7a5233'], crate: [10, 6, '#9c7449'], drum: [6, 6, '#55595e'], ruin_wall: [40, 4, '#9c5a44'], tent: [25, 30, '#a9a07a'] }[c.type] || [8, 8, '#999'];
      g.fillStyle = size[2];
      g.fillRect(-size[0] / 2, -size[1] / 2, size[0], size[1]);
      g.strokeRect(-size[0] / 2, -size[1] / 2, size[0], size[1]);
    }
    g.restore();
  }
  for (const b of field.bunkers) {
    g.fillStyle = '#a7a396';
    g.strokeStyle = INK;
    g.lineWidth = 3;
    g.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
      g.lineTo(X(b.x) + Math.cos(a) * 2.3 * PX, X(b.z) + Math.sin(a) * 2.3 * PX);
    }
    g.closePath();
    g.fill();
    g.stroke();
  }
  if (field.watchtower) {
    g.strokeStyle = INK;
    g.lineWidth = 3;
    g.strokeRect(X(field.watchtower.x) - 13, X(field.watchtower.z) - 13, 26, 26);
  }
  // map grid with references, A-J across and 1-10 down
  g.strokeStyle = 'rgba(42,33,25,0.12)';
  g.lineWidth = 1;
  g.fillStyle = 'rgba(42,33,25,0.45)';
  g.font = '600 26px "Barlow Condensed", sans-serif';
  for (let k = 0; k <= 10; k++) {
    const p = k * 20 * PX;
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, n);
    g.moveTo(0, p);
    g.lineTo(n, p);
    g.stroke();
    if (k < 10) {
      g.fillText('ABCDEFGHIJ'[k], p + 8, 28);
      g.fillText(String(k + 1), 8, p + 30);
    }
  }
  g.strokeStyle = INK;
  g.lineWidth = 6;
  g.strokeRect(3, 3, n - 6, n - 6);
}

function inside(x, z, poly) {
  let ok = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ok = !ok;
  }
  return ok;
}
