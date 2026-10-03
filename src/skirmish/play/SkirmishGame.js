import * as THREE from 'three';
import { loadAssetPack } from '../../render/assetLibrary.js';
import { ASSETS } from '../../render/assetManifest.js';
import { generateField } from '../battlefield/generateField.js';
import { FieldBuilder } from '../battlefield/fieldBuilder.js';
import { CanvasPost, installCanvasShading } from '../render/canvasStyle.js';
import { SkyLight } from '../render/skyLight.js';
import { loadSoldierTemplates, loadWeapons } from '../units/soldiers.js';
import { Arena } from '../game/arena.js';
import { Battle } from '../game/battle.js';
import { ROSTER, DEFAULT_SQUAD } from '../game/roster.js';
import { TacticalMap } from '../ui/tacticalMap.js';
import { PrepPanel, COVER_LEVELS } from '../ui/prepPanel.js';
import { Hud } from '../ui/hud.js';
import { UnitViews } from './unitViews.js';
import { Effects } from './effects.js';
import { Combat } from './combat.js';
import { ActionControl } from './actionControl.js';
import { EnemyTurn } from './enemyTurn.js';
import { Sound } from './sound.js';

// The skirmish as an engine mode. Phases:
//   prep     flat map + setup panel (no 3D yet): seed, squad, deployment, briefing
//   loading  building the 3D battlefield
//   command  flat map: pick a unit (1 CP), or end the turn
//   action   third-person control of that unit (ActionControl)
//   enemy    the AI's turn in 3D (EnemyTurn)
//   over     the result card
// document.body.dataset.phase drives which UI shows.

const PICK_RADIUS = 3;

