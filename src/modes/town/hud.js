import { PLANET_TYPES } from '../../world/planetTypes.js';

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const QUALITY_LABEL = { auto: 'Auto', high: 'Tinggi', medium: 'Sedang', low: 'Rendah' };
const HINTS = {
  diorama: 'Seret untuk memutar, klik kanan atau dua jari untuk menggeser, scroll untuk zoom. Tombol 2 jalan kaki, 3 nyetir.',
  walk: 'WASD jalan, Shift lari, Spasi lompat, E masuk kendaraan. Seret untuk melihat sekeliling. Esc kembali ke diorama.',
  interior: 'WASD jalan, E pakai atau ambil barang, seret untuk memutar kamera, Esc keluar.',
  drive: 'W gas, S rem/mundur, A/D belok, Spasi rem tangan (drift), Shift ngebut, E turun. Seret untuk melihat sekeliling.'
};

/** Touch joystick (left thumb) for walking and driving on phones. */
class Joystick {
  constructor(root) {
    this.el = root.querySelector('.joystick');
    this.knob = this.el.querySelector('.joystick__knob');
    this.active = false;
    this.x = 0;
    this.y = 0;
    const R = 46;
    const move = (e) => {
      const r = this.el.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2);
      let dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy);
      if (d > R) {
        dx *= R / d;
        dy *= R / d;
      }
      this.x = dx / R;
      this.y = dy / R;
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    this.down = (e) => {
      this.active = true;
      this.el.setPointerCapture(e.pointerId);
      move(e);
      e.preventDefault();
    };
    this.move = (e) => this.active && move(e);
    this.up = () => {
      this.active = false;
      this.x = this.y = 0;
      this.knob.style.transform = '';
    };
    this.el.addEventListener('pointerdown', this.down);
    this.el.addEventListener('pointermove', this.move);
    this.el.addEventListener('pointerup', this.up);
    this.el.addEventListener('pointercancel', this.up);
  }
}

export class TownHud {
  constructor(root, { city, planet, layout, quality, on }) {
    this.root = root;
    this.on = on;
    const type = PLANET_TYPES[planet.type];
    const kind = `${city.type === 'capital' ? 'Ibukota' : 'Kota'} ${city.style === 'modern' ? 'modern' : 'fantasi'}`;
    const houses = layout.buildings.length;
    const pop = Math.round((houses * (layout.modern ? 38 : 6.5)) / 10) * 10;
    root.innerHTML = `
      <header class="topbar">
        <div class="crumbs">
          <button class="pill pill--ghost" type="button" data-act="liftoff" aria-label="Lepas landas ke planet"><span class="arrow-up" aria-hidden="true"></span>Lepas landas</button>
          <span class="wordmark">${escapeHtml(city.name)}<span class="wordmark__meta">${kind}, ${escapeHtml(planet.name)} (${type.label})</span></span>
        </div>
        <div class="topbar__right">
          <div class="seg" role="group" aria-label="Cara melihat kota">
            <button type="button" class="seg__btn" data-view="diorama" aria-pressed="true">Diorama</button>
            <button type="button" class="seg__btn" data-view="walk" aria-pressed="false">Jalan kaki</button>
            <button type="button" class="seg__btn" data-view="drive" aria-pressed="false">Nyetir</button>
          </div>
          <button class="pill pill--ghost town-quality" type="button" data-act="quality">Grafis: <span data-quality>${QUALITY_LABEL[quality.preset]}</span></button>
        </div>
      </header>
      <aside class="town-card">
        <dl class="facts">
          <dt>Penduduk</dt><dd>sekitar ${pop.toLocaleString('id-ID')}</dd>
          <dt>Bangunan</dt><dd>${houses}</dd>
          <dt>Jalan ke luar</dt><dd>${layout.exits.length ? layout.exits.map((e) => escapeHtml(e.to || '?')).join(', ') : 'Tidak ada'}</dd>
          <dt>Pelabuhan</dt><dd>${layout.isPort ? 'Ada' : 'Tidak ada'}</dd>
        </dl>
      </aside>
      <div class="town-hud" role="status"><span data-hint>${HINTS.diorama}</span></div>
      <button type="button" class="interact-prompt" hidden><kbd data-key>E</kbd><span data-prompt></span></button>
      <div class="joystick" aria-hidden="true" hidden><span class="joystick__knob"></span></div>`;
    this.hint = root.querySelector('[data-hint]');
    this.buttons = [...root.querySelectorAll('[data-view]')];
    this.joyEl = root.querySelector('.joystick');
    this.joystick = new Joystick(root);
    this.touch = matchMedia('(pointer: coarse)').matches;
    this.onClick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.view) this.on.view(b.dataset.view);
      else if (b.classList.contains('interact-prompt')) this.on.interact?.();
      else if (b.dataset.act === 'liftoff') this.on.liftoff();
      else if (b.dataset.act === 'quality') {
        const order = ['auto', 'high', 'medium', 'low'];
        quality.setPreset(order[(order.indexOf(quality.preset) + 1) % order.length]);
        root.querySelector('[data-quality]').textContent = QUALITY_LABEL[quality.preset];
      }
    };
    root.addEventListener('click', this.onClick);
  }

  setView(v) {
    const shown = v === 'interior' ? 'walk' : v;
    this.buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === shown)));
    this.hint.textContent = HINTS[v];
    this.joyEl.hidden = !(this.touch && v !== 'diorama');
    this.root.classList.toggle('is-street', v !== 'diorama');
  }

  /** Contextual action hint, e.g. "E  Masuk kendaraan" (tap it on touch screens). */
  setPrompt(text, key = 'E') {
    if (text === this.promptText) return;
    this.promptText = text;
    const el = this.root.querySelector('.interact-prompt');
    el.hidden = !text;
    if (text) {
      el.querySelector('[data-prompt]').textContent = text;
      el.querySelector('[data-key]').textContent = key;
    }
  }

  update() {}

  dispose() {
    this.root.removeEventListener('click', this.onClick);
    this.root.innerHTML = '';
    this.root.classList.remove('is-street');
  }
}
