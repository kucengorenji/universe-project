import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { loadAssetPack, ASSET_PACK_URL, ASSET_PACK_LOD0_URL, getToonGradient } from '../../render/assetLibrary.js';
import { mulberry32 } from '../../map/mapGenerator.js';
import { PLANET_TYPES } from '../../world/planetTypes.js';
import { generateTownLayout, DIORAMA_R } from './townLayout.js';
import { TownBuilder, WATER_Y, packFootprints } from './townBuilder.js';
import { Crowd, Pedestrians } from './crowd.js';
import { Colliders } from './colliders.js';
import { TownHud } from './hud.js';
import { TownSky } from './sky.js';
import { Fleet } from './fleet.js';
import { Car, ChaseCamera } from './vehicle.js';
import { RiggedPeople, makePerson, animatePerson } from './peopleRig.js';
import { Interior, ENTERABLE } from './interior.js';
import { Minimap, Speedo } from '../../ui/gauges.js';

// Which models drive which physics. Modern towns get cars, fantasy towns carts and caravans.
const VEHICLES = {
  modern: [
    { asset: 'v_sedan', variant: 0, type: 'sedan' },
    { asset: 'v_sedan', variant: 1, type: 'sedan' },
    { asset: 'v_sedan', variant: 2, type: 'sedan' },
    { asset: 'v_sedan', variant: 3, type: 'sedan' },
    { asset: 'v_hatch', variant: 0, type: 'hatch' },
    { asset: 'v_hatch', variant: 1, type: 'hatch' },
    { asset: 'v_hatch', variant: 2, type: 'hatch' },
    { asset: 'v_suv', variant: 0, type: 'suv' },
    { asset: 'v_suv', variant: 1, type: 'suv' },
    { asset: 'v_van', variant: 0, type: 'van' },
    { asset: 'v_van', variant: 1, type: 'van' },
    { asset: 'v_pickup', variant: 0, type: 'pickup' },
    { asset: 'v_pickup', variant: 1, type: 'pickup' },
    { asset: 'v_taxi', variant: 0, type: 'sedan' },
    { asset: 'v_police', variant: 0, type: 'police' },
    { asset: 'v_sport', variant: 0, type: 'sport' },
    { asset: 'v_sport', variant: 1, type: 'sport' }
  ],
  // Buses only run the main avenues
  bus: [
    { asset: 'v_bus', variant: 0, type: 'bus' },
    { asset: 'v_bus', variant: 1, type: 'bus' }
  ],
  fantasy: [
    { asset: 'v_cart', variant: 0, type: 'cart' },
    { asset: 'v_cart', variant: 1, type: 'cart' },
    { asset: 'v_wagon', variant: 0, type: 'wagon' },
    { asset: 'v_caravan', variant: 0, type: 'caravan' }
  ],
  // Fallback models from the planet pack when the town pack is missing
  legacy: {
    modern: [{ asset: 'm_car', variant: 0, type: 'sedan' }],
    fantasy: [{ asset: 'caravan', variant: 0, type: 'caravan' }]
  }
};
const STREET_FOV = 55;

// Inside a city: the diorama is the main view; from there you can walk the
// streets (third person) or drive. Everything is built from the planet's map
// data, so the town you land in is the one you clicked on the globe.

const TOWN_PACK_URL = `${import.meta.env.BASE_URL}models/town.glb`;
const CHARACTER_URL = `${import.meta.env.BASE_URL}models/character.glb`;
const FURNITURE_URL = `${import.meta.env.BASE_URL}models/furniture.glb`;
const ATLAS_URL = `${import.meta.env.BASE_URL}textures/interior_atlas.jpg`;
let atlasTex = null;
const loadAtlas = () =>
  (atlasTex ||= new THREE.TextureLoader().loadAsync(ATLAS_URL).then((t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }).catch(() => null));
let characterGltf = null;
const loadCharacter = () => (characterGltf ||= new GLTFLoader().loadAsync(CHARACTER_URL).catch(() => null));
const packs = () =>
  Promise.all([
    loadAssetPack(ASSET_PACK_URL),
    loadAssetPack(ASSET_PACK_LOD0_URL).catch(() => null),
    loadAssetPack(TOWN_PACK_URL).catch(() => null),
    loadCharacter(),
    loadAssetPack(FURNITURE_URL).catch(() => null),
    loadAtlas()
  ]);

const UP = new THREE.Vector3(0, 1, 0);
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const _v = new THREE.Vector3();

export default class TownMode {
  static prepare() {
    return packs();
  }

  constructor(ctx, route, arrival) {
    this.ctx = ctx;
    this.route = route;
    this.arrival = arrival;
    this.view = 'diorama';
    this.keys = new Set();
    this.tween = null;
  }

