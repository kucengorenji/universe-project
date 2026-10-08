import './hud.css';
import { TURN_LIMIT } from '../game/rules.js';
import { FACTIONS } from '../units/soldierLook.js';
import { ActionHud } from './actionHud.js';
import { shield, unitShield, CLASS_NAME } from './emblems.js';
import { t } from '../../i18n/index.js';

// The skirmish HUD (DOM), in the war-notebook style: cream paper, sepia ink, red stamps,
// typewriter labels, blue and red faction shields. Military labels (PLAYER PHASE, COMMAND MODE,
// AP) stay English in every language on purpose; descriptions are translated. Parts:
//   strip     turn, phase and command points (top left, every battle phase)
//   cmd       the command list beside the flat map (Command Mode)
//   action    Action Mode (ActionHud): unit card, AP gauge, reticle, target, enemy tags
//   band      the enemy-phase ribbon; banner: the phase change; cutin: the leader taking command
//   result    the mission result; toast: short notes; fx: floating words over the scene
// Which parts show is set by the phase on <body data-phase> (hud.css).

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const PHASE = { fed: 'Player Phase', imp: 'Enemy Phase' };

export class Hud {
  constructor(root, game) {
    this.game = game;
    root.innerHTML = `
      <header class="strip" aria-live="polite">
        <span class="strip__shield"></span>
        <span class="strip__text"><b class="strip__turn"></b><span class="strip__phase"></span></span>
        <span class="strip__cp" aria-label="Command point"></span>
      </header>
      <aside class="cmd" aria-label="${t('skirmish.command.aria')}">
        <h2 class="cmd__title">Command Mode</h2>
        <p class="cmd__hint">${t('skirmish.command.hint')}</p>
        <ol class="cmd__units"></ol>
        <button type="button" class="stampbtn cmd__end">${t('skirmish.endTurn')}</button>
      </aside>
      <div class="action"></div>
      <div class="band"><b>Enemy Phase</b><span>${t('skirmish.holdSpace')}</span></div>
      <div class="banner" aria-hidden="true"><div class="banner__ribbon"><span class="banner__shield"></span><b class="banner__title"></b><span class="banner__turn"></span></div></div>
      <div class="cutin" aria-hidden="true"><div class="cutin__strip"><img class="cutin__face" alt="" /><div class="cutin__text"><span class="cutin__stamp">Leader</span><b class="cutin__name"></b><span class="cutin__line"></span></div></div></div>
      <div class="result" role="dialog" aria-modal="true" aria-labelledby="resultTitle">
        <div class="result__sheet">
          <p class="result__kicker">Operation Report</p>
          <h2 id="resultTitle" class="result__title"></h2>
          <p class="result__why"></p>
          <div class="result__rank"><span>Rank</span><b></b></div>
          <dl class="result__stats"></dl>
          <div class="result__actions">
            <button type="button" class="stampbtn result__again">${t('skirmish.replay')}</button>
            <button type="button" class="paperbtn result__new">${t('skirmish.newField')}</button>
          </div>
        </div>
      </div>
      <div class="toast" role="status"></div>
      <div class="fx" aria-hidden="true"></div>`;
    const $ = (s) => root.querySelector(s);
    this.el = {
      root,
      shield: $('.strip__shield'), turn: $('.strip__turn'), phase: $('.strip__phase'), cp: $('.strip__cp'),
      units: $('.cmd__units'), end: $('.cmd__end'),
      banner: $('.banner'), cutin: $('.cutin'), result: $('.result'), toast: $('.toast'), fx: $('.fx')
    };
    this.actionHud = new ActionHud($('.action'), game);
    this.el.minimap = this.actionHud.el.minimap;
    this.el.end.addEventListener('click', () => game.endPlayerTurn());
    $('.result__again').addEventListener('click', () => game.restart(false));
    $('.result__new').addEventListener('click', () => game.restart(true));
    this.el.units.addEventListener('click', (e) => {
      const li = e.target.closest('[data-unit]');
      if (li) game.pickUnit(li.dataset.unit);
    });
    // the list and the map share one cursor
    this.el.units.addEventListener('pointerover', (e) => {
      const li = e.target.closest('[data-unit]');
      if (li) {
        game.setCursor(li.dataset.unit);
        game.map.pointerMoved = false;
      }
    });
  }

  get fxLayer() {
    return this.el.fx;
  }

  set portraits(p) {
    this._portraits = p;
    this.actionHud.portraits = p;
  }

  get portraits() {
    return this._portraits;
  }

