import { CLASSES } from '../units/soldierLook.js';
import { TURN_LIMIT, WEAPONS } from '../game/rules.js';

// Skirmish HUD (DOM): the turn and CP bar, the command panel beside the map, the action HUD
// (unit card, AP gauge, reticle, controls), the enemy-turn banner, the result card and toasts.
// Which parts show is set by the phase class on <body> (see skirmish.css).

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const CLASS_LABEL = { ...Object.fromEntries(Object.entries(CLASSES).map(([k, v]) => [k, v.label])), tank: 'Tank', bunker: 'Bunker' };

export class Hud {
  constructor(root, game) {
    this.game = game;
    root.innerHTML = `
      <div class="topbar" aria-live="polite">
        <span class="topbar__turn"></span>
        <span class="topbar__side"></span>
        <span class="topbar__cp" aria-label="Command point"></span>
      </div>
      <aside class="cmd" aria-label="Komando">
        <h2 class="cmd__title">Command Mode</h2>
        <p class="cmd__hint">Klik unit biru di peta untuk memerintahnya (1 CP). Lancer dan Sniper punya amunisi terbatas.</p>
        <ol class="cmd__units"></ol>
        <button type="button" class="btn btn--primary cmd__end">Akhiri giliran</button>
      </aside>
      <div class="action">
        <div class="reticle" aria-hidden="true"></div>
        <canvas class="minimap" aria-label="Minimap"></canvas>
        <div class="unitcard">
          <div class="unitcard__name"></div>
          <div class="unitcard__class"></div>
          <div class="bar bar--hp"><i></i><span></span></div>
          <div class="unitcard__ammo"></div>
        </div>
        <div class="apgauge"><div class="apgauge__label">AP</div><div class="bar bar--ap"><i></i></div></div>
        <p class="keys">WASD gerak · Shift lari · C jongkok · Klik kanan bidik · Klik kiri tembak · Space selesai</p>
        <button type="button" class="lockhint">Klik untuk mengendalikan unit (Esc melepas mouse)</button>
      </div>
      <div class="banner"><strong>Giliran musuh</strong><span>Tahan Space untuk mempercepat</span></div>
      <div class="result" role="dialog" aria-modal="true" aria-labelledby="resultTitle">
        <div class="result__card">
          <h2 id="resultTitle" class="result__title"></h2>
          <p class="result__why"></p>
          <div class="result__rank"></div>
          <p class="result__stats"></p>
          <div class="result__actions">
            <button type="button" class="btn btn--primary result__again">Main lagi (seed sama)</button>
            <button type="button" class="btn result__new">Medan baru</button>
          </div>
        </div>
      </div>
      <div class="toast" role="status"></div>
      <div class="fx" aria-hidden="true"></div>`;
    const $ = (s) => root.querySelector(s);
    this.el = {
      turn: $('.topbar__turn'), side: $('.topbar__side'), cp: $('.topbar__cp'),
      units: $('.cmd__units'), end: $('.cmd__end'),
      reticle: $('.reticle'), name: $('.unitcard__name'), cls: $('.unitcard__class'), hp: $('.bar--hp'), ammo: $('.unitcard__ammo'), ap: $('.bar--ap'),
      lock: $('.lockhint'), minimap: $('.minimap'), result: $('.result'), toast: $('.toast'), fx: $('.fx')
    };
    this.el.end.addEventListener('click', () => game.endPlayerTurn());
    this.el.lock.addEventListener('click', () => game.engine.renderer.domElement.requestPointerLock?.());
    $('.result__again').addEventListener('click', () => game.restart(false));
    $('.result__new').addEventListener('click', () => game.restart(true));
    this.el.units.addEventListener('click', (e) => {
      const li = e.target.closest('[data-unit]');
      if (li) game.pickUnit(li.dataset.unit);
    });
  }

  get fxLayer() {
    return this.el.fx;
  }

