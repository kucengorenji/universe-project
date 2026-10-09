import { t } from '../i18n/index.js';

// Onboarding: a title card on the very first visit, then one short tip the
// first time the player reaches each place or way of moving. Seen tips are
// remembered; the pause menu can bring them back.

const KEY = 'planet_globe_tips';

const TIPS = {
  space: ['W', 'A', 'D', 'Shift'],
  planet: ['key.drag'],
  town: ['WASD', '2', '3'],
  walk: ['E'],
  drive: ['key.space', 'E'],
  interior: ['E', 'J'],
  rover: ['W', 'R', 'F']
};

export class Tips {
  constructor(root) {
    this.root = root;
    this.seen = new Set(this.load());
    root.innerHTML = `
      <aside class="tip" hidden role="status" aria-live="polite">
        <div class="tip__keys" data-keys></div>
        <div class="tip__body"><strong data-title></strong><p data-text></p></div>
        <button type="button" class="menu-circle menu-circle--close menu-circle--small" data-act="dismiss" aria-label="${t('tips.close')}"><span></span><span></span></button>
      </aside>
      <div class="intro" hidden>
        <section class="intro__card" role="dialog" aria-modal="true" aria-labelledby="introTitle">
          <span class="card-block__eyebrow">${t('intro.eyebrow')}</span>
          <h1 id="introTitle" class="intro__title">Planet Globe</h1>
          <p class="intro__lead">${t('intro.lead')}</p>
          <ol class="intro__steps">
            <li><strong>${t('intro.space')}</strong><span>${t('intro.space.text')}</span></li>
            <li><strong>${t('intro.planet')}</strong><span>${t('intro.planet.text')}</span></li>
            <li><strong>${t('intro.town')}</strong><span>${t('intro.town.text')}</span></li>
          </ol>
          <p class="intro__hint">${t('intro.hint')}</p>
          <p class="intro__privacy">${t('intro.privacy')}</p>
          <button type="button" class="pill" data-act="start">${t('intro.start')}</button>
        </section>
      </div>`;
    this.el = {
      tip: root.querySelector('.tip'),
      keys: root.querySelector('[data-keys]'),
      title: root.querySelector('[data-title]'),
      text: root.querySelector('[data-text]'),
      intro: root.querySelector('.intro')
    };
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b?.dataset.act === 'dismiss') this.hide();
      else if (b?.dataset.act === 'start') this.closeIntro();
    });
    window.addEventListener(
      'keydown',
      (e) => {
        if (this.el.intro.hidden) return;
        if (['Enter', ' ', 'Escape'].includes(e.key)) this.closeIntro();
        e.preventDefault();
        e.stopImmediatePropagation();
      },
      { capture: true }
    );
  }

  load() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '[]');
    } catch {
      return [];
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify([...this.seen]));
    } catch {
      /* optional */
    }
  }

  /** Title card on the first visit; resolves when the player starts. */
  intro() {
    if (this.seen.has('intro')) return Promise.resolve();
    this.el.intro.hidden = false;
    this.root.querySelector('[data-act="start"]').focus({ preventScroll: true });
    return new Promise((res) => (this.introDone = res));
  }

  closeIntro() {
    this.el.intro.hidden = true;
    this.seen.add('intro');
    this.save();
    this.introDone?.();
    // The tip for where we are shows right after
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      this.show(p);
    }
  }

  /** Show a tip once. The newest place wins: a tip replaced within a moment comes back later. */
  show(id) {
    const keys = TIPS[id];
    if (!keys || this.seen.has(id) || this.current === id) return;
    if (!this.el.intro.hidden) {
      this.pending = id;
      return;
    }
    if (this.current && performance.now() - this.shownAt < 3000) this.seen.delete(this.current);
    this.seen.add(id);
    this.shownAt = performance.now();
    this.save();
    this.current = id;
    this.el.keys.innerHTML = keys.map((k) => `<kbd>${k.startsWith('key.') ? t(`controls.${k}`) : k}</kbd>`).join('');
    this.el.title.textContent = t(`tips.${id}.title`);
    this.el.text.textContent = t(`tips.${id}.text`);
    this.el.tip.hidden = false;
    this.el.tip.classList.remove('is-out');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.hide(), 11000);
  }

  hide() {
    clearTimeout(this.timer);
    const el = this.el.tip;
    if (el.hidden) return;
    el.classList.add('is-out');
    const was = this.current;
    setTimeout(() => {
      if (this.current !== was) return; // a newer tip took over
      el.hidden = true;
      this.current = null;
    }, 300);
  }

  /** Forget everything (pause menu): tips show again from the next place visited. */
  reset() {
    this.seen.clear();
    this.save();
  }
}
