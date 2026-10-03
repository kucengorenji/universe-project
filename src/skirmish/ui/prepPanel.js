import { CLASSES } from '../units/soldierLook.js';
import { ROSTER, MAX_SQUAD, briefing } from '../game/roster.js';
import { DIFFICULTY } from '../game/rules.js';

// Preparation Mode panel beside the flat map: the battlefield setup (seed, difficulty, cover,
// time, river), the squad (six of nine, one leader) and the generated briefing.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const COVER_LEVELS = { sparse: { label: 'Jarang', value: 0.6 }, normal: { label: 'Normal', value: 1 }, dense: { label: 'Padat', value: 1.4 } };

export class PrepPanel {
  /**
   * setup: { seed, difficulty, cover, time, river, squad: [ids], leader }
   * onChange(setup, { field: true when the battlefield must be regenerated }), onStart()
   */
  constructor(root, setup, { onChange, onStart }) {
    this.setup = setup;
    this.onChange = onChange;
    const opt = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v}</option>`).join('');
    root.innerHTML = `
      <h2 class="prep__title">Persiapan</h2>
      <section class="prep__sec" aria-labelledby="setupHead">
        <h3 id="setupHead">Medan</h3>
        <label class="row">Seed <input class="p-seed" type="number" min="1" step="1" value="${setup.seed}" /><button type="button" class="btn p-roll">Acak</button></label>
        <label class="row">Kesulitan <select class="p-diff">${opt(Object.fromEntries(Object.entries(DIFFICULTY).map(([k, v]) => [k, v.label])), setup.difficulty)}</select></label>
        <label class="row">Cover <select class="p-cover">${opt(Object.fromEntries(Object.entries(COVER_LEVELS).map(([k, v]) => [k, v.label])), setup.cover)}</select></label>
        <label class="row">Waktu <select class="p-time">${opt({ day: 'Siang', dusk: 'Senja', night: 'Malam' }, setup.time)}</select></label>
        <label class="row">Sungai <select class="p-river">${opt({ auto: 'Acak', yes: 'Ada', no: 'Tidak ada' }, setup.river)}</select></label>
      </section>
      <section class="prep__sec" aria-labelledby="squadHead">
        <h3 id="squadHead">Regu <span class="p-count"></span></h3>
        <p class="prep__hint">Centang maks. ${MAX_SQUAD}. ★ = leader (+1 CP). Di peta: klik token lalu klik lingkaran deploy untuk memindah.</p>
        <ul class="roster"></ul>
      </section>
      <section class="prep__sec briefing" aria-labelledby="briefHead">
        <h3 id="briefHead">Briefing</h3>
        <div class="p-brief"></div>
      </section>
      <button type="button" class="btn btn--primary p-start">Mulai operasi</button>`;
    const $ = (s) => root.querySelector(s);
    this.el = { seed: $('.p-seed'), roster: $('.roster'), count: $('.p-count'), brief: $('.p-brief'), start: $('.p-start') };
    const field = (key, sel, cast = (v) => v) =>
      $(sel).addEventListener('change', (e) => {
        setup[key] = cast(e.target.value);
        onChange(setup, { field: key !== 'difficulty' });
      });
    field('seed', '.p-seed', (v) => Math.max(1, Math.floor(Number(v)) || 1));
    field('difficulty', '.p-diff');
    field('cover', '.p-cover');
    field('time', '.p-time');
    field('river', '.p-river');
    $('.p-roll').addEventListener('click', () => {
      setup.seed = 1 + Math.floor(Math.random() * 999999);
      this.el.seed.value = setup.seed;
      onChange(setup, { field: true });
    });
    this.el.start.addEventListener('click', () => onStart());
    this.el.roster.addEventListener('change', (e) => {
      const id = e.target.closest('[data-id]')?.dataset.id;
      if (!id) return;
      if (e.target.name === 'leader') setup.leader = id;
      else if (e.target.checked) {
        if (setup.squad.length >= MAX_SQUAD) {
          e.target.checked = false;
          return;
        }
        setup.squad.push(id);
      } else setup.squad = setup.squad.filter((s) => s !== id);
      if (!setup.squad.includes(setup.leader)) setup.leader = setup.squad[0] || null;
      this.renderRoster();
      onChange(setup, { field: false });
    });
    this.renderRoster();
  }

  renderRoster() {
    const s = this.setup;
    this.el.count.textContent = `${s.squad.length}/${MAX_SQUAD}`;
    this.el.roster.innerHTML = ROSTER.map((r) => {
      const on = s.squad.includes(r.id);
      return `<li data-id="${r.id}" class="roster__row ${on ? 'on' : ''}">
        <label class="roster__pick"><input type="checkbox" ${on ? 'checked' : ''} aria-label="Ikut: ${esc(r.name)}" /></label>
        <span class="roster__who"><b>${esc(r.name)}</b><small>${CLASSES[r.cls].label} · ${esc(r.note)}</small></span>
        <label class="roster__lead" title="Leader"><input type="radio" name="leader" ${s.leader === r.id ? 'checked' : ''} ${on ? '' : 'disabled'} aria-label="Leader: ${esc(r.name)}" />★</label>
      </li>`;
    }).join('');
    this.el.start.disabled = !s.squad.length;
  }

  showBriefing(field) {
    const b = briefing(field, { difficulty: this.setup.difficulty });
    this.el.brief.innerHTML = `<h4>${esc(b.title)}</h4>${b.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}<ol>${b.objectives.map((o) => `<li>${esc(o)}</li>`).join('')}</ol>`;
  }
}
