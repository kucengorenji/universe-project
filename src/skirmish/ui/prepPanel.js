import './prep.css';
import { CLASSES } from '../units/soldierLook.js';
import { ROSTER, MAX_SQUAD, briefing } from '../game/roster.js';
import { DIFFICULTY, STATS, WEAPONS } from '../game/rules.js';
import { shield } from './emblems.js';
import { t, setLocale, getLocale, LOCALES } from '../../i18n/index.js';

// Preparation Mode as an open field notebook on the desk. Left page: the operation's heading
// (title stamp, village, chips for time, difficulty and river), the deployment map (the
// TacticalMap canvas, laid over the page by prep.css) and an intel line. Right page, behind two
// bookmark tabs: SQUAD (nine character cards: pick six, one leader) and BRIEFING; a SETUP
// drawer slides up from the foot of the page (seed, difficulty, cover, time, river, graphics);
// the red stamp under it starts the operation.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const COVER_LEVELS = {
  sparse: { get label() { return t('skirmish.cover.sparse'); }, value: 0.6 },
  normal: { get label() { return t('skirmish.cover.normal'); }, value: 1 },
  dense: { get label() { return t('skirmish.cover.dense'); }, value: 1.4 }
};
const options = (prefix, keys) => Object.fromEntries(keys.map((k) => [k, t(`${prefix}.${k}`)]));
const WEAPON_NAME = { rifle: 'Rifle', rifle_eng: 'Rifle', smg: 'SMG', lance: 'Lance', sniper: 'Sniper rifle' };

