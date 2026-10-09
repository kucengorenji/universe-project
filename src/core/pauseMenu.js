import { t, getLocale, setLocale, LOCALES } from '../i18n/index.js';
import { saveStatus } from '../world/saveStatus.js';

// Pause menu: stops the world and gathers the settings in one place.
//   Graphics   quality preset, post effects
//   Sound      master / music / effects volume, mute
//   Controls   keys per mode
//   More       language, show the tips again, reset the missions
// P (or the round button) opens it, Esc or "Resume" closes it, B mutes anywhere.

const QUALITY = ['auto', 'high', 'medium', 'low'];
const POST = ['auto', 'on', 'off'];
// [group, [[key label or i18n key, i18n description key]]]
const CONTROLS = [
  ['space', [['W / S', 'thrust'], ['A / D', 'turn'], ['Q / E', 'strafe'], ['R / F', 'climb'], ['Shift', 'boost'], ['L', 'land'], ['key.click', 'autopilot'], ['M', 'map']]],
  ['planet', [['key.drag', 'rotate'], ['key.clickCity', 'viewCity'], ['key.fly', 'fly'], ['O', 'orbit']]],
  ['trade', [['B', 'build'], ['R', 'route'], ['key.space', 'pause'], ['1 / 2 / 4', 'speed'], ['F', 'focus'], ['Esc', 'cancel']]],
  ['town', [['1 2 3', 'views'], ['WASD', 'move'], ['Shift', 'run'], ['key.space', 'jump'], ['E', 'enter'], ['Esc', 'exit']]],
  ['general', [['J', 'missions'], ['P', 'pause'], ['B', 'mute']]]
];

