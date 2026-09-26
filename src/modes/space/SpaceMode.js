import * as THREE from 'three';
import { createSpaceBackdrop } from '../../render/spaceBackdrop.js';
import { loadAssetPack } from '../../render/assetLibrary.js';
import { bakeSystem } from './bake.js';
import { SystemBodies } from './bodies.js';
import { Ship, SHIPS, proceduralShipGeometry } from './ship.js';
import { SpaceTraffic } from './traffic.js';
import { SpaceHud } from './hud.js';

// Star-system mode. The ship flies freely (WASD) or by autopilot (click a
// planet); from orbit it can land, which hands the exact camera view over to
// the planet mode so the swap reads as one continuous descent.

const SPACE_PACK_URL = `${import.meta.env.BASE_URL}models/space.glb`;
let shipPack = null;
const loadShipPack = () => (shipPack ||= loadAssetPack(SPACE_PACK_URL).catch(() => null));

const UP = new THREE.Vector3(0, 1, 0);
const SHIP_KEY = 'planet_globe_ship';
const savedShip = () => {
  try {
    return SHIPS[localStorage.getItem(SHIP_KEY)] ? localStorage.getItem(SHIP_KEY) : 'frigate';
  } catch {
    return 'frigate';
  }
};
const LAND_FOV = 42; // the planet view's field of view
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/** Rotate unit vector a toward unit vector b by fraction t (great-circle). */
function slerpDir(a, b, t, out) {
  const axis = _v3.crossVectors(a, b);
  const ang = a.angleTo(b);
  if (axis.lengthSq() < 1e-10) return out.copy(a).lerp(b, t).normalize();
  return out.copy(a).applyAxisAngle(axis.normalize(), ang * t);
}

export default class SpaceMode {
  static prepare(ctx) {
    return Promise.all([bakeSystem(ctx.world, (f) => ctx.overlay.setProgress(f, 'Menyiapkan tata surya')), loadShipPack()]);
  }

  constructor(ctx, route, arrival) {
    this.ctx = ctx;
    this.route = route;
    this.arrival = arrival;
    this.keys = new Set();
    this.mapMode = false;
    this.sequence = null;
    this.orbiting = null;
    this.selected = null;
    this.rig = { az: 0, polar: 1.18, dist: 4.2, mapScale: 1, lastInput: -10, look: new THREE.Vector3() };
  }

  async enter() {
    const { engine, world } = this.ctx;
    this.system = world.system;
    const [baked, pack] = await Promise.all([bakeSystem(world), loadShipPack()]);
    const { width, height } = engine.size;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, width / height, 0.05, 6000);
    this.scene.add(this.camera);

    const backdrop = createSpaceBackdrop({ radius: 2400, pixelRatio: engine.renderer.getPixelRatio(), count: 4200, texWidth: 1024 });
    this.backdrop = backdrop;
    this.scene.add(backdrop.nebula, backdrop.stars);

    this.bodies = new SystemBodies(this.system, baked, engine.quality);
    this.scene.add(this.bodies.group);
    this.bodies.update(0, world.now(), engine.time);

    this.pack = pack;
    this.shipKey = savedShip();
    this.ship = this.makeShip(this.shipKey);
    this.scene.add(this.ship.object);
    this.traffic = new SpaceTraffic(this, pack, { count: engine.quality.tier === 'low' ? 3 : 6, seed: this.system.seed });
    this.scene.add(this.traffic.group);
    this.buildStreaks();

    this.ui = document.getElementById('spaceUi');
    this.hud = new SpaceHud(this.ui, {
      system: this.system,
      quality: engine.quality,
      on: {
        select: (i, { fly } = {}) => this.select(i, fly),
        fly: (i) => this.flyToPlanet(i),
        land: (i) => this.land(i),
        toggleMap: () => this.setMap(!this.mapMode),
        hangar: () => this.hud.showHangar(SHIPS, this.shipKey),
        pickShip: (key) => this.swapShip(key)
      }
    });
    this.ui.hidden = false;
    document.body.dataset.mode = 'space';
    this.bindInput();

