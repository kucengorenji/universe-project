// Houses the player designed: put them into the town, the "Build House" button, and picking a house to edit.
// Methods of the town instance (mixed into TownMode, see mixin.js): they use its state and are called as this.<name>().

import * as THREE from 'three';
import { ensureHomeRecord, listTownHomes, townHomeContext } from '../../../world/homeState.js';
import { applyAuthoredHomes } from '../authoredHomes.js';
import { createHomeGroup } from '../../home/homeBuilder.js';
import { t as tr } from '../../../i18n/index.js';
import { HOME_SHELLS } from './shared.js';

export class HomeMethods {
  prepareAuthoredHomes() {
    const homes = listTownHomes(this.ctx.world.state, this.route.planet, this.route.city).filter(home => home.layoutSeed === this.layout.seed);
    this.homes = applyAuthoredHomes(homes, this.layout, this.footprints);
  }

  addAuthoredHomes(quality) {
    this.homeGroups = [];
    for (const b of this.layout.buildings) {
      const home = b.homeRecord;
      if (!home) continue;
      const lod = new THREE.LOD();
      for (const level of [1, 2]) {
        const group = createHomeGroup(home.applied, { lod: level, pack: this.homePack });
        group.traverse(node => {
          if (node.isMesh) { node.userData.townShadow = level < 2; node.castShadow = quality.settings.shadows && level < 2; node.receiveShadow = quality.settings.shadows; }
        });
        lod.addLevel(group, level === 1 ? 0 : 140 * quality.settings.detail);
        this.homeGroups.push(group);
      }
      lod.position.set(home.origin.x, this.builder.groundAt(home.origin.x, home.origin.z), home.origin.z);
      lod.rotation.y = -home.origin.yaw;
      this.scene.add(lod);
    }
  }

  setupHomeEntry() {
    this.homeButton = document.createElement('button');
    this.homeButton.type = 'button';
    this.homeButton.className = 'pill pill--ghost town-home';
    this.homeButton.textContent = tr('town.home.build');
    this.homeButton.title = tr('town.home.build.title');
    this.homeButton.setAttribute('aria-pressed', 'false');
    this.onHomeEntry = () => this.toggleHomeSelection();
    this.homeButton.addEventListener('click', this.onHomeEntry);
    this.ui.querySelector('.topbar__right').prepend(this.homeButton);
  }

  showHomeMessage(message) {
    clearTimeout(this.homeMessageTimer);
    const previous = this.hud.hint.textContent;
    this.hud.hint.textContent = message;
    this.homeMessageTimer = setTimeout(() => {
      if (this.hud && !this.homePicking && this.hud.hint.textContent === message) this.hud.hint.textContent = previous;
    }, 6500);
  }

  toggleHomeSelection(enabled = !this.homePicking) {
    if (enabled && (this.interior || this.planner || this.tween || this.transfer)) return;
    if (enabled && this.view !== 'diorama') this.setView('diorama');
    this.homePicking = enabled;
    this.homeButton?.setAttribute('aria-pressed', String(enabled));
    if (this.homeButton) this.homeButton.textContent = tr(enabled ? 'town.home.cancel' : 'town.home.build');
    this.ctx.engine.renderer.domElement.style.cursor = enabled ? 'crosshair' : '';
    if (enabled) {
      this.homePreviousHint = this.hud.hint.textContent;
      this.hud.hint.textContent = tr('town.home.pickHint');
    } else if (this.homePreviousHint) this.hud.hint.textContent = this.homePreviousHint;
  }

  pickHomeAt(clientX, clientY) {
    if (!this.homePicking || this.view !== 'diorama' || this.tween || this.planner) return;
    const canvas = this.ctx.engine.renderer.domElement, rect = canvas.getBoundingClientRect();
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1), this.renderCamera);
    let best = null, distance = Infinity;
    for (const b of this.layout.buildings) {
      if (!HOME_SHELLS.has(b.asset)) continue;
      const f = b.homeBounds || this.footprints[b.asset];
      const sx = b.homeBounds ? 1 : b.sx ?? 1, sz = b.homeBounds ? 1 : b.sz ?? 1;
      const bounds = new THREE.Box3(new THREE.Vector3((f?.minX ?? -b.w / 2) * sx, 0, (f?.minZ ?? -b.d / 2) * sz), new THREE.Vector3((f?.maxX ?? b.w / 2) * sx, b.homeHeight || f?.maxY || 12, (f?.maxZ ?? b.d / 2) * sz));
      const matrix = new THREE.Matrix4().makeRotationY(-b.yaw).setPosition(b.x, this.builder.groundAt(b.x, b.z), b.z);
      const ray = raycaster.ray.clone().applyMatrix4(matrix.clone().invert());
      const hit = ray.intersectBox(bounds, new THREE.Vector3());
      if (!hit) continue;
      const d = hit.applyMatrix4(matrix).distanceTo(raycaster.ray.origin);
      if (d < distance) { best = b; distance = d; }
    }
    if (!best) { this.showHomeMessage(tr('town.home.pickMissed')); return; }
    const context = townHomeContext(this.layout, best, this.footprints, this.homes);
    if (context.unavailable && !best.homeRecord) {
      this.showHomeMessage(tr('town.home.tooClose'));
      return;
    }
    const home = ensureHomeRecord(this.ctx.world.state, { planet: this.route.planet, city: this.route.city, townSeed: this.townSeed, layoutSeed: this.layout.seed, layoutVersion: this.layout.layoutVersion, building: best, ...context });
    this.toggleHomeSelection(false);
    this.ctx.director.go({ mode: 'home', planet: this.route.planet, city: this.route.city, home: home.id });
  }
}
