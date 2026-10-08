import { PLANET_TYPES } from '../../../world/planetTypes.js';
import { cityNavigation } from '../../../ui/cityNavigation.js';
import { t, formatNumber } from '../../../i18n/index.js';

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const qualityLabel = (preset) => t(`pause.quality.${preset}`);
const hint = (id, pixel) => t(`town.${pixel ? 'pixelHint' : 'hint'}.${id}`);

/** Rough head count from the buildings (shared by the HUD and the town planner). */
export function estimatePopulation(layout) {
  return Math.round((layout.buildings.length * (layout.modern ? 38 : 6.5)) / 10) * 10;
}

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
  constructor(root, { city, cities = [], planet, layout, quality, on }) {
    this.root = root;
    this.on = on;
    const type = PLANET_TYPES[planet.type];
    const kind = t(`planet.card.${city.type === 'capital' ? 'capital' : 'city'}.${city.style === 'modern' ? 'modern' : 'fantasy'}`);
    const houses = layout.buildings.length;
    const pop = estimatePopulation(layout);
    root.innerHTML = `
      <header class="topbar">
        <div class="crumbs">
          <button class="pill pill--ghost" type="button" data-act="liftoff" aria-label="${t('town.liftoff.aria')}"><span class="arrow-up" aria-hidden="true"></span>${t('town.liftoff')}</button>
          <span class="wordmark">${escapeHtml(city.name)}<span class="wordmark__meta">${kind}, ${escapeHtml(planet.name)} (${type.label})</span></span>
        </div>
        <div class="topbar__right">
          <div class="seg town-style" role="group" aria-label="${t('town.style.aria')}">
            <button type="button" class="seg__btn" data-style="normal" aria-pressed="true">${t('town.style.normal')}</button>
            <button type="button" class="seg__btn" data-style="pixel" aria-pressed="false">${t('town.style.pixel')}</button>
          </div>
          <div class="seg" role="group" aria-label="${t('town.view.aria')}">
            <button type="button" class="seg__btn" data-view="diorama" aria-pressed="true">${t('town.view.diorama')}</button>
            <button type="button" class="seg__btn" data-view="walk" aria-pressed="false">${t('town.view.walk')}</button>
            <button type="button" class="seg__btn" data-view="drive" aria-pressed="false">${t('town.view.drive')}</button>
          </div>
          <button class="pill pill--ghost town-plan" type="button" data-act="plan" title="${t('town.plan.title')}">${t('town.plan')}</button>
          <button class="pill pill--ghost town-quality" type="button" data-act="quality">${t('space.graphics')} <span data-quality>${qualityLabel(quality.preset)}</span></button>
        </div>
      </header>
      <aside class="town-card">
        <dl class="facts">
          <dt>${t('town.fact.population')}</dt><dd>${t('town.about', { count: pop })}</dd>
          <dt>${t('town.fact.buildings')}</dt><dd>${houses}</dd>
          <dt>${t('town.fact.exits')}</dt><dd>${layout.exits.length ? layout.exits.map((e) => escapeHtml(e.to || '?')).join(', ') : t('planet.none')}</dd>
          <dt>${t('town.fact.port')}</dt><dd>${t(layout.isPort ? 'town.fact.port.yes' : 'planet.none')}</dd>
        </dl>
        ${cityNavigation(cities,city.index,'data-town-city')}
      </aside>
      <div class="pixel-zoom" role="group" aria-label="${t('town.zoom.aria')}" hidden>
        <span>${t('town.zoom')}</span>
        <button type="button" data-pixel-zoom="0" aria-pressed="false">${t('town.zoom.near')}</button>
        <button type="button" data-pixel-zoom="1" aria-pressed="true">${t('town.zoom.normal')}</button>
        <button type="button" data-pixel-zoom="2" aria-pressed="false">${t('town.zoom.far')}</button>
      </div>
      <div class="town-hud" role="status"><span data-hint>${hint('diorama')}</span></div>
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
      else if (b.dataset.style) this.on.style?.(b.dataset.style);
      else if (b.dataset.pixelZoom !== undefined) this.on.zoom?.(Number(b.dataset.pixelZoom));
      else if (b.dataset.townCity !== undefined) this.on.city?.(Number(b.dataset.townCity));
      else if (b.classList.contains('interact-prompt')) this.on.interact?.();
      else if (b.dataset.act === 'liftoff') this.on.liftoff();
      else if (b.dataset.act === 'plan') this.on.plan?.();
      else if (b.dataset.act === 'quality') {
        const order = ['auto', 'high', 'medium', 'low'];
        quality.setPreset(order[(order.indexOf(quality.preset) + 1) % order.length]);
        root.querySelector('[data-quality]').textContent = qualityLabel(quality.preset);
      }
    };
    root.addEventListener('click', this.onClick);
    this.quality = quality;
    this.onQuality = () => (root.querySelector('[data-quality]').textContent = qualityLabel(quality.preset));
    quality.listeners.add(this.onQuality);
    this.headerObserver = new ResizeObserver(entries => {
      root.style.setProperty('--pixel-header-height', `${entries[0].target.getBoundingClientRect().height}px`);
    });
    this.headerObserver.observe(root.querySelector('.topbar'));
  }

  setView(v) {
    this.view = v;
    const shown = v === 'interior' ? 'walk' : v;
    this.buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === shown)));
    this.hint.textContent = hint(v);
    this.joyEl.hidden = !(this.touch && v !== 'diorama');
    this.root.classList.toggle('is-street', v !== 'diorama');
    const plan = this.root.querySelector('[data-act="plan"]');
    if (plan) plan.disabled = v !== 'diorama';
    this.setStyle(this.style || 'normal', this.zoom ?? 1);
  }

  setStyle(style, zoom = 1) {
    this.style = style; this.zoom = zoom;
    const active = style === 'pixel' && this.view !== 'interior';
    this.root.classList.toggle('is-pixel', active);
    document.body.dataset.townStyle = active ? 'pixel' : 'normal';
    this.root.querySelectorAll('[data-style]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.style === style));
      button.disabled = this.view === 'interior';
    });
    this.root.querySelector('.pixel-zoom').hidden = !active;
    this.root.querySelectorAll('[data-pixel-zoom]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.pixelZoom) === zoom)));
    this.hint.textContent = hint(this.view || 'diorama', active);
  }

  setInteriorFloor(floor,total) {
    this.hint.textContent=`${t('town.floorHint', { floor: floor + 1, total })} · ${hint('interior')}`;
  }

  /** Contextual action hint, e.g. "E  Enter vehicle" (tap it on touch screens). */
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
    this.headerObserver.disconnect();
    this.quality.listeners.delete(this.onQuality);
    this.root.removeEventListener('click', this.onClick);
    this.root.innerHTML = '';
    this.root.classList.remove('is-street');
    this.root.classList.remove('is-pixel');
    this.root.style.removeProperty('--pixel-header-height');
    delete document.body.dataset.townStyle;
  }
}
