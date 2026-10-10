import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mulberry32 } from '../../math/random.js';
import { PLANET_TYPES } from '../../world/planetTypes.js';
import { generateTownLayout, townBaseSeed } from './layout/townLayout.js';
import { TownBuilder, packFootprints } from './render/townBuilder.js';
import { WATER_Y } from './scale.js';
import { Crowd, Pedestrians } from './people/crowd.js';
import { createWalkNetwork, townWalkable } from './navigation/walkNetwork.js';
import { StreetLighting } from './render/streetLighting.js';
import { townGenerationVersion, townPlanChoice } from '../../world/townGeneration.js';
import { Colliders } from './navigation/colliders.js';
import { TownHud } from './ui/hud.js';
import { TownSky } from './render/sky.js';
import { ChaseCamera } from './vehicles/vehicle.js';
import { SkirmishPeople, disposeTownPerson } from './people/skirmishPeople.js';
import { buildingId } from '../../world/identity.js';
import { TransitionGuard } from './interior/interiorSession.js';
import { TownJourney } from './journeyTown.js';
import { TownLife } from './townLife.js';
import { loadTownPacks, createFurniturePack, usesLowAtlases } from './townPacks.js';
import { isOn } from '../../core/experiments.js';
import { disposeHomeGroup, loadHomePack } from '../home/homeBuilder.js';
import { TownDetailBudget } from './render/detailBudget.js';
import { Minimap, Speedo } from '../../ui/gauges.js';
import { readTownStyle, PIXEL_YAW } from './render/pixelConfig.js';
import { STREET_FOV, UP, ease } from './controllers/shared.js';
import { mixin } from './controllers/mixin.js';
import { StyleMethods } from './controllers/townStyle.js';
import { HomeMethods } from './controllers/townHomes.js';
import { ViewMethods } from './controllers/townViews.js';
import { PlannerMethods } from './controllers/townPlanner.js';
import { InteriorMethods } from './controllers/townInterior.js';
import { VehicleMethods } from './controllers/townVehicles.js';
import { InputMethods } from './controllers/townInput.js';
import { EnvironmentMethods } from './controllers/townEnvironment.js';

// Inside a city: the diorama is the main view; from there you can walk the streets (third person) or drive.
// Everything is built from the planet's map data, so the town you land in is the one you clicked on the globe.
// TownMode is the orchestrator: it builds the scene (enter), runs a frame (update), and tears everything down (exit).
// The work is grouped by responsibility in controllers/ and mixed in below.

export default class TownMode {
  static prepare(ctx) {
    return loadTownPacks({ low: usesLowAtlases(ctx.engine.quality), deferFemale: isOn('lazyBodies') });
  }

  constructor(ctx, route, arrival) {
    this.ctx = ctx;
    this.route = route;
    this.arrival = arrival;
    this.view = 'diorama';
    this.keys = new Set();
    this.tween = null;
    this.detailBudget = new TownDetailBudget();
    this.transitions = new TransitionGuard();
    this.townStyle = readTownStyle();
  }

