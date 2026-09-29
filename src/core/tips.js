// Onboarding: a title card on the very first visit, then one short tip the
// first time the player reaches each place or way of moving. Seen tips are
// remembered; the pause menu can bring them back.

const KEY = 'planet_globe_tips';

const TIPS = {
  space: { title: 'Terbang di tata surya', keys: ['W', 'A', 'D', 'Shift'], text: 'W dorong, A/D belok, Shift boost. Pilih planet di daftar kiri untuk autopilot, lalu tekan L atau Mendarat.' },
  planet: { title: 'Di atas planet', keys: ['Seret'], text: 'Seret untuk memutar planet. Klik sebuah kota untuk melihatnya lalu mendarat, atau tekan Terbang untuk menjelajah langitnya dengan kapalmu.' },
  town: { title: 'Diorama kota', keys: ['WASD', '2', '3'], text: 'Seret untuk memutar, WASD atau panah untuk menggeser, scroll untuk zoom. Tekan 2 untuk jalan kaki atau 3 untuk langsung nyetir.' },
  walk: { title: 'Jalan kaki', keys: ['E'], text: 'Dekati mobil, kereta, atau pintu rumah lalu tekan E. Shift lari, Spasi lompat, Esc kembali ke diorama.' },
  drive: { title: 'Nyetir', keys: ['Spasi', 'E'], text: 'W gas, S rem, Spasi rem tangan untuk drift, Shift ngebut. Tekan E untuk turun. Mobil di jalan juga bisa diambil alih.' },
  interior: { title: 'Di dalam rumah', keys: ['E', 'J'], text: 'Dekati perabot lalu tekan E: duduk, tidur, nyalakan lampu atau TV, buka kulkas, ambil dan taruh barang. Buka daftar misi dengan J.' },
  rover: { title: 'Terbang', keys: ['W', 'R', 'F'], text: 'W/S dorong, A/D belok, R/F naik turun, Shift boost. Seret untuk melihat sekeliling. Di atas kota tekan L untuk mendarat, Esc selesai.' }
};

export class Tips {
  constructor(root) {
    this.root = root;
    this.seen = new Set(this.load());
    root.innerHTML = `
      <aside class="tip" hidden role="status" aria-live="polite">
        <div class="tip__keys" data-keys></div>
        <div class="tip__body"><strong data-title></strong><p data-text></p></div>
        <button type="button" class="menu-circle menu-circle--close menu-circle--small" data-act="dismiss" aria-label="Tutup tip"><span></span><span></span></button>
      </aside>
      <div class="intro" hidden>
        <section class="intro__card" role="dialog" aria-modal="true" aria-labelledby="introTitle">
          <span class="card-block__eyebrow">Selamat datang</span>
          <h1 id="introTitle" class="intro__title">Planet Globe</h1>
          <p class="intro__lead">Satu tata surya, dibuat dari satu angka. Terbang antar planet, mendarat di dunia heksagonal, lalu turun ke kotanya.</p>
          <ol class="intro__steps">
            <li><strong>Luar angkasa</strong><span>Terbangkan kapal, ganti kapal di hangar, parkir di orbit.</span></li>
            <li><strong>Planet</strong><span>Putar globe, pilih kota, atau terbangkan kapal di langitnya.</span></li>
            <li><strong>Kota</strong><span>Diorama, jalan kaki, nyetir mobil siapa saja, masuk ke rumah.</span></li>
          </ol>
          <p class="intro__hint">Daftar misi ada di kiri bawah (J), menu dan pengaturan di kanan bawah (P).</p>
          <button type="button" class="pill" data-act="start">Mulai menjelajah</button>
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
    const tip = TIPS[id];
    if (!tip || this.seen.has(id) || this.current === id) return;
    if (!this.el.intro.hidden) {
      this.pending = id;
      return;
    }
    if (this.current && performance.now() - this.shownAt < 3000) this.seen.delete(this.current);
    this.seen.add(id);
    this.shownAt = performance.now();
    this.save();
    this.current = id;
    this.el.keys.innerHTML = tip.keys.map((k) => `<kbd>${k}</kbd>`).join('');
    this.el.title.textContent = tip.title;
    this.el.text.textContent = tip.text;
    this.el.tip.hidden = false;
    this.el.tip.classList.remove('is-out');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.hide(), 11000);
  }

  hide() {
    clearTimeout(this.timer);
    const t = this.el.tip;
    if (t.hidden) return;
    t.classList.add('is-out');
    const was = this.current;
    setTimeout(() => {
      if (this.current !== was) return; // a newer tip took over
      t.hidden = true;
      this.current = null;
    }, 300);
  }

  /** Forget everything (pause menu): tips show again from the next place visited. */
  reset() {
    this.seen.clear();
    this.save();
  }
}