export class PauseMenu {
  constructor(root, { engine, audio, missions, tips, world }) {
    this.world = world;
    this.root = root;
    this.engine = engine;
    this.audio = audio;
    this.missions = missions;
    this.tips = tips;
    this.open = false;
    root.innerHTML = `
      <button type="button" class="menu-circle pause-toggle" data-act="open" aria-label="${t('pause.open')}" title="${t('pause.openTitle')}"><span></span><span></span><span></span></button>
      <div class="pause" hidden>
        <section class="pause__panel" role="dialog" aria-modal="true" aria-labelledby="pauseTitle">
          <header class="pause__head">
            <span class="card-block__eyebrow">${t('pause.eyebrow')}</span>
            <h2 id="pauseTitle" class="pause__title">${t('pause.title')}</h2>
          </header>
          <div class="pause__body">
            <div class="pause__col">
            <section class="pause__group">
              <h3>${t('pause.graphics')}</h3>
              <div class="pause__row"><span>${t('pause.quality')}</span><div class="seg seg--small" data-seg="quality">${QUALITY.map((k) => `<button type="button" class="seg__btn" data-val="${k}">${t(`pause.quality.${k}`)}</button>`).join('')}</div></div>
              <div class="pause__row"><span>${t('pause.effects')} <small>${t('pause.effects.hint')}</small></span><div class="seg seg--small" data-seg="post">${POST.map((k) => `<button type="button" class="seg__btn" data-val="${k}">${t(`pause.post.${k}`)}</button>`).join('')}</div></div>
            </section>
            <section class="pause__group">
              <h3>${t('pause.more')}</h3>
              <div class="pause__row"><span>${t('pause.language')}</span><div class="seg seg--small" data-seg="language">${LOCALES.map((l) => `<button type="button" class="seg__btn" data-locale="${l.code}" lang="${l.code}" aria-pressed="${l.code === getLocale()}">${l.label}</button>`).join('')}</div></div>
              <div class="pause__row" data-save-status role="status"></div>
              <div class="pause__row"><span>${t('pause.tips')}</span><button type="button" class="pill pill--ghost pill--small" data-act="tips">${t('pause.tips.show')}</button></div>
              <div class="pause__row"><span>${t('pause.missions')}</span><button type="button" class="pill pill--ghost pill--small" data-act="reset">${t('pause.missions.reset')}</button></div>
            </section>
            </div>
            <section class="pause__group">
              <h3>${t('pause.sound')}</h3>
              ${['master', 'music', 'sfx']
                .map((k) => `<label class="pause__row"><span>${t(`pause.sound.${k}`)}</span><input type="range" min="0" max="100" step="1" data-vol="${k}" aria-label="${t('pause.sound.volume', { name: t(`pause.sound.${k}`) })}"></label>`)
                .join('')}
              <div class="pause__row"><span>${t('pause.mute')} <small>${t('pause.mute.hint')}</small></span><button type="button" class="pill pill--ghost pill--small" data-act="mute" aria-pressed="false"></button></div>
            </section>
            <section class="pause__group pause__group--wide">
              <h3>${t('pause.controls')}</h3>
              <div class="pause__keys">${CONTROLS.map(
                ([group, rows]) => `<div><h4>${t(`controls.${group}`)}</h4><dl>${rows.map(([k, v]) => `<dt><kbd>${k.startsWith('key.') ? t(`controls.${k}`) : k}</kbd></dt><dd>${t(`controls.${group}.${v}`)}</dd>`).join('')}</dl></div>`
              ).join('')}</div>
            </section>
          </div>
          <footer class="pause__foot"><button type="button" class="pill" data-act="close">${t('pause.resume')}</button></footer>
        </section>
      </div>`;
    this.el = {
      overlay: root.querySelector('.pause'),
      toggle: root.querySelector('.pause-toggle'),
      mute: root.querySelector('[data-act="mute"]'),
      reset: root.querySelector('[data-act="reset"]'),
      tips: root.querySelector('[data-act="tips"]')
    };
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('input', (e) => {
      const k = e.target.dataset.vol;
      if (k) this.audio.set(k, e.target.value / 100);
    });
    // Capture: the menu owns the keyboard while it is open
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.open && e.target.closest?.('input, textarea, select, dialog')) return;
        const k = e.key.toLowerCase();
        if (this.open) {
          if (k === 'escape' || k === 'p') this.close();
          if (!e.target.matches?.('input, button')) e.preventDefault();
          if (k !== 'tab') e.stopImmediatePropagation();
          return;
        }
        if (k === 'p' && !e.repeat) {
          e.stopImmediatePropagation();
          this.show();
        } else if (k === 'b' && !e.repeat && document.body.dataset.mode !== 'trade') this.audio.toggleMute();
      },
      { capture: true }
    );
    this.audio.listeners.add(() => this.sync());
    // A write can fail at any moment, long after the last click: look again now and then
    this.world?.subscribe?.(() => this.syncAlert());
    setInterval(() => this.syncAlert(), 2000);
    this.engine.quality.listeners.add(() => this.sync());
    this.sync();
  }

  onClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    const act = b.dataset.act;
    if (b.dataset.locale) {
      // Text is built once at load, so a language change restarts the page (the route stays in the hash)
      if (setLocale(b.dataset.locale)) {
        const url = new URL(location.href);
        if (url.searchParams.has('lang')) { url.searchParams.set('lang', b.dataset.locale); history.replaceState(null, '', url); }
        location.reload();
      }
      return;
    }
    const seg = b.closest('[data-seg]')?.dataset.seg;
    if (act === 'open') this.show();
    else if (act === 'close') this.close();
    else if (act === 'mute') this.audio.toggleMute();
    else if (act === 'tips') {
      this.tips?.reset();
      b.textContent = t('pause.tips.done');
    } else if (act === 'reset') {
      // Two clicks: no browser dialogs
      if (b.dataset.armed) {
        this.missions.reset();
        b.textContent = t('pause.missions.done');
        delete b.dataset.armed;
      } else {
        b.dataset.armed = '1';
        b.textContent = t('pause.missions.confirm');
      }
    } else if (seg === 'quality') this.engine.quality.setPreset(b.dataset.val);
    else if (seg === 'post') {
      this.engine.post.setPref(b.dataset.val);
      this.engine.resize();
    }
    this.sync();
  }

  status() {
    return saveStatus({ world: this.world, missions: this.missions, tips: this.tips });
  }

  /** The menu button shows a red dot while saving is failing, so the player need not open the menu to find out. */
  syncAlert() {
    const failing = this.status().level === 'error';
    this.el.toggle.classList.toggle('has-alert', failing);
    this.el.toggle.title = failing ? t('pause.save.alert') : t('pause.openTitle');
  }

  sync() {
    const status = this.status();
    this.root.querySelector('[data-save-status]').textContent = t(status.key, status.params);
    this.syncAlert();
    const q = this.engine.quality.preset;
    const p = this.engine.post.pref;
    this.root.querySelectorAll('[data-seg="quality"] [data-val]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.val === q)));
    this.root.querySelectorAll('[data-seg="post"] [data-val]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.val === p)));
    const s = this.audio.settings;
    this.root.querySelectorAll('[data-vol]').forEach((i) => {
      const v = Math.round(s[i.dataset.vol] * 100);
      if (Number(i.value) !== v) i.value = v;
      i.style.setProperty('--fill', `${v}%`);
    });
    this.el.mute.textContent = s.muted ? t('pause.muted') : t('pause.soundOn');
    this.el.mute.setAttribute('aria-pressed', String(s.muted));
    this.el.toggle.classList.toggle('is-muted', s.muted);
  }

  show() {
    if (this.open) return;
    this.open = true;
    this.el.overlay.hidden = false;
    this.el.reset.textContent = t('pause.missions.reset');
    delete this.el.reset.dataset.armed;
    this.el.tips.textContent = t('pause.tips.show');
    this.engine.paused = true;
    this.engine.trade?.setAppPaused(true);
    this.world?.clock.pause(true);
    this.audio.setPaused(true);
    this.sync();
    this.root.querySelector('[data-act="close"]').focus({ preventScroll: true });
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.el.overlay.hidden = true;
    this.engine.paused = false;
    this.engine.trade?.setAppPaused(false);
    this.world?.clock.pause(false);
    this.audio.setPaused(false);
  }
}
