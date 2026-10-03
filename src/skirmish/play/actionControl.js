import * as THREE from 'three';
import { WEAPONS, WALK_SPEED, RUN_SPEED, RUN_AP_COST } from '../game/rules.js';

// Action Mode for the player's unit, third person. WASD moves relative to the camera
// (spending AP), Shift runs, C crouches, right mouse aims over the shoulder (time stops), left
// mouse fires one burst per action, Space ends the action. Right click toggles the aim; holding
// it aims until it is let go. Two ways to look around:
//   lock    pointer lock (a normal browser tab): the mouse turns the camera freely
//   cursor  when the page may not lock the pointer (embedded browsers refuse it): mouse movement
//           still turns the camera (movementX/Y work without a lock), the cursor is hidden and
//           the reticle stays in the centre; where the cursor is stopped by the window's edge
//           the camera keeps turning that way,
//           and Q/E (or the arrow keys) turn it too.
// The mode is found out by asking for the lock once; a refusal switches to cursor mode for good.

const CROUCH_SPEED = 1.6;
const TURN_KEYS = 1.9; // rad/s, Q/E and arrows
const EDGE_PX = 10; // a cursor this close to the window's edge keeps the camera turning
const EDGE_TURN = 2.2; // rad/s while it does
const LOOK = 0.0024; // rad per pixel of mouse movement
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class ActionControl {
  constructor(game) {
    this.game = game;
    this.keys = new Set();
    this.active = false;
    this.camYaw = 0;
    this.camPitch = -0.15;
    this.mode = 'lock';
    this.cursor = { x: 0, y: 0, inside: false };
    this.look = { yaw: 0, pitch: 0 };
    const dom = game.engine.renderer.domElement;
    this.dom = dom;
    this.onKey = (e) => {
      if (!this.active) return;
      const k = e.key.toLowerCase();
      if (e.type === 'keydown') {
        if (k === ' ') {
          e.preventDefault();
          if (!e.repeat) this.finish();
        } else if (k === 'c' && !e.repeat) this.toggleCrouch();
        if (k.startsWith('arrow')) e.preventDefault();
        this.keys.add(k);
      } else this.keys.delete(k);
    };
    this.onMouseMove = (e) => {
      if (!this.active) return;
      if (!this.locked && this.mode !== 'cursor') return;
      const k = this.aiming ? (this.scope ? 0.0005 : 0.0011) : LOOK;
      this.camYaw -= e.movementX * k;
      this.camPitch = THREE.MathUtils.clamp(this.camPitch - e.movementY * k, -1.1, 0.75);
      if (!this.locked) {
        const r = dom.getBoundingClientRect();
        this.cursor.x = e.clientX - r.left;
        this.cursor.y = e.clientY - r.top;
        this.cursor.inside = this.cursor.x >= 0 && this.cursor.y >= 0 && this.cursor.x <= r.width && this.cursor.y <= r.height;
      }
    };
    this.onLeave = () => (this.cursor.inside = false);
    this.onMouseDown = (e) => {
      if (!this.active) return;
      if (this.mode === 'lock' && !this.locked) {
        this.requestLock();
        if (e.button !== 2) return;
      }
      // right button: a click toggles aiming, holding it aims until release
      if (e.button === 2 && !this.firing) {
        if (this.aiming) this.setAim(false);
        else {
          this.setAim(true);
          this.aimPressed = performance.now();
        }
      }
      if (e.button === 0 && this.aiming) this.fire();
    };
    this.onMouseUp = (e) => {
      if (this.active && e.button === 2 && !this.firing && this.aiming && performance.now() - this.aimPressed > 350) this.setAim(false);
    };
    this.onContext = (e) => this.active && e.preventDefault();
    this.onLock = () => {
      // a lock granted after the action already ended (the request is asynchronous) is released
      if (document.pointerLockElement === dom && !this.active) document.exitPointerLock();
      game.hud.setLocked(this.locked, this.mode);
    };
    this.onLockError = () => this.useCursor();
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    window.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mouseleave', this.onLeave);
    dom.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    dom.addEventListener('contextmenu', this.onContext);
    document.addEventListener('pointerlockchange', this.onLock);
    document.addEventListener('pointerlockerror', this.onLockError);
  }

  get locked() {
    return document.pointerLockElement === this.dom;
  }

  requestLock() {
    if (this.mode !== 'lock' || !this.dom.requestPointerLock) return this.useCursor();
    try {
      const p = this.dom.requestPointerLock();
      p?.catch?.(() => this.useCursor());
    } catch {
      this.useCursor();
    }
  }

  useCursor() {
    if (this.mode === 'cursor') return;
    this.mode = 'cursor';
    const r = this.dom.getBoundingClientRect();
    this.cursor = { x: r.width / 2, y: r.height / 2, inside: false };
    this.game.hud.setLocked(false, 'cursor');
  }

  /** Take control of a unit with an AP budget (metres). */
  start(u, ap, { onEnd }) {
    this.unit = u;
    this.ap = ap;
    this.apMax = ap;
    this.onEnd = onEnd;
    this.attacked = false;
    this.aiming = false;
    this.firing = false;
    this.active = true;
    this.keys.clear();
    this.camYaw = u.yaw;
    this.camPitch = -0.12;
    this.weapon = WEAPONS[u.weapon];
    this.scope = !!this.weapon?.scope;
    const r = this.dom.getBoundingClientRect();
    this.cursor = { x: r.width / 2, y: r.height * 0.45, inside: false };
    this.requestLock();
    this.game.hud.setLocked(this.locked, this.mode);
  }

  stop() {
    this.active = false;
    this.aiming = false;
    this.keys.clear();
    if (this.locked) document.exitPointerLock();
  }

  get frozen() {
    return this.active && (this.aiming || this.firing);
  }

  toggleCrouch() {
    if (this.firing) return;
    this.unit.stance = this.unit.stance === 'crouch' ? 'stand' : 'crouch';
  }

  setAim(on) {
    if (on && (this.attacked || !this.game.battle.canFire(this.unit))) {
      this.game.hud.toast(this.attacked ? 'Sudah menyerang di aksi ini' : 'Amunisi habis');
      return;
    }
    this.aiming = on;
    if (on) this.camPitch = THREE.MathUtils.clamp(this.camPitch, -0.6, 0.5);
  }

  async fire() {
    if (this.firing || this.attacked) return;
    const u = this.unit;
    this.firing = true;
    this.attacked = true;
    this.game.battle.useAmmo(u);
    const target = this.aimPoint();
    await this.game.combat.burst(u, { point: target });
    await this.game.wait(0.35);
    this.firing = false;
    this.aiming = false;
  }

  finish() {
    if (this.firing || !this.active) return;
    this.stop();
    this.onEnd?.();
  }

  /** Screen point of the reticle (CSS px in the canvas): always the centre. */
  reticlePos() {
    const r = this.dom.getBoundingClientRect();
    return { x: r.width / 2, y: r.height / 2 };
  }

  /** Where the reticle points in the world (the first thing the ray through it meets). */
  aimPoint() {
    const cam = this.game.camera;
    const r = this.dom.getBoundingClientRect();
    const p = this.reticlePos();
    const ndc = new THREE.Vector3((p.x / r.width) * 2 - 1, -(p.y / r.height) * 2 + 1, 0.5).unproject(cam);
    const dir = ndc.sub(cam.position).normalize();
    const o = { x: cam.position.x, y: cam.position.y, z: cam.position.z };
    const hit = this.game.arena.bullet(o, dir, 260, this.game.battle.units, this.unit);
    const t = hit ? hit.t : 260;
    return { x: o.x + dir.x * t, y: o.y + dir.y * t, z: o.z + dir.z * t };
  }

  /** Turn the camera with the keys; in cursor mode also while the cursor is held at the window's edge. */
  turn(dt) {
    const k = this.keys;
    const slow = this.aiming ? (this.scope ? 0.2 : 0.45) : 1;
    const yawKeys = (k.has('q') || k.has('arrowleft') ? 1 : 0) - (k.has('e') || k.has('arrowright') ? 1 : 0);
    const pitchKeys = (k.has('arrowup') ? 1 : 0) - (k.has('arrowdown') ? 1 : 0);
    this.camYaw += yawKeys * TURN_KEYS * slow * dt;
    this.camPitch += pitchKeys * TURN_KEYS * 0.6 * slow * dt;
    if (this.mode === 'cursor' && this.cursor.inside) {
      const r = this.dom.getBoundingClientRect();
      const { x, y } = this.cursor;
      const px = x < EDGE_PX ? -1 : x > r.width - EDGE_PX ? 1 : 0;
      const py = y < EDGE_PX ? -1 : y > r.height - EDGE_PX ? 1 : 0;
      this.camYaw -= px * EDGE_TURN * slow * dt;
      this.camPitch -= py * EDGE_TURN * 0.4 * slow * dt;
    }
    this.camPitch = THREE.MathUtils.clamp(this.camPitch, -1.1, 0.75);
  }

  update(dt) {
    if (!this.active) return;
    const u = this.unit;
    const game = this.game;
    const view = game.views.get(u.id);
    if (u.state !== 'ok') return this.finish();
    this.turn(dt);
    // movement (not while aiming or firing)
    let moving = false;
    if (!this.aiming && !this.firing && this.ap > 0) {
      const f = (this.keys.has('w') ? 1 : 0) - (this.keys.has('s') ? 1 : 0);
      const s = (this.keys.has('d') ? 1 : 0) - (this.keys.has('a') ? 1 : 0);
      if (f || s) {
        const run = this.keys.has('shift') && u.stance === 'stand';
        const speed = u.stance === 'crouch' ? CROUCH_SPEED : run ? RUN_SPEED : WALK_SPEED;
        const cost = run ? RUN_AP_COST : 1;
        // camera forward is (sin yaw, cos yaw); its right is (-cos yaw, sin yaw)
        const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
        let dx = fx * f - fz * s, dz = fz * f + fx * s;
        const L = Math.hypot(dx, dz);
        dx /= L;
        dz /= L;
        const step = Math.min(speed * dt, this.ap / cost);
        const others = game.battle.units.filter((o) => o !== u && (o.state === 'ok' || o.kind !== 'infantry') && o.state !== 'evac' && o.state !== 'dead').map((o) => ({ x: o.x, z: o.z, r: o.kind === 'tank' ? 2.2 : o.kind === 'bunker' ? 2.4 : 0.4 }));
        const [nx, nz] = game.arena.slide(u.x, u.z, dx * step, dz * step, 0.35, others);
        const moved = Math.hypot(nx - u.x, nz - u.z);
        if (moved > 1e-4) {
          u.x = nx;
          u.z = nz;
          this.ap = Math.max(0, this.ap - moved * cost);
          moving = true;
          u.yaw += wrap(Math.atan2(dx, dz) - u.yaw) * (1 - Math.exp(-dt * 14));
          game.battle.touch(u);
        }
      }
    }
    this.moving = moving;
    this.placeCamera(dt);
    if (view) {
      view.aim = this.aiming || this.firing;
      if (view.aim && !this.firing) {
        // the body and weapon follow the reticle's world point
        const p = this.aimPoint();
        const e = game.arena.eye(u);
        this.look.yaw = Math.atan2(p.x - e.x, p.z - e.z);
        this.look.pitch = Math.atan2(p.y - e.y, Math.hypot(p.x - e.x, p.z - e.z));
      }
      if (view.aim) {
        u.yaw = this.look.yaw;
        view.look = { yaw: this.look.yaw, pitch: this.look.pitch };
      }
    }
  }

  placeCamera() {
    const u = this.unit;
    const game = this.game;
    const cam = game.camera;
    const aim = this.aiming || this.firing;
    const g = game.arena.ground(u.x, u.z);
    const head = g + (u.stance === 'crouch' ? 1.15 : 1.6);
    const dist = aim ? (this.scope ? 0.2 : 2.1) : 3.6;
    const side = aim ? (this.scope ? 0 : 0.85) : 0.75;
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    const target = new THREE.Vector3(u.x, head + (aim ? 0.05 : 0.15), u.z);
    // over the right shoulder: the right of a camera looking along (fx, fz) is (-fz, fx)
    const pos = target.clone().add(new THREE.Vector3(-fx * dist * cp - fz * side, -sp * dist + (aim ? 0 : 0.35), -fz * dist * cp + fx * side));
    // pull in before walls and trees between the soldier and the camera
    const back = pos.clone().sub(target);
    const len = back.length();
    back.divideScalar(len);
    const hit = game.arena.castScenery(target, back, len, 'sight');
    if (hit && !hit.terrain) pos.copy(target).addScaledVector(back, Math.max(0.3, hit.t - 0.3));
    pos.y = Math.max(pos.y, game.arena.ground(pos.x, pos.z) + 0.35);
    cam.position.copy(pos);
    const look = pos.clone().add(new THREE.Vector3(fx * cp, sp, fz * cp));
    cam.lookAt(look);
    const fov = aim ? (this.scope ? 9 : 36) : 50;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov += (fov - cam.fov) * 0.35;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }

  /** Reticle radius in CSS pixels for the current weapon and stance. */
  reticle() {
    if (!this.weapon) return 0;
    const cam = this.game.camera;
    const deg = this.weapon.spread[this.unit.stance === 'crouch' ? 1 : 0];
    const h = this.game.engine.size.height;
    return (Math.tan(THREE.MathUtils.degToRad(deg)) / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) * (h / 2);
  }

  dispose() {
    this.stop();
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    window.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseleave', this.onLeave);
    this.dom.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.dom.removeEventListener('contextmenu', this.onContext);
    document.removeEventListener('pointerlockchange', this.onLock);
    document.removeEventListener('pointerlockerror', this.onLockError);
  }
}
