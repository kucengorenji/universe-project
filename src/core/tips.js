import { t } from '../i18n/index.js';
import { ScopedProgress } from '../world/scopedProgress.js';
import { TipPresence, tipMatches } from './tipPolicy.js';

// Onboarding: a title card on the very first visit, then one short tip the
// first time the player reaches each place or way of moving. Seen tips are
// remembered; the pause menu can bring them back.

const KEY = 'planet_globe_tips';
// The title card is for the person at this browser, not for each world: seeing it once is enough.
const INTRO_KEY = 'planet_globe_intro';
const introSeen = () => { try { return globalThis.localStorage?.getItem(INTRO_KEY) === '1'; } catch { return false; } };
const markIntroSeen = (seen) => { try { if (seen) globalThis.localStorage?.setItem(INTRO_KEY, '1'); else globalThis.localStorage?.removeItem(INTRO_KEY); } catch { /* optional */ } };
const overlayOpen = (on) => { if (typeof document !== 'undefined') { if (on) document.body.dataset.overlay = 'intro'; else if (document.body.dataset.overlay === 'intro') delete document.body.dataset.overlay; } };

const TIPS = {
  space: ['W', 'A', 'D', 'Shift'],
  planet: ['key.drag'],
  town: ['WASD', '2', '3'],
  walk: ['E'],
  drive: ['key.space', 'E'],
  interior: ['E', 'J'],
  rover: ['W', 'R', 'F'],
  home: ['key.click', 'key.drag']
};

export class Tips {
  /** Seen tips are remembered per world, like the mission log. */
  constructor(root, world = null) {
    this.root = root;
    this.world = world;
    this.store = new ScopedProgress(KEY);
    this.seen = new Set(this.load());
    this.presence = new TipPresence();
    this.context = null; // where the player is: tipPolicy.contextKey()
    this.reasons = new Set(); // why the card has to step aside right now ('prompt', 'overlay')
    world?.subscribe?.((event) => { if (event === 'world') this.switchWorld(); });
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

  get worldId() { return this.world?.worldId ?? 'default'; }

  get saveError() { return this.store.error; }

  load() {
    const saved = this.store.load(this.worldId, []);
    return Array.isArray(saved) ? saved : [];
  }

  save() {
    return this.store.save(this.worldId, [...this.seen]);
  }

  switchWorld() {
    this.seen = new Set(this.load());
    this.finish();
  }

  /** Title card on the first visit; resolves when the player starts. */
  intro() {
    if (this.seen.has('intro') || introSeen()) return Promise.resolve();
    this.el.intro.hidden = false;
    overlayOpen(true);
    this.root.querySelector('[data-act="start"]').focus({ preventScroll: true });
    return new Promise((res) => (this.introDone = res));
  }

  closeIntro() {
    this.el.intro.hidden = true;
    overlayOpen(false);
    this.seen.add('intro');
    markIntroSeen(true);
    this.save();
    this.introDone?.();
    // The tip for where we are shows right after
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      this.show(p);
    }
  }

  /** Show a tip once, only where it belongs. The newest place wins: a tip replaced within a moment comes back later. */
  show(id) {
    const keys = TIPS[id];
    if (!keys || this.seen.has(id) || this.current === id) return;
    if (this.context && !tipMatches(id, this.context)) return; // not seen: the player already moved on
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
    this.el.tip.classList.remove('is-out');
    this.presence.start(id, performance.now());
    this.sync();
    this.ticker ??= setInterval(() => this.sync(), 200);
  }

  /**
   * Where the player is now ('space', 'planet', 'town.walk', ...). A tip that belongs somewhere else
   * leaves at once, with no fade and without waiting for its timer.
   */
  setContext(context) {
    this.context = context;
    this.sync();
  }

  /** An action prompt or an overlay needs the bottom of the screen: the tip steps aside and keeps its time. */
  suppress(reason, on) {
    if (on === this.reasons.has(reason)) return;
    this.reasons[on ? 'add' : 'delete'](reason);
    this.sync();
  }

  /** Apply TipPresence to the card. */
  sync() {
    if (!this.current) return;
    const state = this.presence.step({ now: performance.now(), suppressed: this.reasons.size > 0, matches: !this.context || tipMatches(this.current, this.context) });
    if (state.over) return this.finish();
    this.el.tip.hidden = !state.visible;
  }

  finish() {
    clearInterval(this.ticker);
    this.ticker = null;
    this.presence.clear();
    this.el.tip.hidden = true;
    this.current = null;
  }

  /** The close button: the card fades and the tip counts as seen. */
  hide() {
    const el = this.el.tip;
    if (!this.current) return;
    clearInterval(this.ticker);
    this.ticker = null;
    this.presence.clear();
    if (el.hidden) { this.current = null; return; }
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
    markIntroSeen(false);
    this.save();
  }
}
