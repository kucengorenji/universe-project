// Keyboard, mouse and touch: binding the controls, walking, the interaction prompt and footsteps.
// Methods of the town instance (mixed into TownMode, see mixin.js): they use its state and are called as this.<name>().

import * as THREE from 'three';
import { WATER_Y } from '../scale.js';
import { ENTERABLE } from '../interior/interior.js';
import { t as tr } from '../../../i18n/index.js';

export class InputMethods {
  bindInput() {
    const canvas = this.ctx.engine.renderer.domElement;
    this.onKeyDown = (e) => {
      if (e.target.matches?.('input, textarea') || this.planner) return;
      const k = e.key.toLowerCase();
      if (k === '1') this.setView('diorama');
      else if (k === '2') this.setView('walk');
      else if (k === '3') this.setView('drive');
      else if (k === 'b' && this.view === 'diorama') this.toggleHomeSelection();
      else if (k === 'escape' && this.homePicking) this.toggleHomeSelection(false);
      else if (k === 'escape' && this.interior) this.exitBuilding();
      else if (k === 'escape' && this.view !== 'diorama') this.setView('diorama');
      else if (k === 'e' || k === 'f') this.interact();
      else if (k === ' ' && this.view === 'walk' && this.player.jump === 0 && !this.player.vy) this.player.vy = 4.4;
      this.keys.add(k);
      if ((this.view !== 'diorama' || k.startsWith('arrow')) && [' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    };
    this.onKeyUp = (e) => this.keys.delete(e.key.toLowerCase());
    this.onBlur = () => this.keys.clear();
    this.onPointerDown = (e) => {
      if (this.pixelActive) {
        if (this.view === 'diorama') {
          this.homeClickStart = { x: e.clientX, y: e.clientY, id: e.pointerId };
          this.drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
        }
        return;
      }
      if (this.view === 'diorama') { this.homeClickStart = { x: e.clientX, y: e.clientY, id: e.pointerId }; return; }
      this.drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
    };
    this.onPointerMove = (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      if (this.pixelActive) {
        if (this.view === 'diorama') {
          const unit = this.pixel.rig.span / Math.max(1, this.ctx.engine.size.height);
          this.panPixelDiorama(-(e.clientX - this.drag.x) * unit, (e.clientY - this.drag.y) * unit * Math.SQRT2);
        }
        this.drag.x = e.clientX; this.drag.y = e.clientY;
        return;
      }
      if (this.view === 'drive') this.chase.look(e.clientX - this.drag.x, e.clientY - this.drag.y, this.ctx.engine.time);
      this.follow.yaw -= (e.clientX - this.drag.x) * 0.006;
      this.follow.pitch = THREE.MathUtils.clamp(this.follow.pitch + (e.clientY - this.drag.y) * 0.004, -0.15, 1.2);
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      this.followInput = this.ctx.engine.time;
    };
    this.onPointerUp = (e) => {
      if (this.homeClickStart?.id === e.pointerId && Math.hypot(e.clientX - this.homeClickStart.x, e.clientY - this.homeClickStart.y) < 6) this.pickHomeAt(e.clientX, e.clientY);
      this.homeClickStart = null;
      this.drag = null;
    };
    this.onWheel = (e) => {
      if (this.pixelActive) {
        if (Math.abs(e.deltaY) < 1 || this.ctx.engine.time - (this.pixelWheelTime ?? -Infinity) < .15) return;
        this.pixelWheelTime = this.ctx.engine.time;
        this.setPixelZoom(this.pixel.rig.levels[this.view] + Math.sign(e.deltaY));
        return;
      }
      if (this.view === 'diorama') {
        // OrbitControls clamps zoom. Leaving the city is an explicit action.
        return;
      }
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
    // A brisk stroll keeps the authored walking cadence natural; Shift still sprints.
    const speed = i.run ? 5.6 : 1.7;
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
    // Vehicles pass through people; buildings and terrain still block walking.
    const r = this.colliders.resolve(nx, nz, 0.42);
    // No wading into deep water, no stepping off the edge of the table
    const g = this.builder.surfaceAt(r.x, r.z);
    // Too steep to climb: stop at the foot of cliffs (going down is fine)
    const climb = (g - this.builder.surfaceAt(p.x, p.z)) / Math.max(1e-3, Math.hypot(r.x - p.x, r.z - p.z));
    if (g > WATER_Y - 0.5 && Math.hypot(r.x, r.z) < this.layout.dioramaR - 6 && climb < 1.1) {
      p.motionSpeed=Math.hypot(r.x-p.x,r.z-p.z)/Math.max(dt,.001);
      p.x = r.x;
      p.z = r.z;
    } else {p.speed *= 0.5;p.motionSpeed=0;}
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
        else if (v) text = tr(v.mode === 'traffic' ? 'town.prompt.takeover' : 'town.prompt.enterVehicle');
      } else if (this.view === 'drive' && this.drive && this.drive.car.speed < 4) text = tr('town.prompt.exitVehicle');
    }
    if (this.roadHint && this.view === 'drive') {
      this.hud.setPrompt(this.roadHint, '↑');
      return;
    }
    this.hud.setPrompt(text, 'E');
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
}