    const a = this.arrival;
    if (a?.dir) this.placeForTakeoff(a);
    else this.park(this.route.planet ?? world.homeIndex, true);
    this.maxOrbit = Math.max(...this.system.planets.map((p) => p.orbit));
  }

  arrived() {
    if (this.sequence?.kind === 'hold') this.sequence.release = true;
  }

  // ------------------------------------------------------------------ ships

  makeShip(key) {
    const cfg = SHIPS[key] || SHIPS.frigate;
    const own = !this.pack?.[cfg.asset];
    const lods = own ? [proceduralShipGeometry()] : [0, 1, 2].map((i) => this.pack[cfg.asset][i]);
    const ship = new Ship(lods, cfg);
    ship.ownsGeometry = own;
    return ship;
  }

  /** Hangar: swap to another ship in place (same position, speed and autopilot). */
  swapShip(key) {
    if (this.sequence || key === this.shipKey) return;
    const old = this.ship;
    const ship = this.makeShip(key);
    ship.position.copy(old.position);
    ship.velocity.copy(old.velocity);
    ship.yaw = old.yaw;
    ship.pitch = old.pitch;
    ship.autopilot = old.autopilot;
    this.scene.remove(old.object);
    this.disposeShip(old);
    this.scene.add(ship.object);
    this.ship = ship;
    this.shipKey = key;
    this.ctx.missions?.emit('hangar');
    try {
      localStorage.setItem(SHIP_KEY, key);
    } catch {
      /* optional */
    }
    this.hud.showHangar(SHIPS, key);
  }

  disposeShip(ship) {
    if (ship.ownsGeometry) ship.geometries.forEach((g) => g.dispose());
    ship.dispose();
  }

  // ------------------------------------------------------------------ planets

  planet(i) {
    return this.bodies.planets[i];
  }

  planetVelocity(i, out = new THREE.Vector3()) {
    const pl = this.planet(i);
    const p = pl.def;
    return out.set(-Math.sin(pl.angle), 0, Math.cos(pl.angle)).multiplyScalar(p.orbit * p.orbitSpeed);
  }

  /** Parking spot: on the sunlit side, a bit ahead, outside rings and moons. */
  parkOffset(i, out = new THREE.Vector3()) {
    const pl = this.planet(i);
    const p = pl.def;
    const toSun = _v.copy(pl.holder.position).negate().normalize();
    toSun.applyAxisAngle(UP, 0.75);
    toSun.y = 0.22;
    const reach = p.ring ? p.ring.outer * 1.25 : p.radius * 3.1 + 2.2;
    return out.copy(toSun).normalize().multiplyScalar(reach);
  }

  parkPoint(i, out = new THREE.Vector3()) {
    return this.parkOffset(i, out).add(this.planet(i).holder.position);
  }

  /** Target point that detours around the star instead of through it. */
  routeTo(target) {
    return this.routeToFrom(this.ship.position, target);
  }

  routeToFrom(P, target) {
    const d = _v2.copy(target).sub(P);
    const len2 = d.lengthSq() || 1;
    const t = THREE.MathUtils.clamp(-P.dot(d) / len2, 0, 1);
    const closest = _v3.copy(P).addScaledVector(d, t);
    const keep = this.system.star.radius * 3.2;
    if (closest.length() < keep && t > 0 && t < 1) {
      if (closest.lengthSq() < 1) closest.set(0, 1, 0);
      return closest.setLength(keep * 1.25).clone();
    }
    return target.clone();
  }

  park(i, instant = false) {
    this.selected = i;
    this.bodies.highlightOrbit(i);
    if (instant) {
      this.ship.position.copy(this.parkPoint(i));
      this.ship.velocity.copy(this.planetVelocity(i));
      const look = _v.copy(this.planet(i).holder.position).sub(this.ship.position);
      this.ship.yaw = Math.atan2(look.x, look.z);
      this.ship.pitch = 0;
      this.snapCamera();
    }
    this.orbiting = null;
    this.ship.flyTo({
      target: () => this.routeTo(this.parkPoint(i)),
      velocity: () => this.planetVelocity(i),
      look: () => this.planet(i).holder.position,
      onArrive: () => {
        this.enterOrbit(i);
        this.refreshCard();
      },
      onCancel: () => {
        this.orbiting = null;
        this.refreshCard();
      }
    });
    if (instant) {
      this.ship.autopilot.arrived = true;
      this.orbiting = i;
    }
    this.refreshCard();
  }

  select(i, fly = false) {
    if (i === null || i === undefined) {
      this.selected = null;
      this.bodies.highlightOrbit(-1);
      this.hud.showCard(null, {});
      return;
    }
    this.selected = i;
    this.bodies.highlightOrbit(i);
    if (fly && this.orbiting !== i) this.flyToPlanet(i);
    else this.refreshCard();
  }

  flyToPlanet(i) {
    if (this.sequence) return;
    this.park(i);
  }

  refreshCard() {
    if (this.selected === null || this.selected === undefined) return;
    const p = this.system.planets[this.selected];
    let cities = 0;
    if (p.inhabited) cities = this.ctx.world.mapFor(p.index)?.cities?.length ?? 0;
    this.hud.showCard(p, { orbiting: this.orbiting === p.index, cities });
  }

  /** Parked in orbit around planet i (the pilot mission counts distinct planets). */
  enterOrbit(i) {
    this.orbiting = i;
    this.ctx.missions?.emit('orbit', i);
  }

  land(i) {
    this.ctx.director.go({ mode: 'planet', planet: i });
  }

  // ------------------------------------------------------------------ input

  bindInput() {
    const canvas = this.ctx.engine.renderer.domElement;
    this.onKeyDown = (e) => {
      if (e.target.matches?.('input, textarea')) return;
      const k = e.key.toLowerCase();
      if (k === 'm') this.setMap(!this.mapMode);
      else if (k === 'l' && this.orbiting !== null && this.system.planets[this.orbiting].landable) this.land(this.orbiting);
      else if (k === 'escape') {
        if (this.mapMode) this.setMap(false);
        else this.select(null);
      } else this.keys.add(k === 'shift' ? 'shift' : k);
    };
    this.onKeyUp = (e) => this.keys.delete(e.key.toLowerCase() === 'shift' ? 'shift' : e.key.toLowerCase());
    this.onBlur = () => this.keys.clear();
    this.onPointerDown = (e) => {
      this.drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, id: e.pointerId };
      canvas.setPointerCapture?.(e.pointerId);
    };
    this.onPointerMove = (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      this.rig.az -= dx * 0.006;
      this.rig.polar = THREE.MathUtils.clamp(this.rig.polar - dy * 0.005, 0.25, 2.7);
      this.rig.lastInput = this.ctx.engine.time;
    };
    this.onPointerUp = (e) => {
      const d = this.drag;
      this.drag = null;
      if (!d || Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 5 || this.sequence) return;
      const hit = this.pick(e.clientX, e.clientY);
      if (hit !== null) this.select(hit, true);
    };
    this.onWheel = (e) => {
      e.preventDefault();
      const f = Math.exp(e.deltaY * 0.0012);
      if (this.mapMode) this.rig.mapScale = THREE.MathUtils.clamp(this.rig.mapScale * f, 0.25, 1.6);
      else this.rig.dist = THREE.MathUtils.clamp(this.rig.dist * f, 1.6, 40);
    };
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  unbindInput() {
    const canvas = this.ctx.engine.renderer.domElement;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('wheel', this.onWheel);
  }

  input() {
    const k = this.keys;
    const axis = (a, b) => (k.has(a) ? 1 : 0) - (k.has(b) ? 1 : 0);
    return {
      forward: axis('w', 's') || axis('arrowup', 'arrowdown'),
      turn: axis('d', 'a') || axis('arrowright', 'arrowleft'),
      lift: axis('r', 'f'),
      strafe: axis('e', 'q'),
      boost: k.has('shift')
    };
  }

  /** Planet nearest the cursor on screen (planets are too small to raycast from afar). */
  pick(x, y) {
    const { width, height } = this.ctx.engine.size;
    const rect = this.ctx.engine.renderer.domElement.getBoundingClientRect();
    let best = null;
    let bestD = Infinity;
    const pxPerUnit = height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    for (const pl of this.bodies.planets) {
      const p = _v.copy(pl.holder.position);
      const dist = p.distanceTo(this.camera.position);
      p.project(this.camera);
      if (p.z > 1) continue;
      const sx = rect.left + ((p.x + 1) / 2) * width;
      const sy = rect.top + ((1 - p.y) / 2) * height;
      const r = (pl.def.radius / dist) * pxPerUnit + 18;
      const d = Math.hypot(sx - x, sy - y);
      if (d < r && d < bestD) {
        best = pl.def.index;
        bestD = d;
      }
    }
    return best;
  }

  setMap(on) {
    if (this.sequence) return;
    this.mapMode = on;
    this.hud.setMap(on);
    this.bodies.planets.forEach((pl) => (pl.orbitLine.material.opacity = on ? (pl.def.index === this.selected ? 0.8 : 0.35) : pl.def.index === this.selected ? 0.55 : 0.16));
  }

  // ------------------------------------------------------------------ camera

  chasePose(outPos, outLook) {
    const ship = this.ship;
    const target = _v.copy(ship.position).addScaledVector(UP, 0.25);
    const az = ship.yaw + Math.PI + this.rig.az;
    const polar = this.rig.polar;
    const d = this.rig.dist;
    outPos.set(Math.sin(polar) * Math.sin(az), Math.cos(polar), Math.sin(polar) * Math.cos(az)).multiplyScalar(d).add(target);
    outLook.copy(target).addScaledVector(ship.forward(_v2), 1.5);
    return outPos;
  }

  snapCamera() {
    this.chasePose(this.camera.position, this.rig.look);
    this.camera.up.copy(UP);
    this.camera.lookAt(this.rig.look);
  }

  updateCamera(dt, t) {
    const cam = this.camera;
    const pos = new THREE.Vector3();
    const look = new THREE.Vector3();
    if (this.mapMode) {
      const h = this.maxOrbit * 1.5 * this.rig.mapScale;
      pos.set(0, h, h * 0.62);
      look.set(0, 0, 0);
    } else {
      // Drift back behind the ship once the player stops orbiting the camera
      if (t - this.rig.lastInput > 2.5 && this.ship.speed > 3) {
        this.rig.az *= Math.exp(-dt * 1.2);
        this.rig.polar += (1.18 - this.rig.polar) * (1 - Math.exp(-dt * 1.2));
      }
      this.chasePose(pos, look);
    }
    // A little lag behind the ship: speed and turns show in the framing
    const k = 1 - Math.exp(-dt * (this.mapMode ? 3 : 5.5));
    cam.position.lerp(pos, k);
    this.rig.look.lerp(look, 1 - Math.exp(-dt * 9));
    cam.up.copy(UP);
    cam.lookAt(this.rig.look);
    const boost = this.ship.boostFx || 0;
    if (boost > 0.6 && !this.boosted) {
      this.boosted = true;
      this.ctx.missions?.emit('boost');
    }
    if (boost > 0.05 && !this.mapMode) {
      cam.position.x += (Math.random() - 0.5) * boost * 0.05;
      cam.position.y += (Math.random() - 0.5) * boost * 0.05;
    }
    const fov = this.mapMode ? 45 : 55 + Math.min(14, this.ship.speed * 0.18) + boost * 6;
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * k;
      cam.updateProjectionMatrix();
    }
  }

  /** Distance at which a sphere of radius r fills the frame like the planet view's globe. */
  frameDistance(r) {
    const { width, height } = this.ctx.engine.size;
    const halfV = THREE.MathUtils.degToRad(LAND_FOV / 2);
    const halfH = Math.atan(Math.tan(halfV) * (width / height));
    return r / Math.sin(0.91 * Math.min(halfV, halfH));
  }

  // ------------------------------------------------------------------ landing / takeoff

  /** Space-side view at the moment of the swap: camera over `dir` (world), globe framed like the planet view. */
  landingPose(i, dirW, outPos) {
    const pl = this.planet(i);
    return outPos.copy(dirW).multiplyScalar(this.frameDistance(pl.def.radius)).add(pl.holder.position);
  }

  depart(route) {
    if (route.mode !== 'planet') return Promise.resolve({ cover: 'fade' });
    const i = route.planet;
    this.setMap(false);
    this.hud.showCard(null, {});
    return new Promise((resolve) => {
      const descend = () => {
        const pl = this.planet(i);
        const camOff = this.camera.position.clone().sub(pl.holder.position);
        const dirW = camOff.clone().normalize();
        dirW.y = THREE.MathUtils.clamp(dirW.y, -0.45, 0.45);
        dirW.normalize();
        this.ship.cancelAutopilot();
        this.sequence = {
          kind: 'land',
          i,
          t0: this.ctx.engine.time,
          dur: 2.8,
          from: { dir: camOff.clone().normalize(), len: camOff.length(), fov: this.camera.fov, look: this.rig.look.clone().sub(pl.holder.position) },
          ship: this.ship.position.clone().sub(pl.holder.position),
          dirW,
          done: () => {
            // Planet-local direction = world direction without the planet's spin
            const local = dirW.clone().applyAxisAngle(UP, -pl.body.rotation.y);
            resolve({ cover: 'snapshot', arrival: { dir: local.toArray() } });
          }
        };
      };
      if (this.orbiting === i) descend();
      else {
        // Not there yet: autopilot to orbit first, then descend
        this.park(i);
        this.ship.autopilot.onArrive = () => {
          this.enterOrbit(i);
          descend();
        };
        this.ship.autopilot.onCancel = null;
        this.lockInput = true;
      }
    });
  }

  runLanding(seq, t) {
    const pl = this.planet(seq.i);
    const P = pl.holder.position;
    const raw = Math.min(1, (t - seq.t0) / seq.dur);
    const e = ease(raw);
    const D = this.frameDistance(pl.def.radius);
    const dir = slerpDir(seq.from.dir, seq.dirW, e, new THREE.Vector3());
    const len = THREE.MathUtils.lerp(seq.from.len, D, e);
    this.camera.position.copy(P).addScaledVector(dir, len);
    this.camera.fov = THREE.MathUtils.lerp(seq.from.fov, LAND_FOV, e);
    this.camera.updateProjectionMatrix();
    this.camera.up.copy(UP);
    this.rig.look.copy(seq.from.look).lerp(_v.set(0, 0, 0), e).add(P);
    this.camera.lookAt(this.rig.look);
    // The ship dives ahead of the camera into the atmosphere
    const s = Math.pow(raw, 1.6);
    const surface = _v2.copy(seq.dirW).multiplyScalar(pl.def.radius * 1.02);
    this.ship.position.copy(seq.ship).lerp(surface, s).add(P);
    this.ship.faceTowards(_v.copy(surface).add(P).sub(this.ship.position), 1 / 60, 6);
    this.ship.thrust = 1;
    this.ship.object.visible = raw < 0.9;
    this.ship.object.scale.setScalar(1 - s * 0.6);
    this.ship.update(0, { forward: 0, turn: 0, lift: 0 });
    this.ship.velocity.set(0, 0, 0);
    if (raw >= 1 && !seq.resolved) {
      seq.resolved = true;
      seq.done();
    }
  }

  /** Arrival from a planet: start exactly where the planet view left off, then climb to orbit. */
  placeForTakeoff(a) {
    const i = a.planet;
    const pl = this.planet(i);
    const dirW = new THREE.Vector3().fromArray(a.dir).applyAxisAngle(UP, pl.body.rotation.y).normalize();
    this.selected = i;
    this.bodies.highlightOrbit(i);
    this.camera.fov = LAND_FOV;
    this.camera.updateProjectionMatrix();
    this.sequence = { kind: 'hold', i, dirW, release: false };
    this.ship.position.copy(dirW).multiplyScalar(pl.def.radius * 1.05).add(pl.holder.position);
    this.ship.object.visible = false;
    this.holdCamera(this.sequence);
  }

  holdCamera(seq) {
    const P = this.planet(seq.i).holder.position;
    this.landingPose(seq.i, seq.dirW, this.camera.position);
    this.camera.up.copy(UP);
    this.rig.look.copy(P);
    this.camera.lookAt(P);
  }

  runTakeoff(seq, t, dt) {
    const pl = this.planet(seq.i);
    const P = pl.holder.position;
    const raw = Math.min(1, (t - seq.t0) / seq.dur);
    const e = ease(raw);
    // Ship: from the surface out to the parking spot
    const park = this.parkOffset(seq.i, new THREE.Vector3());
    const start = _v.copy(seq.dirW).multiplyScalar(pl.def.radius * 1.02);
    const s = 1 - Math.pow(1 - raw, 2);
    this.ship.object.visible = true;
    this.ship.object.scale.setScalar(0.4 + 0.6 * s);
    const shipPos = start.lerp(park, s).add(P);
    const heading = _v2.copy(shipPos).sub(this.ship.position);
    this.ship.position.copy(shipPos);
    if (heading.lengthSq() > 1e-8) this.ship.faceTowards(heading, dt, 5);
    this.ship.thrust = 1 - raw * 0.6;
    this.ship.update(0, { forward: 0, turn: 0, lift: 0 });
    // Camera: from the globe framing to the chase view
    const from = this.landingPose(seq.i, seq.dirW, new THREE.Vector3());
    const chasePos = new THREE.Vector3();
    const chaseLook = new THREE.Vector3();
    this.chasePose(chasePos, chaseLook);
    this.camera.position.copy(from).lerp(chasePos, e);
    this.rig.look.copy(P).lerp(chaseLook, e);
    this.camera.fov = THREE.MathUtils.lerp(LAND_FOV, 55, e);
    this.camera.updateProjectionMatrix();
    this.camera.up.copy(UP);
    this.camera.lookAt(this.rig.look);
    if (raw >= 1) {
      this.sequence = null;
      this.ship.object.scale.setScalar(1);
      this.park(seq.i);
      this.ship.autopilot.arrived = true;
      this.enterOrbit(seq.i);
      this.refreshCard();
    }
  }

  /** Speed lines: short streaks in a box around the camera, stretched along the ship's motion. */
  buildStreaks() {
    const n = 260;
    const pos = new Float32Array(n * 6);
    this.streakPts = [];
    for (let i = 0; i < n; i++) this.streakPts.push(new THREE.Vector3((Math.random() - 0.5) * 60, (Math.random() - 0.5) * 36, (Math.random() - 0.5) * 60));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.streaks = new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.streaks.frustumCulled = false;
    this.scene.add(this.streaks);
  }

  updateStreaks() {
    const v = this.ship.velocity;
    const speed = this.ship.speed;
    const on = this.mapMode || this.sequence ? 0 : THREE.MathUtils.smoothstep(speed, 20, 55);
    this.streaks.material.opacity = on * 0.55;
    this.streaks.visible = on > 0.01;
    if (!this.streaks.visible) return;
    const c = this.camera.position;
    const dir = _v2.copy(v).normalize();
    const len = Math.min(6, speed * 0.07);
    const arr = this.streaks.geometry.attributes.position.array;
    this.streakPts.forEach((p, i) => {
      // Points live in world space; wrap them around the camera
      for (const ax of ['x', 'y', 'z']) {
        const half = ax === 'y' ? 18 : 30;
        const d = p[ax] - c[ax];
        if (d > half) p[ax] -= half * 2;
        else if (d < -half) p[ax] += half * 2;
      }
      arr.set([p.x, p.y, p.z, p.x - dir.x * len, p.y - dir.y * len, p.z - dir.z * len], i * 6);
    });
    this.streaks.geometry.attributes.position.needsUpdate = true;
  }

  // ------------------------------------------------------------------ loop

  update(dt, t) {
    // Orbits and spins run on the world clock (shared with the town's time of day)
    this.bodies.update(dt, this.ctx.world.now(), t);
    this.traffic.update(dt);
    const seq = this.sequence;
    if (seq?.kind === 'land') this.runLanding(seq, t);
    else if (seq?.kind === 'hold') {
      this.holdCamera(seq);
      // Keep still while the snapshot of the planet view cross-fades away
      if (seq.release) {
        seq.release = false;
        seq.wait = t + 0.75;
      }
      if (seq.wait && t >= seq.wait) this.sequence = { kind: 'takeoff', i: seq.i, dirW: seq.dirW, t0: t, dur: 3.2 };
    } else if (seq?.kind === 'takeoff') this.runTakeoff(seq, t, dt);
    else {
      this.ship.update(dt, this.lockInput ? { forward: 0, turn: 0, lift: 0 } : this.input());
      this.keepClear();
      this.updateCamera(dt, t);
    }
    this.updateStreaks();
    const { width, height } = this.ctx.engine.size;
    this.hud.updateLabels(this.camera, width, height, this.bodies, this.ship.position, this.mapMode);
    this.hud.setStatus(this.ship.speed, this.statusText());
  }

  /** Never fly through the star or a planet. */
  keepClear() {
    const P = this.ship.position;
    const starR = this.system.star.radius * 1.6;
    if (P.length() < starR) P.setLength(starR);
    for (const pl of this.bodies.planets) {
      const r = pl.def.radius * 1.2;
      const d = _v.copy(P).sub(pl.holder.position);
      if (d.length() < r) P.copy(pl.holder.position).addScaledVector(d.normalize(), r);
    }
  }

  statusText() {
    if (this.sequence?.kind === 'land') return 'Masuk atmosfer';
    if (this.sequence) return 'Lepas landas';
    if (this.orbiting !== null) return `Orbit ${this.system.planets[this.orbiting].name}`;
    if (this.ship.autopilot) return `Autopilot ke ${this.system.planets[this.selected]?.name ?? 'tujuan'}`;
    return this.ship.speed > 0.5 ? 'Terbang bebas' : 'Diam';
  }

  render() {
    this.ctx.engine.renderer.render(this.scene, this.camera);
  }

  resize(w, h) {
    if (!this.camera) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  exit() {
    this.unbindInput();
    this.hud.dispose();
    this.ui.hidden = true;
    this.bodies.dispose();
    const { nebula, stars } = this.backdrop;
    nebula.geometry.dispose();
    nebula.material.map.dispose();
    nebula.material.dispose();
    stars.geometry.dispose();
    stars.material.dispose();
    this.disposeShip(this.ship);
    this.traffic.dispose();
    this.streaks.geometry.dispose();
    this.streaks.material.dispose();
    this.scene = null;
  }
}
