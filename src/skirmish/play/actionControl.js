import * as THREE from 'three';
import { WEAPONS, WALK_SPEED, RUN_SPEED, RUN_AP_COST } from '../game/rules.js';

// Action Mode for the player's unit: pointer-locked third-person control. Mouse turns the
// camera round the soldier, WASD moves relative to it (spending AP), Shift runs, C crouches,
// right mouse aims over the shoulder (time stops), left mouse fires one burst per action,
// Space ends the action.

const CROUCH_SPEED = 1.6;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class ActionControl {
  constructor(game) {
    this.game = game;
    this.keys = new Set();
    this.active = false;
    this.camYaw = 0;
    this.camPitch = -0.15;
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
        this.keys.add(k);
      } else this.keys.delete(k);
    };
    this.onMouseMove = (e) => {
      if (!this.active || document.pointerLockElement !== dom) return;
      const k = this.aiming ? (this.scope ? 0.0005 : 0.0011) : 0.0024;
      this.camYaw -= e.movementX * k;
      this.camPitch = THREE.MathUtils.clamp(this.camPitch - e.movementY * k, -1.1, 0.75);
    };
    this.onMouseDown = (e) => {
      if (!this.active) return;
      if (document.pointerLockElement !== dom) {
        dom.requestPointerLock?.();
        return;
      }
      if (e.button === 2) this.setAim(true);
      if (e.button === 0 && this.aiming) this.fire();
    };
    this.onMouseUp = (e) => {
      if (this.active && e.button === 2 && !this.firing) this.setAim(false);
    };
    this.onContext = (e) => this.active && e.preventDefault();
    this.onLock = () => {
      // a lock granted after the action already ended (the request is asynchronous) is released
      if (document.pointerLockElement === dom && !this.active) document.exitPointerLock();
      game.hud.setLocked(document.pointerLockElement === dom && this.active);
    };
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    window.addEventListener('mousemove', this.onMouseMove);
    dom.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    dom.addEventListener('contextmenu', this.onContext);
    document.addEventListener('pointerlockchange', this.onLock);
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
    this.dom.requestPointerLock?.();
  }

  stop() {
    this.active = false;
    this.aiming = false;
    this.keys.clear();
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
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

  /** The camera's forward ray: where the reticle points in the world. */
  aimPoint() {
    const cam = this.game.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const o = { x: cam.position.x, y: cam.position.y, z: cam.position.z };
    const hit = this.game.arena.bullet(o, dir, 260, this.game.battle.units, this.unit);
    const t = hit ? hit.t : 260;
    return { x: o.x + dir.x * t, y: o.y + dir.y * t, z: o.z + dir.z * t };
  }

  update(dt) {
    if (!this.active) return;
    const u = this.unit;
    const game = this.game;
    const view = game.views.get(u.id);
    if (u.state !== 'ok') return this.finish();
    // movement (not while aiming or firing)
    let moving = false;
    if (!this.aiming && !this.firing && this.ap > 0) {
      const f = (this.keys.has('w') ? 1 : 0) - (this.keys.has('s') ? 1 : 0);
      const s = (this.keys.has('d') ? 1 : 0) - (this.keys.has('a') ? 1 : 0);
      if (f || s) {
        const run = this.keys.has('shift') && u.stance === 'stand';
        const speed = u.stance === 'crouch' ? CROUCH_SPEED : run ? RUN_SPEED : WALK_SPEED;
        const cost = run ? RUN_AP_COST : 1;
        // camera forward is (sin yaw, cos yaw); right is (-cos yaw, sin yaw) for a camera looking down +z
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
    if (view) {
      view.aim = this.aiming || this.firing;
      if (view.aim) {
        u.yaw = this.camYaw;
        view.look = { yaw: this.camYaw, pitch: this.camPitch };
      }
    }
    this.placeCamera(dt);
  }

  placeCamera() {
    const u = this.unit;
    const game = this.game;
    const cam = game.camera;
    const aim = this.aiming || this.firing;
    const g = game.arena.ground(u.x, u.z);
    const head = g + (u.stance === 'crouch' ? 1.15 : 1.6);
    const dist = aim ? (this.scope ? 0.2 : 1.9) : 3.4;
    const side = aim ? (this.scope ? 0 : 0.85) : 0.7;
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
    this.dom.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.dom.removeEventListener('contextmenu', this.onContext);
    document.removeEventListener('pointerlockchange', this.onLock);
  }
}
