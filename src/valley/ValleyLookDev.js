import * as THREE from 'three';
import layout from './world/layout.json';
import PALETTE from './valleyPalette.json';
import { buildHeightField, padDistance } from './world/valleyGround.js';
import { buildTerrain } from './world/terrain.js';
import { buildGrass } from './world/grass.js';
import { loadKit, mergeKit, kitTriangles, LodInstances, ShakeInstances } from './world/kit.js';
import { buildWater } from './world/water.js';
import { scatterRules, solidsOf, insideSolid } from './world/scatter.js';
import { loadActors, makeActor, animateActor, disposeActor } from './world/actors.js';
import { Villagers } from './world/villagers.js';
import { ValleySky } from './render/valleySky.js';
import { ValleyCamera } from './render/valleyCamera.js';
import { valleyUniforms } from './render/valleyMaterial.js';
import { FieldState } from './world/fieldState.js';
import { FieldView } from './world/fieldView.js';
import { Effects } from './world/effects.js';
import { Pickups } from './world/pickups.js';
import { FarmActions } from './play/farmActions.js';
import { loadAnimals, Animal } from './world/animals.js';
import { Icons } from './world/icons.js';
import { BlobShadows } from './world/blobShadows.js';
import { ASSETS } from '../render/assetManifest.js';

// farm.html look-dev scene (docs/FARM_PLAN.md, milestones V0-V3): the hand-composed valley,
// painted ground, rule-based grass, the semi-chibi player and villagers on the townsfolk rig
// (world/actors.js), the 3/4 follow camera (orbit, pan, zoom, quarter-turn snaps;
// render/valleyCamera.js), the four times of day, and the player's hands: tools on the field,
// lifting and throwing, shaking trees (play/farmActions.js).
// Runs as an engine mode (update/render/resize).

const LOOK = {
  // Bright and soft like the reference: a gentle glow on highlights, a touch more saturation
  bloom: { strength: 0.27, radius: 0.55, threshold: 0.86 },
  grade: { saturation: 1.1, contrast: 1.02, gain: [1.02, 1.005, 0.98], vignette: 0.2 },
  // Neutral tone mapping keeps the painted palette close to its values (as the interior look does)
  toneMapping: THREE.NeutralToneMapping,
  exposure: 1
};
const WALK = 2.1, RUN = 4.2; // a 0.58 m leg: brisk Harvest Moon steps, not an adult's stride
const CARRY = 0.72; // slower with a load over the head

