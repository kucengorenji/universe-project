import { HALF, SIZE, walk } from '../battlefield/generateField.js';
import { FACTIONS } from '../units/soldierLook.js';
import { mulberry32 } from '../../math/random.js';
import { SHORT, CLASS_NAME } from './emblems.js';

// The flat tactical map (Preparation and Command Mode, and the round minimap): the battlefield
// drawn as an ink-and-wash field map on paper, from the same field data as the 3D scene. The
// static map is drawn once per field into an offscreen canvas; on top, every frame: camps,
// deploy slots, and the units as class shields in their faction's colour with an arrow for
// where they face. Enemies out of sight are drawn as ghosts at their last known position. A
// selector cursor (brass corner brackets) sits on the unit under the pointer or picked with
// the keyboard, with a paper label: name, class, AP or HP. The map always fits its box; its
// edges fade out like a wet wash, so it lies on the desk behind it. A click picks.

const PX = 10; // static map pixels per metre
const INK = '#2a2119';
const PAPER = '#efe6d2';
const BRASS = '#c9962c';
const TYPE = '"Courier Prime", ui-monospace, monospace';
const SERIF = '"Roboto Serif", Georgia, serif';
export const SIDE_COLOR = { fed: FACTIONS.fed.flag, imp: FACTIONS.imp.flag };
// the shield of emblems.js (viewBox 40 x 46, centred on its middle)
const SHIELD = new Path2D('M-16 -20H16V-4C16 7 9 14.5 0 19 -9 14.5 -16 7 -16 -4Z');

export class TacticalMap {
  constructor(canvas, { onPick, mini = false } = {}) {
    this.canvas = canvas;
    this.mini = mini; // the round minimap: small tokens, no labels, compass or scale
    this.g = canvas.getContext('2d');
    this.onPick = onPick;
    this.view = { x: 0, z: 0, scale: 3 }; // world centre and screen pixels per metre
    this.time = 0;
    this.listen();
  }

  listen() {
    // the map is fixed (always fitted): a click picks, the pointer only hovers
    const c = this.canvas;
    c.addEventListener('pointermove', (e) => {
      this.hover = this.toWorld(e.offsetX, e.offsetY);
      this.pointerMoved = true;
    });
    c.addEventListener('pointerleave', () => (this.hover = null));
    c.addEventListener('click', (e) => this.onPick?.(...this.toWorld(e.offsetX, e.offsetY), e));
  }

  get width() {
    return this.canvas.clientWidth;
  }

  get height() {
    return this.canvas.clientHeight;
  }

  minScale() {
    return Math.min(this.width, this.height) / (SIZE + 2);
  }

  fit() {
    this.view = { x: 0, z: 0, scale: this.minScale() };
  }

  toWorld(sx, sy) {
    return [this.view.x + (sx - this.width / 2) / this.view.scale, this.view.z + (sy - this.height / 2) / this.view.scale];
  }

  toScreen(x, z) {
    return [this.width / 2 + (x - this.view.x) * this.view.scale, this.height / 2 + (z - this.view.z) * this.view.scale];
  }

  /** Draw the static map of a field (once per field; again once the map fonts have loaded). */
  setField(field, arena = null) {
    this.field = field;
    const n = SIZE * PX;
    const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(n, n) : Object.assign(document.createElement('canvas'), { width: n, height: n });
    drawStatic(cv.getContext('2d'), field, arena);
    this.base = cv;
    if (typeof document !== 'undefined' && document.fonts?.status !== 'loaded') {
      document.fonts.ready.then(() => this.field === field && drawStatic(cv.getContext('2d'), field, arena));
    }
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
    if (!this.mini) this.fit();
  }

  /** Token radius (CSS px) of a unit on this map. */
  radius(u) {
    const big = u.kind !== 'infantry';
    if (this.mini) return big ? 7 : 5;
    return Math.max(big ? 15 : 11, this.view.scale * (big ? 2.6 : 1.5));
  }

