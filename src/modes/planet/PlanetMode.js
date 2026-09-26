import * as THREE from 'three';
import { PlanetRenderer } from '../../render/planetRenderer.js';
import { MenuController } from '../../ui/menuController.js';
import { typeOf } from '../../world/planetTypes.js';
import { PlanetRover } from '../../render/planetRover.js';
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
    // Asset packs are shared by all planets: start them early, once
    return getShared(ctx).pr.assetsPromise;
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

  enter() {
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
    if (a?.dir) pr.viewFrom(new THREE.Vector3().fromArray(a.dir));
    else pr.viewFrom(new THREE.Vector3(0, 0.35, 0.93));
    const city = a?.city ?? this.route.city;
    if (city !== null && city !== undefined && this.map.cities?.[city]) pr.focusOn({ type: 'city', index: city }, { animate: !a?.fromTown });
    if (a?.fromTown) this.riseFrom = city;
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
    }
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

  startRover() {
    const pr = this.pr;
    if (pr.pov) pr.exitPov(true, false);
    // Start from the focused city (or the land in the middle of the screen)
    const start = this.roverStart();
    if (!start) return;
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
    this.rover = new PlanetRover(pr, start.dir, start.heading);
    this.roverBtn.textContent = 'Keluar rover';
    document.body.classList.add('is-rover');
  }

  stopRover() {
    const pr = this.pr;
    const dir = this.rover.pos.clone();
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
    this.pr.render();
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
