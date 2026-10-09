import * as THREE from 'three';
import { loadAssetPack, createToonMaterial } from '../../src/render/assetLibrary.js';
import { ASSETS } from '../../src/render/assetManifest.js';
import { assemble, buildKitModel, poseKitWheels, kitMaterial } from '../../src/modes/town/vehicles/vehicleKit.js';
import { loadTownPeople, makeTownPerson, animateTownPerson, disposeTownPerson } from '../../src/modes/town/people/skirmishPeople.js';
import { mulberry32 } from '../../src/math/random.js';

/** Render the real exported assets with the game's materials and animation path. */
export async function cozyActorGallery({ kind = 'vehicles', lod = 0, angle = 'front', motion = false } = {}) {
  const app = window.__globe;
  window.__cozyGallery?.restore();
  const oldMode = app.engine.mode;
  const [pack, npc] = await Promise.all([loadAssetPack(ASSETS.townPack), loadTownPeople()]);
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#e4e6cd');
  scene.add(new THREE.HemisphereLight('#fff5de', '#9aab87', 2.2));
  const sun = new THREE.DirectionalLight('#fff5df', 2); sun.position.set(-12, 20, 16); scene.add(sun);
  const owned = [], people = [], models = [], stats = [];
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: '#b8c59b', roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -.012; scene.add(floor); owned.push(floor.geometry, floor.material);
  const label = (name, x, z, width = 4) => {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 64;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#526558'; ctx.font = '28px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(name, 256, 44);
    const map = new THREE.CanvasTexture(canvas), mat = new THREE.SpriteMaterial({ map, depthTest: false });
    const sprite = new THREE.Sprite(mat); sprite.position.set(x, .12, z); sprite.scale.set(width, width / 8, 1); scene.add(sprite); owned.push(map, mat);
  };
  let half, target;
  if (kind === 'people') {
    const poses = ['idle', 'walk', 'run', 'jump', 'sit', 'sleep'];
    poses.forEach((pose, i) => {
      const p = makeTownPerson(npc, { seed: i * 131 + 42, player: !i, shadows: false });
      p.root.position.set((i - 2.5) * 1.6, pose === 'sit' ? .35 : pose === 'sleep' ? .6 : pose === 'jump' ? .4 : 0, 0);
      p.root.rotation.y = angle === 'back' ? Math.PI : angle === 'side' ? Math.PI / 2 : .12;
      const speed = [0, 1.4, 4.6, 2, 0, 0][i];
      const options = { pose: ['sit', 'sleep'].includes(pose) ? pose : null, jump: pose === 'jump' ? .4 : 0 };
      for (let f = 0; f < 30; f++) animateTownPerson(p, 1 / 60, speed, options);
      scene.add(p.root); people.push({ p, speed, options });
      label(pose, p.root.position.x, 1.1, 1.4);
      stats.push({ pose, triangles: p.mesh.geometry.index.count / 3, rig: 'skirmish-v5' });
    });
    half = 3.3; target = new THREE.Vector3(0, .90, 0);
  } else {
    const types = kind === 'carts' ? ['cart', 'wagon', 'caravan'] : ['sedan', 'hatch', 'suv', 'van', 'pickup', 'sport', 'taxi', 'police', 'bus'];
    const selected = Object.fromEntries(Object.entries(pack).map(([name, levels]) => [name, { 0: levels[lod] }]));
    types.forEach((type, i) => {
      const model = buildKitModel(assemble(type, mulberry32(100 + i)), selected, kitMaterial(createToonMaterial));
      model.group.position.set((i % 3 - 1) * 6.4, 0, (Math.floor(i / 3) - (kind === 'carts' ? 0 : 1)) * 8.5);
      model.group.rotation.y = -.32; scene.add(model.group); models.push(model);
      label(type, model.group.position.x, model.group.position.z + (type === 'bus' ? 6.3 : 3.3));
      let triangles = 0; model.group.traverse(o => { if (o.isMesh) triangles += o.geometry.attributes.position.count / 3; });
      stats.push({ type, lod, triangles });
    });
    half = kind === 'carts' ? 7.5 : 15; target = new THREE.Vector3(0, .8, 0);
  }
  const aspect = app.engine.size.width / app.engine.size.height;
  const camera = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, .1, 150);
  camera.position.copy(target).add(kind === 'people' ? new THREE.Vector3(0, 2.8, 14) : new THREE.Vector3(11, 22, 32)); camera.lookAt(target);
  const style = document.createElement('style'); style.textContent = '.mode-ui,#missionUi,#tipUi,#pauseUi,#cover{visibility:hidden}'; document.head.append(style);
  let distance = 0;
  const gallery = {
    update(dt) {
      if (!motion) return;
      distance += dt * 2;
      models.forEach(model => poseKitWheels(model, distance, Math.sin(distance) * .2));
      people.forEach(({ p, speed, options }) => animateTownPerson(p, dt, speed, options));
    },
    render() { app.engine.renderer.render(scene, camera); },
    resize(w, h) { camera.left = -half * w / h; camera.right = half * w / h; camera.updateProjectionMatrix(); },
    restore() {
      people.forEach(({ p }) => disposeTownPerson(p));
      models.forEach(model => model.group.traverse(o => { if (o.isInstancedMesh) { o.dispose(); o.geometry.dispose(); } }));
      owned.forEach(o => o.dispose()); style.remove(); app.engine.setMode(oldMode); window.__cozyGallery = null;
    }
  };
  window.__cozyGallery = gallery; app.engine.setMode(gallery);
  for (let i = 0; i < 8; i++) await app.engine.afterFrame();
  if (app.engine.lastError) throw app.engine.lastError;
  return { kind, lod, angle, assets: stats, error: null };
}
