import * as THREE from 'three';
import { PLANET_TYPES } from '../../world/planetTypes.js';
import { t, formatNumber } from '../../i18n/index.js';

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

const qualityLabel = (preset) => t(`pause.quality.${preset}`);

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
          <span class="wordmark">${t('space.system', { name: escapeHtml(system.name) })}<span class="wordmark__meta">${t('space.star', { type: escapeHtml(star.label) })}</span></span>
        </div>
        <div class="topbar__right">
          <button class="pill pill--ghost" type="button" data-act="hangar">${t('space.hangar')}</button>
          <button class="pill pill--ghost" type="button" data-act="map" aria-pressed="false">${t('space.map')}</button>
          <button class="pill pill--ghost" type="button" data-act="quality">${t('space.graphics')} <span data-quality></span></button>
        </div>
      </header>
      <nav class="system-list" aria-label="${t('space.planets.aria')}">
        <h2 class="system-list__title">${t('space.planets', { count: system.planets.length })}</h2>
        <ul>${system.planets
          .map(
            (p) => `<li><button type="button" class="planet-row" data-planet="${p.index}">
              <span class="planet-row__dot" style="background:${hex(TYPE_SWATCH[p.type])}"></span>
              <span class="planet-row__name">${escapeHtml(p.name)}</span>
              <span class="planet-row__meta">${PLANET_TYPES[p.type].label}${p.home ? t('space.row.home') : ''}${p.inhabited ? '' : p.landable ? t('space.row.wild') : ''}</span>
            </button></li>`
          )
          .join('')}</ul>
      </nav>
      <aside class="target-card" hidden aria-live="polite"></aside>
      <div class="flight-hud" role="status">
        <span class="flight-hud__speed"><span data-speed>0</span><small>${t('space.speed.unit')}</small></span>
        <span class="flight-hud__state" data-state>${t('space.state.free')}</span>
        <span class="flight-hud__keys">${t('space.keys')}</span>
      </div>
      <div class="space-labels" aria-hidden="true">${system.planets
        .map((p) => `<button type="button" tabindex="-1" class="space-label" data-planet="${p.index}"><span class="space-label__name">${escapeHtml(p.name)}</span></button>`)
        .join('')}<span class="space-label space-label--ship" data-ship>${t('space.ship')}</span></div>`;
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
    this.el.qualityLabel.textContent = qualityLabel(quality.preset);
    // The pause menu can change the preset too
    this.onQuality = () => (this.el.qualityLabel.textContent = qualityLabel(quality.preset));
    quality.listeners.add(this.onQuality);
    this.onClick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.planet !== undefined) return this.on.select(Number(b.dataset.planet), { fly: b.classList.contains('planet-row') || b.classList.contains('space-label') });
      const act = b.dataset.act;
      if (act === 'map') this.on.toggleMap();
      else if (act === 'quality') {
        const order = ['auto', 'high', 'medium', 'low'];
        quality.setPreset(order[(order.indexOf(quality.preset) + 1) % order.length]);
        this.el.qualityLabel.textContent = qualityLabel(quality.preset);
      } else if (act === 'hangar') this.on.hangar();
      else if (act === 'ship') this.on.pickShip(b.dataset.ship);
      else if (act === 'fly') this.on.fly(Number(b.dataset.index));
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
    const km = formatNumber(Math.round(p.radius * 1520));
    const rows = [
      [t('space.fact.orbit'), t('space.fact.orbit.value', { au })],
      [t('space.fact.radius'), `${km} km`],
      [t('space.fact.moons'), p.moons.length ? `${p.moons.length}` : t('planet.none')],
      [t('space.fact.inhabitants'), p.inhabited ? (cities ? t('space.fact.inhabitants.cities', { count: cities }) : t('space.fact.inhabitants.factions')) : t('planet.none')]
    ];
    if (p.ring) rows.push([t('space.fact.ring'), t('space.fact.ring.yes')]);
    const land = p.landable
      ? `<button type="button" class="pill" data-act="land" data-index="${p.index}"><span class="arrow-down" aria-hidden="true"></span>${t('space.land')}</button>`
      : '';
    const fly = orbiting
      ? ''
      : `<button type="button" class="pill ${p.landable ? 'pill--ghost' : ''}" data-act="fly" data-index="${p.index}">${t('space.fly')}</button>`;
    card.innerHTML = `
      <header class="target-card__head" style="--swatch:${hex(TYPE_SWATCH[p.type])}">
        <span class="card-block__eyebrow">${type.label}${p.home ? t('space.eyebrow.home') : ''}${orbiting ? t('space.eyebrow.orbit') : ''}</span>
        <h2 class="card-block__title">${escapeHtml(p.name)}</h2>
        <button type="button" class="menu-circle menu-circle--close menu-circle--small" data-act="close" aria-label="${t('space.close')}"><span></span><span></span></button>
      </header>
      <div class="info-card__content">
        <p class="target-card__desc">${type.desc}</p>
        <dl class="facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
        ${p.landable ? '' : `<p class="target-card__note">${t('space.nosurface')}</p>`}
        <div class="info-card__actions">${land}${fly}</div>
      </div>`;
    card.hidden = false;
  }

  /** Hangar card: the three ships with their handling, pick one to fly. */
  showHangar(ships, current) {
    const card = this.el.card;
    this.selected = null;
    this.el.rows.forEach((r) => r.classList.remove('is-selected'));
    const bar = (v, max) => `<span class="stat-bar"><i style="transform:scaleX(${Math.min(1, v / max).toFixed(2)})"></i></span>`;
    card.innerHTML = `
      <header class="target-card__head" style="--swatch:#d9d9d9">
        <span class="card-block__eyebrow">${t('space.hangar')}</span>
        <h2 class="card-block__title">${t('space.hangar.title')}</h2>
        <button type="button" class="menu-circle menu-circle--close menu-circle--small" data-act="close" aria-label="${t('space.close')}"><span></span><span></span></button>
      </header>
      <div class="info-card__content">
        ${Object.entries(ships)
          .map(
            ([key, s]) => `<section class="hangar-ship${key === current ? ' is-current' : ''}">
              <h3 class="hangar-ship__name">${escapeHtml(s.name)}${key === current ? ` <small>${t('space.hangar.current')}</small>` : ''}</h3>
              <p class="target-card__note">${escapeHtml(s.desc)}</p>
              <dl class="facts facts--bars">
                <dt>${t('space.hangar.speed')}</dt><dd>${bar(s.maxSpeed, 30)}</dd>
                <dt>${t('space.hangar.boost')}</dt><dd>${bar(s.boostSpeed, 95)}</dd>
                <dt>${t('space.hangar.agility')}</dt><dd>${bar(s.turn, 2.2)}</dd>
              </dl>
              ${key === current ? '' : `<button type="button" class="pill" data-act="ship" data-ship="${key}">${t('space.hangar.fly')}</button>`}
            </section>`
          )
          .join('')}
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
    this.quality.listeners.delete(this.onQuality);
    this.root.removeEventListener('click', this.onClick);
    this.root.innerHTML = '';
  }
}