export class SkirmishGame {
  constructor(engine, { mapEl, prepEl, hudEl }) {
    this.engine = engine;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.15, 2500);
    this.post = new CanvasPost(engine.renderer);
    // shadows are always built; the quality tier sets their map size (or turns them off)
    this.shadows = true;
    engine.renderer.shadowMap.enabled = true;
    engine.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.sky = new SkyLight(this.scene, { shadows: true, mapSize: 2048, extent: 70 });
    engine.quality.onChange(() => this.applyQuality());
    this.clock = 0;
    this.tasks = [];
    this.sound = new Sound(this.camera);
    this.audio = this.sound;
    this.map = new TacticalMap(mapEl, { onPick: (x, z) => this.onMapPick(x, z) });
    this.hud = new Hud(hudEl, this);
    const params = new URLSearchParams(location.search);
    this.setup = {
      seed: Number(params.get('seed')) || 1 + Math.floor(Math.random() * 999999),
      difficulty: 'normal',
      cover: 'normal',
      time: params.get('time') || 'day',
      river: 'auto',
      squad: [...DEFAULT_SQUAD],
      leader: DEFAULT_SQUAD[0]
    };
    this.prep = new PrepPanel(prepEl, this.setup, {
      onChange: (s, { field }) => (field ? this.regenerate() : this.assignDeploy()),
      onStart: () => this.start(),
      quality: engine.quality.preset,
      onQuality: (q) => engine.quality.setPreset(q)
    });
    this.fast = false;
    this.onKey = (e) => {
      if (e.key === ' ' && this.phase === 'enemy') {
        e.preventDefault();
        this.fast = e.type === 'keydown';
      }
    };
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    installCanvasShading();
    // assets load while the player sets up
    this.assets = Promise.all([
      loadAssetPack(ASSETS.townPack),
      loadAssetPack(ASSETS.militaryPack, { glow: { M_radiator: 1 } }),
      loadSoldierTemplates(ASSETS.soldierPack)
    ]).then(async ([town, military, templates]) => ({ town, military, templates, weapons: await loadWeapons(ASSETS.militaryPack, military) }));
    this.setPhase('prep');
    this.regenerate();
  }

  setPhase(p) {
    this.phase = p;
    document.body.dataset.phase = p;
    this.hud.update();
  }

  // ---------------------------------------------------------------- scheduling
  after(sec, fn) {
    this.tasks.push({ at: this.clock + sec, fn });
  }

  wait(sec) {
    return new Promise((r) => this.after(sec, r));
  }

  // ---------------------------------------------------------------- preparation
  regenerate() {
    const s = this.setup;
    this.field = generateField(s.seed, { cover: COVER_LEVELS[s.cover].value, time: s.time, river: s.river });
    this.map.setField(this.field);
    this.map.fit();
    this.deploy = new Map();
    this.assignDeploy();
    this.prep.showBriefing(this.field);
    const url = new URL(location.href);
    url.searchParams.set('seed', s.seed);
    history.replaceState(null, '', url);
  }

  /** Squad members get deploy slots (keeping the ones they have). */
  assignDeploy() {
    const slots = this.field.deploy.fed;
    for (const id of [...this.deploy.keys()]) if (!this.setup.squad.includes(id)) this.deploy.delete(id);
    const used = new Set(this.deploy.values());
    for (const id of this.setup.squad) {
      if (this.deploy.has(id)) continue;
      const free = slots.findIndex((_, i) => !used.has(i));
      if (free < 0) break;
      this.deploy.set(id, free);
      used.add(free);
    }
    this.prep.showBriefing(this.field);
  }

  prepTokens() {
    return this.setup.squad.filter((id) => this.deploy.has(id)).map((id) => {
      const r = ROSTER.find((x) => x.id === id);
      const slot = this.field.deploy.fed[this.deploy.get(id)];
      return { id, side: 'fed', kind: 'infantry', cls: r.cls, name: r.name, x: slot.x, z: slot.z, yaw: Math.PI, hp: 1, maxHp: 1, state: 'ok', leader: this.setup.leader === id };
    });
  }

  onMapPick(x, z) {
    if (this.phase === 'prep') {
      const tok = this.prepTokens().find((t) => Math.hypot(t.x - x, t.z - z) < PICK_RADIUS);
      if (tok) {
        this.prepSelected = tok.id === this.prepSelected ? null : tok.id;
        return;
      }
      const slots = this.field.deploy.fed;
      const k = slots.findIndex((s) => Math.hypot(s.x - x, s.z - z) < PICK_RADIUS);
      if (k >= 0 && this.prepSelected) {
        const other = [...this.deploy.entries()].find(([, v]) => v === k)?.[0];
        if (other) this.deploy.set(other, this.deploy.get(this.prepSelected));
        this.deploy.set(this.prepSelected, k);
        this.prepSelected = null;
      }
      return;
    }
    if (this.phase === 'command') {
      const b = this.battle;
      let best = null;
      for (const u of b.units) {
        if (u.side !== 'fed') continue;
        const d = Math.hypot(u.x - x, u.z - z);
        if (d < PICK_RADIUS && (!best || d < best.d)) best = { u, d };
      }
      if (best) this.pickUnit(best.u.id);
    }
  }

  // ---------------------------------------------------------------- battle
  async start() {
    if (!this.setup.squad.length) return;
    this.sound.unlock();
    this.setPhase('loading');
    const A = await this.assets;
    const field = this.field;
    this.applyQuality();
    this.builder = new FieldBuilder(field, { town: A.town, military: A.military }, { shadows: this.shadows, grass: this.q.grass });
    this.scene.add(this.builder.group);
    this.arena = new Arena(field);
    const squad = this.setup.squad.filter((id) => this.deploy.has(id)).map((id) => {
      const r = ROSTER.find((x) => x.id === id);
      const slot = field.deploy.fed[this.deploy.get(id)];
      return { ...r, leader: id === this.setup.leader, x: slot.x, z: slot.z };
    });
    this.battle = new Battle({ field, squad, difficulty: this.setup.difficulty });
    this.views = new UnitViews(this.scene, { templates: A.templates, weapons: A.weapons, arena: this.arena, tank: this.builder.tank, shadows: this.shadows });
    for (const u of this.battle.units) if (u.kind !== 'bunker') this.views.add(u);
    this.effects = new Effects(this.scene, this.camera, this.hud.fxLayer);
    // the minimap shares the big map's drawing
    this.minimap ||= new TacticalMap(this.hud.el.minimap, { mini: true });
    this.minimap.field = field;
    this.minimap.base = this.map.base;
    this.combat = new Combat(this);
    this.control ||= new ActionControl(this);
    this.enemy = new EnemyTurn(this);
    this.engine.renderer.toneMappingExposure = this.sky.set(this.setup.time);
    // a first frame compiled behind the loading card
    const fed = this.battle.alive('fed')[0];
    this.camera.position.set(fed.x, this.arena.ground(fed.x, fed.z) + 30, fed.z + 30);
    this.camera.lookAt(fed.x, 0, fed.z);
    await this.engine.renderer.compileAsync(this.scene, this.camera);
    this.setPhase('command');
    this.hud.toast('Giliran 1 — pilih unit di peta');
  }

  pickUnit(id) {
    if (this.phase !== 'command') return;
    const u = this.battle.unit(id);
    if (!this.battle.canSelect(u)) {
      if (u && u.side === 'fed' && u.state === 'ok' && this.battle.cp < u.cost) this.hud.toast('CP habis — akhiri giliran');
      return;
    }
    const ap = this.battle.select(u);
    this.setPhase('action');
    this.combat.resetIntercept();
    this.control.start(u, ap, { onEnd: () => this.endAction() });
  }

  endAction() {
    const u = this.control.unit;
    this.battle.endAction(u);
    this.combat.resetIntercept();
    if (this.battle.over) return this.finish();
    this.setPhase('command');
    if (this.battle.cp <= 0) this.hud.toast('CP habis — akhiri giliran');
  }

  endPlayerTurn() {
    if (this.phase !== 'command') return;
    this.battle.endTurn();
    if (this.battle.over) return this.finish();
    this.setPhase('enemy');
    this.combat.resetIntercept();
    this.enemy.run();
  }

  endEnemyTurn() {
    this.fast = false;
    if (this.battle.over) return this.finish();
    this.battle.endTurn();
    if (this.battle.over) return this.finish();
    this.setPhase('command');
    this.hud.toast(`Giliran ${this.battle.turn}`);
  }

  finish() {
    this.control?.stop();
    this.hud.showResult(this.battle.over, this.battle);
    this.setPhase('over');
  }

  restart(newSeed) {
    this.control?.stop();
    this.teardown();
    if (newSeed) this.setup.seed = 1 + Math.floor(Math.random() * 999999);
    this.prep.el.seed.value = this.setup.seed;
    this.setPhase('prep');
    this.regenerate();
  }

  teardown() {
    this.tasks = [];
    this.effects?.dispose();
    this.views?.dispose();
    this.builder?.dispose();
    this.builder = this.views = this.effects = this.battle = this.arena = null;
  }

  // ---------------------------------------------------------------- quality
  /**
   * Per tier: shadow map size (0 = off), share of the tall grass, and the scene's MSAA (none at
   * pixel ratios of 1.75 and up: the ink lines already hide the steps, and it saves ~3 ms at Retina).
   */
  applyQuality() {
    const tier = this.engine.quality.tier;
    this.q = { high: { shadow: 2048, grass: 1 }, medium: { shadow: 1024, grass: 0.6 }, low: { shadow: 0, grass: 0.35 } }[tier];
    // High on a 1x screen supersamples (1.5x, scaled down by the browser): crisper ink lines
    const Q = this.engine.quality;
    if (Q.preset === 'high' && (window.devicePixelRatio || 1) < 1.5 && Q.ratio < 1.5) {
      Q.ratio = 1.5;
      Q.apply();
    }
    this.sky.setShadows(this.q.shadow);
    this.engine.renderer.shadowMap.enabled = this.q.shadow > 0;
    this.scene.traverse((o) => o.material && (o.material.needsUpdate = true));
    this.syncSamples();
  }

  syncSamples() {
    const pr = this.engine.renderer.getPixelRatio();
    this.post.setSamples(pr >= 1.75 || this.engine.quality.tier === 'low' ? 0 : 2);
  }

  // ---------------------------------------------------------------- engine mode
  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const pr = this.engine.renderer.getPixelRatio();
    this.post.setSize(Math.floor(w * pr), Math.floor(h * pr));
    this.syncSamples();
  }

  update(dt) {
    if (this.phase === 'enemy' && this.fast) dt *= 3;
    this.clock += dt;
    if (this.tasks.length) {
      const due = this.tasks.filter((t) => t.at <= this.clock);
      this.tasks = this.tasks.filter((t) => t.at > this.clock);
      for (const t of due) t.fn();
    }
    const p = this.phase;
    if (p === 'prep') {
      this.map.draw(dt, { units: this.prepTokens(), camps: this.field.camps.map((c) => ({ ...c, owner: c.side })), slots: this.field.deploy.fed, selected: this.prepSelected });
      return;
    }
    if (!this.battle) return;
    if (p === 'command') {
      const b = this.battle;
      const pickable = new Set(b.units.filter((u) => b.canSelect(u)).map((u) => u.id));
      this.map.draw(dt, { units: b.units, camps: b.camps, pickable });
    }
    if (p === 'action') {
      this.control.update(dt);
      if (this.control.moving && !this.control.frozen) this.combat.intercept(dt, this.control.unit);
      this.hud.action(this.control);
      const u = this.control.unit;
      this.minimap.view = { x: u.x, z: u.z, scale: 1.3 };
      this.minimap.draw(dt, { units: this.battle.units, camps: this.battle.camps, selected: u.id });
      this.updateMarkers(dt, u);
    } else this.hud.markers([]);
    if (p === 'enemy') {
      this.enemy.update(dt);
      if (this.enemy.moving) this.combat.intercept(dt, this.enemy.moving);
    }
    this.views.update(dt);
    this.effects.update(dt);
    this.builder.update(dt);
    const shake = this.effects.shakeOffset();
    if (shake) this.camera.position.add(shake);
    this.sky.dome.position.copy(this.camera.position);
    // shadows follow the action
    const f = p === 'action' ? this.control.unit : p === 'enemy' ? this.enemy.focus : null;
    if (f) this.sky.follow({ x: f.x, z: f.z });
    const events = this.battle.drain();
    if (events.length) {
      this.hud.update();
      for (const e of events) {
        if (e.type === 'capture') this.hud.toast(e.side === 'fed' ? 'Camp direbut!' : 'Musuh merebut camp!');
        if (e.type === 'evac') this.hud.toast('Kawan dievakuasi');
        if (e.type === 'resupply') this.hud.toast('Amunisi diisi ulang');
      }
    }
    if (this.battle.over && (p === 'action' || p === 'enemy') && !this.control.firing && !this.enemy.running) this.finish();
  }

  /** Red markers over the enemies the acting soldier can see (sight re-checked a few times a second). */
  updateMarkers(dt, u) {
    this.sightTimer = (this.sightTimer || 0) - dt;
    if (this.sightTimer <= 0) {
      this.sightTimer = 0.2;
      this.seen = this.battle.units.filter((e) => e.side !== u.side && e.state === 'ok' && Math.hypot(e.x - u.x, e.z - u.z) < 150 && this.arena.sees(u, e));
    }
    const r = this.engine.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3();
    const list = [];
    for (const e of this.seen || []) {
      const g = this.arena.ground(e.x, e.z);
      v.set(e.x, g + (e.kind === 'tank' ? 3.4 : e.kind === 'bunker' ? 2.8 : e.stance === 'crouch' ? 1.6 : 2.05), e.z).project(this.camera);
      if (v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1) list.push({ x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height });
    }
    this.hud.markers(list);
  }

  render() {
    if (this.phase === 'action' || this.phase === 'enemy' || this.phase === 'over') this.post.render(this.scene, this.camera);
  }
}
