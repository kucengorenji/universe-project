// Pause menu: stops the world and gathers the settings in one place.
//   Grafis   quality preset, post effects
//   Suara    master / music / effects volume, mute
//   Kontrol  keys per mode
//   Lainnya  show the tips again, reset the missions
// P (or the round button) opens it, Esc or "Lanjut" closes it, B (bisu) mutes anywhere.

const QUALITY = [
  ['auto', 'Auto'],
  ['high', 'Tinggi'],
  ['medium', 'Sedang'],
  ['low', 'Rendah']
];
const POST = [
  ['auto', 'Auto'],
  ['on', 'Nyala'],
  ['off', 'Mati']
];
const CONTROLS = [
  ['Luar angkasa', [['W / S', 'Dorong, mundur'], ['A / D', 'Belok'], ['Q / E', 'Geser'], ['R / F', 'Naik, turun'], ['Shift', 'Boost'], ['L', 'Mendarat'], ['Klik', 'Autopilot ke planet'], ['M', 'Peta sistem']]],
  ['Planet', [['Seret', 'Putar planet'], ['Klik kota', 'Lihat kota'], ['Rover', 'WASD nyetir, Esc keluar'], ['O', 'Kembali ke orbit']]],
  ['Kota', [['1 2 3', 'Diorama, jalan, nyetir'], ['WASD', 'Jalan atau nyetir'], ['Shift', 'Lari, ngebut'], ['Spasi', 'Lompat, drift'], ['E', 'Masuk, pakai barang'], ['Esc', 'Keluar, diorama']]],
  ['Umum', [['J', 'Daftar misi'], ['P', 'Menu jeda'], ['B', 'Bisukan suara']]]
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
      <button type="button" class="menu-circle pause-toggle" data-act="open" aria-label="Menu jeda (P)" title="Menu (P)"><span></span><span></span><span></span></button>
      <div class="pause" hidden>
        <section class="pause__panel" role="dialog" aria-modal="true" aria-labelledby="pauseTitle">
          <header class="pause__head">
            <span class="card-block__eyebrow">Dijeda</span>
            <h2 id="pauseTitle" class="pause__title">Menu</h2>
          </header>
          <div class="pause__body">
            <div class="pause__col">
            <section class="pause__group">
              <h3>Grafis</h3>
              <div class="pause__row"><span>Kualitas</span><div class="seg seg--small" data-seg="quality">${QUALITY.map(([k, l]) => `<button type="button" class="seg__btn" data-val="${k}">${l}</button>`).join('')}</div></div>
              <div class="pause__row"><span>Efek visual <small>bloom, warna, anti-alias</small></span><div class="seg seg--small" data-seg="post">${POST.map(([k, l]) => `<button type="button" class="seg__btn" data-val="${k}">${l}</button>`).join('')}</div></div>
            </section>
            <section class="pause__group">
              <h3>Lainnya</h3>
              <div class="pause__row" data-save-status role="status"></div>
              <div class="pause__row"><span>Tips pemula</span><button type="button" class="pill pill--ghost pill--small" data-act="tips">Tampilkan lagi</button></div>
              <div class="pause__row"><span>Progres misi</span><button type="button" class="pill pill--ghost pill--small" data-act="reset">Reset misi</button></div>
            </section>
            </div>
            <section class="pause__group">
              <h3>Suara</h3>
              ${[['master', 'Utama'], ['music', 'Musik'], ['sfx', 'Efek dan suasana']]
                .map(([k, l]) => `<label class="pause__row"><span>${l}</span><input type="range" min="0" max="100" step="1" data-vol="${k}" aria-label="Volume ${l}"></label>`)
                .join('')}
              <div class="pause__row"><span>Bisu <small>tombol B</small></span><button type="button" class="pill pill--ghost pill--small" data-act="mute" aria-pressed="false"></button></div>
            </section>
            <section class="pause__group pause__group--wide">
              <h3>Kontrol</h3>
              <div class="pause__keys">${CONTROLS.map(
                ([title, rows]) => `<div><h4>${title}</h4><dl>${rows.map(([k, v]) => `<dt><kbd>${k}</kbd></dt><dd>${v}</dd>`).join('')}</dl></div>`
              ).join('')}</div>
            </section>
          </div>
          <footer class="pause__foot"><button type="button" class="pill" data-act="close">Lanjut</button></footer>
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
        if (e.target.matches?.('input[type="text"], textarea')) return;
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
        } else if (k === 'b' && !e.repeat) this.audio.toggleMute();
      },
      { capture: true }
    );
    this.audio.listeners.add(() => this.sync());
    this.engine.quality.listeners.add(() => this.sync());
    this.sync();
  }

  onClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    const act = b.dataset.act;
    const seg = b.closest('[data-seg]')?.dataset.seg;
    if (act === 'open') this.show();
    else if (act === 'close') this.close();
    else if (act === 'mute') this.audio.toggleMute();
    else if (act === 'tips') {
      this.tips?.reset();
      b.textContent = 'Siap';
    } else if (act === 'reset') {
      // Two clicks: no browser dialogs
      if (b.dataset.armed) {
        this.missions.reset();
        b.textContent = 'Direset';
        delete b.dataset.armed;
      } else {
        b.dataset.armed = '1';
        b.textContent = 'Yakin? Klik lagi';
      }
    } else if (seg === 'quality') this.engine.quality.setPreset(b.dataset.val);
    else if (seg === 'post') {
      this.engine.post.setPref(b.dataset.val);
      this.engine.resize();
    }
    this.sync();
  }

  sync() {
    const state = this.world?.state;
    this.root.querySelector('[data-save-status]').textContent = state?.error
      ? 'Perubahan belum tersimpan. Penyimpanan browser penuh atau tidak tersedia.'
      : 'Perubahan rumah tersimpan di browser ini.';
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
    this.el.mute.textContent = s.muted ? 'Dibisukan' : 'Suara nyala';
    this.el.mute.setAttribute('aria-pressed', String(s.muted));
    this.el.toggle.classList.toggle('is-muted', s.muted);
  }

  show() {
    if (this.open) return;
    this.open = true;
    this.el.overlay.hidden = false;
    this.el.reset.textContent = 'Reset misi';
    delete this.el.reset.dataset.armed;
    this.el.tips.textContent = 'Tampilkan lagi';
    this.engine.paused = true;
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
    this.world?.clock.pause(false);
    this.audio.setPaused(false);
  }
}
