// Sun, sky, fog, shadows and the depth range of the camera; and the adaptive quality sample.
// Methods of the town instance (mixed into TownMode, see mixin.js): they use its state and are called as this.<name>().

import * as THREE from 'three';
import { UP, ORIGIN, _v, _v2, _lightRot, _lightInv } from './shared.js';

export class EnvironmentMethods {
  /**
   * Near plane follows the camera's distance to what it looks at. With a fixed
   * 0.3 m near plane the depth buffer resolves only ~7 cm at diorama distance,
   * so windows, doors and trim fight with their walls and flicker.
   */
  updateDepthRange() {
    const cam = this.camera;
    const street = this.view !== 'diorama' && !this.tween;
    const d = street ? 0 : cam.position.distanceTo(this.orbit.target);
    const near = street ? 0.3 : THREE.MathUtils.clamp(d * 0.04, 0.3, 40);
    if (Math.abs(near - cam.near) / cam.near > 0.1) {
      cam.near = near;
      cam.updateProjectionMatrix();
    }
  }

  adaptQuality(sample) {
    if (this.interior || this.planner) return false;
    const cpuHeavy = sample.fps < 55 && (this.cpuUpdateMs ?? 0) + (this.cpuRenderMs ?? 0) > 9;
    return this.detailBudget.sample({ ...sample, heavy: sample.heavy || cpuHeavy });
  }

  resetAdaptiveQuality() { this.detailBudget.reset(); }

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
    this.streetLighting.update(this.camera,L.night);
    this.ctx.audio?.setNight(L.night);
    if (!this.interior) this.ctx.engine.post.setBoost(L.night * 0.5); // lit windows and lamps glow at night

    // Fog: from the table the world's edge melts into haze; at street level the horizon opens up
    const street = this.view !== 'diorama' && !this.tween ? 1 : 0;
    this.fogBlend += (street - this.fogBlend) * (1 - Math.exp(-dt * 2));
    const camDist = this.camera.position.distanceTo(this.orbit.target);
    const fog = this.scene.fog;
    fog.color.copy(L.fog);
    fog.near = THREE.MathUtils.lerp(camDist * 0.95, 260, this.fogBlend);
    fog.far = THREE.MathUtils.lerp(camDist + this.layout.dioramaR * 1.05, 3900, this.fogBlend);

    // Shadow box on the point of interest, snapped to whole shadow texels so it does not shimmer
    const focus = this.view === 'walk' ? this.player : this.view === 'drive' && this.drive ? this.drive.car : this.orbit.target;
    const sun = this.sun;
    const budget = this.ctx.engine.quality.preset === 'auto' ? this.detailBudget.current.shadow : 1;
    const shadows = this.ctx.engine.quality.settings.shadows;
    const high = this.ctx.engine.quality.tier === 'high';
    this.shadowBaseSize = high ? 2048 : 1024;
    this.shadowExtents.diorama = high ? 150 : 110;
    this.shadowExtents.street = high ? 45 : 38;
    this.ctx.engine.renderer.shadowMap.enabled = shadows;
    sun.castShadow = shadows;
    if (this.liveShadows !== shadows) {
      for (const group of [this.crowd.group, ...(this.rigged?.pool || []).map(p => p.root), this.avatar?.root, ...this.homeGroups || []]) group?.traverse(node => {
        if (!node.isMesh) return;
        if (node.userData.townShadow === undefined) node.userData.townShadow = true;
        node.castShadow = shadows && node.userData.townShadow;
        if (group !== this.crowd.group) node.receiveShadow = shadows;
      });
      this.liveShadows = shadows;
    }
    const size = budget < 0.8 ? Math.min(this.shadowBaseSize, 1024) : this.shadowBaseSize;
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      sun.shadow.mapSize.set(size, size);
      sun.shadow.normalBias = ((this.shadowExt * 2) / size) * 4;
    }
    const target = _v.set(focus.x, 0, focus.z);
    if (this.shadowExt) {
      const ext = this.view === 'diorama' || this.tween ? this.shadowExtents.diorama : this.shadowExtents.street;
      if (ext !== this.shadowExt) {
        this.shadowExt = ext;
        Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext });
        sun.shadow.camera.updateProjectionMatrix();
        // Normal offset scales with the texel: enough against acne, not so much that shadows lift off
        sun.shadow.normalBias = ((ext * 2) / sun.shadow.mapSize.x) * 4;
      }
      const texel = (this.shadowExt * 2) / sun.shadow.mapSize.x;
      const lightRot = _lightRot.lookAt(ORIGIN, _v2.copy(this.sunDir).negate(), UP);
      target.applyMatrix4(_lightInv.copy(lightRot).invert());
      target.x = Math.round(target.x / texel) * texel;
      target.y = Math.round(target.y / texel) * texel;
      target.applyMatrix4(lightRot);
    }
    sun.target.position.copy(target);
    sun.position.copy(target).addScaledVector(this.sunDir, 400);
    if (this.shadowExt) {
      // The box follows the player in the street, so it is redrawn every frame; from the table every
      // third frame is plenty. A skipped frame keeps the previous map with its own light matrix, so
      // shadows never slide, they only lag the people and cars by a frame or two.
      const interval = street === 1 ? (budget < 0.5 ? 3 : budget < 0.8 ? 2 : 1) : 3;
      this.shadowTick = (this.shadowTick + 1) % interval;
      sun.shadow.needsUpdate = shadows && (this.shadowTick === 0 || !sun.shadow.map);
    }
  }
}
