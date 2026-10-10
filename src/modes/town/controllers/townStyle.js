// The two looks of the town (normal and pixel) and the pixel diorama camera.
// Methods of the town instance (mixed into TownMode, see mixin.js): they use its state and are called as this.<name>().

import * as THREE from 'three';
import { TownPixelStyle } from '../render/pixelStyle.js';
import { saveTownStyle, PIXEL_YAW } from '../render/pixelConfig.js';
import { STREET_FOV } from './shared.js';

export class StyleMethods {
  get pixelActive() { return this.townStyle === 'pixel' && !this.interior; }

  get renderCamera() { return this.pixelActive ? this.pixel.rig.camera : this.camera; }

  setTownStyle(style, { persist = true } = {}) {
    this.townStyle = style === 'pixel' ? 'pixel' : 'normal';
    if (persist) saveTownStyle(this.townStyle);
    if (this.townStyle === 'pixel' && !this.pixel) this.pixel = new TownPixelStyle(this);
    this.pixel?.setActive(this.pixelActive);
    this.tween = null;
    this.drag = null;
    this.orbit.enabled = !this.pixelActive && this.view === 'diorama' && !this.interior;
    if (this.pixelActive) {
      this.pixel.setView(this.view);
      this.pixel.update(0, true);
      this.camera.position.copy(this.pixel.rig.camera.position);
    } else if (!this.interior) {
      this.camera.fov = this.view === 'diorama' ? 40 : STREET_FOV;
      this.camera.updateProjectionMatrix();
      if (this.view === 'diorama') {
        const to = this.dioramaPose({});
        to.pos.sub(to.target).add(this.orbit.target);
        this.camera.position.copy(to.pos); this.camera.lookAt(this.orbit.target);
      } else {
        this.follow.yaw = this.player.yaw + Math.PI;
        this.follow.pitch = .32;
        this.updateFollowCamera(1, this.player, 1.6);
      }
    }
    this.hud.setStyle(this.townStyle, this.pixel?.rig.levels[this.view] ?? 1);
    this.builder.lodView = null;
  }

  setPixelZoom(level) {
    if (!this.pixelActive) return;
    this.pixel.setZoom(level);
    this.pixel.update(0, true);
    this.hud.setStyle(this.townStyle, this.pixel.rig.levels[this.view]);
  }

  panPixelDiorama(dx, dy) {
    const right = new THREE.Vector3(Math.cos(PIXEL_YAW), 0, -Math.sin(PIXEL_YAW));
    const forward = new THREE.Vector3(-Math.sin(PIXEL_YAW), 0, -Math.cos(PIXEL_YAW));
    this.orbit.target.addScaledVector(right, dx).addScaledVector(forward, dy);
    const r = Math.hypot(this.orbit.target.x, this.orbit.target.z), limit = this.layout.dioramaR * .85;
    if (r > limit) { this.orbit.target.x *= limit / r; this.orbit.target.z *= limit / r; }
    this.orbit.target.y = Math.max(0, this.builder.groundAt(this.orbit.target.x, this.orbit.target.z));
  }
}