export class ValleyLookDev {
  constructor(engine, ui = {}) {
    this.engine = engine;
    this.ui = ui;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.3, 1200);
    this.keys = new Set();
    this.disposables = [];
    const shadows = engine.quality.settings.shadows;
    engine.renderer.shadowMap.enabled = shadows;
    engine.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.sky = new ValleySky(this.scene, { shadows, mapSize: engine.quality.tier === 'high' ? 4096 : 2048 });
  }

  async enter({ time = 'pagi', crowd = 0, season = 'semi' } = {}) {
    const t0 = performance.now();
    this.engine.post.configure(LOOK, { boost: 0 });
    const [kit, templates, animalTemplates] = await Promise.all([loadKit(ASSETS.valleyKit), loadActors(ASSETS.valleyActors), loadAnimals(ASSETS.valleyAnimals)]);
    this.animalTemplates = animalTemplates;
    this.kit = kit;
    this.templates = templates;
    const tier = this.engine.quality.tier;
    this.ground = buildHeightField(layout);
    this.planObjects();
    this.terrain = buildTerrain(this.ground, layout, { mapSize: tier === 'low' ? 1024 : 2048, objects: this.objects });
    this.scene.add(this.terrain.mesh);
    this.disposables.push(this.terrain.mesh.geometry, this.terrain.mesh.material, this.terrain.map);

    const water = buildWater(this.ground);
    this.scene.add(water);
    this.disposables.push(water.geometry, water.material);

    this.placeKit();
    const counts = { high: [16000, 700], medium: [11000, 500], low: [6000, 300] }[tier];
    this.grass = buildGrass(this.ground, layout, this.terrain, { count: counts[0], flowers: counts[1], solids: this.solids });
    this.scene.add(this.grass.group);

    const shadows = this.engine.quality.settings.shadows;
    this.player = makeActor(templates, 'player', { shadows });
    this.figure = this.player.root;
    this.figure.position.set(layout.spawn[0], this.ground.heightAt(...layout.spawn), layout.spawn[1]);
    this.scene.add(this.figure);
    this.villagers = new Villagers(templates, this.ground, (x, z) => this.walkable(x, z), { extra: crowd, shadows, layout });
    this.scene.add(this.villagers.group);
    // Buildings stop the camera: inside a footprint and below the ridge
    const walls = this.solids.filter((o) => o.kind === 'rect');
    const blocked = (x, y, z) => walls.some((w) => y < this.ground.heightAt(w.x, w.z) + w.h && padDistance(w, x, z) < 0.2);
    this.cam = new ValleyCamera(this.camera, this.engine.renderer.domElement, this.ground.heightAt, blocked);
    this.cam.settle(this.figure.position);
    this.setupHands();

    this.sky.set(time, { instant: true });
    this.villagers.setTime(time);
    this.villagers.settle();
    this.bindInput();
    this.ambientWait = 0;
    this.stats = {
      build: Math.round(performance.now() - t0), tufts: this.grass.tufts, flowers: this.grass.flowers, kit: this.kitStats,
      actors: 1 + this.villagers.list.length, animals: this.animals.length, actorTriangles: Object.fromEntries(Object.entries(templates).map(([k, t]) => [k, t.triangles]))
    };
    this.setSeason(PALETTE.seasons[season] ? season : 'semi');
  }

  /**
   * Layout objects, the square's contents (if it was placed), rule-based scatter, planned
   * bridges, fences along their lines, stepping stones, crops; one instanced batch per asset,
   * near/far batches for trees.
   */
  placeKit() {
    const ground = this.ground, byAsset = {};
    const push = (asset, x, y, z, rotY = 0, s = 1, sx = s) => {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rotY), new THREE.Vector3(sx, s, s));
      (byAsset[asset] ??= []).push(m);
    };
    for (const o of this.objects) {
      const rot = THREE.MathUtils.degToRad(o.rot || 0), s = o.s || 1;
      // Pads carry the kit; anything else sits on the lowest ground under its base, sunk a little
      let y;
      if (o.pad) y = ground.pads.get(o.pad).y;
      else {
        const r = o.kit.startsWith('tree_') ? 0.45 * s : 0.3 * s;
        y = Math.min(...[[r, 0], [-r, 0], [0, r], [0, -r], [0, 0]].map(([dx, dz]) => ground.heightAt(o.x + dx, o.z + dz))) - 0.06;
      }
      push(o.kit, o.x, y, o.z, rot, s);
    }
    for (const f of layout.fences) {
      for (let i = 1; i < f.points.length; i++) {
        const [ax, az] = f.points[i - 1], [bx, bz] = f.points[i];
        const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 2));
        const rot = Math.atan2(-(bz - az), bx - ax);
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
          push('fence', x, ground.heightAt(x, z) - 0.04, z, rot, 1, len / n / 2);
        }
      }
    }
    layout.steps.forEach(([x, z], i) => push('stepping_stone', x, ground.heightAt(x, z) + 0.01, z, i * 1.3, 0.9 + (i % 3) * 0.1));
    // Bridges: the prefab spans its local +x; the plan's rot turns +x across the flow
    for (const b of ground.bridges) push(`bridge_${b.span}`, b.x, b.y, b.z, -THREE.MathUtils.degToRad(b.rot));
    // Trees swap near/far models as the view moves, bushes can be shaken; the rest is static and merged
    this.kitStats = {};
    this.lods = [];
    this.bushes = [];
    const statics = {};
    for (const [asset, matrices] of Object.entries(byAsset)) {
      if (this.kit[`${asset}_far`]) {
        const lod = new LodInstances(this.kit, asset, matrices);
        this.lods.push(lod);
        this.scene.add(lod.group);
      } else if (asset.startsWith('bush')) {
        const bushes = new ShakeInstances(this.kit, asset, matrices);
        this.bushes.push(bushes);
        this.scene.add(bushes.group);
      } else statics[asset] = matrices;
      this.kitStats[asset] = { count: matrices.length, triangles: kitTriangles(this.kit, asset) };
    }
    this.statics = mergeKit(this.kit, statics);
    this.scene.add(this.statics);
    for (const mesh of this.statics.children) this.disposables.push(mesh.geometry);
  }

  /** The field, its look, effects, pickups and the player's actions (V3). */
  setupHands() {
    const field = layout.fields[0];
    this.field = new FieldState(field, { planted: layout.planted });
    this.fieldView = new FieldView(this.field, this.ground, this.kit);
    this.scene.add(this.fieldView.group);
    this.effects = new Effects();
    this.scene.add(this.effects.mesh);
    const bin = layout.objects.find((o) => o.kit === 'shipping_bin');
    this.pickups = new Pickups(this.kit, this.ground, {
      solids: this.solids, effects: this.effects,
      bin: bin && { x: bin.x, z: bin.z, w: 1.5, d: 1.1, rot: THREE.MathUtils.degToRad(bin.rot || 0), top: this.ground.heightAt(bin.x, bin.z) + 0.8 }
    });
    this.scene.add(this.pickups.group);
    // Things lying about to pick up: stones by the house, logs by the woodpile, apples under the trees
    for (const [x, z] of [[-4.2, -3.6], [-3.1, -1.9], [-8.6, -1.2]]) this.pickups.spawn('stone_small', x, z);
    for (const [x, z] of [[-8.7, -13.2], [-11.2, -12.6]]) this.pickups.spawn('log', x, z);
    for (const o of layout.objects.filter((o) => o.kit === 'tree_apple')) this.pickups.spawn('apple', o.x + 1.1, o.z + 0.6);
    // Animals: three hens by the coop, the cow in front of the barn, the dog by the house
    this.icons = new Icons(this.scene);
    const shadows = this.engine.quality.settings.shadows;
    const coop = layout.objects.find((o) => o.kit === 'coop'), barn = layout.objects.find((o) => o.kit === 'barn');
    this.animals = [
      ...[0, 1, 2].map((k) => new Animal(this.animalTemplates, 'chicken', [coop.x + 1.5, coop.z + 3.5], { shadows, seed: k + 1 })),
      new Animal(this.animalTemplates, 'cow', [barn.x, barn.z + 6.5], { shadows, seed: 11 }),
      new Animal(this.animalTemplates, 'dog', [-3, -5], { shadows, seed: 21 })
    ];
    this.animals.forEach((a, k) => {
      const [x, z] = a.home;
      a.root.position.set(x + (k % 3) * 0.6 - 0.6, this.ground.surfaceAt(x, z), z + (k % 2) * 0.5);
      this.scene.add(a.root);
      if (a.species === 'chicken') this.pickups.adopt('chicken', a);
    });
    this.chickens = this.animals.filter((a) => a.species === 'chicken');
    this.blobs = new BlobShadows();
    this.scene.add(this.blobs.mesh);
    this.actions = new FarmActions({
      player: this.player, kit: this.kit, field: this.field, fieldView: this.fieldView, pickups: this.pickups, effects: this.effects,
      trees: this.lods, bushes: this.bushes, animals: this.animals, villagers: this.villagers, icons: this.icons,
      onTalk: (v, text) => this.say(v, text, 3.6)
    });
  }

  /** A speech balloon over a villager for a few seconds (drawn by the page, see ui.balloon). */
  say(v, text, seconds = 2.6) {
    if (!text) return;
    this.balloon = { v, text, until: this.clock + seconds };
  }

  /** Everything placed: layout objects, the square's contents, rule-based scatter; and what is solid. */
  planObjects() {
    const objects = [...layout.objects, ...this.ground.featureObjects];
    this.scattered = scatterRules(this.ground, layout, objects);
    objects.push(...this.scattered);
    this.objects = objects;
    this.solids = solidsOf(objects);
  }

  bindInput() {
    const down = (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const k = e.key.toLowerCase();
      if (k === 'z') this.rotate(-1);
      else if (k === 'c') this.rotate(1);
      else if (k === 'f') this.cam.recenter();
      else if (/^[1-3]$/.test(k)) this.actions.setTool(Number(k) - 1);
      else if (k === ' ') { e.preventDefault(); this.actions.useTool(); }
      else if (k === 'e') this.actions.interact();
      else if (k === 'y') {
        const names = Object.keys(PALETTE.seasons);
        this.setSeason(names[(names.indexOf(this.season) + 1) % names.length]);
      } else if (k === 't') {
        const names = Object.keys(PALETTE.times);
        this.setTime(names[(names.indexOf(this.sky.name) + 1) % names.length]);
      } else this.keys.add(k);
    };
    const up = (e) => this.keys.delete(e.key.toLowerCase());
    const blur = () => this.keys.clear();
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    addEventListener('blur', blur);
    this.unbind = () => {
      removeEventListener('keydown', down);
      removeEventListener('keyup', up);
      removeEventListener('blur', blur);
      this.cam.unbind();
    };
  }

  /** Switch season (V5): palette tokens only — snow, leaf colour, blossom, grass, ground, flowers, sky, air. */
  setSeason(name) {
    const S = PALETTE.seasons[name];
    if (!S) return;
    this.season = name;
    const u = valleyUniforms;
    u.uSnow.value = S.snow;
    u.uFoliageColor.value.set(S.foliage.color);
    u.uFoliageMix.value = S.foliage.mix;
    u.uBlossom.value = S.blossom;
    u.uGrassHeight.value = S.grassHeight;
    this.terrain.repaint(S.surface);
    this.stats.flowers = this.grass.setSeason(S, this.terrain);
    this.sky.setSeason(S.sky);
    this.villagers.season = name;
    this.ui.onView?.(this);
  }

  /** The season's air around the view: petals, autumn leaves, snow; fireflies on summer nights. */
  ambient(dt) {
    const kind = PALETTE.seasons[this.season]?.particles;
    if (!kind || (kind === 'firefly' && this.sky.name !== 'malam')) return;
    const rate = { petal: 6, autumnLeaf: 5, snow: 26, firefly: 4 }[kind];
    this.ambientWait -= dt * rate;
    const wind = valleyUniforms.uWind.value;
    while (this.ambientWait < 0) {
      this.ambientWait += 1;
      const a = Math.random() * Math.PI * 2, r = Math.random() * 16, look = this.cam.look;
      const x = look.x + Math.cos(a) * r, z = look.z + Math.sin(a) * r;
      const y = kind === 'firefly' ? this.ground.heightAt(x, z) + 0.4 + Math.random() * 1.2 : look.y + 4 + Math.random() * 5;
      this.effects.burst(kind, new THREE.Vector3(x, y, z), 1, { dir: new THREE.Vector3(wind.x, -0.2, wind.y), speed: kind === 'firefly' ? 0.15 : 0.7, spread: 0.6 });
    }
  }

  /** Snap the camera yaw by quarter turns. */
  rotate(dir) {
    this.cam.snap(dir);
    this.ui.onView?.(this);
  }

  setTime(name) {
    if (!PALETTE.times[name]) return;
    this.sky.set(name);
    if (this.villagers && this.villagers.time !== name) this.villagers.setTime(name);
    this.ui.onView?.(this);
  }

  update(dt, t) {
    valleyUniforms.uTime.value = t;
    this.clock = t;
    const speed = this.moveFigure(dt), moving = speed > 0;
    this.playerSpeed = speed;
    this.actions.update(dt);
    this.villagers.update(dt, { frozen: this.frozen, player: this.figure.position, onGreet: (v, text) => this.say(v, text) });
    const world = {
      ground: this.ground, walkable: (x, z) => this.walkable(x, z), icons: this.icons, chickens: this.chickens, night: this.sky.name === 'malam',
      player: { p: this.figure.position, speed, seeds: this.actions.tool === 2 && !this.actions.carrying }
    };
    if (!this.frozen) for (const a of this.animals) a.update(dt, world);
    this.icons.update(dt);
    this.ambient(dt);
    this.updateBalloon();
    this.blobs.update(this.blobTargets(), this.ground.surfaceAt);
    this.pickups.update(dt);
    this.effects.update(dt);
    this.fieldView.update(dt, this.field.update(dt));
    this.fieldView.showCursor(this.actions.carrying ? null : this.actions.targetCell(), t);
    for (const b of this.bushes) b.animate(dt);
    for (const lod of this.lods) lod.animate(dt);
    this.updatePushers();
    this.cam.update(dt, this.figure.position, moving);
    this.sky.update(dt, this.cam.look);
    for (const lod of this.lods) lod.update(dt, this.cam.look);
    this.sky.dome.position.copy(this.camera.position);
    this.engine.post.setBoost(valleyUniforms.uNight.value * 0.25);
  }

  /** Who gets a contact shadow: people, animals, anything lying about or flying. */
  blobTargets() {
    const out = [{ object: this.player.root, radius: 0.32 }];
    for (const v of this.villagers.list) out.push({ object: v.p.root, radius: 0.3 * v.p.root.scale.x });
    for (const a of this.animals) out.push({ object: a.root, radius: { chicken: 0.2, cow: 0.75, dog: 0.3 }[a.species] });
    for (const it of this.pickups.items) if (!it.animal && it.state !== 'gone') out.push({ object: it.mesh, radius: it.r * 1.4 });
    return out;
  }

  updateBalloon() {
    const b = this.balloon;
    if (!b || this.clock > b.until || !b.v.p.root.visible) {
      this.balloon = null;
      this.ui.balloon?.(null);
      return;
    }
    const head = new THREE.Vector3();
    b.v.p.bones.head.node.getWorldPosition(head);
    head.y += 0.55;
    head.project(this.camera);
    const { width, height } = this.engine.size;
    this.ui.balloon?.(b.text, ((head.x + 1) / 2) * width, ((1 - head.y) / 2) * height, b.v.look);
  }

  /** Feet and flying things that push the grass aside (valleyUniforms.uPushers). */
  updatePushers() {
    const out = valleyUniforms.uPushers.value;
    const list = [this.player.root.position, ...this.villagers.list.filter((v) => v.p.root.visible).map((v) => v.p.root.position), ...this.animals.map((a) => a.root.position)];
    let n = 0;
    for (const p of list) if (n < 6) out[n++].set(p.x, p.z, 0.55, 1);
    for (const it of this.pickups.items) if (n < 8 && it.state === 'flying') out[n++].set(it.p.x, it.p.z, 0.4, 1);
    for (; n < 8; n++) out[n].set(0, 0, 0, 0);
  }

  moveFigure(dt) {
    const k = this.keys;
    const ix = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    const iz = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0);
    let speed = 0, turn = 0;
    if ((ix || iz) && !this.actions?.locked) {
      const yaw = this.cam.yaw, len = Math.hypot(ix, iz); // relative to the view, wherever it is turned
      const mx = (ix * Math.cos(yaw) + iz * Math.sin(yaw)) / len, mz = (-ix * Math.sin(yaw) + iz * Math.cos(yaw)) / len;
      speed = (k.has('shift') ? RUN : WALK) * (this.actions?.carrying ? CARRY : 1);
      const p = this.figure.position, nx = p.x + mx * speed * dt, nz = p.z + mz * speed * dt;
      if (this.walkable(nx, nz)) p.set(nx, p.y, nz);
      else if (this.walkable(nx, p.z)) p.x = nx;
      else if (this.walkable(p.x, nz)) p.z = nz;
      const face = Math.atan2(mx, mz);
      let delta = face - this.figure.rotation.y;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      turn = delta * (1 - Math.exp(-dt * 12));
      this.figure.rotation.y += turn;
    }
    animateActor(this.player, dt, speed, { turn: dt > 0 ? turn / dt : 0 });
    const p = this.figure.position;
    p.y = this.ground.surfaceAt(p.x, p.z);
    return speed;
  }

  walkable(x, z) {
    if (Math.abs(x) > 52 || Math.abs(z) > 52) return false;
    // The deck carries you over the water; otherwise stay out of the river
    if (!this.ground.deckAt(x, z) && this.ground.heightAt(x, z) < layout.water + 0.15) return false;
    return !insideSolid(this.solids, x, z, 0.25);
  }

  /** Turnaround for review: the four looks in a row at `at`, facing +Z, routines paused. */
  lineup(at = layout.spawn, face = 'neutral') {
    this.frozen = true;
    const actors = [this.player, ...this.villagers.list.slice(0, 3).map((v) => v.p)];
    actors.forEach((p, i) => {
      const x = at[0] + (i - 1.5) * 0.85, z = at[1];
      p.root.position.set(x, this.ground.heightAt(x, z), z);
      p.root.rotation.y = 0;
      p.mood = face;
      p.face.current = '';
      p.face.blink = 1e9; // no blinks mid-capture
      p.face.closed = 0;
      p.look.toYaw = p.look.yaw = p.look.toPitch = p.look.pitch = 0;
      p.look.next = 1e9;
    });
    return actors;
  }

  /** The quality governor reports frame time; kept for the budget check. */
  adaptQuality(info) {
    this.perf = info;
    return false;
  }

  render() {
    // Count the scene and the post passes of this frame, not just the last draw call
    const info = this.engine.renderer.info;
    info.autoReset = false;
    info.reset();
    this.engine.draw(this.scene, this.camera);
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  exit() {
    this.engine.renderer.info.autoReset = true;
    this.unbind?.();
    this.grass?.dispose();
    this.villagers?.dispose();
    if (this.player) disposeActor(this.player);
    this.sky.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
