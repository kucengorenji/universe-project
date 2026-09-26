import * as THREE from 'three';
import { PLANET_TYPES } from '../../world/planetTypes.js';

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const _v = new THREE.Vector3();

// Swatch per archetype for the planet list and labels
export const TYPE_SWATCH = {
  terran: 0x4f9d4a,
  ocean: 0x1f86c9,
  desert: 0xe0a85a,
  ice: 0xcfe3f2,
  lava: 0xe8521a,
  barren: 0x9c978f,
  gas: 0xd6b27c
};

const QUALITY_LABEL = { auto: 'Auto', high: 'Tinggi', medium: 'Sedang', low: 'Rendah' };

/** DOM overlay of the space mode. Emits intents through `on`; never touches the scene. */
export class SpaceHud {
  constructor(root, { system, on, quality }) {
    this.root = root;
    this.system = system;
    this.on = on;
    this.quality = quality;
    this.selected = null;
    const star = system.star;
    root.innerHTML = `
      <header class="topbar">
        <div class="crumbs">
          <span class="wordmark">Sistem ${escapeHtml(system.name)}<span class="wordmark__meta">Bintang ${escapeHtml(star.label)}</span></span>
        </div>
        <div class="topbar__right">
          <button class="pill pill--ghost" type="button" data-act="map" aria-pressed="false">Peta sistem</button>
          <button class="pill pill--ghost" type="button" data-act="quality">Grafis: <span data-quality></span></button>
        </div>
      </header>
      <nav class="system-list" aria-label="Planet di sistem ini">
        <h2 class="system-list__title">${system.planets.length} planet</h2>
        <ul>${system.planets
          .map(
            (p) => `<li><button type="button" class="planet-row" data-planet="${p.index}">
              <span class="planet-row__dot" style="background:${hex(TYPE_SWATCH[p.type])}"></span>
              <span class="planet-row__name">${escapeHtml(p.name)}</span>
              <span class="planet-row__meta">${PLANET_TYPES[p.type].label}${p.home ? ', rumah' : ''}${p.inhabited ? '' : p.landable ? ', liar' : ''}</span>
            </button></li>`
          )
          .join('')}</ul>
      </nav>
      <aside class="target-card" hidden aria-live="polite"></aside>
      <div class="flight-hud" role="status">
        <span class="flight-hud__speed"><span data-speed>0</span><small>u/dtk</small></span>
        <span class="flight-hud__state" data-state>Terbang bebas</span>
        <span class="flight-hud__keys">W/S dorong, A/D belok, Q/E geser, R/F naik turun, Shift boost. Klik planet untuk autopilot.</span>
      </div>
      <div class="space-labels" aria-hidden="true">${system.planets
        .map((p) => `<button type="button" tabindex="-1" class="space-label" data-planet="${p.index}"><span class="space-label__name">${escapeHtml(p.name)}</span></button>`)
        .join('')}<span class="space-label space-label--ship" data-ship>Kapal</span></div>`;
    this.el = {
      card: root.querySelector('.target-card'),
      speed: root.querySelector('[data-speed]'),
      state: root.querySelector('[data-state]'),
      mapBtn: root.querySelector('[data-act="map"]'),
      qualityLabel: root.querySelector('[data-quality]'),
      labels: [...root.querySelectorAll('.space-label[data-planet]')],
      shipLabel: root.querySelector('[data-ship]'),
      rows: [...root.querySelectorAll('.planet-row')]
    };
    this.el.qualityLabel.textContent = QUALITY_LABEL[quality.preset];
    this.onClick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.planet !== undefined) return this.on.select(Number(b.dataset.planet), { fly: b.classList.contains('planet-row') || b.classList.contains('space-label') });
      const act = b.dataset.act;
      if (act === 'map') this.on.toggleMap();
      else if (act === 'quality') {
        const order = ['auto', 'high', 'medium', 'low'];
        quality.setPreset(order[(order.indexOf(quality.preset) + 1) % order.length]);
        this.el.qualityLabel.textContent = QUALITY_LABEL[quality.preset];
      } else if (act === 'fly') this.on.fly(Number(b.dataset.index));
      else if (act === 'land') this.on.land(Number(b.dataset.index));
      else if (act === 'close') this.on.select(null);
    };
    root.addEventListener('click', this.onClick);
  }

  setMap(on) {
    this.el.mapBtn.setAttribute('aria-pressed', String(on));
    this.root.classList.toggle('is-map', on);
  }

  /** Target card: what the planet is and what you can do there. */
  showCard(p, { orbiting, cities }) {
    const card = this.el.card;
    this.selected = p;
    this.el.rows.forEach((r) => r.classList.toggle('is-selected', p && Number(r.dataset.planet) === p.index));
    if (!p) {
      card.hidden = true;
      return;
    }
    const type = PLANET_TYPES[p.type];
    const au = (p.orbit / 150).toFixed(2);
    const km = Math.round(p.radius * 1520).toLocaleString('id-ID');
    const rows = [
      ['Orbit', `${au} SA dari bintang`],
      ['Radius', `${km} km`],
      ['Bulan', p.moons.length ? `${p.moons.length}` : 'Tidak ada'],
      ['Penghuni', p.inhabited ? (cities ? `${cities} kota, dua faksi` : 'Dua faksi') : 'Tidak ada']
    ];
    if (p.ring) rows.push(['Cincin', 'Ada']);
    const land = p.landable
      ? `<button type="button" class="pill" data-act="land" data-index="${p.index}"><span class="arrow-down" aria-hidden="true"></span>Mendarat</button>`
      : '';
    const fly = orbiting
      ? ''
      : `<button type="button" class="pill ${p.landable ? 'pill--ghost' : ''}" data-act="fly" data-index="${p.index}">Terbang ke orbit</button>`;
    card.innerHTML = `
      <header class="target-card__head" style="--swatch:${hex(TYPE_SWATCH[p.type])}">
        <span class="card-block__eyebrow">${type.label}${p.home ? ', planet rumah' : ''}${orbiting ? ', di orbit' : ''}</span>
        <h2 class="card-block__title">${escapeHtml(p.name)}</h2>
        <button type="button" class="menu-circle menu-circle--close menu-circle--small" data-act="close" aria-label="Tutup"><span></span><span></span></button>
      </header>
      <div class="info-card__content">
        <p class="target-card__desc">${type.desc}</p>
        <dl class="facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
        ${p.landable ? '' : '<p class="target-card__note">Tidak ada permukaan padat. Bisa diorbit, tidak bisa didarati.</p>'}
        <div class="info-card__actions">${land}${fly}</div>
      </div>`;
    card.hidden = false;
  }

  setStatus(speed, state) {
    const s = Math.round(speed);
    if (s !== this.lastSpeed) {
      this.el.speed.textContent = s;
      this.lastSpeed = s;
    }
    if (state !== this.lastState) {
      this.el.state.textContent = state;
      this.lastState = state;
    }
  }

  /** Screen-space labels; `items` = [{ pos, radius }] per planet in world space. */
  updateLabels(camera, width, height, bodies, shipPos, mapMode) {
    const planets = bodies.planets;
    for (let i = 0; i < planets.length; i++) {
      const pl = planets[i];
      const el = this.el.labels[i];
      _v.copy(pl.holder.position);
      const dist = _v.distanceTo(camera.position);
      _v.y += pl.def.radius * 1.25;
      _v.project(camera);
      const visible = _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
      // Up close the planet speaks for itself; far away the label is the target
      const near = !mapMode && dist < pl.def.radius * 5;
      if (!visible || near) {
        if (el.style.opacity !== '0') el.style.opacity = '0';
        el.style.pointerEvents = 'none';
        continue;
      }
      el.style.opacity = '1';
      el.style.pointerEvents = 'auto';
      el.style.transform = `translate(${((_v.x + 1) / 2) * width}px, ${((1 - _v.y) / 2) * height}px) translate(-50%, -100%)`;
      el.classList.toggle('is-selected', this.selected?.index === pl.def.index);
    }
    const s = this.el.shipLabel;
    if (mapMode) {
      _v.copy(shipPos).project(camera);
      s.style.opacity = _v.z < 1 ? '1' : '0';
      s.style.transform = `translate(${((_v.x + 1) / 2) * width}px, ${((1 - _v.y) / 2) * height}px) translate(-50%, 6px)`;
    } else s.style.opacity = '0';
  }

  dispose() {
    this.root.removeEventListener('click', this.onClick);
    this.root.innerHTML = '';
  }
}
