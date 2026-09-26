import * as THREE from 'three';
import { PlanetRenderer } from '../../render/planetRenderer.js';
import { MenuController } from '../../ui/menuController.js';
import { typeOf } from '../../world/planetTypes.js';

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
    this.onOrbit = () => ctx.director.go({ mode: 'space', planet: this.index });
    this.onKey = (e) => {
      if (e.key === 'o' && !e.target.matches?.('input, textarea')) this.onOrbit();
    };
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
    window.addEventListener('keydown', this.onKey);

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
    this.orbitBtn.removeEventListener('click', this.onOrbit);
    window.removeEventListener('keydown', this.onKey);
    this.pr.suspend();
    this.ui.hidden = true;
    document.body.classList.remove('has-card', 'is-pov');
    this.state.mode = null;
  }
}
