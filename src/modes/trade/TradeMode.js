import * as THREE from 'three';
import { generateHexasphere } from '../../math/hexasphere.js';
import { PlanetRenderer } from '../../render/planetRenderer.js';
import { t } from '../../i18n/index.js';
import { buildableTiles } from '../../trade/scenario.js';
import { FACILITIES } from '../../trade/catalog.js';
import { nearby, isLand } from '../../trade/routing.js';
import { TradeView, renderMap } from './render.js';
import { TradeHud } from './ui/hud.js';

let shared = null, current = null;
function rendererFor(ctx) {
  if (!shared) {
    shared = new PlanetRenderer(ctx.engine.container, generateHexasphere(ctx.world.subdivision, ctx.world.radius), {
      renderer: ctx.engine.renderer, externalLoop: true, decorativeMovers: false,
      onSelect: selection => current?.select(selection)
    });
    shared.suspend();
  }
  return shared;
}

export default class TradeMode {
  static async prepare(ctx, route) { await ctx.trade.resume(route.campaign); await rendererFor(ctx).assetsPromise; }
  constructor(ctx, route) { this.ctx = ctx; this.route = route; this.session = ctx.trade; this.tool = null; this.validTiles = []; this.pr = rendererFor(ctx); }
  async enter() {
    current = this;
    this.pr.hexasphere = generateHexasphere(this.session.base.subdivision, this.ctx.world.radius);
    this.map = renderMap(this.session.base, this.session.state);
    for (const data of this.map.tilesData) Object.assign(this.pr.hexasphere.tileMap.get(data.id), data);
    this.pr.resume(); this.pr.buildPlanet(this.map); this.pr.autoRotate = false;
    await this.pr.assetsPromise;
    this.view = new TradeView(this.pr, this.session); this.view.refresh();
    this.hud = new TradeHud(this); document.body.dataset.mode = 'trade';
    this.pr.onTileHover = tile => this.hover(tile);
    this.unsubscribe = this.session.subscribe(() => { this.dirty = true; });
    this.onKey = e => this.key(e); window.addEventListener('keydown', this.onKey, { capture: true });
    this.hiddenRoots = ['missionUi', 'tipUi'].map(id => { const el = document.getElementById(id), hidden = el?.hidden; if (el) el.hidden = true; return { el, hidden }; });
    const ui = this.session.state.ui;
    if (ui.camera?.position && ui.camera?.target) {
      this.pr.camera.position.fromArray(ui.camera.position); this.pr.camera.up.fromArray(ui.camera.up);
      this.pr.controls.target.fromArray(ui.camera.target); this.pr.setControlsUp(this.pr.camera.up);
    } else {
      this.pr.viewFrom(this.pr.hexasphere.tileMap.get(this.session.state.cities[0].tileId).center);
    }
    this.resize(); this.hud.render(true);
  }
  arrived() { this.hud.root.querySelector('[data-action="play"]')?.focus({ preventScroll: true }); }
  update(dt, time, timestamp) {
    if (!this.session.state) return;
    this.pr.update(timestamp);
    if (this.dirty || !this.pr.assets || this.pr.chunks.length !== this.chunkCount || this.lodReady !== this.pr.lod0Ready) {
      this.view.refresh(); this.chunkCount = this.pr.chunks.length; this.lodReady = this.pr.lod0Ready; this.dirty = false;
    }
    this.view.update(this.session.state.paused || this.session.appPaused ? 0 : Math.min(1, this.session.accumulator));
    this.hud.render();
  }
  render() { this.ctx.engine.draw(this.pr.scene, this.pr.camera); }
  resize() {
    this.pr.onWindowResize();
    const panel = this.hud?.root.querySelector('.trade-inspector').getBoundingClientRect(), top = this.hud?.root.querySelector('.trade-topbar').getBoundingClientRect(), dock = this.hud?.root.querySelector('.trade-dock').getBoundingClientRect();
    this.pr.setInset({ left: 80, right: panel ? panel.width + 24 : Math.min(360, window.innerWidth * .3), top: top?.height || 72, bottom: dock?.height || 72 });
  }
  select({ tile, city, event }) {
    const shipment = !this.tool && this.view.pick(event);
    if (shipment) { this.inspect(shipment.startsWith('founder:') ? 'city' : 'shipment', shipment.startsWith('founder:') ? shipment.slice(8) : shipment); return; }
    const index = city?.index ?? tile?.cityIndex;
    const c = index !== null && index !== undefined ? this.session.state.cities[index] : null;
    if (this.tool?.type === 'build') {
      if (!tile || !this.validTiles.includes(tile.id)) { this.hud.message(t('trade.placement.invalid')); return; }
      const { kind, cityId } = this.tool;
      const place = () => this.perform({ type: kind === 'city' ? 'city' : 'build', kind, cityId, tileId: tile.id }, () => {
        this.cancelTool(); const f = kind === 'city' ? this.session.state.cities.at(-1) : this.session.state.facilities.at(-1);
        this.inspect(kind === 'city' ? 'city' : 'facility', f.id);
      });
      if (kind === 'city' || FACILITIES[kind].cost >= 26000) this.hud.confirm(t(kind === 'city' ? 'trade.expand' : `trade.facility.${kind}`), this.hud.buildSummary(kind, cityId, tile.id), place);
      else place(); return;
    }
    if (this.tool?.type === 'origin' || this.tool?.type === 'destination') { if (c) this.hud.pickTown(c.id); return; }
    if (c) this.inspect('city', c.id);
    else if (tile) {
      const facility = this.session.state.facilities.find(f => f.tileId === tile.id);
      this.inspect(facility ? 'facility' : 'tile', facility?.id ?? tile.id);
    }
  }
  hover(tile) {
    if (!this.tool || this.tool.type !== 'build') return;
    this.view.ghostAt(this.tool.kind, tile?.id, tile ? this.validTiles.includes(tile.id) : false);
    this.hud.placementInfo(tile, tile ? this.validTiles.includes(tile.id) : false);
  }
  inspect(type, id, focus = true) {
    this.cancelTool(false); this.hud.selection = { type, id }; this.session.state.ui.selection = { type, id };
    this.hud.page = 'inspect'; this.hud.render(true);
    if (focus) this.focus(type, id);
  }
  focus(type, id) {
    this.view.following = null; this.pr.controls.enabled = true;
    if (type === 'city') {
      const index = this.session.state.cities.findIndex(c => c.id === id);
      this.pr.focusOn({ type: 'city', index }, { animate: false });
    } else if (type === 'facility' || type === 'tile') {
      const tileId = type === 'tile' ? Number(id) : this.session.state.facilities.find(f => f.id === id)?.tileId;
      if (tileId !== undefined) {
        this.pr.focusOn({ type: 'tile', tileId }, { animate: false });
        this.pr.focus.dir.copy(this.pr.hexasphere.tileMap.get(tileId).center);
        this.pr.focus.dist = this.pr.tileSpacing * 5; this.pr.focus.tilt = .35; this.pr.focus.flying = true;
        this.pr.flyTo(this.pr.focusPose(), false, () => this.pr.lockFocusControls());
      }
    } else if (type === 'route') {
      const r = this.session.state.routes.find(r => r.id === id); if (r) this.focus('city', r.from);
    }
  }
  startBuild(kind, cityId) {
    this.cancelTool(false);
    const city = this.session.state.cities.find(c => c.id === cityId && c.owner === 'player'); if (!city) return;
    if (kind !== 'city' && !FACILITIES[kind]) return;
    this.tool = { type: 'build', kind, cityId };
    this.validTiles = kind === 'city' ? [...nearby(this.session.graph, city.tileId, 35, true).keys()].filter(id =>
      isLand(this.session.graph.tiles[id]) && !this.session.state.cities.some(c => nearby(this.session.graph, c.tileId, 3).has(id)) && !this.session.state.facilities.some(f => f.tileId === id)) :
      buildableTiles(this.session.state, this.session.graph, this.session.base.resourcePlan, cityId, kind);
    this.validTiles = this.validTiles.filter(id => {
      const t = this.pr.hexasphere.tileMap.get(id);
      return this.pr.isDry(t.center, t, .12) && t.corners.every(c => this.pr.isDry(t.center.clone().lerp(c, .4).normalize(), t, .05));
    });
    this.focus('city', cityId);
    if (kind === 'city') this.pr.clearFocus({ animate: false });
    else {
      this.pr.focus.dist = this.pr.tileSpacing * (city.tier + 2) * 3; this.pr.focus.tilt = .3;
      this.pr.flyTo(this.pr.focusPose(), false, () => this.pr.lockFocusControls());
    }
    this.view.highlight(this.validTiles); this.hud.page = 'placement'; this.hud.render(true);
    if (!this.validTiles.length) this.hud.message(t('trade.error.tile'));
  }
  cancelTool(render = true) { this.tool = null; this.validTiles = []; this.view?.clearHighlights(); if (render && this.hud) { this.hud.page = 'inspect'; this.hud.render(true); } }
  perform(action, done) {
    try { this.session.run(action); this.view.refresh(); this.hud.message(''); done?.(); this.hud.render(true); }
    catch (error) { this.hud.message(t(error.message)); }
  }
  key(e) {
    if (e.target.closest?.('input, textarea, select, dialog')) return;
    const key = e.key.toLowerCase();
    if (key === 'escape' && (this.tool || ['catalog', 'configure', 'origin', 'destination'].includes(this.hud.page))) {
      e.preventDefault(); e.stopImmediatePropagation(); this.cancelTool(); return;
    }
    if (key === 'escape') { e.preventDefault(); e.stopImmediatePropagation(); this.ctx.engine.pauseMenu.show(); return; }
    if (['b', 'r', ' ', '1', '2', '4', 'f'].includes(key)) { e.preventDefault(); e.stopImmediatePropagation(); }
    if (key === 'b') this.hud.showCatalog();
    else if (key === 'r') this.hud.startRoute();
    else if (key === ' ') this.session.setPaused(!this.session.state.paused);
    else if (['1', '2', '4'].includes(key)) this.session.setSpeed(Number(key));
    else if (key === 'f') this.focus(this.hud.selection.type, this.hud.selection.id);
  }
  async depart() { this.session.state.ui.camera = { position: this.pr.camera.position.toArray(), target: this.pr.controls.target.toArray(), up: this.pr.camera.up.toArray() }; await this.session.save(); return { cover: 'fade' }; }
  exit() {
    this.unsubscribe(); window.removeEventListener('keydown', this.onKey, { capture: true });
    this.hud.destroy(); this.view.destroy(); this.pr.onTileHover = null; this.pr.suspend(); this.pr.setInset();
    for (const { el, hidden } of this.hiddenRoots) if (el) el.hidden = hidden;
    current = null;
  }
}