  async enter() {
    const { engine, world } = this.ctx;
    const planet = world.planet(this.route.planet);
    const map = world.mapFor(this.route.planet);
    const hexasphere = world.activate(map);
    const city = map.cities[this.route.city];
    this.planet = planet;
    this.city = city;
    const { base, lod0, townPack, townPeople, sceneryPack, surfaceAtlas, environmentPack, paintedSurfaces } = await loadTownPacks({ low: usesLowAtlases(engine.quality), deferFemale: isOn('lazyBodies') });
    this.character = townPeople; // the people's bodies: { m, f (loads after arrival), loadFemale() }
    this.furniturePack = createFurniturePack(); // the furniture loads when a door is near or the player goes in
    if (!isOn('lazyInterior')) await this.furniturePack.start('boot');
    const planetPack = {};
    for (const [name, lods] of Object.entries(base || {})) planetPack[name] = { ...lods };
    for (const [name, lods] of Object.entries(lod0 || {})) planetPack[name] = { ...(planetPack[name] || {}), ...lods };

    const quality = engine.quality;
    this.footprints = packFootprints(townPack);
    await world.ready;
    const townSeed=townBaseSeed(map,this.route.city);
    const layoutVersion=townGenerationVersion(world.state,this.route.planet,townSeed);
    // The plan the player approved in the 2D planner (variant 0 = the original town)
    const plan=townPlanChoice(world.state,this.route.planet,townSeed);
    this.townSeed=townSeed;
    this.plan=plan;
    // Everything the 2D planner needs to regenerate this town with another variant or density
    this.genArgs={ map, hexasphere, cityIndex: this.route.city, planetType: planet.type, detail: quality.settings.detail, footprints: this.footprints };
    this.layout = generateTownLayout({ ...this.genArgs, layoutVersion, variant: plan.variant, options: { density: plan.density } });
    this.prepareAuthoredHomes();
    if (this.layout.buildings.some(b => b.homeRecord)) this.homePack = await loadHomePack().catch(() => null);
    this.doors = this.findDoors();
    this.ctx.missions?.emit('visit_town');
    this.ctx.audio?.setScene('town', { modern: this.layout.modern });
    const renderLayout = { ...this.layout, buildings: this.layout.buildings.filter(b => !b.homeRecord) };
    this.builder = new TownBuilder(renderLayout, { planetPack, townPack, sceneryPack, environmentPack, surfaceAtlas, paintedSurfaces, quality, planetType: planet.type });
    this.colliders = new Colliders(this.layout.colliders);
    this.cameraBlockers = this.buildCameraBlockers();
    this.vehicleColliders = this.buildVehicleColliders();

    const { width, height } = engine.size;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, width / height, 0.3, 6000);
    this.scene.add(this.camera);
    // Sky and time of day follow the city's place on the planet and the planet's place in the system
    const look = PLANET_TYPES[planet.type].look || {};
    this.sky = new TownSky(planet.type, world.system.star.light, {
      seed: this.layout.seed,
      clouds: look.clouds !== null,
      darkClouds: planet.type === 'lava'
    });
    this.scene.add(this.sky.group);
    this.scene.fog = new THREE.Fog(0xcfe4f4, 900, 2600);
    this.scene.add(this.builder.group);
    this.addAuthoredHomes(quality);
    this.streetLighting=new StreetLighting(this.layout,(x,z)=>this.builder.surfaceAt(x,z));
    this.scene.add(this.streetLighting.group);