  /** Refresh the turn bar and the command list from the battle. */
  update() {
    const b = this.game.battle;
    if (!b) return;
    this.el.turn.textContent = `Giliran ${Math.min(b.turn, TURN_LIMIT)} / ${TURN_LIMIT}`;
    this.el.side.textContent = b.side === 'fed' ? 'Federasi' : 'Imperium';
    this.el.side.dataset.side = b.side;
    this.el.cp.innerHTML = `CP <b>${b.cp}</b>` + Array.from({ length: b.cpFor(b.side) }, (_, i) => `<i class="${i < b.cp ? 'on' : ''}"></i>`).join('');
    const mine = b.units.filter((u) => u.side === 'fed');
    this.el.units.innerHTML = mine
      .map((u) => {
        const state = { ok: '', down: `Tumbang (${u.downTurns})`, dead: 'Gugur', evac: 'Dievakuasi' }[u.state];
        const ammo = u.ammo === Infinity ? '' : ` · amunisi ${u.ammo}`;
        const can = b.canSelect(u) && this.game.phase === 'command';
        return `<li data-unit="${u.id}" class="unitrow ${can ? 'unitrow--ready' : ''} unitrow--${u.state}">
          <span class="unitrow__name">${u.leader ? '★ ' : ''}${esc(u.name)}</span>
          <span class="unitrow__meta">${CLASS_LABEL[u.cls]}${ammo}${u.picks ? ` · dipakai ${u.picks}×` : ''}</span>
          <span class="unitrow__hp"><i style="width:${(100 * u.hp) / u.maxHp}%"></i></span>
          ${state ? `<span class="unitrow__state">${state}</span>` : ''}
        </li>`;
      })
      .join('');
  }

  /** Per-frame action HUD: AP, HP, ammo, reticle. */
  action(ctrl) {
    const u = ctrl.unit;
    if (!u) return;
    this.el.name.textContent = `${u.leader ? '★ ' : ''}${u.name}`;
    this.el.cls.textContent = `${CLASS_LABEL[u.cls]} · ${u.stance === 'crouch' ? 'jongkok' : 'berdiri'}${ctrl.attacked ? ' · sudah menyerang' : ''}`;
    this.el.hp.querySelector('i').style.width = `${(100 * u.hp) / u.maxHp}%`;
    this.el.hp.querySelector('span').textContent = `${u.hp} / ${u.maxHp}`;
    const W = WEAPONS[u.weapon];
    this.el.ammo.textContent = u.ammo === Infinity ? `${W.shots} peluru per tembakan` : `Amunisi ${u.ammo} / ${u.maxAmmo}`;
    this.el.ap.querySelector('i').style.width = `${(100 * ctrl.ap) / ctrl.apMax}%`;
    const aiming = ctrl.aiming || ctrl.firing;
    const r = Math.max(6, ctrl.reticle());
    this.el.reticle.style.display = aiming ? '' : 'none';
    this.el.reticle.style.width = this.el.reticle.style.height = `${r * 2}px`;
    this.el.reticle.classList.toggle('reticle--scope', !!ctrl.scope && aiming);
  }

  setLocked(locked) {
    document.body.classList.toggle('locked', locked);
  }

  toast(text) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.el.toast.classList.remove('on'), 1800);
  }

  showResult(over, battle) {
    const win = over.winner === 'fed';
    const why = {
      base: win ? 'Base camp musuh direbut.' : 'Base camp kita direbut musuh.',
      wiped: win ? 'Semua pasukan musuh dilumpuhkan.' : 'Seluruh regu tidak bisa bertempur lagi.',
      time: `Batas ${TURN_LIMIT} giliran terlampaui.`
    }[over.reason];
    const fed = battle.units.filter((u) => u.side === 'fed');
    const imp = battle.units.filter((u) => u.side === 'imp' && u.kind === 'infantry');
    this.el.result.querySelector('.result__title').textContent = win ? 'Misi berhasil' : 'Misi gagal';
    this.el.result.querySelector('.result__why').textContent = why;
    this.el.result.querySelector('.result__rank').textContent = win ? over.rank : '–';
    this.el.result.querySelector('.result__rank').dataset.rank = over.rank;
    this.el.result.querySelector('.result__stats').textContent =
      `${over.turns} giliran · musuh gugur ${imp.filter((u) => u.state === 'dead').length}/${imp.length} · regu gugur ${over.deaths}, dievakuasi ${fed.filter((u) => u.state === 'evac').length}`;
  }
}
