import { townFixture, townProfile } from './town_graphics_browser.js';

async function ready() {
  const until = performance.now() + 30000;
  while (!window.__globe?.director?.mode || window.__globe.director.busy) {
    if (performance.now() > until) throw Error('Town QA startup timed out');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

// Run only in a disposable QA browser context. Shared pack buffers stay owned
// by the app; this gallery disposes only its own labels and floor.
export async function townAssetGallery({ kind = 'modern', lod = 0 } = {}) {
  await ready();
  window.__townAssetGallery?.restore();
  await townFixture({ modern: kind !== 'fantasy' });
  const app = window.__globe, town = app.director.mode, THREE = app.three;
  const names = Object.keys(town.builder.townPack).filter(name => kind === 'props'
    ? /^(g_|f_well$|f_market_stall|f_fence$|[fm]_lamp$|m_bench$)/.test(name)
    : kind === 'fantasy' ? /^f_(house|townhouse|shop|tavern|castle|temple|tower)/.test(name)
      : /^m_(house|shop|apartment|office|tower|spire)/.test(name));
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#d6dfdc');
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8d8a70, 2));
  const sun = new THREE.DirectionalLight(0xfff2db, 2.3); sun.position.set(-20, 40, 30); scene.add(sun);
  const columns = 4, rows = Math.ceil(names.length / columns), cell = 26;
  const owned = [], labels = [], stats = [];
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(columns * cell, rows * cell), new THREE.MeshStandardMaterial({ color: '#aeb5a7', roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -.1; scene.add(floor); owned.push(floor.geometry, floor.material);
  names.forEach((name, index) => {
    const variant = Number(/_v(\d+)$/.exec(name)?.[1] ?? 0);
    const res = town.builder.resolve(name.replace(/_v\d+$/, ''), variant);
    if (!res) throw Error(`Missing asset ${name}`);
    const g = res.lods[lod]; g.computeBoundingBox();
    const size = g.boundingBox.getSize(new THREE.Vector3());
    const scale = 17 / Math.max(size.x, size.y, size.z);
    const x = (index % columns - (columns - 1) / 2) * cell, z = (Math.floor(index / columns) - (rows - 1) / 2) * cell;
    const mesh = new THREE.Mesh(g, town.builder.material); mesh.position.set(x, 0, z); mesh.scale.setScalar(scale); scene.add(mesh);
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 64;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#263b37'; ctx.font = '30px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(name, 256, 42);
    const texture = new THREE.CanvasTexture(canvas), material = new THREE.SpriteMaterial({ map: texture, depthTest: false });
    const label = new THREE.Sprite(material); label.position.set(x, .3, z + 10); label.scale.set(23, 2.9, 1); scene.add(label); labels.push(label); owned.push(texture, material);
    stats.push({ name, lod, triangles: g.attributes.position.count / 3, revision: g.userData.townAssetRevision ?? 0 });
  });
  const aspect = app.engine.size.width / app.engine.size.height;
  const half = Math.max(rows * cell, columns * cell / aspect) * .68;
  const camera = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, .1, 1000);
  camera.position.set(45, 100, 115); camera.lookAt(0, 5, 0);
  const style = document.createElement('style'); style.textContent = '#townUi,#missionUi,#tipUi,#pauseUi{visibility:hidden}'; document.head.append(style);
  let restored = false;
  const gallery = {
    update(dt, time) { town.builder.uniforms.uTime.value = time; },
    render() { app.engine.renderer.render(scene, camera); },
    resize(w, h) { camera.left = -half * w / h; camera.right = half * w / h; camera.updateProjectionMatrix(); },
    restore() { if (restored) return; restored = true; style.remove(); owned.forEach(item => item.dispose()); app.engine.setMode(town); window.__townAssetGallery = null; }
  };
  window.__townAssetGallery = gallery; app.engine.setMode(gallery);
  for (let i = 0; i < 15; i++) await app.engine.afterFrame();
  if (app.engine.lastError) throw app.engine.lastError;
  return { kind, lod, assets: stats, error: null };
}

export async function townRefreshProfile(options = {}) {
  await ready();
  window.__townAssetGallery?.restore();
  await townFixture(options);
  const town = window.__globe.director.mode;
  const actor = town.view === 'drive' ? town.drive.car : town.player;
  const start = actor && { x: actor.x, z: actor.z };
  const moving = options.motion && ['walk', 'drive'].includes(town.view);
  if (moving) town.keys.add('w');
  let result;
  try { result = await townProfile({ frames: options.frames ?? 240 }); }
  finally { if (moving) town.keys.delete('w'); }
  const layout = town.layout;
  return { ...result, layoutVersion: layout.layoutVersion, cityR: layout.cityR, dioramaR: layout.dioramaR,
    motionDistance: moving ? Math.round(Math.hypot(actor.x - start.x, actor.z - start.z) * 100) / 100 : null,
    trunks: layout.trees.filter(item => /^(t_|tree_)/.test(item.asset)).length };
}
