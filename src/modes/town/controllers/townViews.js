// The camera views of the town (diorama, walk, drive), moving between them, the player avatar and where the camera may go.
// Methods of the town instance (mixed into TownMode, see mixin.js): they use its state and are called as this.<name>().

import * as THREE from 'three';
import { WATER_Y } from '../scale.js';
import { Colliders } from '../navigation/colliders.js';
import { makeTownPerson, animateTownPerson } from '../people/skirmishPeople.js';
import { PIXEL_YAW } from '../render/pixelConfig.js';
import { STREET_FOV, _v } from './shared.js';

export class ViewMethods {
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
    if (v !== 'diorama' && this.homePicking) this.toggleHomeSelection(false);
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
    if (v !== 'diorama') {
      if (this.ctx.tips?.current !== v) this.ctx.tips?.hide();
      this.ctx.tips?.show(v);
    }
    this.orbit.enabled = v === 'diorama' && !this.tween;
    this.player.visible = v === 'walk' && !this.avatar;
    this.camera.fov = v === 'diorama' ? 40 : STREET_FOV;
    this.camera.updateProjectionMatrix();
    if (v === 'walk') {
      if (prev === 'diorama') {
        // Drop in where the camera was looking, if it is free
        const t = this.orbit.target;
        if (Math.hypot(t.x, t.z) < this.layout.dioramaR - 30 && this.builder.heightAt(t.x, t.z) > WATER_Y + 0.2) this.placePlayer(t.x, t.z);
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
    if (this.pixelActive) {
      this.tween = null; this.orbit.enabled = false;
      this.pixel.setView(v);
      if (v === 'diorama' && prev !== 'diorama') {
        const focus = prev === 'drive' && this.drive ? this.drive.car : this.player;
        this.orbit.target.set(focus.x, focus.y, focus.z);
      }
      if (v === 'walk') this.follow.yaw = PIXEL_YAW;
      this.pixel.update(0, true);
      this.hud.setStyle(this.townStyle, this.pixel.rig.levels[v]);
    }
  }

  setViewSilently(v) {
    this.view = v;
    this.player.visible = false;
    this.orbit.enabled = false;
  }

  /** Diorama: WASD / arrow keys slide the camera over the table (Shift for faster), relative to the view. */
  panDiorama(dt) {
    if (!this.orbit.enabled || this.interior) return;
    const k = this.keys;
    const axis = (a, b, c, d) => (k.has(a) || k.has(c) ? 1 : 0) - (k.has(b) || k.has(d) ? 1 : 0);
    const fwd = axis('w', 's', 'arrowup', 'arrowdown');
    const right = axis('d', 'a', 'arrowright', 'arrowleft');
    const vel = (this.dioramaPan ||= new THREE.Vector3());
    const cam = this.camera.position;
    const tg = this.orbit.target;
    // Ground-plane axes of the current view
    const f = new THREE.Vector3(tg.x - cam.x, 0, tg.z - cam.z);
    if (f.lengthSq() < 1e-6) f.set(0, 0, -1).applyQuaternion(this.camera.quaternion).setY(0);
    f.normalize();
    const r = new THREE.Vector3(-f.z, 0, f.x);
    // Speed scales with the zoom, so it feels the same close up and far out; eased in and out
    const speed = cam.distanceTo(tg) * (k.has('shift') ? 1.5 : 0.65);
    const want = f.multiplyScalar(fwd).addScaledVector(r, right);
    if (want.lengthSq() > 1) want.normalize();
    vel.lerp(want.multiplyScalar(speed), 1 - Math.exp(-dt * (fwd || right ? 10 : 7)));
    if (vel.lengthSq() < 1e-4) return;
    const step = vel.clone().multiplyScalar(dt);
    // Keep the table in reach, and ride over the terrain with the camera
    const limit = this.layout.dioramaR * 0.85;
    const reach = Math.hypot(tg.x + step.x, tg.z + step.z);
    if (reach > limit) {
      step.x -= (tg.x + step.x) * (1 - limit / reach);
      step.z -= (tg.z + step.z) * (1 - limit / reach);
    }
    step.y = Math.max(0, this.builder.groundAt(tg.x + step.x, tg.z + step.z)) - tg.y;
    cam.add(step);
    tg.add(step);
  }

  updateFollowCamera(dt, target, height) {
    if (this.pixelActive) { this.follow.yaw = PIXEL_YAW; return; }
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
    // Pull in (without easing) when a building stands between the player and the camera
    const clear = this.cameraClearance(look, pos);
    if (clear < 1) {
      this.camera.position.lerpVectors(look, pos, clear);
      this.camera.lookAt(look);
      return;
    }
    const k = 1 - Math.exp(-dt * 10);
    this.camera.position.lerp(pos, k);
    this.camera.lookAt(look);
  }

  /** Building volumes the follow camera must stay out of: footprint boxes with a roof height. */
  buildCameraBlockers() {
    const boxes = [];
    for (const b of this.layout.buildings) {
      if (b.homeCollider) {
        boxes.push({ ...b.homeCollider, top: this.builder.groundAt(b.x, b.z) + b.homeHeight });
        continue;
      }
      const f = this.footprints[b.asset];
      if (!f || !Number.isFinite(f.minX)) continue;
      const sx = b.sx ?? 1, sz = b.sz ?? 1, ca = Math.cos(b.yaw), sa = Math.sin(b.yaw);
      const cx = ((f.maxX + f.minX) / 2) * sx, cz = ((f.maxZ + f.minZ) / 2) * sz;
      boxes.push({ type: 'box', x: b.x + ca * cx - sa * cz, z: b.z + sa * cx + ca * cz, hw: ((f.maxX - f.minX) / 2) * sx, hd: ((f.maxZ - f.minZ) / 2) * sz, yaw: b.yaw, top: this.builder.groundAt(b.x, b.z) + f.maxY * (b.sy ?? 1) });
    }
    return new Colliders(boxes);
  }

  /** Share (0..1) of the way from the player's head to the wanted camera spot that stays outside buildings. */
  cameraClearance(from, to) {
    const steps = 16;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t, z = from.z + (to.z - from.z) * t;
      for (const c of this.cameraBlockers.near(x, z, 0.5)) {
        if (y > c.top) continue;
        const ca = Math.cos(c.yaw), sa = Math.sin(c.yaw), dx = x - c.x, dz = z - c.z;
        if (Math.abs(dx * ca + dz * sa) < c.hw + 0.35 && Math.abs(-dx * sa + dz * ca) < c.hd + 0.35) return Math.max(0.15, (i - 1) / steps);
      }
    }
    return 1;
  }

  placePlayer(x, z) {
    const p = this.colliders.resolve(x, z, 0.45);
    this.player.x = p.x;
    this.player.z = p.z;
    this.player.y = this.builder.groundAt(p.x, p.z);
  }

  // ------------------------------------------------------------------ buildings

  /** The skirmish v5 hero, in the town faction colour. */
  setupAvatar(outfit, shadows) {
    const person = makeTownPerson(this.character, { player: true, shadows, top: outfit === 'explorer_red' ? 0xc8453b : 0x027b49 });
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
    const speed = this.interior || this.transfer ? p.speed : (p.motionSpeed ?? p.speed);
    const dyaw = Math.atan2(Math.sin(p.yaw - av.root.rotation.y), Math.cos(p.yaw - av.root.rotation.y));
    av.root.rotation.y = p.yaw;
    av.turn = (av.turn || 0) + ((dt > 0 ? dyaw / dt : 0) - (av.turn || 0)) * (1 - Math.exp(-dt * 8));
    animateTownPerson(av, dt, speed, { pose: this.pose?.name || null, jump: p.jump, turn: av.turn });
  }
}
