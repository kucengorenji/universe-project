// Mission log: checklists that span every mode. Modes report what the player
// did (emit('sit'), emit('drive_m', 12.5), emit('land', 3)); a checklist item
// ticks when its event reaches its goal. Finishing a whole mission throws a
// small party: confetti, a fanfare and a popup.

const KEY = 'planet_globe_missions';

export const MISSIONS = [
  {
    id: 'home',
    title: 'Rumah pertama',
    blurb: 'Masuk ke sebuah rumah dan anggap seperti rumah sendiri.',
    items: [
      { id: 'enter', label: 'Masuk ke rumah atau toko', event: 'enter_house' },
      { id: 'sit', label: 'Duduk di kursi atau sofa', event: 'sit' },
      { id: 'light', label: 'Nyalakan lampu', event: 'light_on' },
      { id: 'fridge', label: 'Buka kulkas atau lemari', event: 'open' },
      { id: 'apple', label: 'Ambil sebuah apel', event: 'pickup_apple' },
      { id: 'sleep', label: 'Tidur sampai pagi', event: 'sleep' }
    ]
  },
  {
    id: 'cozy',
    title: 'Malam santai',
    blurb: 'Hiburan kecil di dalam rumah.',
    items: [
      { id: 'tv', label: 'Nyalakan TV atau radio', event: 'media_on' },
      { id: 'fire', label: 'Nyalakan perapian', event: 'fire_on' },
      { id: 'book', label: 'Ambil buku dari rak', event: 'pickup_book' },
      { id: 'place', label: 'Taruh barang di meja', event: 'place_item' }
    ]
  },
  {
    id: 'explorer',
    title: 'Penjelajah',
    blurb: 'Kenali tata surya dan kota-kotanya.',
    items: [
      { id: 'land3', label: 'Mendarat di 3 planet berbeda', event: 'land', distinct: 3 },
      { id: 'town', label: 'Masuk ke sebuah kota', event: 'visit_town' },
      { id: 'drive', label: 'Nyetir sejauh 1 km di kota', event: 'drive_m', total: 1000 },
      { id: 'jack', label: 'Ambil alih mobil di jalan', event: 'carjack' }
    ]
  },
  {
    id: 'pilot',
    title: 'Pilot',
    blurb: 'Kuasai kapal, orbit, dan langit planet.',
    items: [
      { id: 'boost', label: 'Pakai boost di luar angkasa', event: 'boost' },
      { id: 'hangar', label: 'Ganti kapal di hangar', event: 'hangar' },
      { id: 'orbit3', label: 'Parkir di orbit 3 planet berbeda', event: 'orbit', distinct: 3 },
      { id: 'rover', label: 'Terbang 1 km di langit planet', event: 'rover_m', total: 1000 }
    ]
  }
];

export class Missions {
  constructor(root, audio = null) {
    this.root = root;
    this.sound = audio;
    this.state = this.load();
    this.listeners = new Set();
    this.buildUi();
  }

