import * as THREE from 'three';
import { PlanetRenderer } from '../../render/planetRenderer.js';
import { loadAssetPack } from '../../render/assetLibrary.js';
import { MenuController } from '../../ui/menuController.js';
import { typeOf } from '../../world/planetTypes.js';
import { PlanetRover } from '../../render/planetRover.js';
import { Speedo } from '../../ui/gauges.js';

const TOWN_PACK_URL = `${import.meta.env.BASE_URL}models/town.glb`;
import { BIOMES } from '../../map/mapGenerator.js';

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
    // Asset packs are shared by all planets: start them early, once. The rover lives in the space pack.
    const pr = getShared(ctx).pr;
    const rover = loadAssetPack(`${import.meta.env.BASE_URL}models/space.glb`)
      .then((pack) => (pr.roverPack = pack))
      .catch(() => null);
    return Promise.all([pr.assetsPromise, rover]);
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
    this.roverBtn = document.getElementById('roverBtn');
    this.onOrbit = () => ctx.director.go({ mode: 'space', planet: this.index });
    this.onRover = () => (this.rover ? this.stopRover() : this.startRover());
    this.keys = new Set();
    this.onKey = (e) => {
      if (e.target.matches?.('input, textarea')) return;
      const k = e.key.toLowerCase();
      if (this.rover) {
        if (k === 'escape') this.stopRover();
        else this.keys.add(k);
        if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
        return;
      }
      if (k === 'o') this.onOrbit();
    };
    this.onKeyUp = (e) => this.keys.delete(e.key.toLowerCase());
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
    document.getElementById('planetName').textContent = this.planet.name;
    document.getElementById('planetType').textContent = typeOf(this.planet.type).label;
    this.ui.hidden = false;
    document.body.dataset.mode = 'planet';
    this.orbitBtn.addEventListener('click', this.onOrbit);
    this.roverBtn.addEventListener('click', this.onRover);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);

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
    // Driven out of a town along a road: carry on across the planet in the same vehicle
    if (a?.drive) {
      const pack = await loadAssetPack(TOWN_PACK_URL).catch(() => null);
      const start = this.roadStart(a.drive.fromCity, a.drive.toCity);
      if (start) this.startRover({ start, kit: a.drive.kit, pack, trip: { from: a.drive.fromCity, leftHome: false } });
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
    document.getElementById('planetName').textContent = this.planet.name;
    director.replaceRoute({ mode: 'planet', planet: home, city: null });
  }

  update(dt, t, ts) {
    this.pr.update(ts);
    if (this.rover) {
      const k = this.keys;
      const axis = (a, b, c, d) => (k.has(a) || k.has(c) ? 1 : 0) - (k.has(b) || k.has(d) ? 1 : 0);
      this.rover.update(Math.min(dt, 0.05), {
        forward: axis('w', 's', 'arrowup', 'arrowdown'),
        right: axis('d', 'a', 'arrowright', 'arrowleft'),
        handbrake: k.has(' '),
        boost: k.has('shift')
      });
      this.rover.updateCamera(dt, this.pr.camera);
      this.pr.updateNearPlane();
      const car = this.rover.car;
      const top = car.spec.top || 20;
      const fs = car.forwardSpeed;
      this.speedo.set(Math.abs(fs) * 3.6, Math.abs(fs) / (top * 1.25), fs < -0.5 ? 'R' : Math.abs(fs) < 0.3 ? 'N' : 'D');
      this.ctx.audio?.engine('rover', { speed01: Math.min(1, car.speed / top), throttle: car.throttle, rpm: Math.min(1, 0.15 + (car.speed / top) * 0.8 + car.throttle * 0.1), skid: car.skid * Math.min(1, car.speed / 6) });
      // Mission distance, reported in chunks
      this.roverAcc = (this.roverAcc || 0) + Math.abs(car.speed) * Math.min(dt, 0.05);
      if (this.roverAcc > 10) {
        this.ctx.missions?.emit('rover_m', this.roverAcc);
        this.roverAcc = 0;
      }
      // Last: it may hand over to a town (and stop the rover)
      this.checkCityAhead();
    }
  }

  /** Rolled into a city's tiles: drive on into its town (with the same vehicle). */
  checkCityAhead() {
    if (!this.rover || this.arriving || this.ctx.director.busy) return;
    const t = this.rover.tileAt(this.rover.pos);
    const ci = t.cityIndex;
    const trip = this.trip;
    if (ci === null || ci === undefined) {
      trip.leftHome = true;
      return;
    }
    if (ci === trip.from && !trip.leftHome) return;
    if (!this.map.cities[ci]) return;
    this.arriving = { drive: { kit: this.rover.kit, type: this.rover.kit?.type, dir: this.rover.pos.toArray(), fromCity: trip.from } };
    this.ctx.director.go({ mode: 'town', planet: this.index, city: ci });
  }

  /** Where to put the rover: the focused city, else land under the middle of the screen. */
  roverStart() {
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

  startRover({ start = null, kit = null, pack = null, trip = null } = {}) {
    const pr = this.pr;
    if (pr.pov) pr.exitPov(true, false);
    // Start from the focused city (or the land in the middle of the screen)
    start ||= this.roverStart();
    if (!start) return;
    // Driving into a city takes you into its town: not the one you start in, until you have left it
    const startTile = pr.locate(start.dir.clone().normalize(), pr.hexasphere.tiles[0]);
    this.trip = trip || { from: startTile.cityIndex ?? null, leftHome: startTile.cityIndex === null || startTile.cityIndex === undefined };
    this.tripKit = kit;
    if (pr.focus) pr.clearFocus({ animate: false });
    pr.camTween = null;
    pr.autoRotate = false;
    pr.driving = true;
    pr.controls.enabled = false;
    // Surface visuals: sky instead of space, like riding along
    pr.camera.far = 120;
    pr.camera.updateProjectionMatrix();
    pr.scene.background = new THREE.Color(pr.look?.sky ?? 0x9dc0e3);
    pr.atmosphere.visible = false;
    pr.stars.visible = false;
    pr.nebula.visible = false;
    if (pr.onTileHover) pr.onTileHover(null);
    this.rover = new PlanetRover(pr, start.dir, start.heading, { kit, pack });
    this.ctx.audio?.sfx('ignition');
    this.ctx.tips?.show('rover');
    this.speedo ||= new Speedo(this.ui);
    this.speedo.show(true);
    this.roverBtn.textContent = 'Keluar rover';
    document.body.classList.add('is-rover');
  }

  stopRover() {
    const pr = this.pr;
    const dir = this.rover.pos.clone();
    this.speedo?.show(false);
    this.rover.dispose();
    this.rover = null;
    this.keys.clear();
    pr.driving = false;
    pr.camera.far = 400;
    pr.camera.fov = 42;
    pr.camera.updateProjectionMatrix();
    pr.scene.background = null;
    pr.atmosphere.visible = pr.hasAir !== false;
    pr.stars.visible = true;
    pr.nebula.visible = true;
    // Back up to orbit over the spot where we parked
    const { width, height } = this.ctx.engine.size;
    const halfV = THREE.MathUtils.degToRad(pr.camera.fov / 2);
    const halfH = Math.atan(Math.tan(halfV) * (width / height));
    const d = pr.radius / Math.sin(0.91 * Math.min(halfV, halfH));
    const worldDir = dir.applyQuaternion(pr.planetGroup.quaternion);
    pr.flyTo({ pos: worldDir.multiplyScalar(d), target: new THREE.Vector3(), up: UP.clone() }, true, () => pr.releaseFocusControls());
    this.roverBtn.textContent = 'Nyetir rover';
    document.body.classList.remove('is-rover');
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
      if (this.rover) this.stopRover();
      return Promise.resolve({ cover: 'fade' });
    }
    if (this.arriving && route.mode === 'town') {
      // Driving in: no dive through the clouds, just a quick fade on the road
      const arrival = this.arriving;
      this.arriving = null;
      if (this.rover) this.stopRover();
      return Promise.resolve({ cover: 'fade', arrival });
    }
    if (this.rover) this.stopRover();
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

  exit() {
    this.speedo?.dispose();
    this.speedo = null;
    if (this.rover) {
      this.rover.dispose();
      this.rover = null;
      this.pr.driving = false;
      document.body.classList.remove('is-rover');
    }
    this.orbitBtn.removeEventListener('click', this.onOrbit);
    this.roverBtn.removeEventListener('click', this.onRover);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    this.pr.suspend();
    this.ui.hidden = true;
    document.body.classList.remove('has-card', 'is-pov');
    this.state.mode = null;
  }
}
