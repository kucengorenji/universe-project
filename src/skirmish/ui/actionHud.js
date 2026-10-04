import { WEAPONS, falloff } from '../game/rules.js';
import { unitShield, CLASS_NAME, EYE } from './emblems.js';

// Action Mode HUD, laid out after Valkyria Chronicles with its own war-notebook look:
//   bottom left    unit card: portrait, class shield, name, stance, HP, ammo
//   bottom centre  the AP gauge: a long bar ruled every 5 m that drains as the soldier moves,
//                  with chips for stance, running, the attack and how many enemies see them
//   top centre     TARGET while aiming at an enemy: its HP with the estimated damage of the
//                  burst struck through it, the hit zone (head, weak point, armour) and range
//   over enemies   a tag per enemy in sight: shield, HP, a red eye when it can fire back;
//                  arrows at the screen's edge for those out of view
//   screen         the reticle (red over an enemy), a red ink vignette while moving under the
//                  guns of enemies in range, a flash when hit
// The minimap (top right) is a TacticalMap drawn by the game into el.minimap.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ZONE = { head: 'Head ×2', weak: 'Weak point ×3' };

export class ActionHud {
  constructor(root, game) {
    this.game = game;
    root.innerHTML = `
      <div class="tags" aria-hidden="true"></div>
      <div class="danger" aria-hidden="true"></div>
      <div class="hurt" aria-hidden="true"></div>
      <div class="reticle" aria-hidden="true"><i class="reticle__ring"></i><i class="reticle__dot"></i><span class="reticle__zone"></span></div>
      <div class="minimap-frame"><canvas class="minimap" aria-label="Minimap"></canvas><span class="minimap-frame__n">N</span></div>
      <section class="target" aria-live="polite">
        <span class="target__stamp">Target</span>
        <span class="target__shield"></span>
        <div class="target__body">
          <b class="target__name"></b>
          <div class="hpbar target__hp"><i class="hpbar__left"></i><i class="hpbar__cut"></i><span class="hpbar__num"></span></div>
          <div class="target__line"><span class="target__est"></span><span class="target__zone"></span><span class="target__range"></span></div>
        </div>
      </section>
      <section class="card">
        <img class="card__face" alt="" />
        <span class="card__shield"></span>
        <div class="card__body">
          <b class="card__name"></b>
          <span class="card__class"></span>
          <div class="hpbar card__hp"><i class="hpbar__left"></i><span class="hpbar__num"></span></div>
          <div class="card__ammo"></div>
        </div>
      </section>
      <section class="gauge">
        <div class="gauge__chips"><span class="chip chip--stance"></span><span class="chip chip--run">Run ×1.3</span><span class="chip chip--atk"></span><span class="chip chip--seen"></span></div>
        <div class="gauge__row"><b class="gauge__label">AP</b><div class="gauge__bar"><i class="gauge__fill"></i><i class="gauge__ticks"></i></div><span class="gauge__num"></span></div>
      </section>
      <p class="keys"></p>
      <button type="button" class="lockhint">Klik untuk mengunci mouse (Esc melepas)</button>`;
    const $ = (s) => root.querySelector(s);
    this.root = root;
    this.el = {
      tags: $('.tags'), danger: $('.danger'), hurt: $('.hurt'),
      reticle: $('.reticle'), ring: $('.reticle__ring'), zone: $('.reticle__zone'), minimap: $('.minimap'),
      target: $('.target'), tShield: $('.target__shield'), tName: $('.target__name'), tHp: $('.target__hp'), tEst: $('.target__est'), tZone: $('.target__zone'), tRange: $('.target__range'),
      face: $('.card__face'), cShield: $('.card__shield'), name: $('.card__name'), cls: $('.card__class'), hp: $('.card__hp'), ammo: $('.card__ammo'),
      fill: $('.gauge__fill'), ticks: $('.gauge__ticks'), num: $('.gauge__num'), stance: $('.chip--stance'), run: $('.chip--run'), atk: $('.chip--atk'), seen: $('.chip--seen'),
      keys: $('.keys'), lock: $('.lockhint')
    };
    this.el.lock.addEventListener('click', () => game.engine.renderer.domElement.requestPointerLock?.());
    this.cache = {};
  }