  /**
   * Draw a frame. o: { units, camps, selected (unit id), cursor (unit id), slots ([{x, z}]),
   * pickable (Set of ids: the ones that may still act), range ({ x, z, r }), label (for the
   * cursor: { title, line }) }. Units may carry ghost: true (last known position).
   */
  draw(dt, o = {}) {
    this.resize();
    this.time += dt;
    const g = this.g;
    const { scale } = this.view;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.width, this.height);
    if (this.mini) {
      g.fillStyle = PAPER;
      g.fillRect(0, 0, this.width, this.height);
    }
    if (!this.base) return;
    const [ox, oy] = this.toScreen(-HALF, -HALF);
    g.imageSmoothingQuality = 'high';
    g.drawImage(this.base, ox, oy, SIZE * scale, SIZE * scale);
    const S = (x, z) => this.toScreen(x, z);

    if (o.range) {
      const [x, y] = S(o.range.x, o.range.z);
      g.fillStyle = 'rgba(63, 111, 176, 0.1)';
      g.strokeStyle = 'rgba(43, 76, 124, 0.75)';
      g.setLineDash([7, 5]);
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y, o.range.r * scale, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.setLineDash([]);
    }
    for (const s of o.slots || []) {
      const [x, y] = S(s.x, s.z);
      g.strokeStyle = SIDE_COLOR.fed;
      g.setLineDash([4, 4]);
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y, Math.max(10, 1.6 * scale), 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }
    for (const c of o.camps || []) this.drawCamp(c);
    // the dead first, then ghosts, then the living; the cursor's unit last
    const order = (u) => (u.state === 'dead' ? 0 : u.ghost ? 1 : u.id === o.cursor ? 3 : 2);
    const units = [...(o.units || [])].sort((a, b) => order(a) - order(b));
    for (const u of units) this.drawUnit(u, { selected: u.id === o.selected, dim: o.pickable && u.side === 'fed' && u.state === 'ok' && !o.pickable.has(u.id) });
    const cur = o.cursor && units.find((u) => u.id === o.cursor);
    if (cur && !this.mini) this.drawCursor(cur, o.label);
    if (this.mini) return;
    // compass and scale bar
    g.save();
    g.translate(this.width - 44, this.height - 54);
    g.fillStyle = INK;
    g.font = `700 15px ${TYPE}`;
    g.textAlign = 'center';
    g.fillText('N', 0, -22);
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
    g.font = `400 13px ${TYPE}`;
    g.textAlign = 'left';
    g.fillText('20 m', 26 + bar, this.height - 19);
  }

  drawCamp(c) {
    const g = this.g;
    const [x, y] = this.toScreen(c.x, c.z);
    const s = this.mini ? 0.5 : Math.max(1, this.view.scale / 3);
    g.strokeStyle = INK;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x, y - 26 * s);
    g.stroke();
    g.fillStyle = c.owner ? SIDE_COLOR[c.owner] : '#e8e0c8';
    g.beginPath();
    // a pennant with a wave in it
    g.moveTo(x, y - 26 * s);
    g.quadraticCurveTo(x + 9 * s, y - 27 * s, x + 19 * s, y - 22 * s);
    g.quadraticCurveTo(x + 9 * s, y - 19 * s, x, y - 15 * s);
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

  drawUnit(u, { selected = false, dim = false } = {}) {
    const g = this.g;
    if (u.state === 'evac') return;
    const [x, y] = this.toScreen(u.x, u.z);
    const r = this.radius(u);
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
    const down = u.state === 'down';
    const color = down ? '#8a8378' : SIDE_COLOR[u.side];
    g.save();
    g.globalAlpha = u.ghost ? 0.5 : dim ? 0.55 : 1;
    if (this.mini) {
      g.fillStyle = color;
      g.strokeStyle = INK;
      g.lineWidth = selected ? 2.5 : 1.5;
      g.beginPath();
      g.arc(x, y, selected ? r + 1.5 : r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (!u.ghost) {
        // facing tick
        g.beginPath();
        g.moveTo(x + Math.sin(u.yaw) * r, y + Math.cos(u.yaw) * r);
        g.lineTo(x + Math.sin(u.yaw) * (r + 4), y + Math.cos(u.yaw) * (r + 4));
        g.stroke();
      }
      g.restore();
      return;
    }
    // where it faces: an ink wedge just outside the shield
    if (!down && !u.ghost) {
      const fx = Math.sin(u.yaw), fz = Math.cos(u.yaw);
      const d0 = r * 1.18, d1 = r * 1.72, w = r * 0.42;
      g.fillStyle = color;
      g.strokeStyle = INK;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x + fx * d1, y + fz * d1);
      g.lineTo(x + fx * d0 - fz * w, y + fz * d0 + fx * w);
      g.lineTo(x + fx * d0 + fz * w, y + fz * d0 - fx * w);
      g.closePath();
      g.fill();
      g.stroke();
    }
    // the shield
    const k = r / 16;
    g.save();
    g.translate(x, y);
    g.scale(k, k);
    if (u.ghost) g.setLineDash([4, 3]);
    g.fillStyle = color;
    g.fill(SHIELD);
    g.lineWidth = 2.4;
    g.strokeStyle = INK;
    g.stroke(SHIELD);
    g.setLineDash([]);
    g.restore();
    g.fillStyle = '#f4ecd8';
    g.font = `700 ${Math.round(r * 0.78)}px ${TYPE}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(u.ghost ? '?' : down ? `${u.downTurns}` : SHORT[u.cls] || '?', x, y - r * 0.08);
    g.textBaseline = 'alphabetic';
    // health under the shield
    if (!u.ghost && !down) {
      const f = Math.max(0, u.hp / u.maxHp), bw = r * 1.7, by = y + r * 1.32;
      g.fillStyle = '#d9c9a5';
      g.fillRect(x - bw / 2, by, bw, 4);
      g.fillStyle = f > 0.5 ? '#6b9447' : f > 0.25 ? BRASS : '#b54a2a';
      g.fillRect(x - bw / 2, by, bw * f, 4);
      g.strokeStyle = INK;
      g.lineWidth = 1;
      g.strokeRect(x - bw / 2, by, bw, 4);
    }
    if (u.ghost) {
      g.fillStyle = INK;
      g.font = `700 ${Math.max(10, Math.round(r * 0.62))}px ${TYPE}`;
      g.fillText(`T${u.seenTurn}`, x, y + r * 1.75);
    }
    if (u.leader && !u.ghost) {
      g.fillStyle = BRASS;
      star(g, x + r * 0.95, y - r * 1.05, r * 0.45);
    }
    g.restore();
    if (selected) {
      const pulse = 1 + 0.12 * Math.sin(this.time * 6);
      g.strokeStyle = BRASS;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(x, y, (r + 7) * pulse, 0, Math.PI * 2);
      g.stroke();
    }
  }

  /** The selector: brass corner brackets turning slowly round the unit, and its paper label. */
  drawCursor(u, label) {
    const g = this.g;
    const [x, y] = this.toScreen(u.x, u.z);
    const r = this.radius(u) * 1.75 + 2 * Math.sin(this.time * 5);
    g.save();
    g.translate(x, y);
    g.rotate(this.time * 0.8);
    for (let k = 0; k < 4; k++) {
      g.rotate(Math.PI / 2);
      g.beginPath();
      g.moveTo(r, r * 0.45);
      g.lineTo(r, r);
      g.lineTo(r * 0.45, r);
      g.lineCap = 'square';
      g.strokeStyle = INK;
      g.lineWidth = 5.5;
      g.stroke();
      g.strokeStyle = BRASS;
      g.lineWidth = 3;
      g.stroke();
    }
    g.restore();
    if (!label) return;
    // the label: a slip of paper to the upper right, flipped inward near the map's edges
    g.font = `800 17px ${SERIF}`;
    const tw = g.measureText(label.title).width;
    g.font = `400 12px ${TYPE}`;
    const lw = g.measureText(label.line).width;
    const w = Math.max(tw, lw) + 20, h = 44;
    let lx = x + r + 6, ly = y - r - h + 6;
    if (lx + w > this.width - 8) lx = x - r - 6 - w;
    if (ly < 8) ly = y + r - 6;
    g.fillStyle = 'rgba(42,33,25,0.75)';
    g.fillRect(lx + 3, ly + 3, w, h);
    g.fillStyle = '#f7f0de';
    g.fillRect(lx, ly, w, h);
    g.fillStyle = u.side === 'fed' ? SIDE_COLOR.fed : SIDE_COLOR.imp;
    g.fillRect(lx, ly, 4, h);
    g.strokeStyle = INK;
    g.lineWidth = 1.5;
    g.strokeRect(lx, ly, w, h);
    g.fillStyle = INK;
    g.textAlign = 'left';
    g.font = `800 17px ${SERIF}`;
    g.fillText(label.title, lx + 11, ly + 19);
    g.font = `400 12px ${TYPE}`;
    g.fillStyle = '#5a4632';
    g.fillText(label.line, lx + 11, ly + 36);
  }
}

/** The label under the cursor for a unit as the player knows it. */
export function unitLabel(u, ap = null) {
  if (u.ghost) return { title: 'Unknown', line: `last seen turn ${u.seenTurn}` };
  const cls = CLASS_NAME[u.cls] || u.cls;
  if (u.side === 'fed') {
    const state = u.state === 'down' ? `DOWN · ${u.downTurns} turns` : ap != null ? `${cls} · AP ${Math.round(ap)} m` : cls;
    return { title: `${u.leader ? '★ ' : ''}${u.name}`, line: state };
  }
  return { title: u.kind === 'infantry' ? `Enemy ${cls}` : u.name, line: `HP ${u.hp}/${u.maxHp}` };
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
  g.font = `700 26px ${TYPE}`;
  for (let k = 0; k <= 10; k++) {
    const p = k * 20 * PX;
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, n);
    g.moveTo(0, p);
    g.lineTo(n, p);
    g.stroke();
    if (k < 10) {
      g.fillText('ABCDEFGHIJ'[k], p + 8, n * 0.075);
      g.fillText(String(k + 1), n * 0.065, p + 30);
    }
  }
  fadeEdges(g, n, rng);
}

/** Feather the map's edges to transparent with a ragged, blurred mask (a wash that ran dry). */
function fadeEdges(g, n, rng) {
  const mk = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(n, n) : Object.assign(document.createElement('canvas'), { width: n, height: n });
  const m = mk.getContext('2d');
  const inset = n * 0.05;
  m.filter = `blur(${Math.round(n * 0.012)}px)`;
  m.fillStyle = '#000';
  m.beginPath();
  // a wobbly rectangle: points along each side pushed in and out
  const pts = [];
  const side = (x0, y0, x1, y1) => {
    for (let k = 0; k < 24; k++) {
      const t = k / 24, j = (rng() - 0.5) * n * 0.025;
      const nx = y1 - y0, ny = x0 - x1, L = Math.hypot(nx, ny);
      pts.push([x0 + (x1 - x0) * t + (nx / L) * j, y0 + (y1 - y0) * t + (ny / L) * j]);
    }
  };
  side(inset, inset, n - inset, inset);
  side(n - inset, inset, n - inset, n - inset);
  side(n - inset, n - inset, inset, n - inset);
  side(inset, n - inset, inset, inset);
  pts.forEach(([x, y], i) => (i ? m.lineTo(x, y) : m.moveTo(x, y)));
  m.closePath();
  m.fill();
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(mk, 0, 0);
  g.globalCompositeOperation = 'source-over';
}

function inside(x, z, poly) {
  let ok = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ok = !ok;
  }
  return ok;
}
