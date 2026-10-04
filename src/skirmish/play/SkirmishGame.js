import * as THREE from 'three';
import { loadAssetPack } from '../../render/assetLibrary.js';
import { ASSETS } from '../../render/assetManifest.js';
import { generateField } from '../battlefield/generateField.js';
import { FieldBuilder } from '../battlefield/fieldBuilder.js';
import { CanvasPost, installCanvasShading } from '../render/canvasStyle.js';
import { SkyLight } from '../render/skyLight.js';
import { loadWeapons } from '../units/soldiers.js';
import { loadSoldierTemplates, portrait } from '../units/vcSoldiers.js';
import { Arena } from '../game/arena.js';
import { Battle } from '../game/battle.js';
import { Spotting } from '../game/spotting.js';
import { ROSTER, DEFAULT_SQUAD } from '../game/roster.js';
import { MIN_AP_SHARE, RESELECT_AP, WEAPONS } from '../game/rules.js';
import { TacticalMap, unitLabel } from '../ui/tacticalMap.js';
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
//   dive     the map zooms into the picked unit and the camera drops from above to its shoulder
//   action   third-person control of that unit (ActionControl)
//   rise     the camera climbs back above the unit, then the map returns
//   enemy    the AI's turn in 3D (EnemyTurn)
//   over     the result card
// document.body.dataset.phase drives which UI shows.

