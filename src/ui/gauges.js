// Street HUD gauges shared by the modes that drive: a rotating town minimap
// and a speedometer with a fake gearbox readout.

import { JOURNEY_PALETTE } from '../art/palette.js';
import { minimapPin } from '../modes/town/ui/waypointMath.js';

/** Town minimap: a pre-painted plan of the town, turned so the view points up. */
export class Minimap {
  /**
   * layout   town layout (streets, buildings, walls, cityR, modern)
   * groundAt (x, z) -> height, for water
   * waterY   water level
   * doors    enterable doors [{ x, z }]
   */
  constructor(parent, { layout, groundAt, waterY, doors = [] }) {
    this.el = document.createElement('div');
    this.el.className = 'minimap';
    this.el.hidden = true;
    this.el.innerHTML = '<canvas aria-hidden="true"></canvas><span class="minimap__label" aria-hidden="true">U</span>';
    parent.appendChild(this.el);
    this.canvas = this.el.querySelector('canvas');
    this.north = this.el.querySelector('.minimap__label');
    this.ctx = this.canvas.getContext('2d');
    this.doors = doors;
    this.pin = null; // { x, z }: the home door of the First Journey
    this.size = 0;
    this.plan = this.paint(layout, groundAt, waterY);
  }

  paint(L, groundAt, waterY) {
    const R = Math.min(640, (L.cityR || 300) + 160);
    const res = 768;
    const m = (R * 2) / res;
    const c = document.createElement('canvas');
    c.width = c.height = res;
    const g = c.getContext('2d');
    g.setTransform(1 / m, 0, 0, 1 / m, R / m, R / m); // world metres, origin at the centre
    g.fillStyle = L.modern ? '#a4ad8e' : '#aeb382';
    g.fillRect(-R, -R, R * 2, R * 2);
    // Water from the height field (coarse is fine at this size)
    const n = 140;
    const step = (R * 2) / n;
    g.fillStyle = '#6d9ccb';
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -R + (i + 0.5) * step;
        const z = -R + (j + 0.5) * step;
        if (groundAt(x, z) < waterY + 0.05) g.fillRect(x - step / 2, z - step / 2, step + 0.6, step + 0.6);
      }
    }
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const s of L.streets || []) {
      g.strokeStyle = L.modern ? '#f1efe8' : '#e3cfa4';
      g.lineWidth = Math.max(3, s.w || 6);
      g.beginPath();
      s.pts.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
      g.stroke();
    }
    g.strokeStyle = '#6b6252';
    g.lineWidth = 2.5;
    for (const w of L.walls || []) {
      const dx = (Math.cos(w.yaw) * w.len) / 2;
      const dz = (Math.sin(w.yaw) * w.len) / 2;
      g.beginPath();
      g.moveTo(w.x - dx, w.z - dz);
      g.lineTo(w.x + dx, w.z + dz);
      g.stroke();
    }
    const box = (b, col) => {
      g.save();
      g.translate(b.x, b.z);
      g.rotate(b.yaw);
      g.fillStyle = col;
      g.fillRect(-b.w / 2, -b.d / 2, b.w, b.d);
      g.restore();
    };
    for (const b of L.buildings || []) box(b, L.landmark && b.x === L.landmark.x && b.z === L.landmark.z ? '#b8483f' : '#3d4350');
    this.R = R;
    return c;
  }

  show(on) {
    this.el.hidden = !on;
  }

  /** Mark one place with the house pin (or clear it with null). */
  setPin(point) {
    this.pin = point ? { x: point.x, z: point.z } : null;
  }

  /**
   * pos      { x, z } centre (player or car)
   * facing   yaw of the player/car (forward = (sin, cos))
   * view     { x, z } horizontal camera direction (points up on the map)
   * cars     [{ x, z }] other vehicles
   * radius   metres from the centre to the rim
   */
  draw(pos, facing, view, cars, radius, { doors = true } = {}) {
    const css = this.canvas.clientWidth;
    if (!css) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const S = Math.round(css * dpr);
    if (S !== this.size) {
      this.size = this.canvas.width = this.canvas.height = S;
    }
    const g = this.ctx;
    const h = S / 2;
    const k = h / radius;
    const len = Math.hypot(view.x, view.z) || 1;
    const fx = view.x / len;
    const fz = view.z / len;
    const rx = -fz;
    const rz = fx;
    const inView = p => {
      const x = p.x - pos.x, z = p.z - pos.z;
      return Math.abs(rx * x + rz * z) < radius && Math.abs(fx * x + fz * z) < radius;
    };
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath();
    g.rect(0, 0, S, S);
    g.clip();
    g.fillStyle = '#8f9678';
    g.fillRect(0, 0, S, S);
    // World -> map: x' = k (r . d), y' = -k (f . d), centred on pos
    g.setTransform(k * rx, -k * fx, k * rz, -k * fz, h - k * (rx * pos.x + rz * pos.z), h + k * (fx * pos.x + fz * pos.z));
    g.drawImage(this.plan, -this.R, -this.R, this.R * 2, this.R * 2);
    // Doors you can open, and the traffic
    g.fillStyle = '#fbb833';
    const dr = 2.2 / Math.max(0.4, k / dpr);
    if (doors) for (const d of this.doors) if (inView(d)) g.fillRect(d.x - dr, d.z - dr, dr * 2, dr * 2);
    g.fillStyle = '#fa4d43';
    const cr = 3 / Math.max(0.4, k / dpr);
    for (const c of cars) if (inView(c)) g.fillRect(c.x - cr, c.z - cr, cr * 2, cr * 2);
    g.setTransform(1, 0, 0, 1, 0, 0);
    // The home pin: upright whatever way the map turns; at the rim, with a chevron, when the door is out of range
    if (this.pin) {
      const p = minimapPin({ d: { x: this.pin.x - pos.x, z: this.pin.z - pos.z }, view, radius, rim: 0.74 });
      const px = h + p.x * h, py = h + p.y * h, u = 8 * dpr;
      g.lineWidth = 2 * dpr;
      g.lineJoin = 'round';
      g.strokeStyle = JOURNEY_PALETTE.outline;
      g.fillStyle = JOURNEY_PALETTE.target;
      g.beginPath();
      g.moveTo(px - u, py);
      g.lineTo(px, py - u);
      g.lineTo(px + u, py);
      g.lineTo(px + u, py + u * 0.9);
      g.lineTo(px - u, py + u * 0.9);
      g.closePath();
      g.fill();
      g.stroke();
      if (!p.inside) {
        g.save();
        g.translate(px, py);
        g.rotate(p.angle);
        g.beginPath();
        g.moveTo(u * 1.2, -u * 0.55);
        g.lineTo(u * 1.85, 0);
        g.lineTo(u * 1.2, u * 0.55);
        g.stroke();
        g.restore();
      }
    }
    // The player: an arrow turned by facing relative to the view
    const px = Math.sin(facing);
    const pz = Math.cos(facing);
    const a = Math.atan2(px * rx + pz * rz, px * fx + pz * fz);
    g.translate(h, h);
    g.rotate(a);
    g.fillStyle = '#1f1f1f';
    g.strokeStyle = '#d9d9d9';
    g.lineWidth = 2 * dpr;
    const u = 7 * dpr;
    g.beginPath();
    g.moveTo(0, -u * 1.3);
    g.lineTo(u, u);
    g.lineTo(0, u * 0.45);
    g.lineTo(-u, u);
    g.closePath();
    g.stroke();
    g.fill();
    g.restore();
    // North (-Z) marker on the rim
    const na = Math.atan2(-rz, -fz); // screen angle of world -Z
    const nr = (css / 2 - 12) / Math.max(Math.abs(Math.sin(na)), Math.abs(Math.cos(na)));
    this.north.style.transform = `translate(${Math.sin(na) * nr}px, ${-Math.cos(na) * nr}px)`;
  }

  dispose() {
    this.el.remove();
  }
}