  load() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
      // Drop checklist items that no longer exist
      const known = new Set(MISSIONS.flatMap((m) => m.items.map((it) => `${m.id}.${it.id}`)));
      return Object.fromEntries(Object.entries(saved).filter(([k]) => known.has(k)));
    } catch {
      return {};
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
    } catch {
      /* optional */
    }
  }

  itemState(m, it) {
    const k = `${m.id}.${it.id}`;
    return (this.state[k] ||= { done: false, n: 0, seen: [] });
  }

  /** Something happened. value: an amount (totals) or an id (distinct counts). */
  emit(event, value = 1) {
    let changed = false;
    for (const m of MISSIONS) {
      const wasDone = this.missionDone(m);
      for (const it of m.items) {
        if (it.event !== event) continue;
        const st = this.itemState(m, it);
        if (st.done) continue;
        if (it.distinct) {
          if (!st.seen.includes(value)) st.seen.push(value);
          st.done = st.seen.length >= it.distinct;
        } else if (it.total) {
          st.n += value;
          st.done = st.n >= it.total;
        } else st.done = true;
        changed = true;
        if (st.done) this.toast(`${it.label}`, m.title);
      }
      if (!wasDone && this.missionDone(m)) this.celebrate(m);
    }
    if (changed) {
      this.save();
      this.render();
    }
  }

  /** Start over (pause menu). */
  reset() {
    this.state = {};
    this.save();
    this.render();
  }

  missionDone(m) {
    return m.items.every((it) => this.itemState(m, it).done);
  }

  progress(it, st) {
    if (it.distinct) return `${Math.min(st.seen.length, it.distinct)}/${it.distinct}`;
    if (it.total) return `${Math.min(it.total, Math.round(st.n))}/${it.total} m`;
    return '';
  }

  // ------------------------------------------------------------------ UI

  buildUi() {
    const r = this.root;
    r.innerHTML = `
      <button type="button" class="pill pill--ghost mission-toggle" data-act="toggle" aria-expanded="false">Misi <span data-count></span></button>
      <aside class="mission-log" hidden aria-label="Daftar misi">
        <header class="mission-log__head"><h2>Misi</h2><button type="button" class="menu-circle menu-circle--close menu-circle--small" data-act="toggle" aria-label="Tutup misi"><span></span><span></span></button></header>
        <div class="mission-log__body" data-list></div>
      </aside>
      <div class="mission-toast" hidden role="status"></div>
      <div class="mission-party" hidden>
        <canvas class="mission-party__confetti"></canvas>
        <section class="mission-party__card" role="dialog" aria-modal="true" aria-labelledby="partyTitle">
          <span class="card-block__eyebrow">Misi selesai</span>
          <h2 id="partyTitle" class="mission-party__title" data-title></h2>
          <p class="mission-party__text" data-text></p>
          <ul class="mission-party__list" data-items></ul>
          <button type="button" class="pill" data-act="party-close">Mantap</button>
        </section>
      </div>`;
    this.el = {
      log: r.querySelector('.mission-log'),
      list: r.querySelector('[data-list]'),
      count: r.querySelector('[data-count]'),
      toggle: r.querySelector('.mission-toggle'),
      toast: r.querySelector('.mission-toast'),
      party: r.querySelector('.mission-party'),
      confetti: r.querySelector('.mission-party__confetti')
    };
    r.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'toggle') this.toggle();
      else if (b.dataset.act === 'party-close') this.closeParty();
    });
    window.addEventListener('keydown', (e) => {
      if (e.target.matches?.('input, textarea')) return;
      // The party popup owns the keyboard until it is closed
      if (!this.el.party.hidden) {
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') this.closeParty();
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (e.key.toLowerCase() === 'j') this.toggle();
    });
    this.render();
  }

  toggle(force) {
    const open = force ?? this.el.log.hidden;
    this.el.log.hidden = !open;
    this.el.toggle.setAttribute('aria-expanded', String(open));
  }

  render() {
    let done = 0;
    this.el.list.innerHTML = MISSIONS.map((m) => {
      const all = this.missionDone(m);
      if (all) done++;
      return `<section class="mission${all ? ' is-done' : ''}">
        <h3 class="mission__title">${m.title}${all ? ' <small>selesai</small>' : ''}</h3>
        <p class="mission__blurb">${m.blurb}</p>
        <ul class="mission__items">${m.items
          .map((it) => {
            const st = this.itemState(m, it);
            return `<li class="${st.done ? 'is-done' : ''}"><span class="mission__check" aria-hidden="true"></span><span>${it.label}</span><small>${st.done ? '' : this.progress(it, st)}</small></li>`;
          })
          .join('')}</ul>
      </section>`;
    }).join('');
    this.el.count.textContent = `${done}/${MISSIONS.length}`;
  }

  toast(label, mission) {
    const t = this.el.toast;
    t.innerHTML = `<span class="mission__check is-on" aria-hidden="true"></span><span><small>${mission}</small>${label}</span>`;
    t.hidden = false;
    t.classList.remove('is-out');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      t.classList.add('is-out');
      setTimeout(() => (t.hidden = true), 400);
    }, 2600);
    this.sound?.sfx('tick');
    this.listeners.forEach((fn) => fn('tick'));
  }

  celebrate(m) {
    const p = this.el.party;
    p.querySelector('[data-title]').textContent = m.title;
    p.querySelector('[data-text]').textContent = `${m.items.length} tugas beres. ${m.blurb}`;
    p.querySelector('[data-items]').innerHTML = m.items.map((it, i) => `<li style="animation-delay:${300 + i * 90}ms"><span class="mission__check is-on" aria-hidden="true"></span>${it.label}</li>`).join('');
    p.hidden = false;
    p.querySelector('[data-act="party-close"]').focus({ preventScroll: true });
    if (this.sound) this.sound.fanfare();
    else this.fanfare();
    this.confetti();
    this.listeners.forEach((fn) => fn('party'));
  }

  closeParty() {
    this.el.party.hidden = true;
    cancelAnimationFrame(this.confettiFrame);
  }

  /** Canvas confetti: a burst from both lower corners, then a rain from the top that flutters down. */
  confetti() {
    const c = this.el.confetti;
    const ctx = c.getContext('2d');
    const W = (c.width = innerWidth);
    const H = (c.height = innerHeight);
    const colors = ['#027b49', '#fa4d43', '#fbb833', '#f19ec8', '#3f6fb0', '#ffffff'];
    const bit = (x, y, vx, vy) => ({ x, y, vx, vy, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3, w: 7 + Math.random() * 7, h: 4 + Math.random() * 5, c: colors[Math.floor(Math.random() * colors.length)], ph: Math.random() * 6 });
    const bits = [];
    for (let i = 0; i < 160; i++) {
      const left = i % 2 === 0;
      bits.push(bit(left ? -10 : W + 10, H * 0.85, (left ? 1 : -1) * (6 + Math.random() * 12), -(12 + Math.random() * 14)));
    }
    const t0 = performance.now();
    let last = t0;
    const step = (now = performance.now()) => {
      const f = Math.min(3, (now - last) / 16.7);
      last = now;
      const age = now - t0;
      // Keep it raining for a few seconds
      if (age < 3800) for (let k = 0; k < 3; k++) bits.push(bit(Math.random() * W, -20, (Math.random() - 0.5) * 2, 1 + Math.random() * 2));
      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = Math.min(1, (6500 - age) / 800);
      for (let i = bits.length - 1; i >= 0; i--) {
        const b = bits[i];
        b.vy = Math.min(b.vy + 0.32 * f, 3.2); // air drag: paper falls slowly
        b.vx *= Math.pow(0.975, f);
        b.ph += 0.12 * f;
        b.x += (b.vx + Math.sin(b.ph) * 0.9) * f;
        b.y += b.vy * f;
        b.r += b.vr * f;
        if (b.y > H + 30) {
          bits.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.r);
        ctx.scale(1, Math.cos(b.ph * 1.3)); // tumbling
        ctx.fillStyle = b.c;
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
        ctx.restore();
      }
      if (age < 6500 && !this.el.party.hidden) this.confettiFrame = requestAnimationFrame(step);
      else ctx.clearRect(0, 0, W, H);
    };
    cancelAnimationFrame(this.confettiFrame);
    step();
  }

  /** A short brass-ish arpeggio with Web Audio (no files). */
  fanfare() {
    try {
      const ac = (this.audio ||= new AudioContext());
      const now = ac.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = 'sawtooth';
        o.frequency.value = f;
        const t = now + i * 0.13;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.09, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + (i === 3 ? 0.9 : 0.25));
        const lp = ac.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2400;
        o.connect(lp).connect(g).connect(ac.destination);
        o.start(t);
        o.stop(t + 1);
      });
    } catch {
      /* audio is optional */
    }
  }
}