const PICK_RADIUS = 3;
const DIVE = 1.05; // seconds from the map to the soldier's shoulder
const RISE = 0.6;
const ALTITUDE = 60; // the overhead camera that matches the zoomed-in map (m above the unit)
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

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
      if (e.type === 'keydown' && this.phase === 'command') this.commandKey(e);
    };
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    installCanvasShading();
    // assets load while the player sets up
    this.assets = Promise.all([
      loadAssetPack(ASSETS.townPack),
      loadAssetPack(ASSETS.militaryPack, { glow: { M_radiator: 1 } }),
      loadSoldierTemplates(ASSETS.soldierPack, ASSETS.soldierAtlas, ASSETS.soldierHead)
    ]).then(async ([town, military, templates]) => ({ town, military, templates, weapons: await loadWeapons(ASSETS.militaryPack, military) }));
    // portraits of the nine, rendered from the 3D model once it has loaded
    this.assets.then((A) => {
      this.portraits = Object.fromEntries(ROSTER.map((r) => [r.id, portrait(engine.renderer, A.templates, A.weapons, { faction: 'fed', cls: r.cls, id: r.id, seed: r.face })]));
      this.prep.setPortraits(this.portraits);
      this.hud.portraits = this.portraits;
      this.hud.update();
    });
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
    this.spot = new Spotting(this.battle, this.arena, 'fed');
    this.spot.update();
    this.cursor = null;
    this.views = new UnitViews(this.scene, { templates: A.templates, weapons: A.weapons, arena: this.arena, tank: this.builder.tank, shadows: this.shadows, camera: this.camera });
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
    this.hud.banner('fed', 1);
  }

  pickUnit(id) {
    if (this.phase !== 'command') return;
    const u = this.battle.unit(id);
    if (!this.battle.canSelect(u)) {
      if (u && u.side === 'fed' && u.state === 'ok' && this.battle.cp < u.cost) this.hud.toast('CP habis — akhiri giliran');
      return;
    }
    const ap = this.battle.select(u);
    this.seen = null; // re-check sight for the new soldier at once
    this.combat.resetIntercept();
    // take the controls now (the pointer lock needs this click), idle until the camera lands
    this.control.start(u, ap, { onEnd: () => this.endAction() });
    this.control.hold = true;
    this.control.placeCamera();
    const land = this.pose();
    this.mapZoom(u, 'diving');
    this.setPhase('dive');
    if (u.leader) this.hud.cutIn(u);
    this.setPose(this.overhead(u));
    this.fly(land, DIVE, () => {
      this.control.hold = false;
      this.setPhase('action');
    });
  }

  endAction() {
    const u = this.control.unit;
    this.battle.endAction(u);
    this.combat.resetIntercept();
    if (this.battle.over) return this.finish();
    this.spot.update();
    this.setPhase('rise');
    this.fly(this.overhead(u), RISE, () => {
      this.mapZoom(u, 'rising');
      this.setPhase('command');
      if (this.battle.cp <= 0) this.hud.toast('CP habis — akhiri giliran');
    });
  }

  // ---------------------------------------------------------------- the camera between map and field
  /** The camera's pose now. */
  pose() {
    const c = this.camera;
    return { pos: c.position.clone(), quat: c.quaternion.clone(), fov: c.fov };
  }

  setPose(p) {
    const c = this.camera;
    c.position.copy(p.pos);
    c.quaternion.copy(p.quat);
    if (c.fov !== p.fov) {
      c.fov = p.fov;
      c.updateProjectionMatrix();
    }
    c.updateMatrixWorld();
  }

  /** Straight down onto a unit, north up, as the flat map shows it. */
  overhead(u) {
    const pos = new THREE.Vector3(u.x, this.arena.ground(u.x, u.z) + ALTITUDE, u.z);
    const m = new THREE.Matrix4().lookAt(pos, new THREE.Vector3(u.x, 0, u.z), new THREE.Vector3(0, 0, -1));
    return { pos, quat: new THREE.Quaternion().setFromRotationMatrix(m), fov: 50 };
  }

  /** Fly the camera to a pose over `dur` seconds, then call done. */
  fly(to, dur, done) {
    this.flight = { from: this.pose(), to, t: 0, dur, done };
  }

  stepFlight(dt) {
    const f = this.flight;
    f.t = Math.min(f.dur, f.t + dt);
    const k = ease(f.t / f.dur);
    // the height drops ahead of the rest, so the camera falls first and then swings in behind
    const ky = ease(Math.min(1, (f.t / f.dur) * 1.25));
    const c = this.camera;
    c.position.lerpVectors(f.from.pos, f.to.pos, k);
    c.position.y = f.from.pos.y + (f.to.pos.y - f.from.pos.y) * ky;
    c.quaternion.slerpQuaternions(f.from.quat, f.to.quat, k);
    c.fov = f.from.fov + (f.to.fov - f.from.fov) * k;
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
    if (f.t >= f.dur) {
      this.flight = null;
      f.done?.();
    }
  }

  /** The flat map zooms into (or back out from) a unit's spot as the camera takes over. */
  mapZoom(u, kind) {
    const el = this.map.canvas;
    const [x, y] = this.map.toScreen(u.x, u.z);
    el.style.transformOrigin = `${x}px ${y}px`;
    el.classList.remove('diving', 'rising');
    void el.offsetWidth;
    el.classList.add(kind);
  }

  // ---------------------------------------------------------------- command mode cursor
  /** The units on the flat map as the player knows them: the squad, and the enemy as spotted. */
  known() {
    return [...this.battle.units.filter((u) => u.side === 'fed'), ...this.spot.view()];
  }

  /** The AP the next selection of a unit would get. */
  nextAp(u) {
    return u.apMax * Math.max(MIN_AP_SHARE, RESELECT_AP ** u.picks);
  }

  setCursor(id) {
    this.cursor = id;
  }

  /** Tab / arrows walk the cursor through the squad; Enter commands the unit under it. */
  commandKey(e) {
    const squad = this.battle.units.filter((u) => u.side === 'fed' && u.state === 'ok');
    if (!squad.length) return;
    const step = e.key === 'Tab' ? (e.shiftKey ? -1 : 1) : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (step) {
      e.preventDefault();
      const i = squad.findIndex((u) => u.id === this.cursor);
      this.cursor = squad[(i + step + squad.length) % squad.length].id;
      this.map.pointerMoved = false;
    } else if (e.key === 'Enter' && this.cursor) {
      e.preventDefault();
      this.pickUnit(this.cursor);
    }
  }

  endPlayerTurn() {
    if (this.phase !== 'command') return;
    this.battle.endTurn();
    if (this.battle.over) return this.finish();
    this.setPhase('enemy');
    this.hud.banner('imp', this.battle.turn);
    this.combat.resetIntercept();
    this.enemy.run();
  }

  endEnemyTurn() {
    this.fast = false;
    if (this.battle.over) return this.finish();
    this.battle.endTurn();
    if (this.battle.over) return this.finish();
    this.spot.update();
    this.setPhase('command');
    this.hud.banner('fed', this.battle.turn);
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
    // the enemy's turn plays back faster (its soldiers can walk 225 m); Space faster still
    if (this.phase === 'enemy') dt *= this.fast ? 4 : 2;
    this.clock += dt;
    if (this.tasks.length) {
      const due = this.tasks.filter((t) => t.at <= this.clock);
      this.tasks = this.tasks.filter((t) => t.at > this.clock);
      for (const t of due) t.fn();
    }
    const p = this.phase;
    if (p === 'prep') {
      const tokens = this.prepTokens();
      const h = this.map.hover;
      const cur = h && tokens.find((t) => Math.hypot(t.x - h[0], t.z - h[1]) < PICK_RADIUS);
      this.map.draw(dt, { units: tokens, camps: this.field.camps.map((c) => ({ ...c, owner: c.side })), slots: this.field.deploy.fed, selected: this.prepSelected, cursor: cur?.id, label: cur && unitLabel(cur) });
      return;
    }
    if (!this.battle) return;
    if (p === 'command') {
      const b = this.battle;
      const units = this.known();
      const pickable = new Set(b.units.filter((u) => b.canSelect(u)).map((u) => u.id));
      // the cursor follows the pointer onto the nearest token (the keyboard moves it otherwise)
      const h = this.map.hover;
      if (h && this.map.pointerMoved) {
        let best = null;
        for (const u of units) {
          if (u.state === 'evac' || u.state === 'dead') continue;
          const d = Math.hypot(u.x - h[0], u.z - h[1]);
          if (d < PICK_RADIUS * 1.4 && (!best || d < best.d)) best = { u, d };
        }
        this.cursor = best?.u.id ?? null;
      }
      const cur = units.find((u) => u.id === this.cursor);
      // one of ours under the cursor shows how far it could go (straight-line AP of its next selection)
      const mine = cur && cur.side === 'fed' && cur.state === 'ok' && !cur.ghost;
      const range = mine && pickable.has(cur.id) ? { x: cur.x, z: cur.z, r: this.nextAp(cur) } : null;
      const label = cur ? unitLabel(cur, mine ? this.nextAp(cur) : null) : null;
      this.map.draw(dt, { units, camps: b.camps, pickable, range, cursor: this.cursor, label });
      this.hud.highlight(this.cursor);
    }
    if (this.flight) this.stepFlight(dt);
    // what the squad can see, a few times a second while anything moves
    if (p === 'action' || p === 'enemy') {
      this.spotTimer = (this.spotTimer || 0) - dt;
      if (this.spotTimer <= 0) {
        this.spotTimer = 0.25;
        this.spot.update();
      }
    }
    const c = this.control;
    if (p === 'action') {
      c.update(dt);
      if (c.moving && !c.frozen) this.combat.intercept(dt, c.unit);
      const u = c.unit;
      this.updateMarkers(dt, u);
      this.hud.action(c, { target: this.aimTarget(u), threats: this.threats.length, running: c.running });
      this.minimap.view = { x: u.x, z: u.z, scale: 1.3 };
      this.minimap.draw(dt, { units: this.known(), camps: this.battle.camps, selected: u.id });
    } else this.hud.markers([]);
    // aiming: the background melts out of focus and the frame's edges darken
    const aiming = p === 'action' && (c.aiming || c.firing);
    this.aimK = (this.aimK || 0) + ((aiming ? 1 : 0) - (this.aimK || 0)) * (1 - Math.exp(-dt * 10));
    // focus on what the reticle meets (a unit, a wall); on open ground or sky, a middle distance
    const sight = c?.sight;
    const focus = sight?.hit ? sight.dist : Math.min(sight?.dist ?? 30, 40);
    this.post.dof(focus, this.aimK * (sight?.hit?.unit ? 0.8 : 0.45));
    this.post.aim(this.aimK);
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
      this.hud.events(events);
      // an enemy that fires on the squad gives itself away
      for (const e of events) if (e.type === 'hit' && e.by && this.battle.unit(e.by)?.side === 'imp') this.spot.reveal(e.by);
      for (const e of events) {
        if (e.type === 'capture') this.hud.toast(e.side === 'fed' ? 'Camp direbut!' : 'Musuh merebut camp!');
        if (e.type === 'evac') this.hud.toast('Kawan dievakuasi');
        if (e.type === 'resupply') this.hud.toast('Amunisi diisi ulang');
      }
    }
    if (this.battle.over && (p === 'action' || p === 'enemy') && !this.control.firing && !this.enemy.running) this.finish();
  }

  /** The enemy under the reticle while aiming, with the attack's estimate: { unit, part, dist, est } or null. */
  aimTarget(u) {
    const c = this.control;
    const h = c.sight?.hit;
    if (!(c.aiming || c.firing) || !h?.unit || h.unit.side === u.side || h.unit.state !== 'ok') return null;
    const e = h.unit;
    const dist = Math.hypot(e.x - u.x, e.z - u.z);
    return { unit: e, part: h.part, dist, est: this.battle.estimate(u, e, { part: h.part, dist }) };
  }

  /**
   * Enemy tags for the acting soldier: every enemy it can see, and every enemy that could fire
   * on it if it moved now (standing, in range of its interception weapon, with a line of sight).
   * Sight is re-checked a few times a second; the tags follow every frame. Enemies out of view
   * get an arrow at the screen's edge.
   */
  updateMarkers(dt, u) {
    this.sightTimer = (this.sightTimer || 0) - dt;
    if (this.sightTimer <= 0 || !this.seen) {
      this.sightTimer = 0.2;
      const A = this.arena;
      this.seen = [];
      this.threats = [];
      for (const e of this.battle.units) {
        if (e.side === u.side || e.state !== 'ok') continue;
        const d = Math.hypot(e.x - u.x, e.z - u.z);
        if (d > 150) continue;
        const W = e.intercept && WEAPONS[e.intercept];
        const canFire = W && d <= W.range && (e.kind !== 'infantry' || e.stance === 'stand');
        const theySee = canFire && A.sees(e, u);
        if (!theySee && !A.sees(u, e)) continue;
        this.seen.push(e);
        if (theySee) this.threats.push(e);
      }
    }
    const r = this.engine.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3();
    const target = this.aimTarget(u)?.unit;
    const threat = new Set(this.threats);
    const M = 46; // edge arrows stay this far inside the screen
    const list = [];
    for (const e of this.seen) {
      const g = this.arena.ground(e.x, e.z);
      v.set(e.x, g + (e.kind === 'tank' ? 3.4 : e.kind === 'bunker' ? 2.8 : e.stance === 'crouch' ? 1.55 : 2.05), e.z).project(this.camera);
      const behind = v.z > 1;
      const on = !behind && Math.abs(v.x) < 0.98 && Math.abs(v.y) < 0.98;
      let x = ((v.x + 1) / 2) * r.width, y = ((1 - v.y) / 2) * r.height, angle = 0;
      if (!on) {
        // the direction from the screen's centre, flipped when the enemy is behind the camera
        let dx = behind ? -v.x : v.x, dy = behind ? v.y : -v.y;
        if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) dy = 1;
        angle = Math.atan2(dy, dx);
        const hw = r.width / 2 - M, hh = r.height / 2 - M;
        const k = Math.min(hw / Math.max(Math.abs(Math.cos(angle)), 1e-4), hh / Math.max(Math.abs(Math.sin(angle)), 1e-4));
        x = r.width / 2 + Math.cos(angle) * k;
        y = r.height / 2 + Math.sin(angle) * k;
      }
      list.push({ unit: e, x, y, on, angle, threat: threat.has(e), targeted: e === target });
    }
    this.hud.markers(list);
  }

  render() {
    if (this.phase !== 'prep' && this.phase !== 'command' && this.phase !== 'loading') this.post.render(this.scene, this.camera);
  }
}
