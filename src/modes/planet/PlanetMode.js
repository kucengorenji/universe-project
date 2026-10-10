import * as THREE from 'three';
import { PlanetRenderer } from '../../render/planetRenderer.js';
import { loadAssetPack } from '../../render/assetLibrary.js';
import { ASSETS } from '../../render/assetManifest.js';
import { MenuController } from '../../ui/menuController.js';
import { typeOf } from '../../world/planetTypes.js';
import { PlanetFlight } from '../../render/planetFlight.js';

import { BIOMES } from '../../map/mapGenerator.js';
import { t } from '../../i18n/index.js';
import { mountTradeEntry } from '../../trade/entry.js';
import { worldImpact } from '../../world/worldImpact.js';
import { journeyTargets, markRows, cityText } from '../../ui/journeyTargets.js';

// The globe view (the original app) as one mode. The renderer and its menu are
// created once and kept: leaving the planet suspends them (every per-planet
// mesh is freed and nothing renders), arriving rebuilds from the map data.
let shared = null;

function getShared(ctx) {
  if (shared) return shared;
  const container = ctx.engine.container;
  const pr = new PlanetRenderer(container, ctx.world.hexasphere, { renderer: ctx.engine.renderer, externalLoop: true });
  pr.suspend();
  const state = { pr, menu: null, mode: null };
  state.menu = new MenuController({
    renderer: pr,
    mapData: ctx.world.homeMap,
    storageOk: () => !ctx.world.mapSaveError,
    regenImpact: () => worldImpact({ world: ctx.world, trade: ctx.trade, missions: ctx.missions }),
    onRegenerate: (seed, options) => state.mode?.regenerate(seed, options),
    onResetCamera: () => pr.resetCamera(),
    onToggleAutoRotate: (active) => (pr.autoRotate = active),
    onLandCity: (index) => state.mode?.landCity(index),
    onFocus: (spec) => state.mode?.focusChanged(spec)
  });
  shared = state;
  return state;
}

const UP = new THREE.Vector3(0, 1, 0);

export default class PlanetMode {
  static prepare(ctx) {
    // Asset packs are shared by all planets: start them early, once. The player's ship lives in the space pack.
    const pr = getShared(ctx).pr;
    const ships = loadAssetPack(ASSETS.spacePack)
      .then((pack) => (pr.shipPack = pack))
      .catch(() => null);
    return Promise.all([pr.assetsPromise, ships]);
  }

  constructor(ctx, route, arrival) {
    this.ctx = ctx;
    this.route = route;
    this.arrival = arrival;
    this.index = route.planet;
    this.planet = ctx.world.planet(this.index);
    this.state = getShared(ctx);
    this.pr = this.state.pr;
    this.ui = document.getElementById('planetUi');
    this.orbitBtn = document.getElementById('orbitBtn');
    this.flyBtn = document.getElementById('flyBtn');
    this.flightHud = document.getElementById('planetFlightHud');
    this.flightSpeed = this.flightHud.querySelector('[data-speed]');
    this.flightState = this.flightHud.querySelector('[data-state]');
    this.flightLand = this.flightHud.querySelector('[data-act="land"]');
    this.onOrbit = () => ctx.director.go({ mode: 'space', planet: this.index });
    this.onFly = () => (this.flight ? this.stopFlight() : this.startFlight());
    this.onHudClick = (e) => {
      if (!this.flight) return;
      const action = e.target.closest('[data-act]')?.dataset.act;
      if (action === 'stop') this.stopFlight();
      if (action === 'land') {
        const city = this.flight.cityBelow();
        if (city !== null) this.landCity(city);
      }
    };
    this.keys = new Set();
    this.onKey = (e) => {
      if (e.target.matches?.('input, textarea')) return;
      const k = e.key.toLowerCase();
      if (this.flight) {
        if (k === 'escape') this.stopFlight();
        else if (k === 'l' && this.flight.cityBelow() !== null) this.landCity(this.flight.cityBelow());
        else this.keys.add(k);
        if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
        return;
      }
      if (k === 'o') this.onOrbit();
    };
    this.onKeyUp = (e) => this.keys.delete(e.key.toLowerCase());
    this.onBlur = () => this.keys.clear();
    // Flying: drag orbits the chase camera, the wheel zooms it
    const canvas = ctx.engine.renderer.domElement;
    this.onPointerDown = (e) => {
      if (!this.flight) return;
      this.drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      canvas.setPointerCapture?.(e.pointerId);
    };
    this.onPointerMove = (e) => {
      if (!this.flight || !this.drag || e.pointerId !== this.drag.id) return;
      this.flight.look(e.clientX - this.drag.x, e.clientY - this.drag.y, this.ctx.engine.time);
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
    };
    this.onPointerUp = () => (this.drag = null);
    this.onWheel = (e) => {
      if (!this.flight) return;
      e.preventDefault();
      this.flight.zoom(e.deltaY);
    };
  }