  async enter() {
    const { engine, world } = this.ctx;
    const planet = world.planet(this.route.planet);
    const map = world.mapFor(this.route.planet);
    const hexasphere = world.activate(map);
    const city = map.cities[this.route.city];
    this.planet = planet;
    this.city = city;
    const [base, lod0, townPack, character, furniture, atlas] = await packs();
    this.character = character;
    this.furniture = furniture;
    this.atlas = atlas;
    const planetPack = {};
    for (const [name, lods] of Object.entries(base || {})) planetPack[name] = { ...lods };
    for (const [name, lods] of Object.entries(lod0 || {})) planetPack[name] = { ...(planetPack[name] || {}), ...lods };

    const quality = engine.quality;
    this.footprints = packFootprints(townPack);
    this.layout = generateTownLayout({ map, hexasphere, cityIndex: this.route.city, planetType: planet.type, detail: quality.settings.detail, footprints: this.footprints });
    this.doors = this.findDoors();
    this.ctx.missions?.emit('visit_town');
    this.ctx.audio?.setScene('town', { modern: this.layout.modern });
    this.builder = new TownBuilder(this.layout, { planetPack, townPack, quality, planetType: planet.type });
    this.colliders = new Colliders(this.layout.colliders);

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
    if (shadows) {
      const high = quality.tier === 'high';
      sun.castShadow = true;
      sun.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024);
      const ext = high ? 150 : 110;
      this.shadowExt = ext;
      Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 10, far: 900 });
      sun.shadow.bias = -0.0006;
      sun.shadow.normalBias = 0.6;
    }
    this.sun = sun;
    this.scene.add(sun, sun.target);

    // People: #0 is the player, the rest walk the streets
    const count = { high: 90, medium: 60, low: 30 }[quality.tier];
    this.crowd = new Crowd(count, { modern: this.layout.modern, seed: this.layout.seed, shadows });
    this.crowd.dress(0, { shirt: city.owner === 'system' ? 0xfa4d43 : 0x027b49, pants: 0x2f2f33 });
    this.scene.add(this.crowd.group);
    const rng = mulberry32(this.layout.seed + 5);
    this.walkers = new Pedestrians(this.crowd, 1, this.layout.walkGraph, rng, (x, z) => this.builder.heightAt(x, z));
    this.player = this.crowd.people[0];
    const sp = this.layout.spawn;
    Object.assign(this.player, { x: sp.x, z: sp.z, y: this.builder.groundAt(sp.x, sp.z), yaw: sp.yaw, vy: 0, visible: false });
    if (character) {
      this.setupAvatar(character, city.owner === 'system' ? 'explorer_red' : 'explorer', shadows);
      const rigCount = { high: 24, medium: 14, low: 6 }[quality.tier];
      this.rigged = new RiggedPeople(character, this.scene, { count: rigCount, modern: this.layout.modern, shadows, seed: this.layout.seed % 7 });
    }
    this.buildFleet(rng, shadows);
    this.chase = new ChaseCamera(this.camera);
    this.chase.baseFov = STREET_FOV;

    // Controls
    this.orbit = new OrbitControls(this.camera, engine.renderer.domElement);
    Object.assign(this.orbit, { enableDamping: true, dampingFactor: 0.08, screenSpacePanning: false, maxPolarAngle: 1.36, minDistance: 18, maxDistance: 1100, zoomSpeed: 1.1 });
    this.orbit.enabled = false;
    this.follow = { yaw: sp.yaw + Math.PI, pitch: 0.32, dist: 6.5 };
    this.bindInput();

    this.ui = document.getElementById('townUi');
    this.hud = new TownHud(this.ui, {
      city,
      planet,
      layout: this.layout,
      quality,
      on: {
        liftoff: () => this.ctx.director.go({ mode: 'planet', planet: this.route.planet, city: this.route.city }),
        view: (v) => this.setView(v),
        interact: () => this.interact()
      }
    });
    this.minimap = new Minimap(this.ui, { layout: this.layout, groundAt: (x, z) => this.builder.groundAt(x, z), waterY: WATER_Y, doors: this.doors });
    this.speedo = new Speedo(this.ui);
    this.ui.hidden = false;
    document.body.dataset.mode = 'town';

    // Arrival: high above the town (under the cloud cover), then swoop in
    this.camera.position.set(0.1, 950, 60);
    this.camera.lookAt(0, 0, 0);
    this.orbit.target.set(0, 0, 0);
  }

  arrived() {
    const to = this.dioramaPose({});
    this.flyCamera(to, 2.8, () => this.setView('diorama'));
  }

  // ------------------------------------------------------------------ views

  dioramaPose(out) {
    const L = this.layout;
    const dist = Math.min(900, L.cityR * 2.3 + 110);
    const polar = 0.92;
    const target = new THREE.Vector3(L.plaza?.x ?? 0, 0, L.plaza?.z ?? 0);
    const dir = (az) => new THREE.Vector3(Math.sin(polar) * Math.sin(az), Math.cos(polar), Math.sin(polar) * Math.cos(az));
    // Look from the side with the clearest line of sight (mountains block some views)
    if (this.viewAz === undefined) {
      let best = 0;
      let bestScore = Infinity;
      for (let k = 0; k < 12; k++) {
        const az = (k / 12) * Math.PI * 2 + (L.seed % 100) / 200;
        const d = dir(az);
        let block = 0;
        for (let t = 0.1; t <= 1; t += 0.05) {
          const p = d.clone().multiplyScalar(dist * t).add(target);
          block = Math.max(block, this.builder.groundAt(p.x, p.z) + 8 - p.y);
        }
        const score = block + (1 - Math.cos(az - 0.9)) * 2; // mild preference for a south-east view
        if (score < bestScore) {
          bestScore = score;
          best = az;
        }
      }
      this.viewAz = best;
    }
    out.target = target;
    out.pos = dir(this.viewAz).multiplyScalar(dist).add(target);
    return out;
  }

  flyCamera(to, dur, done) {
    this.orbit.enabled = false;
    this.tween = { from: { pos: this.camera.position.clone(), target: this.orbit.target.clone() }, to, t0: this.ctx.engine.time, dur, done };
  }

  setView(v, { fromTransfer = false } = {}) {
    if (this.interior) {
      // Leave the building first, then switch
      if (v !== 'walk') this.exitBuilding().then(() => this.setView(v));
      return;
    }
    if (this.tween && v !== 'diorama') return;
    if (this.transfer && !fromTransfer) return;
    const prev = this.view;
    if (v === 'drive' && !fromTransfer) {
      // "Drive" means: get into the nearest vehicle (walk over to it first if needed)
      if (prev === 'diorama') this.setView('walk');
      const near = this.fleet.nearest(this.player.x, this.player.z, 3.2) || this.fleet.nearest(this.player.x, this.player.z, Infinity);
      if (!near) return;
      if (Math.hypot(near.car.x - this.player.x, near.car.z - this.player.z) > 12) {
        const door = this.doorOf(near.car, near.spec);
        this.placePlayer(door.x + 3, door.z + 3);
      }
      this.enterVehicle(near);
      return;
    }
    if (v === 'walk' && prev === 'drive' && !fromTransfer) {
      this.exitVehicle();
      return;
    }
    this.view = v;
    this.hud.setView(v);
    this.minimap.show(v !== 'diorama');
    this.speedo.show(v === 'drive');
    if (v !== 'diorama') this.ctx.tips?.show(v);
    this.orbit.enabled = v === 'diorama' && !this.tween;
    this.player.visible = v === 'walk' && !this.avatar;
    this.camera.fov = v === 'diorama' ? 40 : STREET_FOV;
    this.camera.updateProjectionMatrix();
    if (v === 'walk') {
      if (prev === 'diorama') {
        // Drop in where the camera was looking, if it is free
        const t = this.orbit.target;
        if (Math.hypot(t.x, t.z) < DIORAMA_R - 30 && this.builder.heightAt(t.x, t.z) > WATER_Y + 0.2) this.placePlayer(t.x, t.z);
      }
      this.follow.dist = 6.5;
      this.follow.yaw = this.player.yaw + Math.PI;
    } else if (v === 'diorama' && prev !== 'diorama') {
      // Rise out of the street to the table view around where we were
      const focus = prev === 'drive' && this.drive ? this.drive.car : this.player;
      const to = this.dioramaPose({});
      to.target.set(focus.x, 0, focus.z);
      to.pos.sub(new THREE.Vector3(this.layout.plaza?.x ?? 0, 0, this.layout.plaza?.z ?? 0)).multiplyScalar(0.55).add(to.target);
      this.flyCamera(to, 1.6, () => (this.orbit.enabled = true));
    }
  }

  /** The player's rigged explorer (faction outfit), toon-shaded like the rest. */
  setupAvatar(gltf, outfit, shadows) {
    const person = makePerson(gltf, outfit, { shadows }) || makePerson(gltf, 'explorer', { shadows });
    if (!person) return;
    person.root.visible = false;
    this.scene.add(person.root);
    this.avatar = person;
  }

  updateAvatar(dt) {
    const av = this.avatar;
    if (!av) return;
    const p = this.player;
    const on = this.view === 'walk' || this.view === 'interior' || this.pose;
    av.root.visible = !!on;
    this.crowd.people[0].visible = false; // the rig stands in for person #0
    if (!on) return;
    av.root.position.set(p.x, p.y + p.jump + (this.pose?.lift || 0), p.z);
    av.root.rotation.y = p.yaw;
    animatePerson(av, dt, p.speed, { pose: this.pose?.name || null });
  }

  placePlayer(x, z) {
    const p = this.colliders.resolve(x, z, 0.45);
    this.player.x = p.x;
    this.player.z = p.z;
    this.player.y = this.builder.groundAt(p.x, p.z);
  }

  // ------------------------------------------------------------------ buildings

  /** Front doors of every building you can go into. */
  findDoors() {
    const doors = [];
    this.layout.buildings.forEach((b, i) => {
      if (!ENTERABLE[b.asset] || !this.furniture) return;
      const f = this.footprints[b.asset];
      const front = f ? f.maxZ : b.d / 2;
      const fx = -Math.sin(b.yaw);
      const fz = Math.cos(b.yaw);
      doors.push({ b, i, x: b.x + fx * (front + 0.9), z: b.z + fz * (front + 0.9), outYaw: Math.atan2(fx, fz) });
    });
    return doors;
  }

  nearestDoor(x, z, reach = 2.4) {
    let best = null;
    let bestD = reach;
    for (const d of this.doors) {
      const dd = Math.hypot(d.x - x, d.z - z);
      if (dd < bestD) {
        bestD = dd;
        best = d;
      }
    }
    return best;
  }

  async enterBuilding(door) {
    if (this.fading || this.transfer || this.interior) return;
    this.fading = true;
    this.hud.setPrompt(null);
    const overlay = this.ctx.overlay;
    await overlay.cover('fade', { duration: 280 });
    const inside = new Interior({
      building: door.b,
      pack: this.furniture,
      atlas: this.atlas,
      character: this.character,
      modern: this.layout.modern,
      seed: this.layout.seed * 31 + door.i,
      night: this.night || 0,
      shadows: false
    });
    this.interior = inside;
    this.interiorDoor = door;
    this.outside = { x: this.player.x, z: this.player.z };
    if (this.avatar) inside.scene.add(this.avatar.root);
    Object.assign(this.player, { x: inside.spawn.x, z: inside.spawn.z, y: 0, yaw: inside.spawn.yaw, speed: 0, jump: 0, vy: 0 });
    this.pose = null;
    this.follow.yaw = inside.spawn.yaw + Math.PI;
    this.follow.pitch = 0.85;
    this.follow.dist = 7.5 * Math.max(1, Math.max(inside.W, inside.D * 1.3) / 10); // big rooms pull the camera back
    this.view = 'interior';
    this.hud.setView('interior');
    this.ctx.engine.post.configure('interior', { boost: 0 });
    this.ctx.audio?.setScene('interior');
    this.ctx.tips?.show('interior');
    this.minimap.show(false);
    this.ctx.audio?.sfx('door');
    this.ui.classList.add('is-inside');
    this.fading = false;
    this.ctx.missions?.emit('enter_house');
    await overlay.reveal({ duration: 420 });
  }

  async exitBuilding() {
    if (!this.interior || this.fading) return;
    this.fading = true;
    this.hud.setPrompt(null);
    const overlay = this.ctx.overlay;
    await overlay.cover('fade', { duration: 280 });
    const d = this.interiorDoor;
    if (this.avatar) this.scene.add(this.avatar.root);
    this.interior.dispose();
    this.interior = null;
    this.pose = null;
    this.placePlayer(d.x + Math.sin(d.outYaw) * 0.6, d.z + Math.cos(d.outYaw) * 0.6);
    this.player.yaw = d.outYaw;
    this.follow.yaw = d.outYaw + Math.PI;
    this.follow.pitch = 0.32;
    this.follow.dist = 6.5;
    this.view = 'walk';
    this.hud.setView('walk');
    this.ctx.engine.post.configure('town');
    this.minimap.show(true);
    this.ctx.audio?.stopRoom();
    this.ctx.audio?.setScene('town', { modern: this.layout.modern });
    this.ctx.audio?.sfx('door');
    this.ui.classList.remove('is-inside');
    this.fading = false;
    await overlay.reveal({ duration: 420 });
  }

  /** Sit / sleep poses, the bed skipping the night, and everything else the interior does. */
  async useInterior(it) {
    const inside = this.interior;
    const p = this.player;
    if (this.pose) {
      // Standing up (or waking up) from a seat or a bed
      const back = this.pose.stand;
      this.pose = null;
      p.x = back.x;
      p.z = back.z;
      return;
    }
    const r = inside.use(it, p);
    if (r.event) this.ctx.missions?.emit(r.event);
    if (r.action === 'exit') return this.exitBuilding();
    const audio = this.ctx.audio;
    if (r.action === 'radio_on') audio?.radio(true);
    else if (r.action === 'radio_off') audio?.radio(false);
    else if (it.kind === 'media') audio?.tv(it.on);
    else if (it.kind === 'fire') audio?.fire(it.on);
    else if (it.kind === 'light') audio?.sfx('switch');
    else if (it.kind === 'door') audio?.sfx('door');
    else if (r.action === 'hold') audio?.sfx('pickup');
    else if (r.action === 'drop') audio?.sfx('drop');
    else if (r.action === 'sit' || r.action === 'sleep') audio?.sfx('sit');
    if (r.action === 'sit') {
      this.pose = { name: 'sit', lift: 0, stand: { x: it.x + Math.sin(r.pose.yaw) * 0.6, z: it.z + Math.cos(r.pose.yaw) * 0.6 } };
      p.x = r.pose.x;
      p.z = r.pose.z;
      p.yaw = r.pose.yaw;
      p.speed = 0;
    } else if (r.action === 'sleep') {
      const b = r.pose;
      this.pose = { name: 'sleep', lift: -0.34, stand: { x: it.x, z: it.z } };
      p.x = b.x;
      p.z = b.z;
      p.yaw = b.yaw;
      p.speed = 0;
      // Lights out, skip to the morning, lights up
      const overlay = this.ctx.overlay;
      this.fading = true;
      await overlay.cover('fade', { duration: 900 });
      this.ctx.world.skipTime(this.secondsToMorning());
      this.ctx.missions?.emit('sleep');
      await new Promise((res) => setTimeout(res, 500));
      this.fading = false;
      await overlay.reveal({ duration: 1200 });
    }
  }

  /** How long until the sun is up again at this city (past the coming night if it is day now). */
  secondsToMorning() {
    const w = this.ctx.world;
    const now = w.now();
    let sawNight = w.sunAt(this.route.planet, this.layout.frame, now).y < -0.05;
    for (let s = 10; s < 4000; s += 10) {
      const e = w.sunAt(this.route.planet, this.layout.frame, now + s).y;
      if (e < -0.05) sawNight = true;
      if (sawNight && e > 0.2) return s;
    }
    return 0;
  }

  updateInterior(dt, t) {
    const inside = this.interior;
    const p = this.player;
    if (!this.pose && !this.fading) {
      const i = this.intent();
      const f = this.follow;
      const fx = -Math.sin(f.yaw);
      const fz = -Math.cos(f.yaw);
      let mx = fx * i.forward - fz * i.right;
      let mz = fz * i.forward + fx * i.right;
      const len = Math.hypot(mx, mz);
      if (len > 0.01) {
        mx /= Math.max(1, len);
        mz /= Math.max(1, len);
        let d = Math.atan2(mx, mz) - p.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        p.yaw += d * (1 - Math.exp(-dt * 12));
        p.speed = THREE.MathUtils.lerp(p.speed, (i.run ? 3.4 : 1.8) * Math.min(1, len), 1 - Math.exp(-dt * 8));
      } else p.speed = THREE.MathUtils.lerp(p.speed, 0, 1 - Math.exp(-dt * 10));
      const r = inside.colliders.resolve(p.x + Math.sin(p.yaw) * p.speed * dt, p.z + Math.cos(p.yaw) * p.speed * dt, 0.32);
      p.x = THREE.MathUtils.clamp(r.x, -inside.W / 2 + 0.3, inside.W / 2 - 0.3);
      p.z = THREE.MathUtils.clamp(r.z, -inside.D / 2 + 0.3, inside.D / 2 - 0.2);
    } else p.speed = 0;
    p.y = 0;
    p.phase += dt * (p.speed * 3.1 + 0.6);
    // Dollhouse camera: high, looking down over the player; walls in the way hide themselves
    const f = this.follow;
    const look = _v.set(p.x * 0.6, 1.0, p.z * 0.6);
    const pos = new THREE.Vector3(Math.sin(f.yaw) * Math.cos(f.pitch), Math.sin(f.pitch), Math.cos(f.yaw) * Math.cos(f.pitch)).multiplyScalar(f.dist).add(look);
    this.camera.position.lerp(pos, 1 - Math.exp(-dt * 8));
    this.camera.lookAt(look);
    inside.update(dt, t, this.camera, p);
    // Prompt: the thing you are standing at
    let text = null;
    if (this.pose) text = this.pose.name === 'sleep' ? 'Bangun' : 'Berdiri';
    else if (!this.fading) text = inside.promptFor(inside.nearest(p.x, p.z));
    this.hud.setPrompt(text, 'E');
  }

  // ------------------------------------------------------------------ vehicles

  /** Parked cars along the streets and traffic on the bigger ones; every one of them can be taken. */
  buildFleet(rng, shadows) {
    const L = this.layout;
    const style = L.modern ? 'modern' : 'fantasy';
    let kinds = VEHICLES[style].filter((k) => this.builder.townPack[`${k.asset}_v${k.variant}`] || this.builder.townPack[k.asset]);
    if (!kinds.length) kinds = VEHICLES.legacy[style].filter((k) => this.builder.resolve(k.asset, k.variant));
    const buses = L.modern ? VEHICLES.bus.filter((k) => this.builder.townPack[`${k.asset}_v${k.variant}`]) : [];
    this.fleet = new Fleet(this.builder, this.scene, { shadows });
    if (!kinds.length) return;
    const pick = () => kinds[Math.floor(rng() * kinds.length)];
    // Parked: the layout's roadside spots (modern), or carts left by the main streets (fantasy)
    for (const p of L.props) {
      if (!p.parked) continue;
      const k = pick();
      this.fleet.add({ ...k, x: p.x, z: p.z, yaw: -p.yaw, mode: 'parked' });
    }
    const lines = L.driveGraph.filter((l) => l.pts.length >= 2);
    if (!L.modern) {
      const mains = L.streets.filter((st) => st.kind === 'main' || st.kind === 'road');
      for (let i = 0; i < Math.min(6, mains.length * 2); i++) {
        const st = mains[i % mains.length];
        const k = Math.min(st.pts.length - 2, 2 + Math.floor(rng() * Math.max(1, st.pts.length - 4)));
        if (k < 1) continue;
        const [ax, az] = st.pts[k];
        const [bx, bz] = st.pts[k + 1];
        const len = Math.hypot(bx - ax, bz - az) || 1;
        const off = st.w / 2 + 1.4;
        const x = ax - ((bz - az) / len) * off;
        const z = az + ((bx - ax) / len) * off;
        if (this.colliders.resolve(x, z, 1.4).x !== x) continue;
        this.fleet.add({ ...pick(), x, z, yaw: Math.atan2(bx - ax, bz - az), mode: 'parked' });
      }
    }
    // Traffic
    const n = Math.min(L.modern ? 22 : 8, lines.length * 3);
    const mains = lines.filter((l) => l.w >= 18);
    for (let i = 0; i < n; i++) {
      // Every sixth vehicle on a main avenue is a bus
      const bus = buses.length && mains.length && i % 6 === 0;
      const line = bus ? mains[i % mains.length] : lines[i % lines.length];
      const kind = bus ? buses[i % buses.length] : pick();
      const v = this.fleet.add({ ...kind, x: line.pts[0].x, z: line.pts[0].z, yaw: 0, mode: 'traffic', line, s: rng() * 400, dir: rng() < 0.5 ? 1 : -1 });
      if (!v) continue;
      v.route.s = Math.min(v.route.total, v.route.s);
      const p = this.fleet.routePose(v);
      Object.assign(v.car, { x: p.x, z: p.z, yaw: p.yaw });
    }
    this.fleet.build();
  }

  /** The drivable model of a fleet vehicle, as its own mesh while the player drives it. */
  vehicleObject(v) {
    const mesh = new THREE.Mesh(v.res.lods[0] || v.res.lods[1], this.builder.material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(v.res.fix);
    mesh.castShadow = true;
    const holder = new THREE.Group();
    holder.add(mesh);
    this.scene.add(holder);
    return holder;
  }

  /** Door the player uses: the driver's side (left of the car). */
  doorOf(car, spec) {
    const lx = Math.cos(car.yaw);
    const lz = -Math.sin(car.yaw);
    const side = spec.width / 2 + 0.7;
    const back = -spec.length * 0.08;
    return { x: car.x + lx * side + Math.sin(car.yaw) * back, z: car.z + lz * side + Math.cos(car.yaw) * back };
  }

  /** Walk to the door, open it (and pull the driver out of traffic), get in. */
  enterVehicle(v) {
    if (this.transfer || !v) return;
    const jack = v.mode === 'traffic';
    if (jack) v.stopped = 1e9;
    const p = this.player;
    this.transfer = { kind: 'enter', v, t0: this.ctx.engine.time, dur: jack ? 1.5 : 0.95, from: { x: p.x, z: p.z }, jack, fled: false };
    this.hud.setPrompt(null);
  }

  exitVehicle() {
    const d = this.drive;
    if (this.transfer || !d || d.car.speed > 4) return;
    this.transfer = { kind: 'exit', v: d.v, t0: this.ctx.engine.time, dur: 0.7 };
    this.hud.setPrompt(null);
  }

  updateTransfer(t) {
    const tr = this.transfer;
    const raw = Math.min(1, (t - tr.t0) / tr.dur);
    const p = this.player;
    if (tr.kind === 'enter') {
      const car = tr.v.car;
      const door = this.doorOf(car, tr.v.spec);
      if (tr.jack && !tr.fled && raw > 0.3) {
        // The driver jumps out and runs for it
        tr.fled = true;
        this.walkers.flee(door.x, door.z, p.x, p.z);
        this.ctx.missions?.emit('carjack');
      }
      const walkT = Math.min(1, raw / 0.55);
      p.x = THREE.MathUtils.lerp(tr.from.x, door.x, walkT);
      p.z = THREE.MathUtils.lerp(tr.from.z, door.z, walkT);
      p.y = this.builder.groundAt(p.x, p.z);
      p.speed = walkT < 1 ? 2.3 : 0;
      const face = walkT < 1 ? Math.atan2(door.x - tr.from.x, door.z - tr.from.z) : car.yaw;
      let dy = face - p.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      p.yaw += dy * 0.25;
      if (raw >= 1) {
        this.transfer = null;
        this.ctx.audio?.sfx('carDoor');
        this.ctx.audio?.sfx('ignition');
        this.fleet.hide(tr.v);
        tr.v.mode = 'player';
        const drive = new Car(tr.v.spec, { x: car.x, z: car.z, yaw: car.yaw });
        drive.y = car.y;
        this.drive = { v: tr.v, car: drive, obj: this.vehicleObject(tr.v) };
        drive.apply(this.drive.obj);
        this.chase.reset(drive);
        this.setView('drive', { fromTransfer: true });
      }
    } else {
      const d = this.drive;
      d.car.vx *= 0.8;
      d.car.vz *= 0.8;
      if (raw >= 1) {
        this.transfer = null;
        this.ctx.audio?.sfx('carDoor');
        const door = this.doorOf(d.car, d.v.spec);
        this.scene.remove(d.obj);
        this.fleet.park(d.v, d.car);
        this.drive = null;
        this.placePlayer(door.x, door.z);
        p.yaw = d.car.yaw + Math.PI / 2;
        this.setView('walk', { fromTransfer: true });
      }
    }
  }

  /** What the world looks like to the player's car. */
  driveWorld() {
    const exclude = this.drive?.v;
    return {
      heightAt: (x, z) => this.builder.groundAt(x, z),
      resolve: (x, z, r) => {
        const a = this.colliders.resolve(x, z, r);
        return this.fleet.resolve(a.x, a.z, r, exclude);
      },
      blocked: (x, z) => this.builder.heightAt(x, z) < WATER_Y - 0.3 || Math.hypot(x, z) > DIORAMA_R - 8
    };
  }

  updateDrive(dt) {
    const d = this.drive;
    if (!d) return;
    const i = this.intent();
    const input = this.transfer ? { forward: 0, right: 0 } : { forward: i.forward, right: i.right, handbrake: this.keys.has(' '), boost: i.run };
    d.car.update(dt, input, this.driveWorld());
    d.car.apply(d.obj);
    this.engineSound(d.car, ['cart', 'wagon', 'caravan'].includes(d.v.type));
    this.driveAcc = (this.driveAcc || 0) + d.car.speed * dt;
    if (this.driveAcc > 25) {
      this.ctx.missions?.emit('drive_m', this.driveAcc);
      this.driveAcc = 0;
    }
  }

  /** Engine note with a fake gearbox: revs climb through each gear and drop on the shift. */
  engineSound(car, horse) {
    const audio = this.ctx.audio;
    if (!audio) return;
    const top = car.spec.top || 30;
    const sp = Math.abs(car.forwardSpeed);
    if (horse) {
      // Carts are pulled: hooves instead of an engine
      this.hoof = (this.hoof || 0) + sp * 0.016 * 1.6;
      if (this.hoof > 1 && sp > 0.5) {
        this.hoof = 0;
        audio.sfx('step', { surface: 'wood' });
      }
      return;
    }
    const gears = 5;
    const g = Math.min(gears - 1, Math.floor((sp / top) * gears));
    const inGear = (sp / top) * gears - g;
    const rpm = Math.min(1, 0.18 + inGear * 0.72 + car.throttle * (g === 0 ? 0.25 : 0.08));
    audio.engine('car', { speed01: Math.min(1, sp / top), throttle: car.throttle, rpm, skid: car.skid * Math.min(1, car.speed / 6) });
    if (car.impact > 0.25 && !this.lastImpact) audio.sfx('hit', { strength: Math.min(1, car.impact) });
    this.lastImpact = car.impact > 0.25;
  }

  /** Minimap (every other frame) and the speedometer. */
  updateGauges() {
    if (this.view === 'diorama') return;
    this.gaugeFrame = (this.gaugeFrame || 0) + 1;
    const car = this.drive?.car;
    if (car && this.view === 'drive') {
      const top = car.spec.top || 30;
      const sp = Math.abs(car.forwardSpeed);
      const gear = car.forwardSpeed < -0.5 ? 'R' : sp < 0.3 ? 'N' : String(1 + Math.min(4, Math.floor((sp / top) * 5)));
      this.speedo.set(sp * 3.6, sp / (top * 1.25), gear);
    }
    if (this.gaugeFrame % 2) return;
    const dir = this.camera.getWorldDirection(_v);
    const pos = car && this.view === 'drive' ? car : this.player;
    const cars = [];
    for (const v of this.fleet.vehicles) if (!v.hidden && v.mode === 'traffic') cars.push(v.car);
    this.minimap.draw(pos, pos.yaw, { x: dir.x, z: dir.z }, cars, this.view === 'drive' ? 160 : 90, { doors: this.view === 'walk' });
  }

  /** A footstep on every half stride. */
  footsteps(surface) {
    const p = this.player;
    const step = Math.floor(p.phase / Math.PI);
    if (step !== this.lastStep) {
      this.lastStep = step;
      if (p.speed > 0.6 && !p.jump && !this.pose) this.ctx.audio?.sfx('step', { surface, run: p.speed > 3 });
    }
  }

  // ------------------------------------------------------------------ input

  bindInput() {
    const canvas = this.ctx.engine.renderer.domElement;
    this.onKeyDown = (e) => {
      if (e.target.matches?.('input, textarea')) return;
      const k = e.key.toLowerCase();
      if (k === '1') this.setView('diorama');
      else if (k === '2') this.setView('walk');
      else if (k === '3') this.setView('drive');
      else if (k === 'escape' && this.interior) this.exitBuilding();
      else if (k === 'escape' && this.view !== 'diorama') this.setView('diorama');
      else if (k === 'e' || k === 'f') this.interact();
      else if (k === ' ' && this.view === 'walk' && this.player.jump === 0 && !this.player.vy) this.player.vy = 4.4;
      this.keys.add(k);
      if (this.view !== 'diorama' && [' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    };
    this.onKeyUp = (e) => this.keys.delete(e.key.toLowerCase());
    this.onBlur = () => this.keys.clear();
    this.onPointerDown = (e) => {
      if (this.view === 'diorama') return;
      this.drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
    };
    this.onPointerMove = (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      if (this.view === 'drive') this.chase.look(e.clientX - this.drag.x, e.clientY - this.drag.y, this.ctx.engine.time);
      this.follow.yaw -= (e.clientX - this.drag.x) * 0.006;
      this.follow.pitch = THREE.MathUtils.clamp(this.follow.pitch + (e.clientY - this.drag.y) * 0.004, -0.15, 1.2);
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      this.followInput = this.ctx.engine.time;
    };
    this.onPointerUp = () => (this.drag = null);
    this.onWheel = (e) => {
      if (this.view === 'diorama') return;
      this.follow.dist = THREE.MathUtils.clamp(this.follow.dist * Math.exp(e.deltaY * 0.001), 3, 30);
    };
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: true });
  }

  unbindInput() {
    const canvas = this.ctx.engine.renderer.domElement;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('wheel', this.onWheel);
  }

  /** Move intent in -1..1 from keys or the touch joystick. */
  intent() {
    const k = this.keys;
    const axis = (a, b, c, d) => (k.has(a) || k.has(c) ? 1 : 0) - (k.has(b) || k.has(d) ? 1 : 0);
    const joy = this.hud.joystick;
    return {
      forward: joy.active ? -joy.y : axis('w', 's', 'arrowup', 'arrowdown'),
      right: joy.active ? joy.x : axis('d', 'a', 'arrowright', 'arrowleft'),
      run: k.has('shift') || (joy.active && Math.hypot(joy.x, joy.y) > 0.92)
    };
  }

  // ------------------------------------------------------------------ simulation

  updateWalk(dt) {
    const p = this.player;
    const i = this.intent();
    const f = this.follow;
    // Camera-relative movement: "forward" is where the camera looks
    const fx = -Math.sin(f.yaw);
    const fz = -Math.cos(f.yaw);
    // Screen right is forward turned a quarter to the right: (-fz, fx)
    let mx = fx * i.forward - fz * i.right;
    let mz = fz * i.forward + fx * i.right;
    const len = Math.hypot(mx, mz);
    const speed = i.run ? 5.6 : 2.3;
    if (len > 0.01) {
      mx /= Math.max(1, len);
      mz /= Math.max(1, len);
      const target = Math.atan2(mx, mz);
      let d = target - p.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      p.yaw += d * (1 - Math.exp(-dt * 12));
      p.speed = THREE.MathUtils.lerp(p.speed, speed * Math.min(1, len), 1 - Math.exp(-dt * 8));
    } else p.speed = THREE.MathUtils.lerp(p.speed, 0, 1 - Math.exp(-dt * 10));
    const nx = p.x + Math.sin(p.yaw) * p.speed * dt;
    const nz = p.z + Math.cos(p.yaw) * p.speed * dt;
    const r0 = this.colliders.resolve(nx, nz, 0.42);
    const r = this.fleet.resolve(r0.x, r0.z, 0.42);
    // No wading into deep water, no stepping off the edge of the table
    const g = this.builder.heightAt(r.x, r.z);
    // Too steep to climb: stop at the foot of cliffs (going down is fine)
    const climb = (g - this.builder.heightAt(p.x, p.z)) / Math.max(1e-3, Math.hypot(r.x - p.x, r.z - p.z));
    if (g > WATER_Y - 0.5 && Math.hypot(r.x, r.z) < DIORAMA_R - 6 && climb < 1.1) {
      p.x = r.x;
      p.z = r.z;
    } else p.speed *= 0.5;
    const ground = this.builder.groundAt(p.x, p.z);
    if (p.vy || p.jump > 0) {
      p.vy -= 12 * dt;
      p.jump = Math.max(0, p.jump + p.vy * dt);
      if (p.jump === 0) p.vy = 0;
    }
    p.y = ground;
    p.phase += dt * (p.speed * 3.1 + 0.6);
  }

  /** E / F: get in or out of a vehicle. */
  interact() {
    if (this.transfer || this.fading) return;
    if (this.interior) {
      const it = this.pose ? {} : this.interior.nearest(this.player.x, this.player.z);
      if (it || this.pose) this.useInterior(it);
      return;
    }
    if (this.view === 'walk') {
      const v = this.fleet.nearest(this.player.x, this.player.z, 3.2);
      const door = this.nearestDoor(this.player.x, this.player.z);
      const vd = v ? Math.hypot(v.car.x - this.player.x, v.car.z - this.player.z) : Infinity;
      const dd = door ? Math.hypot(door.x - this.player.x, door.z - this.player.z) : Infinity;
      if (door && dd <= vd) this.enterBuilding(door);
      else if (v) this.enterVehicle(v);
    } else if (this.view === 'drive') this.exitVehicle();
  }

  updatePrompt() {
    let text = null;
    if (!this.transfer) {
      if (this.view === 'walk') {
        const v = this.fleet.nearest(this.player.x, this.player.z, 3.2);
        const door = this.nearestDoor(this.player.x, this.player.z);
        const vd = v ? Math.hypot(v.car.x - this.player.x, v.car.z - this.player.z) : Infinity;
        const dd = door ? Math.hypot(door.x - this.player.x, door.z - this.player.z) : Infinity;
        if (door && dd <= vd) text = ENTERABLE[door.b.asset].label;
        else if (v) text = v.mode === 'traffic' ? 'Ambil kendaraan' : 'Masuk kendaraan';
      } else if (this.view === 'drive' && this.drive && this.drive.car.speed < 4) text = 'Turun';
    }
    this.hud.setPrompt(text, 'E');
  }

  updateFollowCamera(dt, target, height) {
    const f = this.follow;
    const t = this.ctx.engine.time;
    // Swing back behind the direction of travel when the player lets go of the camera
    const heading = this.player.yaw;
    const moving = this.player.speed > 0.5;
    if (moving && t - (this.followInput || 0) > 2) {
      let d = heading + Math.PI - f.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      f.yaw += d * (1 - Math.exp(-dt * (this.view === 'drive' ? 2.5 : 1.2)));
    }
    const look = _v.set(target.x, target.y + height, target.z);
    const pos = new THREE.Vector3(Math.sin(f.yaw) * Math.cos(f.pitch), Math.sin(f.pitch), Math.cos(f.yaw) * Math.cos(f.pitch)).multiplyScalar(f.dist).add(look);
    const floor = this.builder.groundAt(pos.x, pos.z) + 0.6;
    if (pos.y < floor) pos.y = floor;
    const k = 1 - Math.exp(-dt * 10);
    this.camera.position.lerp(pos, k);
    this.camera.lookAt(look);
  }

  update(dt, t) {
    if (this.interior) {
      // Inside: only the room runs and renders; the town waits outside
      this.updateInterior(dt, t);
      this.updateAvatar(dt);
      this.footsteps('wood');
      return;
    }
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
      this.orbit.update();
      // Keep the table in reach
      const tg = this.orbit.target;
      const r = Math.hypot(tg.x, tg.z);
      if (r > DIORAMA_R * 0.85) tg.multiplyScalar((DIORAMA_R * 0.85) / r);
      tg.y = Math.max(0, this.builder.groundAt(tg.x, tg.z));
    } else if (this.view === 'walk') {
      if (this.transfer) this.updateTransfer(t);
      else this.updateWalk(dt);
      this.updateFollowCamera(dt, this.player, 1.6);
      this.updatePrompt();
    } else if (this.view === 'drive') {
      if (this.transfer) this.updateTransfer(t);
      this.updateDrive(dt);
      if (this.drive) this.chase.update(dt, t, this.drive.car, (x, z) => this.builder.groundAt(x, z), { dist: 5 + this.drive.v.spec.length * 0.55, height: 1.4 + this.drive.v.spec.length * 0.12 });
      this.updatePrompt();
    }
    if (this.view === 'walk') this.footsteps(this.layout.modern ? 'road' : 'grass');
    this.updateGauges();
    const obstacles = [this.player];
    if (this.drive) obstacles.push(this.drive.car);
    this.fleet.update(dt, obstacles);
    const cam = this.camera.position;
    const near = (x, z) => Math.hypot(x - cam.x, z - cam.z) < 260 + cam.y;
    // People jump out of the way of a car coming at them
    const threat = this.drive && this.drive.car.speed > 5 ? this.drive.car : null;
    this.walkers.update(dt, near, threat);
    this.rigged?.update(dt, this.walkers.walkers, this.crowd.people, this.camera.position);
    if (this.avatar) this.player.visible = false;
    this.crowd.pose();
    this.updateAvatar(dt);
    this.builder.update(this.camera);
    this.updateEnvironment(dt, t);
    this.hud.update(this);
  }

  /** Time of day, light, fog and the sun's shadow box. */
  updateEnvironment(dt, t) {
    const s = this.ctx.world.sunAt(this.route.planet, this.layout.frame);
    this.sunVec.set(s.x, s.y, s.z).normalize();
    const L = this.sky.update(this.sunVec, dt);
    this.sky.group.position.copy(this.camera.position);
    this.sunDir.copy(L.lightDir);
    this.sun.color.copy(L.sunColor);
    this.sun.intensity = L.sunIntensity;
    this.hemi.color.copy(L.hemiSky);
    this.hemi.intensity = L.hemiIntensity;
    this.ambient.intensity = L.ambient;
    this.builder.setEnvironment({ time: t, night: L.night, sunDir: this.sunVec, sunColor: L.sunColor, sunIntensity: L.sunIntensity, sky: L.fog });
    this.night = L.night;
    this.ctx.audio?.setNight(L.night);
    if (!this.interior) this.ctx.engine.post.setBoost(L.night * 0.5); // lit windows and lamps glow at night

    // Fog: from the table the world's edge melts into haze; at street level the horizon opens up
    const street = this.view !== 'diorama' && !this.tween ? 1 : 0;
    this.fogBlend += (street - this.fogBlend) * (1 - Math.exp(-dt * 2));
    const camDist = this.camera.position.distanceTo(this.orbit.target);
    const fog = this.scene.fog;
    fog.color.copy(L.fog);
    fog.near = THREE.MathUtils.lerp(camDist * 0.95, 260, this.fogBlend);
    fog.far = THREE.MathUtils.lerp(camDist + DIORAMA_R * 1.05, 3900, this.fogBlend);

    // Shadow box on the point of interest, snapped to whole shadow texels so it does not shimmer
    const focus = this.view === 'walk' ? this.player : this.view === 'drive' && this.drive ? this.drive.car : this.orbit.target;
    const sun = this.sun;
    const target = _v.set(focus.x, 0, focus.z);
    if (this.shadowExt) {
      const texel = (this.shadowExt * 2) / sun.shadow.mapSize.x;
      const lightRot = new THREE.Matrix4().lookAt(new THREE.Vector3(), this.sunDir.clone().negate(), UP);
      const inv = lightRot.clone().invert();
      target.applyMatrix4(inv);
      target.x = Math.round(target.x / texel) * texel;
      target.y = Math.round(target.y / texel) * texel;
      target.applyMatrix4(lightRot);
    }
    sun.target.position.copy(target);
    sun.position.copy(target).addScaledVector(this.sunDir, 400);
  }

  render() {
    this.ctx.engine.draw(this.interior ? this.interior.scene : this.scene, this.camera);
  }

  resize(w, h) {
    if (!this.camera) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  depart(route) {
    // Climb straight up into the clouds
    const cam = this.camera.position.clone();
    const to = { pos: new THREE.Vector3(cam.x * 0.3, 1100, cam.z * 0.3 + 40), target: new THREE.Vector3(0, 0, 0) };
    this.setViewSilently('diorama');
    return new Promise((resolve) =>
      this.flyCamera(to, 1.7, () => resolve({ cover: 'clouds', arrival: route.mode === 'planet' ? { city: this.route.city, fromTown: true } : null }))
    );
  }

  setViewSilently(v) {
    this.view = v;
    this.player.visible = false;
    this.orbit.enabled = false;
  }

  exit() {
    this.unbindInput();
    this.orbit.dispose();
    this.hud.dispose();
    this.ui.hidden = true;
    this.builder.dispose();
    this.crowd.dispose();
    this.avatar?.mixer.stopAllAction();
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
