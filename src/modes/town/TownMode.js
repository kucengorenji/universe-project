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

// Inside a city: the diorama is the main view; from there you can walk the
// streets (third person) or drive. Everything is built from the planet's map
// data, so the town you land in is the one you clicked on the globe.

const TOWN_PACK_URL = `${import.meta.env.BASE_URL}models/town.glb`;
const CHARACTER_URL = `${import.meta.env.BASE_URL}models/character.glb`;
let characterGltf = null;
const loadCharacter = () => (characterGltf ||= new GLTFLoader().loadAsync(CHARACTER_URL).catch(() => null));
const packs = () =>
  Promise.all([
    loadAssetPack(ASSET_PACK_URL),
    loadAssetPack(ASSET_PACK_LOD0_URL).catch(() => null),
    loadAssetPack(TOWN_PACK_URL).catch(() => null),
    loadCharacter()
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
    const [base, lod0, townPack, character] = await packs();
    const planetPack = {};
    for (const [name, lods] of Object.entries(base || {})) planetPack[name] = { ...lods };
    for (const [name, lods] of Object.entries(lod0 || {})) planetPack[name] = { ...(planetPack[name] || {}), ...lods };

    const quality = engine.quality;
    this.layout = generateTownLayout({ map, hexasphere, cityIndex: this.route.city, planetType: planet.type, detail: quality.settings.detail, footprints: packFootprints(townPack) });
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
    if (character) this.setupAvatar(character, city.owner === 'system' ? 0xfa4d43 : 0x027b49, shadows);
    this.buildTraffic(rng);

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
        view: (v) => this.setView(v)
      }
    });
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

  setView(v) {
    if (this.tween && v !== 'diorama') return;
    const prev = this.view;
    this.view = v;
    this.hud.setView(v);
    this.orbit.enabled = v === 'diorama' && !this.tween;
    this.player.visible = v === 'walk' && !this.avatar;
    if (v === 'walk') {
      if (prev === 'drive' && this.car) {
        // Step out next to the car
        const side = this.car.yaw + Math.PI / 2;
        this.placePlayer(this.car.x + Math.sin(side) * 2.4, this.car.z + Math.cos(side) * 2.4);
      } else if (prev === 'diorama') {
        // Drop in where the camera was looking, if it is free
        const t = this.orbit.target;
        if (Math.hypot(t.x, t.z) < DIORAMA_R - 30 && this.builder.heightAt(t.x, t.z) > WATER_Y + 0.2) this.placePlayer(t.x, t.z);
      }
      this.follow.dist = 6.5;
      this.follow.yaw = this.player.yaw + Math.PI;
    } else if (v === 'drive') {
      if (!this.car) this.spawnCar();
      else if (prev === 'walk' && Math.hypot(this.car.x - this.player.x, this.car.z - this.player.z) > 30) this.spawnCar();
      this.follow.dist = 13;
      this.follow.yaw = this.car.yaw + Math.PI;
    } else if (v === 'diorama' && prev !== 'diorama') {
      // Rise out of the street to the table view around where we were
      const focus = prev === 'drive' && this.car ? this.car : this.player;
      const to = this.dioramaPose({});
      to.target.set(focus.x, 0, focus.z);
      to.pos.sub(new THREE.Vector3(this.layout.plaza?.x ?? 0, 0, this.layout.plaza?.z ?? 0)).multiplyScalar(0.55).add(to.target);
      this.flyCamera(to, 1.6, () => (this.orbit.enabled = true));
    }
  }

  /** Rigged explorer from the Blender pack (idle / walk / run), toon-shaded like the rest. */
  setupAvatar(gltf, shirt, shadows) {
    const root = cloneSkinned(gltf.scene);
    const materials = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      const src = o.material;
      const color = src.name === 'M_shirt' ? new THREE.Color(shirt) : src.color.clone();
      o.material = new THREE.MeshToonMaterial({ color, gradientMap: getToonGradient() });
      materials.push(o.material);
      o.castShadow = shadows;
      o.frustumCulled = false;
    });
    const mixer = new THREE.AnimationMixer(root);
    const actions = {};
    for (const clip of gltf.animations) {
      const a = mixer.clipAction(clip);
      a.play();
      a.setEffectiveWeight(0);
      actions[clip.name] = a;
    }
    if (!actions.idle || !actions.walk || !actions.run) {
      materials.forEach((m) => m.dispose());
      return;
    }
    root.visible = false;
    this.scene.add(root);
    this.avatar = { root, mixer, actions, materials };
  }

  updateAvatar(dt) {
    const av = this.avatar;
    if (!av) return;
    const p = this.player;
    const on = this.view === 'walk';
    av.root.visible = on;
    this.crowd.people[0].visible = false; // the rig stands in for person #0
    if (!on) return;
    av.root.position.set(p.x, p.y + p.jump, p.z);
    av.root.rotation.y = p.yaw;
    const sm = THREE.MathUtils.smoothstep;
    const idle = 1 - sm(p.speed, 0.1, 0.9);
    const run = sm(p.speed, 2.8, 4.6);
    const walk = Math.max(0, 1 - idle - run);
    av.actions.idle.setEffectiveWeight(idle);
    av.actions.walk.setEffectiveWeight(walk);
    av.actions.run.setEffectiveWeight(run);
    // Match the cycle to the ground speed so the feet do not skate
    av.actions.walk.setEffectiveTimeScale(Math.max(0.4, p.speed / 1.5));
    av.actions.run.setEffectiveTimeScale(Math.max(0.6, p.speed / 5.2));
    av.mixer.update(dt);
  }

  placePlayer(x, z) {
    const p = this.colliders.resolve(x, z, 0.45);
    this.player.x = p.x;
    this.player.z = p.z;
    this.player.y = this.builder.groundAt(p.x, p.z);
  }

  // ------------------------------------------------------------------ vehicles

  vehicleMesh(name) {
    const res = this.builder.resolve(name);
    if (!res) return null;
    const mesh = new THREE.Mesh(res.lods[0], this.builder.material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(res.fix);
    mesh.castShadow = true;
    const holder = new THREE.Group();
    holder.add(mesh);
    return holder;
  }

  spawnCar() {
    const L = this.layout;
    const name = L.modern ? 'm_car' : 'caravan';
    if (!this.car) {
      const obj = this.vehicleMesh(name);
      if (!obj) return;
      this.scene.add(obj);
      this.car = { obj, x: 0, y: 0, z: 0, yaw: 0, speed: 0, steer: 0, top: L.modern ? 17 : 7.5, accel: L.modern ? 9 : 4 };
    }
    // Park on the street nearest to where you are
    const from = this.view === 'walk' || this.player ? this.player : { x: 0, z: 0 };
    let best = null;
    let bestD = Infinity;
    for (const line of L.driveGraph.length ? L.driveGraph : L.walkGraph) {
      for (let i = 0; i + 1 < line.pts.length; i++) {
        const a = line.pts[i];
        const d = Math.hypot(a.x - from.x, a.z - from.z);
        if (d < bestD) {
          bestD = d;
          best = { a, b: line.pts[i + 1] };
        }
      }
    }
    const c = this.car;
    if (best) {
      c.x = best.a.x;
      c.z = best.a.z;
      c.yaw = Math.atan2(best.b.x - best.a.x, best.b.z - best.a.z);
    } else {
      c.x = from.x + 3;
      c.z = from.z;
    }
    c.speed = 0;
    c.y = this.builder.groundAt(c.x, c.z);
  }

  /** Cars (modern) or caravans (fantasy) driving the bigger streets. */
  buildTraffic(rng) {
    const L = this.layout;
    const name = L.modern ? 'm_car' : 'caravan';
    const lines = L.driveGraph.filter((l) => l.pts.length >= 2);
    const kinds = Math.max(1, this.builder.variants(name));
    const n = Math.min(L.modern ? 24 : 10, lines.length * 3);
    if (!lines.length || !this.builder.resolve(name)) return;
    // One instanced mesh per model variant; each car keeps its slot in one of them
    this.traffic = { groups: [], cars: [] };
    for (let v = 0; v < kinds; v++) {
      const res = this.builder.resolve(name, v);
      const count = Math.ceil((n - v) / kinds);
      if (!res || count <= 0) continue;
      const inst = new THREE.InstancedMesh(res.lods[1], this.builder.material, count);
      inst.frustumCulled = false;
      inst.castShadow = this.ctx.engine.quality.settings.shadows;
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(inst);
      this.traffic.groups.push({ inst, res, used: 0 });
    }
    for (let i = 0; i < n; i++) {
      const line = lines[i % lines.length];
      const lens = [0];
      for (let k = 1; k < line.pts.length; k++) lens.push(lens[k - 1] + Math.hypot(line.pts[k].x - line.pts[k - 1].x, line.pts[k].z - line.pts[k - 1].z));
      const g = this.traffic.groups[i % this.traffic.groups.length];
      this.traffic.cars.push({ g, slot: g.used++, line, lens, total: lens[lens.length - 1], s: rng() * lens[lens.length - 1], dir: rng() < 0.5 ? 1 : -1, speed: L.modern ? 7 + rng() * 5 : 2.2 + rng() * 1.2, lane: L.modern ? line.w / 4 : 0 });
    }
  }

  updateTraffic(dt) {
    const tr = this.traffic;
    if (!tr) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const one = new THREE.Vector3(1, 1, 1);
    tr.cars.forEach((car, i) => {
      if (car.total < 5) return;
      car.s += car.speed * car.dir * dt;
      if (car.s > car.total || car.s < 0) {
        car.dir *= -1;
        car.s = THREE.MathUtils.clamp(car.s, 0, car.total);
      }
      let k = 1;
      while (k < car.lens.length - 1 && car.lens[k] < car.s) k++;
      const a = car.line.pts[k - 1];
      const b = car.line.pts[k];
      const t = (car.s - car.lens[k - 1]) / (car.lens[k] - car.lens[k - 1] || 1);
      const dx = (b.x - a.x) * car.dir;
      const dz = (b.z - a.z) * car.dir;
      const len = Math.hypot(dx, dz) || 1;
      const x = a.x + (b.x - a.x) * t - (dz / len) * car.lane;
      const z = a.z + (b.z - a.z) * t + (dx / len) * car.lane;
      m.compose(_v.set(x, this.builder.groundAt(x, z), z), q.setFromEuler(e.set(0, Math.atan2(dx, dz), 0)), one).multiply(car.g.res.fix);
      car.g.inst.setMatrixAt(car.slot, m);
    });
    tr.groups.forEach((g) => (g.inst.instanceMatrix.needsUpdate = true));
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
      else if (k === 'escape' && this.view !== 'diorama') this.setView('diorama');
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
    const r = this.colliders.resolve(nx, nz, 0.42);
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

  updateDrive(dt) {
    const c = this.car;
    if (!c) return;
    const i = this.intent();
    const accel = i.forward > 0 ? c.accel * (i.run ? 1.5 : 1) : i.forward < 0 ? (c.speed > 0.5 ? -c.accel * 2.2 : -c.accel * 0.6) : -Math.sign(c.speed) * 2.2;
    c.speed = THREE.MathUtils.clamp(c.speed + accel * dt, -c.top * 0.35, c.top * (i.run ? 1.35 : 1));
    if (!i.forward && Math.abs(c.speed) < 0.3) c.speed = 0;
    c.steer = THREE.MathUtils.lerp(c.steer, -i.right, 1 - Math.exp(-dt * 6));
    c.yaw += c.steer * dt * THREE.MathUtils.clamp(c.speed / 6, -1, 1) * 1.6;
    const nx = c.x + Math.sin(c.yaw) * c.speed * dt;
    const nz = c.z + Math.cos(c.yaw) * c.speed * dt;
    const r = this.colliders.resolve(nx, nz, 1.4);
    const bumped = Math.hypot(r.x - nx, r.z - nz) > 0.05;
    const g = this.builder.heightAt(r.x, r.z);
    if (g > WATER_Y - 0.2 && Math.hypot(r.x, r.z) < DIORAMA_R - 8) {
      c.x = r.x;
      c.z = r.z;
    } else c.speed *= -0.3;
    if (bumped) c.speed *= 0.7;
    // Sit on the ground and pitch with the slope
    const y = this.builder.groundAt(c.x, c.z);
    const ahead = this.builder.groundAt(c.x + Math.sin(c.yaw) * 1.8, c.z + Math.cos(c.yaw) * 1.8);
    const pitch = Math.atan2(ahead - y, 1.8);
    c.y = y;
    c.obj.position.set(c.x, y, c.z);
    c.obj.rotation.set(-pitch, c.yaw, 0, 'YXZ');
  }

  updateFollowCamera(dt, target, height) {
    const f = this.follow;
    const t = this.ctx.engine.time;
    // Swing back behind the direction of travel when the player lets go of the camera
    const heading = this.view === 'drive' ? this.car.yaw : this.player.yaw;
    const moving = this.view === 'drive' ? Math.abs(this.car.speed) > 1 : this.player.speed > 0.5;
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
      this.updateWalk(dt);
      this.updateFollowCamera(dt, this.player, 1.6);
    } else if (this.view === 'drive') {
      this.updateDrive(dt);
      this.updateFollowCamera(dt, this.car, 2.2);
    }
    const cam = this.camera.position;
    const near = (x, z) => Math.hypot(x - cam.x, z - cam.z) < 260 + cam.y;
    this.walkers.update(dt, near);
    if (this.avatar) this.player.visible = false;
    this.crowd.pose();
    this.updateAvatar(dt);
    this.updateTraffic(dt);
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

    // Fog: from the table the world's edge melts into haze; at street level the horizon opens up
    const street = this.view !== 'diorama' && !this.tween ? 1 : 0;
    this.fogBlend += (street - this.fogBlend) * (1 - Math.exp(-dt * 2));
    const camDist = this.camera.position.distanceTo(this.orbit.target);
    const fog = this.scene.fog;
    fog.color.copy(L.fog);
    fog.near = THREE.MathUtils.lerp(camDist * 0.95, 260, this.fogBlend);
    fog.far = THREE.MathUtils.lerp(camDist + DIORAMA_R * 1.05, 3900, this.fogBlend);

    // Shadow box on the point of interest, snapped to whole shadow texels so it does not shimmer
    const focus = this.view === 'walk' ? this.player : this.view === 'drive' && this.car ? this.car : this.orbit.target;
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
    this.ctx.engine.renderer.render(this.scene, this.camera);
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
    this.avatar?.materials.forEach((m) => m.dispose());
    this.avatar?.mixer.stopAllAction();
    this.traffic?.groups.forEach((g) => g.inst.dispose());
    this.sky.dispose();
    this.ctx.engine.renderer.shadowMap.enabled = false;
    this.sun.shadow.map?.dispose();
    this.scene = null;
  }
}