export class PrepPanel {
  /**
   * setup: { seed, difficulty, cover, time, river, squad: [ids], leader }
   * onChange(setup, { field: true when the battlefield must be regenerated }), onStart()
   */
  constructor(root, setup, { onChange, onStart, quality = 'auto', onQuality }) {
    this.setup = setup;
    this.onChange = onChange;
    const opt = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v}</option>`).join('');
    const diffs = Object.fromEntries(Object.entries(DIFFICULTY).map(([k, v]) => [k, v.label]));
    const TIMES = options('skirmish.time', ['day', 'dusk', 'night']);
    const RIVERS = options('skirmish.river', ['auto', 'yes', 'no']);
    const GFX = options('skirmish.gfx', ['auto', 'high', 'medium', 'low']);
    this.times = TIMES;
    root.innerHTML = `
      <section class="page page--left" aria-labelledby="opTitle">
        <header class="op">
          <span class="op__shield">${shield('fed')}</span>
          <div class="op__text">
            <p class="op__kicker">Field orders · Preparation</p>
            <h2 id="opTitle" class="op__title"></h2>
            <p class="op__chips"></p>
          </div>
          <span class="op__stamp">Secret</span>
        </header>
        <div class="mapslot" aria-hidden="true"></div>
        <p class="intel"></p>
      </section>
      <section class="page page--right">
        <div class="tabs" role="tablist" aria-label="${t('skirmish.prep')}">
          <button type="button" role="tab" class="tab" id="tabSquad" aria-selected="true" aria-controls="paneSquad">Squad <b class="p-count"></b></button>
          <button type="button" role="tab" class="tab" id="tabBrief" aria-selected="false" aria-controls="paneBrief">Briefing</button>
        </div>
        <div class="pane" id="paneSquad" role="tabpanel" aria-labelledby="tabSquad">
          <p class="pane__hint">${t('skirmish.squadHint', { max: MAX_SQUAD })}</p>
          <ul class="cards"></ul>
        </div>
        <div class="pane" id="paneBrief" role="tabpanel" aria-labelledby="tabBrief" hidden>
          <div class="brief"></div>
        </div>
        <div class="drawer">
          <button type="button" class="drawer__handle" aria-expanded="false" aria-controls="setupDrawer">Setup</button>
          <div class="drawer__body" id="setupDrawer">
            <label class="field">Seed <span class="field__seed"><input class="p-seed" type="number" min="1" step="1" inputmode="numeric" value="${setup.seed}" /><button type="button" class="paperbtn p-roll">${t('skirmish.roll')}</button></span></label>
            <label class="field">${t('skirmish.field.difficulty')} <select class="p-diff">${opt(diffs, setup.difficulty)}</select></label>
            <label class="field">Cover <select class="p-cover">${opt(Object.fromEntries(Object.entries(COVER_LEVELS).map(([k, v]) => [k, v.label])), setup.cover)}</select></label>
            <label class="field">${t('skirmish.field.time')} <select class="p-time">${opt(TIMES, setup.time)}</select></label>
            <label class="field">${t('skirmish.field.river')} <select class="p-river">${opt(RIVERS, setup.river)}</select></label>
            <label class="field">${t('skirmish.field.graphics')} <select class="p-gfx">${opt(GFX, quality)}</select></label>
            <label class="field">${t('skirmish.field.language')} <select class="p-lang">${LOCALES.map((l) => `<option value="${l.code}" lang="${l.code}" ${l.code === getLocale() ? 'selected' : ''}>${l.label}</option>`).join('')}</select></label>
          </div>
        </div>
        <button type="button" class="stampbtn p-start">${t('skirmish.start')}</button>
      </section>`;
    const $ = (s) => root.querySelector(s);
    this.root = root;
    this.el = {
      seed: $('.p-seed'), cards: $('.cards'), count: $('.p-count'), brief: $('.brief'), start: $('.p-start'),
      title: $('.op__title'), chips: $('.op__chips'), intel: $('.intel'), drawer: $('.drawer'), handle: $('.drawer__handle')
    };
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
    $('.p-gfx').addEventListener('change', (e) => onQuality?.(e.target.value));
    // The page text is built once, so a new language restarts the page (the seed stays in the setup)
    $('.p-lang').addEventListener('change', (e) => setLocale(e.target.value) && location.reload());
    $('.p-roll').addEventListener('click', () => {
      setup.seed = 1 + Math.floor(Math.random() * 999999);
      this.el.seed.value = setup.seed;
      onChange(setup, { field: true });
    });
    this.el.handle.addEventListener('click', () => {
      const open = !this.el.drawer.classList.contains('open');
      this.el.drawer.classList.toggle('open', open);
      this.el.handle.setAttribute('aria-expanded', String(open));
    });
    for (const tab of root.querySelectorAll('[role=tab]')) tab.addEventListener('click', () => this.showTab(tab.id));
    this.el.start.addEventListener('click', () => onStart());
    this.el.cards.addEventListener('change', (e) => {
      const id = e.target.closest('[data-id]')?.dataset.id;
      if (!id) return;
      if (e.target.name === 'leader') setup.leader = id;
      else if (e.target.checked) {
        if (setup.squad.length >= MAX_SQUAD) {
          e.target.checked = false;
          return;
        }
        setup.squad.push(id);
        if (!setup.leader) setup.leader = id;
      } else setup.squad = setup.squad.filter((s) => s !== id);
      if (!setup.squad.includes(setup.leader)) setup.leader = setup.squad[0] || null;
      this.renderRoster();
      onChange(setup, { field: false });
    });
    this.renderRoster();
  }

  showTab(id) {
    for (const tab of this.root.querySelectorAll('[role=tab]')) {
      const on = tab.id === id;
      tab.setAttribute('aria-selected', String(on));
      this.root.querySelector(`#${tab.getAttribute('aria-controls')}`).hidden = !on;
    }
  }

  renderRoster() {
    const s = this.setup;
    this.el.count.textContent = `${s.squad.length}/${MAX_SQUAD}`;
    const full = s.squad.length >= MAX_SQUAD;
    this.el.cards.innerHTML = ROSTER.map((r) => {
      const on = s.squad.includes(r.id);
      const lead = s.leader === r.id;
      const S = STATS[r.cls], W = WEAPONS[S.weapon];
      const face = this.portraits?.[r.id];
      return `<li data-id="${r.id}" class="pcard ${on ? 'on' : ''} ${lead ? 'lead' : ''} ${!on && full ? 'full' : ''}">
        <label class="pcard__pick">
          <input type="checkbox" ${on ? 'checked' : ''} ${!on && full ? 'disabled' : ''} aria-label="${t('skirmish.join', { name: esc(r.name) })}" />
          <span class="pcard__face">${face ? `<img src="${face}" alt="" />` : ''}<span class="pcard__shield">${shield('fed', CLASSES[r.cls].short)}</span></span>
          <span class="pcard__body">
            <b class="pcard__name">${esc(r.name)}</b>
            <span class="pcard__cls">${CLASSES[r.cls].label}${lead ? ' · <em>Leader</em>' : ''}</span>
            <span class="pcard__stats"><span>HP <b>${S.hp}</b></span><span>AP <b>${S.ap}</b> m</span><span>${WEAPON_NAME[S.weapon]} <b>${W.shots}×${W.damage}</b></span></span>
            <span class="pcard__note">${esc(r.note)}</span>
          </span>
          <span class="pcard__stamp">Deployed</span>
        </label>
        <label class="pcard__lead" title="${t('skirmish.makeLeader')}"><input type="radio" name="leader" ${lead ? 'checked' : ''} ${on ? '' : 'disabled'} aria-label="${t('skirmish.leaderOf', { name: esc(r.name) })}" /><span>★</span></label>
      </li>`;
    }).join('');
    this.el.start.disabled = !s.squad.length;
  }

  setPortraits(p) {
    this.portraits = p;
    this.renderRoster();
  }

  showBriefing(field) {
    const s = this.setup;
    const b = briefing(field, { difficulty: s.difficulty });
    this.el.title.textContent = b.title;
    const chip = (label, value) => `<span class="chip"><i>${label}</i> ${esc(value)}</span>`;
    this.el.chips.innerHTML =
      chip('AO', b.village) + chip('Time', this.times[s.time] || s.time) + chip('Threat', DIFFICULTY[s.difficulty].label) + chip('River', t(field.river ? 'skirmish.river.yes' : 'skirmish.river.no'));
    this.el.intel.innerHTML = `<b>Intel</b> ${t('skirmish.intel', { infantry: DIFFICULTY[s.difficulty].infantry, bunkers: field.bunkers.length ? t('skirmish.bunkerCount', { count: field.bunkers.length }) : t('skirmish.noBunkers') })}${field.river ? ` · ${t('skirmish.bridges', { count: field.bridges.length })}` : ''}`;
    this.el.brief.innerHTML = `
      <h3 class="brief__title">${esc(b.title)}</h3>
      ${b.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}
      <h4 class="brief__obj">Objectives</h4>
      <ol class="brief__list">${b.objectives.map((o) => `<li>${esc(o)}</li>`).join('')}</ol>`;
  }
}