  async enter() {
    const { world } = this.ctx;
    this.state.mode = this;
    this.map = world.mapFor(this.index);
    const hexasphere = world.activate(this.map);
    const pr = this.pr;
    pr.hexasphere = hexasphere;
    pr.resume();
    pr.buildPlanet(this.map);
    this.state.menu.updateUI(this.map);
    this.stopJourney = this.ctx.journey?.subscribe(() => this.markJourney());
    this.markJourney();
    document.getElementById('planetName').textContent = this.planet.name;
    document.getElementById('planetType').textContent = typeOf(this.planet.type).label;
    this.ui.hidden = false;
    document.body.dataset.mode = 'planet';
    this.unmountTradeEntry = mountTradeEntry(this);
    this.orbitBtn.addEventListener('click', this.onOrbit);
    this.flyBtn.addEventListener('click', this.onFly);
    this.flightHud.addEventListener('click', this.onHudClick);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    const canvas = this.ctx.engine.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });

    // Arrival: from orbit the globe is framed from the side we flew in on;
    // from a town the camera starts over that city.
    const a = this.arrival;
    if (a?.dir) {
      pr.viewFrom(new THREE.Vector3().fromArray(a.dir));
      this.ctx.missions?.emit('land', this.index);
    } else pr.viewFrom(new THREE.Vector3(0, 0.35, 0.93));
    const city = a?.city ?? this.route.city;
    if (city !== null && city !== undefined && this.map.cities?.[city]) pr.focusOn({ type: 'city', index: city }, { animate: !a?.fromTown });
    if (a?.fromTown) this.riseFrom = city;
    // Driven out of a town along a road: take off low over that road and fly on
    if (a?.drive) {
      const start = this.roadStart(a.drive.fromCity, a.drive.toCity);
      if (start) this.startFlight({ start, altitude: 0.18, speed: 14 });
    }
  }

  /**
   * Where a car leaving city `from` toward `to` comes out on the globe: the
   * first tile past the city along their road, heading down it.
   */
  roadStart(from, to) {
    const tm = this.pr.hexasphere.tileMap;
    const route = (this.map.landRoutes || []).find((r) => (r.from === from && r.to === to) || (r.from === to && r.to === from));
    let path = route ? (route.from === from ? route.path : [...route.path].reverse()) : null;
    if (!path) {
      // No road: straight out of the city on any dry side
      const city = this.map.cities[from];
      const ids = city?.tiles || [city?.tileId];
      for (const id of ids) {
        const t = tm.get(id);
        const out = t?.neighbors.map((n) => tm.get(n)).find((n) => n.cityIndex !== from && n.biome !== BIOMES.MOUNTAIN && this.pr.isDry(n.center, n, 0.1));
        if (out) return { dir: out.center.clone(), heading: out.center.clone().sub(t.center) };
      }
      return null;
    }
    const k = path.findIndex((id) => tm.get(id)?.cityIndex !== from);
    if (k < 0) return null;
    const t = tm.get(path[k]);
    const next = tm.get(path[Math.min(path.length - 1, k + 1)]);
    const prev = tm.get(path[Math.max(0, k - 1)]);
    const heading = next && next !== t ? next.center.clone().sub(t.center) : t.center.clone().sub(prev.center);
    return { dir: t.center.clone(), heading };
  }

  arrived() {
    if (this.riseFrom !== undefined) {
      // Coming up out of the town: start low over it, settle into the city close-up
      this.riseFrom = undefined;
    }
  }

  navigate(route) {
    if (route.planet !== this.index) return false;
    if (route.city !== null && route.city !== undefined) this.pr.focusOn({ type: 'city', index: route.city });
    else if (this.pr.focus) this.pr.clearFocus();
    return true;
  }

  focusChanged(spec) {
    if (this.ctx.director.busy) return;
    const city = spec?.type === 'city' ? spec.index : null;
    this.ctx.director.replaceRoute({ mode: 'planet', planet: this.index, city });
  }

  landCity(index) {
    this.ctx.director.go({ mode: 'town', planet: this.index, city: index });
  }

  regenerate(seed, options) {
    const { world, director } = this.ctx;
    world.regenerateHome(seed, options);
    const home = world.homeIndex;
    if (this.index !== home || world.hexasphere !== this.pr.hexasphere) {
      // A new home world is a new system: re-enter through the router
      this.index = home;
    }
    this.planet = world.planet(home);
    this.map = world.homeMap;
    this.pr.hexasphere = world.activate(this.map);
    this.pr.buildPlanet(this.map);
    this.state.menu.updateUI(this.map);
    this.markJourney();
    document.getElementById('planetName').textContent = this.planet.name;
    director.replaceRoute({ mode: 'planet', planet: home, city: null });
    this.unmountTradeEntry?.();
    this.unmountTradeEntry = mountTradeEntry(this);
  }

  update(dt, t, ts) {
    this.pr.update(ts);
    if (this.flight) {
      const k = this.keys;
      const axis = (a, b, c, d) => (k.has(a) || k.has(c) ? 1 : 0) - (k.has(b) || k.has(d) ? 1 : 0);
      const step = THREE.MathUtils.clamp(dt, 0, 0.05);
      this.flight.update(step, {
        forward: axis('w', 's', 'arrowup', 'arrowdown'),
        turn: axis('d', 'a', 'arrowright', 'arrowleft'),
        strafe: axis('e', 'q'),
        lift: axis('r', 'f', ' ', 'c'),
        boost: k.has('shift')
      });
      this.flight.updateCamera(step, t, this.pr.camera);
      this.pr.updateNearPlane();
      this.updateFlightHud(t);
      const sh = this.flight.ship;
      const boost = sh.boostFx || 0;
      this.ctx.audio?.engine('ship', { speed01: Math.min(1, sh.speed / sh.boostSpeed), throttle: sh.thrust, boost });
      // Kick of air as the boost lights
      if (boost > 0.3 && !this.boostKick) this.ctx.audio?.sfx('whoosh', { dur: 1.1, peak: 0.3 });
      this.boostKick = boost > 0.3;
      // Mission distance, reported in chunks
      this.flownAcc = (this.flownAcc || 0) + this.flight.metresPerSecond * step;
      if (this.flownAcc > 10) {
        this.ctx.missions?.emit('rover_m', this.flownAcc);
        this.flownAcc = 0;
      }
    }
  }

  updateFlightHud() {
    const f = this.flight;
    const kmh = Math.round(f.metresPerSecond * 3.6);
    if (kmh !== this.hudSpeed) this.flightSpeed.textContent = this.hudSpeed = kmh;
    const ci = f.cityBelow();
    const city = ci === null ? null : this.map.cities[ci];
    this.flightLand.hidden = !city;
    if (city) this.flightLand.title = `${t('planet.card.land')} · ${city.name}`;
    let state = t('planet.flight.hover');
    if (city) state = t('planet.flight.over', { city: city.name });
    else if (f.alt > f.ceiling * 0.9) state = t('planet.flight.ceiling');
    else if (f.speed > 0.5) state = t(f.clearance < 0.3 ? 'planet.flight.low' : 'planet.flight.free');
    if (state !== this.hudState) this.flightState.textContent = this.hudState = state;
  }

  /** Where to take off: the focused city, else land under the middle of the screen. */
  takeoffStart() {
    const pr = this.pr;
    const tiles = pr.hexasphere.tiles;
    const q = pr.planetGroup.quaternion.clone().invert();
    let dir = pr.focus ? pr.focus.dir.clone() : pr.camera.position.clone().applyQuaternion(q).normalize();
    // Walk outward to the nearest dry, non-mountain tile
    let tile = pr.locate(dir, tiles[0]);
    const ok = (t) => t.biome !== BIOMES.MOUNTAIN && pr.isDry(t.center, t, 0.1);
    if (!ok(tile)) {
      const seen = new Set([tile.id]);
      let frontier = [tile];
      let found = null;
      while (frontier.length && !found) {
        const next = [];
        for (const t of frontier) {
          for (const id of t.neighbors) {
            if (seen.has(id)) continue;
            seen.add(id);
            const nb = pr.hexasphere.tileMap.get(id);
            if (ok(nb)) {
              found = nb;
              break;
            }
            next.push(nb);
          }
          if (found) break;
        }
        frontier = next;
      }
      if (!found) return null;
      tile = found;
    }
    dir = tile.center.clone();
    const road = tile.neighbors.map((id) => pr.hexasphere.tileMap.get(id)).find(ok);
    const heading = road ? road.center.clone().sub(dir) : new THREE.Vector3(0, 1, 0);
    return { dir, heading };
  }

  startFlight({ start = null, altitude = 0.45, speed = 0 } = {}) {
    const pr = this.pr;
    if (pr.pov) pr.exitPov(true, false);
    // Take off over the focused city (or the land in the middle of the screen)
    start ||= this.takeoffStart();
    if (!start) return;
    if (pr.focus) pr.clearFocus({ animate: false });
    pr.camTween = null;
    pr.autoRotate = false;
    pr.driving = true;
    pr.controls.enabled = false;
    // Inside the sky: a sky dome instead of space, clouds you can fly past
    pr.camera.far = pr.radius * 12;
    pr.camera.updateProjectionMatrix();
    pr.scene.background = new THREE.Color(pr.look?.sky ?? 0x9dc0e3);
    pr.atmosphere.visible = false;
    pr.stars.visible = false;
    pr.nebula.visible = false;
    const clouds = pr.cloudsMesh.material.uniforms;
    clouds.uNear.value = pr.radius * 0.012;
    clouds.uFar.value = pr.radius * 0.05;
    if (pr.hoverIndicatorMesh) pr.hoverIndicatorMesh.visible = false;
    if (pr.onTileHover) pr.onTileHover(null);
    this.flight = new PlanetFlight(pr, start.dir, start.heading, { pack: pr.shipPack, altitude, speed });
    this.ctx.audio?.sfx('whoosh', { dur: 1.6, peak: 0.35 });
    this.ctx.tips?.show('rover');
    this.hudSpeed = this.hudState = null;
    this.flightHud.hidden = false;
    this.flyBtn.textContent = t('planet.flight.finish');
    document.body.classList.add('is-flying');
  }

  stopFlight() {
    const pr = this.pr;
    const dir = this.flight.pos.clone();
    this.endFlight();
    pr.camera.far = 400;
    pr.camera.fov = 42;
    pr.camera.updateProjectionMatrix();
    // Back up to orbit over the spot where we were flying
    const { width, height } = this.ctx.engine.size;
    const halfV = THREE.MathUtils.degToRad(pr.camera.fov / 2);
    const halfH = Math.atan(Math.tan(halfV) * (width / height));
    const d = pr.radius / Math.sin(0.91 * Math.min(halfV, halfH));
    const worldDir = dir.applyQuaternion(pr.planetGroup.quaternion);
    pr.flyTo({ pos: worldDir.multiplyScalar(d), target: new THREE.Vector3(), up: UP.clone() }, true, () => pr.releaseFocusControls());
  }

  /** Put the ship away and restore the globe visuals (no camera move). */
  endFlight() {
    const pr = this.pr;
    this.flight.dispose();
    this.flight = null;
    this.keys.clear();
    this.drag = null;
    pr.driving = false;
    pr.scene.background = null;
    pr.atmosphere.visible = pr.hasAir !== false;
    pr.stars.visible = true;
    pr.nebula.visible = true;
    const clouds = pr.cloudsMesh.material.uniforms;
    clouds.uNear.value = pr.radius * 0.1;
    clouds.uFar.value = pr.radius * 0.26;
    this.flightHud.hidden = true;
    this.flyBtn.textContent = t('planet.flight.start');
    document.body.classList.remove('is-flying');
  }

  render() {
    this.ctx.engine.draw(this.pr.scene, this.pr.camera);
  }

  resize() {
    this.pr.onWindowResize();
  }

  /** Planet-space direction of the camera (the planet itself may have auto-rotated). */
  cameraDir() {
    const q = this.pr.planetGroup.quaternion.clone().invert();
    return this.pr.camera.position.clone().applyQuaternion(q).normalize();
  }

  depart(route) {
    const pr = this.pr;
    // A saved route or direct navigation can target a different planet. Its
    // city index cannot be used to animate over this planet's map.
    if (route.mode === 'town' && route.planet !== this.index) {
      if (this.flight) this.stopFlight();
      return Promise.resolve({ cover: 'fade' });
    }
    if (this.flight) this.stopFlight();
    pr.camTween = null;
    if (pr.pov) pr.exitPov(true, false);
    if (route.mode === 'town') {
      // Dive toward the city until the clouds close in
      const city = this.map.cities[route.city];
      const tiles = city.tiles || [city.tileId];
      const dir = new THREE.Vector3();
      tiles.forEach((id) => dir.add(pr.hexasphere.tileMap.get(id).center));
      dir.normalize().applyQuaternion(pr.planetGroup.quaternion);
      const T = dir.clone().multiplyScalar(pr.landR);
      const side = pr.camera.position.clone().sub(T);
      side.addScaledVector(dir, -side.dot(dir));
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0).addScaledVector(dir, -dir.x);
      side.normalize();
      const pos = T.clone().addScaledVector(dir, pr.tileSpacing * 1.3).addScaledVector(side, pr.tileSpacing * 0.9);
      return new Promise((resolve) =>
        pr.flyTo({ pos, target: T, up: dir.clone() }, true, () => resolve({ cover: 'clouds', arrival: { fromPlanet: true, yaw: 0 } }))
      );
    }
    if (route.mode === 'space') {
      // Rise to the whole-globe view, then hand the exact view over to orbit
      if (pr.focus) pr.clearFocus({ animate: false, notify: true });
      const { width, height } = this.ctx.engine.size;
      const halfV = THREE.MathUtils.degToRad(pr.camera.fov / 2);
      const halfH = Math.atan(Math.tan(halfV) * (width / height));
      const d = pr.radius / Math.sin(0.91 * Math.min(halfV, halfH));
      const dirWorld = pr.camera.position.clone().normalize();
      dirWorld.y = THREE.MathUtils.clamp(dirWorld.y, -0.5, 0.5);
      dirWorld.normalize();
      return new Promise((resolve) =>
        pr.flyTo({ pos: dirWorld.multiplyScalar(d), target: new THREE.Vector3(), up: UP.clone() }, true, () =>
          resolve({ cover: 'snapshot', arrival: { planet: this.index, dir: this.cameraDir().toArray(), fov: pr.camera.fov } })
        )
      );
    }
    return Promise.resolve({ cover: 'fade' });
  }

  /** On the home planet the hometown's list row and banner carry the First Journey's house badge while it is the target. */
  markJourney() {
    const journey = this.ctx.journey;
    if (!journey) return;
    const onHome = this.index === journey.homePlanet;
    const city = onHome ? journeyTargets(journey).city : null;
    markRows(document.querySelectorAll('#cityList .city-row'), (el) => Number(el.dataset.focusCity), city, cityText(journey));
    this.pr.setJourneyCity(city);
  }

  exit() {
    this.stopJourney?.();
    this.pr.setJourneyCity(null);
    this.unmountTradeEntry?.();
    if (this.flight) this.endFlight();
    this.orbitBtn.removeEventListener('click', this.onOrbit);
    this.flyBtn.removeEventListener('click', this.onFly);
    this.flightHud.removeEventListener('click', this.onHudClick);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    const canvas = this.ctx.engine.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('wheel', this.onWheel);
    this.pr.suspend();
    this.ui.hidden = true;
    document.body.classList.remove('has-card', 'is-pov');
    this.state.mode = null;
  }
}
