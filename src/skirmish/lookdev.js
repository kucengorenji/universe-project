import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadAssetPack } from '../render/assetLibrary.js';
import { ASSETS } from '../render/assetManifest.js';
import { generateField, heightAt } from './battlefield/generateField.js';
import { FieldBuilder } from './battlefield/fieldBuilder.js';
import { CanvasPost, installCanvasShading } from './render/canvasStyle.js';
import { SkyLight } from './render/skyLight.js';
import { loadSoldierTemplates, loadWeapons, makeSoldier, animateSoldier, disposeSoldier } from './units/soldiers.js';
import { CLASSES } from './units/soldierLook.js';

// Look-development scene for the skirmish art direction: a generated battlefield, both
// factions' soldiers in a lineup, the canvas post on or off, times of day and camera presets.
// Runs as an engine mode (update/render/resize), see src/core/engine.js.

const POSES = ['ready', 'aim', 'crouch', 'crouch-aim', 'walk', 'run', 'crouch-walk', 'down', 'dead'];

export class LookDev {
  constructor(engine, ui) {
    this.engine = engine;
    this.ui = ui;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.2, 2500);
    this.post = new CanvasPost(engine.renderer);
    this.controls = new OrbitControls(this.camera, engine.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.soldiers = [];
    this.pose = 'ready';
    this.shadows = engine.quality.settings.shadows;
    engine.renderer.shadowMap.enabled = this.shadows;
    engine.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.sky = new SkyLight(this.scene, { shadows: this.shadows, mapSize: engine.quality.tier === 'high' ? 4096 : 2048 });
  }

  async enter({ seed, time = 'day' }) {
    installCanvasShading();
    const [town, military, templates] = await Promise.all([
      loadAssetPack(ASSETS.townPack),
      loadAssetPack(ASSETS.militaryPack, { glow: { M_radiator: 1 } }),
      loadSoldierTemplates(ASSETS.soldierPack)
    ]);
    this.packs = { town, military };
    this.templates = templates;
    this.weapons = await loadWeapons(ASSETS.militaryPack, military);
    this.setTime(time);
    this.build(seed);
    this.view('lineup');
  }

  build(seed) {
    this.field?.dispose();
    for (const s of this.soldiers) disposeSoldier(s);
    this.soldiers = [];
    const t0 = performance.now();
    this.data = generateField(seed);
    const t1 = performance.now();
    this.field = new FieldBuilder(this.data, this.packs, { shadows: this.shadows });
    this.scene.add(this.field.group);
    this.stats = { generate: Math.round(t1 - t0), build: Math.round(performance.now() - t1), houses: this.data.houses.length, grass: this.field.grassCount || 0 };
    this.lineup();
    this.ui?.onBuilt?.(this);
  }

  /** Both squads in two rows in front of the player's camp, facing the camera. */
  lineup() {
    const d = this.data;
    const camp = d.camps[0];
    const classes = Object.keys(CLASSES);
    const base = new THREE.Vector3(camp.x, 0, camp.z - 13);
    this.lineupAt = base;
    ['fed', 'imp'].forEach((faction, row) => {
      classes.forEach((cls, i) => {
        const s = makeSoldier(this.templates, this.weapons, { faction, cls, seed: row * 10 + i + 3, shadows: this.shadows });
        const x = base.x + (i - 2) * 1.6, z = base.z + row * 2.4;
        s.root.position.set(x, heightAt(d, x, z), z);
        s.root.rotation.y = Math.PI; // face north, toward the camera preset
        s.home = s.root.position.clone();
        this.scene.add(s.root);
        this.soldiers.push(s);
      });
    });
  }

  setTime(time) {
    this.engine.renderer.toneMappingExposure = this.sky.set(time);
  }

  setPose(pose) {
    this.pose = POSES.includes(pose) ? pose : 'ready';
  }

  /** Camera presets. */
  view(name) {
    const d = this.data;
    const c = this.controls;
    const at = (x, z, dy = 0) => new THREE.Vector3(x, heightAt(d, x, z) + dy, z);
    const L = this.lineupAt;
    const presets = {
      lineup: [at(L.x, L.z - 7.5, 1.6), at(L.x, L.z + 1.2, 1.0)],
      portrait: [at(L.x + 1.4, L.z - 3.2, 1.65), at(L.x + 1.6, L.z, 1.35)],
      village: [at(d.camps[2].x + 26, d.camps[2].z + 30, 14), at(d.camps[2].x, d.camps[2].z, 1)],
      enemy: [at(d.tank.x + 14, d.tank.z + 22, 6), at(d.tank.x, d.tank.z - 4, 1.5)],
      overview: [new THREE.Vector3(0, 150, 150), new THREE.Vector3(0, 0, 0)],
      // over the right shoulder of the first soldier (the lineup faces north, -z: the right is +x)
      tps: [at(L.x - 3.2 + 0.95, L.z + 3.0, 2.1), at(L.x - 3.2 + 0.3, L.z - 12, 1.1)]
    };
    const [eye, target] = presets[name] || presets.lineup;
    this.camera.position.copy(eye);
    c.target.copy(target);
    c.update();
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const pr = this.engine.renderer.getPixelRatio();
    this.post.setSize(Math.floor(w * pr), Math.floor(h * pr));
  }

  update(dt, t) {
    this.controls.update();
    this.sky.dome.position.copy(this.camera.position);
    this.field?.update(dt);
    const pose = this.pose;
    const walking = pose === 'walk' || pose === 'run' || pose === 'crouch-walk';
    const speed = pose === 'walk' ? 1.4 : pose === 'run' ? 4.2 : pose === 'crouch-walk' ? 1.6 : 0;
    this.soldiers.forEach((s, i) => {
      if (walking) {
        // pace up and down in front of the line
        const phase = (t * speed) / 6 + i * 0.37;
        const leg = Math.floor(phase) % 2;
        const u = phase % 1;
        s.root.position.z = s.home.z + (leg ? 6 - u * 6 : u * 6) - 3;
        s.root.rotation.y = leg ? Math.PI : 0;
        s.root.position.y = heightAt(this.data, s.root.position.x, s.root.position.z);
      } else {
        s.root.position.copy(s.home);
        s.root.rotation.y = Math.PI;
      }
      s.aimYaw = Math.sin(t * 0.6 + i) * 0.15;
      s.aimPitch = Math.sin(t * 0.4 + i * 2) * 0.08;
      animateSoldier(s, dt, walking ? speed : 0, { aim: pose === 'aim' || pose === 'crouch-aim', crouch: pose.startsWith('crouch'), down: pose === 'down' || pose === 'dead' ? pose : false });
    });
  }

  render() {
    this.post.render(this.scene, this.camera);
  }

  dispose() {
    this.field?.dispose();
    for (const s of this.soldiers) disposeSoldier(s);
    this.sky.dispose();
    this.post.dispose();
    this.controls.dispose();
  }
}