/** Speed readout: big number, unit, gear and a bar. */
export class Speedo {
  constructor(parent, { unit = 'km/j' } = {}) {
    this.el = document.createElement('div');
    this.el.className = 'speedo';
    this.el.hidden = true;
    this.el.innerHTML = `<div class="speedo__num"><b data-v>0</b><span>${unit}</span></div><div class="speedo__row"><i class="speedo__bar"><i data-bar></i></i><span class="speedo__gear" data-g>N</span></div>`;
    parent.appendChild(this.el);
    this.v = this.el.querySelector('[data-v]');
    this.g = this.el.querySelector('[data-g]');
    this.bar = this.el.querySelector('[data-bar]');
    this.last = '';
  }

  show(on) {
    this.el.hidden = !on;
  }

  /** value in display units, frac 0..1 of top speed, gear label. */
  set(value, frac, gear) {
    const key = `${Math.round(value)}|${gear}|${Math.round(frac * 50)}`;
    if (key === this.last) return;
    this.last = key;
    this.v.textContent = Math.round(value);
    this.g.textContent = gear;
    this.bar.style.transform = `scaleX(${Math.min(1, Math.max(0, frac)).toFixed(3)})`;
    this.el.classList.toggle('is-red', frac > 0.92);
  }

  dispose() {
    this.el.remove();
  }
}