    // Light: sky fill + a sun (or the moon) whose shadow box follows what you are looking at
    this.hemi = new THREE.HemisphereLight(0xcfe4f4, 0x6b5a45, 1.0);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.22);
    this.scene.add(this.hemi, this.ambient);
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.3);
    this.sunDir = new THREE.Vector3(-0.55, 0.75, 0.35).normalize();
    this.sunVec = new THREE.Vector3();
    this.fogBlend = 0; // 0 = diorama haze, 1 = street-level horizon
    const shadows = quality.settings.shadows;
    engine.renderer.shadowMap.enabled = shadows;
    engine.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    {
      const high = quality.tier === 'high';
      sun.castShadow = shadows;
      // 2048 is enough: from the table a texel is under a screen pixel, in the street a few cm.
      // A 4096 map cost the high tier about 12 ms a frame on an M1 Pro for no visible gain.
      const size = high ? 2048 : 1024;
      this.shadowBaseSize = size;
      sun.shadow.mapSize.set(size, size);
      // The whole table from above; a tight box round the player in the street, so shadow
      // edges stay crisp (a few cm per shadow texel instead of 15)
      this.shadowExtents = { diorama: high ? 150 : 110, street: high ? 45 : 38 };
      const ext = this.shadowExtents.diorama;
      this.shadowExt = ext;
      Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 10, far: 900 });
      sun.shadow.bias = -0.0006;
      sun.shadow.normalBias = ((ext * 2) / size) * 4;
      // Redrawn on demand (updateEnvironment): from the table only the people and cars move
      sun.shadow.autoUpdate = false;
      this.shadowTick = 0;
    }
    this.sun = sun;
    this.scene.add(sun, sun.target);

    // People: #0 is the player, the rest walk the streets
    const count = { high: 13, medium: 9, low: 5 }[quality.tier];
    this.crowd = new Crowd(count, { modern: this.layout.modern, seed: this.layout.seed, shadows });
    this.crowd.dress(0, { shirt: city.owner === 'system' ? 0xfa4d43 : 0x027b49, pants: 0x2f2f33 });
    // Crowd provides movement data only; every visible person uses the complete v5 body.
    this.crowd.group.visible = false;
    const rng = mulberry32(this.layout.seed + 5);
    const navField = {};
    this.walkNetwork = createWalkNetwork(this.layout.walkGraph, {
      // The analytical surface is quality independent. Leave a bank margin for
      // the coarser terrain triangles used by lower render tiers.
      walkable: townWalkable(this.layout, { margin: .3, minHeight: WATER_Y + .8,
        groundHeight: (x, z) => this.builder.sampleGround(x, z, navField) }),
      portals: this.doors.filter(d => d.b.blueprint).map(d => ({
        id: d.b.blueprint.portalId, buildingId: d.b.id, x: d.x, z: d.z,
        facing: { x: Math.sin(d.outYaw), z: Math.cos(d.outYaw) }
      }))
    });
    this.walkers = new Pedestrians(this.crowd, 1, this.walkNetwork, rng, (x, z) => this.builder.surfaceAt(x, z));
    this.player = this.crowd.people[0];
    const sp = this.layout.spawn;
    Object.assign(this.player, { x: sp.x, z: sp.z, y: this.builder.groundAt(sp.x, sp.z), yaw: sp.yaw, vy: 0, visible: false });
    const rigCount = count - 1;
    this.setupAvatar(city.owner === 'system' ? 'explorer_red' : 'explorer', shadows);
    // A small, consistent cast of townsfolk uses the actual skirmish humanoids.
    this.rigged = new SkirmishPeople(townPeople, this.scene, { count: rigCount, shadows, seed: this.layout.seed });
    this.buildFleet(rng, shadows);
    // Lamp posts light the street at night only: compile that variant of every material now, the
    // hidden townsfolk pool and LOD levels included, so dusk does not stall on shader compiles
    // (by day the lights are out of the shaders entirely)
    const hidden = [];
    this.scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    this.streetLighting.setActive(true);
    engine.post.compileAsync(this.scene, this.camera).catch(() => {});
    this.streetLighting.setActive(false);
    hidden.forEach((o) => (o.visible = false));
    this.chase = new ChaseCamera(this.camera);
    this.chase.baseFov = STREET_FOV;

    // Controls
    this.orbit = new OrbitControls(this.camera, engine.renderer.domElement);
    Object.assign(this.orbit, { enableDamping: true, dampingFactor: 0.08, screenSpacePanning: false, maxPolarAngle: 1.36, minDistance: 18, maxDistance: Math.max(Math.min(900,this.layout.cityR*2.3+110),this.layout.dioramaR*1.3), zoomSpeed: 1.1 });
    this.orbit.enabled = false;
    this.follow = { yaw: sp.yaw + Math.PI, pitch: 0.32, dist: 6.5 };
    this.bindInput();

    this.ui = document.getElementById('townUi');
    this.hud = new TownHud(this.ui, {
      city,
      cities: map.cities,
      planet,
      layout: this.layout,
      quality,
      on: {
        liftoff: () => this.ctx.director.go({ mode: 'planet', planet: this.route.planet, city: this.route.city }),
        city: city => this.ctx.director.go({ mode: 'town', planet: this.route.planet, city }),
        view: (v) => this.setView(v),
        style: (style) => this.setTownStyle(style),
        zoom: (level) => this.setPixelZoom(level),
        plan: () => this.openPlanner(),
        interact: () => this.interact()
      }
    });
    this.setupHomeEntry();
    this.minimap = new Minimap(this.ui, { layout: this.layout, groundAt: (x, z) => this.builder.groundAt(x, z), waterY: WATER_Y, doors: this.doors });
    this.speedo = new Speedo(this.ui);
    this.journeyTown = this.ctx.journey && new TownJourney({ journey: this.ctx.journey, planet: this.route.planet, city: this.route.city, scene: this.scene, ui: this.ui, layout: this.layout, doors: this.doors, walkNetwork: this.walkNetwork, groundAt: (x, z) => this.builder.groundAt(x, z), minimap: this.minimap, reducedMotion: quality.tier === 'low' || !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches });
    this.life = new TownLife({ builder: this.builder, quality, walkers: this.walkers, rigged: this.rigged, crowd: this.crowd, walkNetwork: this.walkNetwork, layout: this.layout, planet: this.route.planet, city: this.route.city, ui: this.ui, door: this.journeyTown?.door, prefetch: { pack: this.furniturePack, doors: this.doors } });
    this.ui.hidden = false;
    document.body.dataset.mode = 'town';

    // Arrival: high above the town (under the cloud cover), then swoop in
    this.camera.position.set(0.1, 950, 60);
    this.camera.lookAt(0, 0, 0);
    this.orbit.target.set(0, 0, 0);
    this.setTownStyle(this.townStyle, { persist: false });
    // ...or, driven in from the planet, already on the road into town
    if (this.roadVehicle) this.startRoadArrival();
  }

  arrived() {
    this.character.loadFemale?.().catch((error) => console.warn("The women's body could not be loaded:", error)); // the town is on screen: now the rest of the people
    if (this.arrivedByRoad) return;
    if (this.pixelActive) {
      this.tween = null;
      this.orbit.target.set(this.layout.plaza?.x ?? 0, 0, this.layout.plaza?.z ?? 0);
      this.setView('diorama');
      this.pixel.update(0, true);
      return;
    }
    const to = this.dioramaPose({});
    this.flyCamera(to, 2.8, () => this.setView('diorama'));
  }

  // ------------------------------------------------------------------ views

  update(dt, t) {
    const cpuStart = performance.now();
    if (this.interior) {
      // Inside: only the room runs and renders; the town waits outside
      this.life.update(dt, { walker: null });
      this.updateInterior(dt, t);
      this.updateAvatar(dt);
      this.footsteps('wood');
      return;
    }
    if (this.pixelActive && this.view === 'walk') this.follow.yaw = PIXEL_YAW;
    if (this.tween) {
      const tw = this.tween;
      const raw = Math.min(1, (t - tw.t0) / tw.dur);
      const e = ease(raw);
      this.camera.position.lerpVectors(tw.from.pos, tw.to.pos, e);
      // Arc: rise in the middle of the flight
      this.camera.position.y += Math.sin(Math.PI * e) * tw.from.pos.distanceTo(tw.to.pos) * 0.08;
      this.orbit.target.lerpVectors(tw.from.target, tw.to.target, e);
      this.camera.up.copy(UP);
      this.camera.lookAt(this.orbit.target);
      if (raw >= 1) {
        this.tween = null;
        tw.done?.();
      }
    } else if (this.view === 'diorama') {
      if (this.pixelActive) {
        const i = this.intent(), speed = this.pixel.rig.span * (i.run ? 1.2 : .5);
        this.panPixelDiorama(i.right * speed * dt, i.forward * speed * dt);
      } else { this.panDiorama(dt); this.orbit.update(); }
      // Keep the table in reach
      const tg = this.orbit.target;
      const r = Math.hypot(tg.x, tg.z);
      if (r > this.layout.dioramaR * 0.85) tg.multiplyScalar((this.layout.dioramaR * 0.85) / r);
      tg.y = Math.max(0, this.builder.groundAt(tg.x, tg.z));
    } else if (this.view === 'walk') {
      if (this.transfer) this.updateTransfer(t);
      else this.updateWalk(dt);
      this.updateFollowCamera(dt, this.player, 1.6);
      this.updatePrompt();
    } else if (this.view === 'drive') {
      if (this.transfer) this.updateTransfer(t);
      this.updateDrive(dt);
      if (this.drive && !this.pixelActive) this.chase.update(dt, t, this.drive.car, (x, z) => this.builder.groundAt(x, z), { dist: 5 + this.drive.v.spec.length * 0.55, height: 1.4 + this.drive.v.spec.length * 0.12 });
      this.updatePrompt();
    }
    if (this.view === 'walk') this.footsteps(this.layout.modern ? 'road' : 'grass');
    this.life.update(dt, { walker: this.view === 'walk' && !this.transfer ? this.player : null, camera: this.renderCamera });
    this.journeyTown?.update(t, { pos: this.view === 'diorama' ? null : this.view === 'drive' && this.drive ? this.drive.car : this.player, view: this.view, camera: this.renderCamera, night: this.night });
    this.updateGauges();
    const obstacles = []; // Traffic only brakes for other vehicles.
    if (this.drive) obstacles.push(this.drive.car);
    this.fleet.update(dt, obstacles, { deferFlush: true });
    if (this.pixelActive) {
      this.pixel.update(dt);
      this.camera.position.copy(this.pixel.rig.camera.position);
    }
    const detail = this.ctx.engine.quality.preset === 'auto' ? this.detailBudget.current : { lod: 1, shadow: 1, vegetation: 1 };
    this.fleet.updateLod(this.renderCamera, this.view === 'diorama' ? this.orbit.target : null, detail.lod, detail.shadow);
    const cam = this.camera.position;
    const near = (x, z) => Math.hypot(x - cam.x, z - cam.z) < 260 + cam.y;
    // Vehicles never startle or displace townsfolk.
    this.walkers.update(dt, near);
    this.rigged?.update(dt, this.walkers.walkers, this.crowd.people, this.camera.position);
    if (this.avatar) this.player.visible = false;
    this.crowd.pose();
    this.updateAvatar(dt);
    this.updateDepthRange();
    this.builder.update(this.renderCamera, this.view === 'diorama' ? this.orbit.target : null, detail);
    if (this.pixelActive) this.pixel.update(0);
    this.updateEnvironment(dt, t);
    this.hud.update(this);
    this.cpuUpdateMs = (this.cpuUpdateMs ?? 0) * 0.9 + (performance.now() - cpuStart) * 0.1;
  }

  render() {
    if (this.planner) return; // the planner covers the view; keep the last frame
    const cpuStart = performance.now();
    if (this.pixelActive) this.pixel.render();
    else this.ctx.engine.draw(this.interior ? this.interior.scene : this.scene, this.camera);
    this.cpuRenderMs = (this.cpuRenderMs ?? 0) * 0.9 + (performance.now() - cpuStart) * 0.1;
  }

  resize(w, h) {
    if (!this.camera) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.pixel?.resize(w, h);
  }

  depart(route) {
    if (route.mode === 'home') return Promise.resolve({ cover: 'fade', arrival: { fromTownWalk: this.view === 'walk' } });
    if(route.mode === 'town')return Promise.resolve({cover:'fade'});
    if (this.interior) {
      // Interior updates deliberately suspend the town camera tween.
      // The director covers this room, then exit() saves and disposes it.
      return Promise.resolve({ cover: 'fade', arrival: route.mode === 'planet' ? { city: this.route.city, fromTown: true } : null });
    }
    if (this.leaving && route.mode === 'planet') {
      // Off down the road: a quick fade, the car carries on on the globe
      return Promise.resolve({ cover: 'fade', arrival: { drive: this.leaving } });
    }
    if (this.pixelActive) return Promise.resolve({ cover: 'fade', arrival: route.mode === 'planet' ? { city: this.route.city, fromTown: true } : null });
    // Climb straight up into the clouds
    const cam = this.camera.position.clone();
    const to = { pos: new THREE.Vector3(cam.x * 0.3, 1100, cam.z * 0.3 + 40), target: new THREE.Vector3(0, 0, 0) };
    this.setViewSilently('diorama');
    return new Promise((resolve) =>
      this.flyCamera(to, 1.7, () => resolve({ cover: 'clouds', arrival: route.mode === 'planet' ? { city: this.route.city, fromTown: true } : null }))
    );
  }

  exit() {
    this.transitions.cancel(); // a fade still running must not touch what is disposed below
    this.journeyTown?.dispose();
    this.life?.dispose();
    this.closePlanner();
    this.saveInterior();
    this.ctx.world.state.set('playerLocation', null);
    this.ctx.audio?.stopRoom();
    this.unbindInput();
    clearTimeout(this.homeMessageTimer);
    this.homeButton?.removeEventListener('click', this.onHomeEntry);
    this.ctx.engine.renderer.domElement.style.cursor = '';
    this.orbit.dispose();
    this.pixel?.dispose();
    this.hud.dispose();
    this.ui.hidden = true;
    this.builder.dispose();
    this.homeGroups?.forEach(disposeHomeGroup);
    this.streetLighting.dispose();
    this.crowd.dispose();
    if (this.avatar) disposeTownPerson(this.avatar);
    this.rigged?.dispose();
    this.fleet.dispose();
    if (this.drive) this.scene.remove(this.drive.obj);
    this.interior?.dispose();
    this.ui.classList.remove('is-inside');
    this.sky.dispose();
    this.ctx.engine.renderer.shadowMap.enabled = false;
    this.sun.shadow.map?.dispose();
    this.scene = null;
  }
}

mixin(TownMode, StyleMethods, HomeMethods, ViewMethods, PlannerMethods, InteriorMethods, VehicleMethods, InputMethods, EnvironmentMethods);