  /** Refresh the strip and the command list from the battle. */
  update() {
    const b = this.game.battle;
    if (!b) return;
    this.el.shield.innerHTML = shield(b.side);
    this.el.turn.textContent = `Turn ${String(Math.min(b.turn, TURN_LIMIT)).padStart(2, '0')}/${TURN_LIMIT}`;
    this.el.phase.textContent = PHASE[b.side];
    this.el.phase.dataset.side = b.side;
    const n = b.cpFor(b.side);
    this.el.cp.innerHTML = `<span class="label">CP</span>${Array.from({ length: n }, (_, i) => `<i class="medal ${i < b.cp ? 'on' : ''}"></i>`).join('')}<b>${b.cp}</b>`;
    const mine = b.units.filter((u) => u.side === 'fed');
    this.el.units.innerHTML = mine
      .map((u) => {
        const state = { ok: '', down: `Down · ${u.downTurns}`, dead: 'KIA', evac: 'Evac' }[u.state];
        const ammo = u.ammo === Infinity ? '' : ` · ${t('skirmish.ammo', { count: u.ammo })}`;
        const can = b.canSelect(u) && this.game.phase === 'command';
        const face = this._portraits?.[u.id];
        return `<li data-unit="${u.id}" class="unitrow ${can ? 'unitrow--ready' : ''} unitrow--${u.state}">
          <span class="seal">${face ? `<img class="portrait" src="${face}" alt="" />` : ''}${unitShield(u)}</span>
          <span class="unitrow__body">
            <span class="unitrow__name">${u.leader ? '<i class="star">★</i>' : ''}${esc(u.name)}</span>
            <span class="unitrow__meta">${CLASS_NAME[u.cls]} · AP ${u.apMax} m${ammo}${u.picks ? ` · ${t('skirmish.picks', { count: u.picks })}` : ''}</span>
            <span class="hpline"><i style="width:${(100 * u.hp) / u.maxHp}%"></i></span>
          </span>
          ${state ? `<span class="stamp">${state}</span>` : ''}
        </li>`;
      })
      .join('');
  }

  /** Mark the command list row under the map cursor. */
  highlight(id) {
    if (this.cursorRow === id && this.el.units.querySelector('.unitrow--cursor')?.dataset.unit === id) return;
    this.cursorRow = id;
    for (const li of this.el.units.children) li.classList.toggle('unitrow--cursor', li.dataset.unit === id);
  }

  /** Per-frame Action Mode HUD. */
  action(ctrl, info) {
    this.actionHud.update(ctrl, info);
  }

  /** Enemy tags, arrows and threats for the acting soldier (see ActionHud.tags). */
  markers(list) {
    this.actionHud.tags(list);
  }

  setLocked(locked, mode = 'lock') {
    this.actionHud.setInput(locked, mode);
  }

  /** Battle events since the last frame: hits on the acting soldier flash the screen. */
  events(events) {
    const acting = this.game.control?.active ? this.game.control.unit : null;
    for (const e of events) if (e.type === 'hit' && acting && e.unit === acting.id) this.actionHud.hurt();
  }

  /** The phase banner: a ribbon across the screen for a moment. */
  banner(side, turn) {
    const el = this.el.banner;
    el.querySelector('.banner__shield').innerHTML = shield(side);
    el.querySelector('.banner__title').textContent = PHASE[side];
    el.querySelector('.banner__turn').textContent = `Turn ${String(turn).padStart(2, '0')}`;
    el.dataset.side = side;
    el.classList.remove('on');
    void el.offsetWidth; // restart the animation
    el.classList.add('on');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => el.classList.remove('on'), 1900);
  }

  /** The leader's cut-in as they take command. */
  cutIn(u) {
    const el = this.el.cutin;
    const face = el.querySelector('.cutin__face');
    const src = this._portraits?.[u.id];
    if (src) face.src = src;
    face.hidden = !src;
    el.querySelector('.cutin__name').textContent = u.name;
    el.querySelector('.cutin__line').textContent = `${CLASS_NAME[u.cls]} · ${FACTIONS[u.side].label}`;
    el.dataset.side = u.side;
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
    clearTimeout(this.cutTimer);
    this.cutTimer = setTimeout(() => el.classList.remove('on'), 1500);
  }

  toast(text) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.el.toast.classList.remove('on'), 1900);
  }

  showResult(over, battle) {
    const win = over.winner === 'fed';
    const why = {
      base: t(win ? 'skirmish.why.baseWin' : 'skirmish.why.baseLoss'),
      wiped: t(win ? 'skirmish.why.wipedWin' : 'skirmish.why.wipedLoss'),
      time: t('skirmish.why.time', { count: TURN_LIMIT })
    }[over.reason];
    const fed = battle.units.filter((u) => u.side === 'fed');
    const imp = battle.units.filter((u) => u.side === 'imp' && u.kind === 'infantry');
    const r = this.el.result;
    r.dataset.win = win ? 'yes' : 'no';
    r.querySelector('.result__title').textContent = win ? 'Mission Complete' : 'Mission Failed';
    r.querySelector('.result__why').textContent = why;
    const rank = r.querySelector('.result__rank b');
    rank.textContent = win ? over.rank : '–';
    rank.dataset.rank = over.rank;
    const row = (k, v) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
    r.querySelector('.result__stats').innerHTML =
      row('Turns', over.turns) +
      row('Enemy KIA', `${imp.filter((u) => u.state === 'dead').length}/${imp.length}`) +
      row('Squad KIA', over.deaths) +
      row('Evacuated', fed.filter((u) => u.state === 'evac').length);
  }
}