  /** Set a text or attribute only when it changed (this runs every frame). */
  set(key, value, apply) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    apply(value);
  }

  /**
   * ctrl: the ActionControl. info: { target: { unit, part, dist, est } | null, threats, running }.
   */
  update(ctrl, info = {}) {
    const u = ctrl.unit;
    if (!u) return;
    const el = this.el;
    // the unit card
    this.set('unit', u.id, () => {
      el.cShield.innerHTML = unitShield(u);
      const src = this.portraits?.[u.id];
      if (src) el.face.src = src;
      el.face.hidden = !src;
      el.name.innerHTML = `${u.leader ? '<i class="star">★</i>' : ''}${esc(u.name)}`;
      this.root.classList.remove('enter');
      void this.root.offsetWidth;
      this.root.classList.add('enter');
    });
    this.set('cls', `${CLASS_NAME[u.cls]} · ${u.stance}`, (v) => (el.cls.textContent = v));
    this.set('hp', `${u.hp}/${u.maxHp}`, () => {
      el.hp.querySelector('.hpbar__left').style.width = `${(100 * u.hp) / u.maxHp}%`;
      el.hp.querySelector('.hpbar__num').textContent = `HP ${u.hp} / ${u.maxHp}`;
      el.hp.classList.toggle('low', u.hp / u.maxHp < 0.3);
    });
    const W = WEAPONS[u.weapon];
    this.set('ammo', `${u.id}:${u.ammo}`, () => {
      el.ammo.innerHTML =
        u.ammo === Infinity
          ? `<span class="ammo__inf">∞</span><span>${W.shots} rds / burst</span>`
          : `<span class="pips">${Array.from({ length: u.maxAmmo }, (_, i) => `<i class="${i < u.ammo ? 'on' : ''}"></i>`).join('')}</span><span>${u.ammo}/${u.maxAmmo}</span>`;
    });
    // the AP gauge, ruled every 5 m of this action's budget
    this.set('apMax', `${u.id}:${ctrl.apMax}`, () => el.ticks.style.setProperty('--tick', `${(500 / Math.max(5, ctrl.apMax)).toFixed(3)}%`));
    el.fill.style.transform = `scaleX(${Math.max(0, ctrl.ap / ctrl.apMax)})`;
    this.set('ap', Math.ceil(ctrl.ap), (v) => (el.num.innerHTML = `<b>${v}</b> / ${Math.round(ctrl.apMax)} m`));
    this.set('empty', ctrl.ap <= 0.01, (v) => this.root.classList.toggle('ap-empty', v));
    this.set('stance', u.stance, (v) => (el.stance.textContent = v === 'crouch' ? 'Crouch' : 'Stand'));
    this.set('run', !!info.running, (v) => el.run.classList.toggle('on', v));
    const atk = ctrl.attacked ? 'used' : this.game.battle.canFire(u) ? 'ready' : 'empty';
    this.set('atk', atk, (v) => {
      el.atk.textContent = { used: 'Attack used', ready: 'Attack ready', empty: 'No ammo' }[v];
      el.atk.dataset.state = v;
    });
    const threats = info.threats || 0;
    this.set('seen', threats, (v) => {
      el.seen.textContent = v ? `Spotted ×${v}` : 'Unseen';
      el.seen.classList.toggle('on', v > 0);
    });
    // red ink at the edges while moving where enemies can fire
    this.set('danger', threats > 0 && ctrl.moving && !ctrl.frozen, (v) => this.root.classList.toggle('in-danger', v));

    // the reticle
    const aiming = ctrl.aiming || ctrl.firing;
    const cursor = ctrl.mode === 'cursor';
    const t = aiming ? info.target : null;
    const ret = el.reticle;
    ret.style.display = aiming || cursor ? '' : 'none';
    const r = aiming ? Math.max(7, ctrl.reticle()) : 7;
    el.ring.style.width = el.ring.style.height = `${r * 2}px`;
    const p = ctrl.reticlePos();
    ret.style.transform = `translate(${p.x}px, ${p.y}px)`;
    const state = !aiming ? 'idle' : t ? (t.est.ping ? 'nohit' : t.est.crit ? 'crit' : 'hostile') : 'aim';
    this.set('ret', `${state}:${!!ctrl.scope}`, () => {
      ret.dataset.state = state;
      ret.classList.toggle('scope', !!ctrl.scope && aiming);
    });
    this.set('zone', t ? (t.est.ping ? 'No effect' : ZONE[t.part] || '') : '', (v) => (el.zone.textContent = v));

    // the target panel
    this.set('target', !!t, (v) => el.target.classList.toggle('on', v));
    if (t) {
      const e = t.unit;
      this.set('tUnit', e.id, () => {
        el.tShield.innerHTML = unitShield(e);
        el.tName.textContent = e.kind === 'infantry' ? `${CLASS_NAME[e.cls]} · ${e.name.replace(/^Prajurit Imperium /, 'No. ')}` : e.name;
      });
      const est = t.est;
      this.set('tHp', `${e.id}:${e.hp}:${est.total}`, () => {
        const left = Math.max(0, e.hp - est.total);
        el.tHp.querySelector('.hpbar__left').style.width = `${(100 * left) / e.maxHp}%`;
        const cut = el.tHp.querySelector('.hpbar__cut');
        cut.style.left = `${(100 * left) / e.maxHp}%`;
        cut.style.width = `${(100 * (e.hp - left)) / e.maxHp}%`;
        el.tHp.querySelector('.hpbar__num').textContent = `HP ${e.hp} / ${e.maxHp}`;
        el.tEst.innerHTML = est.ping ? '<b>0</b> dmg' : `<b>${est.total}</b> dmg${est.lethal ? ' <em>Lethal</em>' : ''}`;
      });
      this.set('tZone', est.ping ? 'nohit' : t.part, () => {
        el.tZone.textContent = est.ping ? 'Armour · no effect' : ZONE[t.part] || (e.kind === 'infantry' ? 'Body' : 'Armour');
        el.tZone.dataset.zone = est.ping ? 'nohit' : est.crit ? 'crit' : 'body';
      });
      const k = falloff(W, t.dist);
      const band = t.dist > W.range ? 'Out of range' : k < 1 ? 'Falloff' : 'Effective';
      this.set('tRange', `${Math.round(t.dist)}:${band}`, () => {
        el.tRange.textContent = `${Math.round(t.dist)} m · ${band}`;
        el.tRange.dataset.band = band === 'Effective' ? 'ok' : band === 'Falloff' ? 'mid' : 'far';
      });
    }
  }

  /**
   * Enemy tags: [{ unit, x, y, on (inside the view), angle (for edge arrows), threat, targeted }].
   */
  tags(list) {
    const box = this.el.tags;
    while (box.children.length < list.length) {
      const d = document.createElement('div');
      d.className = 'tag';
      d.innerHTML = `<span class="tag__shield"></span><span class="tag__hp"><i></i></span><span class="tag__eye">${EYE}</span><i class="tag__arrow"></i>`;
      box.appendChild(d);
    }
    [...box.children].forEach((d, i) => {
      const m = list[i];
      d.style.display = m ? '' : 'none';
      if (!m) return;
      const u = m.unit;
      if (d.dataset.unit !== u.id) {
        d.dataset.unit = u.id;
        d.querySelector('.tag__shield').innerHTML = unitShield(u);
      }
      d.querySelector('.tag__hp i').style.width = `${(100 * u.hp) / u.maxHp}%`;
      d.classList.toggle('threat', !!m.threat);
      d.classList.toggle('targeted', !!m.targeted);
      d.classList.toggle('off', !m.on);
      d.style.transform = `translate(${m.x}px, ${m.y}px)`;
      if (!m.on) d.querySelector('.tag__arrow').style.transform = `rotate(${m.angle}rad)`;
    });
  }

  /** A hit on the acting soldier. */
  hurt() {
    const h = this.el.hurt;
    h.classList.remove('on');
    void h.offsetWidth;
    h.classList.add('on');
  }

  setInput(locked, mode) {
    document.body.classList.toggle('locked', locked);
    document.body.dataset.input = mode;
    this.el.keys.innerHTML = [['WASD', 'gerak'], [mode === 'cursor' ? 'Mouse · Q/E' : 'Mouse', 'kamera'], ['Shift', 'lari'], ['C', 'jongkok'], ['Klik kanan', 'bidik'], ['Klik kiri', 'tembak'], ['Space', 'selesai']]
      .map(([k, v]) => `<span><kbd>${k}</kbd>${v}</span>`)
      .join('');
  }
}
