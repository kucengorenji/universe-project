import { drawTownMap } from './townMapRenderer.js';
import { estimatePopulation } from '../ui/hud.js';
import { t, formatNumber } from '../../../i18n/index.js';

// The 2D town planner: reroll the settlement on a Watabou-style plan, pick a
// density, step back through earlier rolls, then apply. Applying rebuilds the
// 3D town from exactly the layout shown here. Pure DOM + canvas 2D: the
// generator is passed in, so this module never touches three.js.

const DENSITY = [
  { value: 0.75, key: 'sparse' },
  { value: 1, key: 'normal' },
  { value: 1.3, key: 'dense' }
];
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class TownPlanner {
  /**
   * @param {object} o
   *   name, footprints, layout + choice: the town as it stands now
   *   generate({ variant, density }) -> layout
   *   hasRooms(layout) -> true when rooms were changed in that layout
   *   onApply({ variant, density }), onClose()
   */
  constructor({ name, layout, choice, footprints, generate, hasRooms, onApply, onClose }) {
    this.name = name;
    this.footprints = footprints;
    this.generate = generate;
    this.hasRooms = hasRooms;
    this.onApply = onApply;
    this.onClose = onClose;
    this.start = { ...choice };
    this.history = [{ ...choice, layout }];
    this.index = 0;
    this.busy = false;

    const el = (this.el = document.createElement('div'));
    el.className = 'planner';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', t('planner.aria', { name }));
    el.innerHTML = `
      <div class="planner__map">
        <canvas class="planner__canvas" aria-label="${t('planner.canvas')}"></canvas>
        <div class="planner__busy" hidden><span class="cover__spinner" aria-hidden="true"></span><span data-busy>${t('planner.busy.plan')}</span></div>
      </div>
      <aside class="planner__panel">
        <p class="planner__eyebrow">${t('town.plan')}</p>
        <h2 class="planner__title">${escapeHtml(name)}</h2>
        <dl class="facts planner__facts">
          <dt>${t('planner.fact.plan')}</dt><dd data-f="plan"></dd>
          <dt>${t('town.fact.buildings')}</dt><dd data-f="buildings"></dd>
          <dt>${t('town.fact.population')}</dt><dd data-f="pop"></dd>
          <dt>${t('planner.fact.trees')}</dt><dd data-f="trees"></dd>
        </dl>
        <div class="planner__group">
          <span class="planner__label" id="plannerDensity">${t('planner.density')}</span>
          <div class="seg" role="group" aria-labelledby="plannerDensity">
            ${DENSITY.map((d) => `<button type="button" class="seg__btn" data-density="${d.value}" aria-pressed="false">${t(`planner.density.${d.key}`)}</button>`).join('')}
          </div>
        </div>
        <div class="planner__row">
          <button type="button" class="pill pill--ghost" data-act="prev">${t('planner.prev')}</button>
          <button type="button" class="pill" data-act="reroll">${t('planner.reroll')}</button>
        </div>
        <button type="button" class="pill pill--ghost planner__original" data-act="original">${t('planner.original')}</button>
        <p class="planner__note" data-rooms hidden></p>
        <div class="planner__actions">
          <button type="button" class="pill pill--ghost" data-act="cancel">${t('planner.cancel')}</button>
          <button type="button" class="pill planner__apply" data-act="apply">${t('planner.apply')}</button>
        </div>
        <p class="planner__keys"><kbd>Enter</kbd> ${t('planner.keys.reroll')} · <kbd>Backspace</kbd> ${t('planner.keys.prev')} · <kbd>Esc</kbd> ${t('planner.keys.cancel')}</p>
      </aside>`;
    document.body.append(el);
    this.canvas = el.querySelector('canvas');
    this.busyEl = el.querySelector('.planner__busy');

    this.onClick = (e) => {
      const b = e.target.closest('button');
      if (!b || this.busy) return;
      if (b.dataset.density) this.roll({ density: Number(b.dataset.density), variant: this.current.variant });
      else if (b.dataset.act === 'reroll') this.roll({ density: this.current.density, variant: newVariant() });
      else if (b.dataset.act === 'prev') this.step(-1);
      else if (b.dataset.act === 'original') this.roll({ variant: 0, density: 1 });
      else if (b.dataset.act === 'cancel') this.close();
      else if (b.dataset.act === 'apply') this.apply();
    };
    this.onKey = (e) => {
      if (this.busy) return;
      if (e.key === 'Enter') this.roll({ density: this.current.density, variant: newVariant() });
      else if (e.key === 'Backspace') this.step(-1);
      else if (e.key === 'Escape') this.close();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    this.onResize = () => this.draw();
    el.addEventListener('click', this.onClick);
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('resize', this.onResize);
    this.show();
    el.querySelector('[data-act="reroll"]').focus();
  }

  get current() {
    return this.history[this.index];
  }

  /** Generate a plan after the busy state has painted (generation blocks for a few hundred ms). */
  roll(choice) {
    const same = this.history.findIndex((h) => h.variant === choice.variant && h.density === choice.density);
    if (same >= 0) {
      this.index = same;
      this.show();
      return;
    }
    this.setBusy(t('planner.busy.plan'));
    setTimeout(() => {
      try {
        const layout = this.generate(choice);
        this.history.splice(this.index + 1);
        this.history.push({ ...choice, layout });
        this.index = this.history.length - 1;
      } finally {
        this.setBusy(null);
        this.show();
      }
    }, 30);
  }

  step(delta) {
    const i = Math.max(0, Math.min(this.history.length - 1, this.index + delta));
    if (i === this.index) return;
    this.index = i;
    this.show();
  }

  apply() {
    const { variant, density } = this.current;
    if (variant === this.start.variant && density === this.start.density) return this.close();
    this.setBusy(t('planner.busy.build'));
    this.onApply({ variant, density });
  }

  close() {
    this.onClose?.();
  }

  setBusy(text) {
    this.busy = !!text;
    this.busyEl.hidden = !text;
    if (text) this.busyEl.querySelector('[data-busy]').textContent = text;
    this.el.querySelectorAll('button').forEach((b) => (b.disabled = !!text));
  }

  show() {
    const { layout, variant, density } = this.current;
    const f = (k) => this.el.querySelector(`[data-f="${k}"]`);
    f('plan').textContent = variant ? t('planner.variant', { id: String(variant).slice(-6) }) : t('planner.originalPlan');
    f('buildings').textContent = formatNumber(layout.buildings.length);
    f('pop').textContent = t('town.about', { count: estimatePopulation(layout) });
    f('trees').textContent = formatNumber(layout.trees.filter((tree) => tree.asset.startsWith('t_')).length);
    this.el.querySelectorAll('[data-density]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.density) === density)));
    this.el.querySelector('[data-act="prev"]').disabled = this.index === 0;
    this.el.querySelector('[data-act="original"]').disabled = variant === 0 && density === 1;
    const changed = !(variant === this.start.variant && density === this.start.density);
    const apply = this.el.querySelector('[data-act="apply"]');
    apply.textContent = t(changed ? 'planner.apply' : 'planner.close');
    const note = this.el.querySelector('[data-rooms]');
    const rooms = changed && this.hasRooms(this.history[0].layout);
    note.hidden = !rooms;
    if (rooms) note.textContent = t('planner.rooms');
    this.draw();
  }

  draw() {
    const box = this.canvas.parentElement.getBoundingClientRect();
    const size = Math.max(200, Math.floor(Math.min(box.width, box.height)));
    const ratio = 2; // plans are line art: always draw at twice the CSS size
    this.canvas.style.width = this.canvas.style.height = `${size}px`;
    this.canvas.width = this.canvas.height = Math.round(size * ratio);
    const ctx = this.canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const { layout } = this.current;
    drawTownMap(ctx, layout, {
      size,
      footprints: this.footprints,
      title: this.name,
      subtitle: t('planner.subtitle', { count: estimatePopulation(layout) })
    });
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('resize', this.onResize);
    this.el.removeEventListener('click', this.onClick);
    this.el.remove();
  }
}

/** A fresh variant number (1..2^31); the layout itself is deterministic from it. */
function newVariant() {
  return 1 + Math.floor(Math.random() * 0x7ffffffe);
}
