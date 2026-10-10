import { t, formatNumber } from '../i18n/index.js';
import { JOURNEY_PALETTE } from '../art/palette.js';
import { flashToast } from './toast.js';

// One line for the First Journey: what to do next, how far the door is, and the one
// message about saving that matters right now. It only reads the journey; it never
// decides whether a step is done. Names (planet, city) are set with textContent.

const HIDDEN_IN = new Set(['trade', 'home']);

/** The one saving message to show, worst first, or null. */
export function pickAlert({ journey, world }) {
  const s = journey.status;
  if (world?.mapSaveError) return { key: 'pause.save.mapError', menu: true };
  if (s.save === 'failed') return { key: 'journey.save.failed', menu: true };
  if (s.quarantine === 'failed') return { key: 'journey.quarantine.failed', menu: true };
  if (s.progressFailed) return { key: 'journey.progress.failed', menu: true };
  if (s.restoreFailed) return { key: 'journey.restore.failed', menu: true };
  if (s.quarantine === 'saved') return { key: 'journey.quarantined', menu: false, transient: true };
  return null;
}

export class ObjectiveHud {
  constructor(root, { journey, world = null, audio = null, openMenu = () => {}, notify = flashToast }) {
    this.root = root;
    this.journey = journey;
    this.world = world;
    this.audio = audio;
    this.openMenu = openMenu;
    this.notify = notify;
    this.lastAlert = null;
    this.noticeUntil = 0;
    for (const [name, value] of Object.entries(JOURNEY_PALETTE)) document.documentElement.style.setProperty(`--journey-${name}`, value);
    root.innerHTML = `
      <section class="journey-hud" hidden aria-label="${t('journey.objective')}">
        <p class="journey-hud__step" data-step></p>
        <p class="journey-hud__line"><span data-line></span><span class="journey-hud__distance" data-distance aria-hidden="true"></span></p>
        <p class="journey-hud__hint" data-hint></p>
        <p class="journey-hud__alert" data-alert hidden><span data-alert-text></span><button type="button" class="pill pill--ghost" data-act="menu">${t('journey.save.openMenu')}</button></p>
      </section>
      <div class="journey-complete" hidden>
        <section class="journey-complete__card" role="dialog" aria-modal="true" aria-labelledby="journeyDoneTitle">
          <span class="card-block__eyebrow">${t('journey.complete.eyebrow')}</span>
          <h2 id="journeyDoneTitle">${t('journey.complete.title')}</h2>
          <p>${t('journey.complete.text')}</p>
          <p class="journey-complete__hint">${t('journey.complete.homeHint')}</p>
          <button type="button" class="pill" data-act="close">${t('journey.complete.close')}</button>
        </section>
      </div>`;
    this.el = {
      hud: root.querySelector('.journey-hud'), step: root.querySelector('[data-step]'), line: root.querySelector('[data-line]'),
      distance: root.querySelector('[data-distance]'), hint: root.querySelector('[data-hint]'), alert: root.querySelector('[data-alert]'),
      alertText: root.querySelector('[data-alert-text]'), card: root.querySelector('.journey-complete')
    };
    this.onClick = (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (act === 'menu') this.openMenu();
      else if (act === 'close') this.closeCard();
    };
    this.onKey = (e) => {
      if (this.el.card.hidden) return;
      if (e.key === 'Escape' || e.key === 'Enter') { this.closeCard(); e.preventDefault(); e.stopImmediatePropagation(); }
    };
    root.addEventListener('click', this.onClick);
    window.addEventListener('keydown', this.onKey, { capture: true });
    this.onResize = () => this.place();
    window.addEventListener('resize', this.onResize);
    this.unsubscribe = journey.subscribe((event) => {
      if (event.type === 'toast') this.notify(t(event.key), event.key === 'journey.toast.j5' ? 4000 : 2800);
      else if (event.type === 'complete') this.celebrate();
      this.render();
    });
    this.render();
  }

  /** 12 px under whichever top bar is on screen, as the UX spec asks. */
  place() {
    let bottom = 0;
    for (const bar of document.querySelectorAll('.topbar')) {
      const rect = bar.getBoundingClientRect();
      if (rect.height && !bar.closest('[hidden]')) bottom = Math.max(bottom, rect.bottom);
    }
    this.el.hud.style.top = `${Math.round(bottom + 12)}px`;
  }

  render() {
    const { journey } = this;
    const objective = journey.objective();
    const hide = !objective || HIDDEN_IN.has(journey.view.mode);
    this.el.hud.hidden = hide;
    if (hide) return;
    this.place();
    const [lineKey, lineParams] = objective.line;
    this.el.step.textContent = t('journey.progress', { step: objective.step, total: objective.total });
    this.el.line.textContent = t(lineKey, lineParams);
    this.el.distance.textContent = objective.distance !== null && objective.distance !== undefined ? ` · ${t('journey.distance', { distance: formatNumber(objective.distance) })}` : '';
    const [hintKey, hintParams] = journey.status.save === 'pending' ? ['journey.save.pending'] : objective.hint;
    this.el.hint.textContent = t(hintKey, hintParams);
    this.renderAlert(pickAlert({ journey, world: this.world }));
  }

  renderAlert(alert) {
    if (alert?.transient && !this.noticeUntil) this.noticeUntil = Date.now() + 9000;
    const expired = alert?.transient && Date.now() > this.noticeUntil;
    if (!alert || expired) {
      this.el.alert.hidden = true;
      this.lastAlert = null;
      return;
    }
    this.el.alert.hidden = false;
    this.el.alert.querySelector('button').hidden = !alert.menu;
    if (this.lastAlert !== alert.key) {
      // announced once when it appears; distance and step changes are never announced
      this.el.alert.setAttribute('role', alert.menu ? 'alert' : 'status');
      this.el.alertText.textContent = t(alert.key);
      this.lastAlert = alert.key;
    }
  }

  celebrate() {
    this.previousFocus = document.activeElement;
    this.el.card.hidden = false;
    this.el.card.querySelector('[data-act="close"]').focus({ preventScroll: true });
    document.body.dataset.overlay = 'journey';
    this.audio?.fanfare?.();
  }

  closeCard() {
    this.el.card.hidden = true;
    if (document.body.dataset.overlay === 'journey') delete document.body.dataset.overlay;
    this.previousFocus?.focus?.({ preventScroll: true });
    this.render();
  }

  destroy() {
    this.unsubscribe();
    this.root.removeEventListener('click', this.onClick);
    window.removeEventListener('keydown', this.onKey, { capture: true });
    window.removeEventListener('resize', this.onResize);
    this.root.innerHTML = '';
  }
}
