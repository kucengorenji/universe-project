import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const output = path.resolve(process.env.PIXEL_QA_OUTPUT || 'docs/qa/pixel-town');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error' && /shader|webgl|THREE|TypeError|ReferenceError/i.test(message.text())) errors.push(message.text()); });
const checks = [];
const environment = { browser: browser.version(), headless: true, desktopViewport: '1440x900', narrowViewport: '390x844', deviceScaleFactor: 1 };
async function check(name, fn) {
  const value = await page.evaluate(fn); checks.push({ ...value, name });
  if (!value.pass) throw Error(`${name}: ${JSON.stringify(value)}`);
}
try {
  await page.goto(process.env.PIXEL_QA_URL || 'http://127.0.0.1:5198/play/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__globe && !window.__globe.director.busy, null, { timeout: 60000 });
  const welcome = page.getByRole('button', { name: 'Mulai menjelajah' });
  if (await welcome.isVisible()) await welcome.click();
  await page.evaluate(async () => {
    const a = window.__globe;
    a.world.regenerateHome(74291);
    await a.world.ready;
    a.world.sunAt = () => ({ x: -.45, y: .8, z: .4 });
    a.engine.quality.setPreset('high', false);
    const map = a.world.mapFor(a.world.homeIndex);
    let city = map.cities.findIndex(c => c.style !== 'modern');
    await a.director.go({ mode: 'town', planet: a.world.homeIndex, city });
    const { generateTownLayout } = await import('/src/modes/town/layout/townLayout.js');
    let found = false;
    const footprints = a.director.mode.footprints;
    for (const seed of [74291, 42, 12345, 20260929, 173, 1001, 20261008]) {
      a.world.regenerateHome(seed); await a.world.ready;
      const candidateMap = a.world.mapFor(a.world.homeIndex), hexasphere = a.world.activate(candidateMap);
      for (let i = 0; i < candidateMap.cities.length; i++) {
        if (candidateMap.cities[i].style === 'modern') continue;
        const layout = generateTownLayout({ map: candidateMap, hexasphere, cityIndex: i, planetType: 'terran', detail: 1, footprints, layoutVersion: 4 });
        if (layout.bridges?.length) { city = i; found = true; break; }
      }
      if (found) break;
    }
    if (!found) throw Error('No river/bridge town found in the deterministic QA seeds');
    await a.director.go({ mode: 'town', planet: a.world.homeIndex, city });
    const m = a.director.mode; m.tween = null; m.ctx.tips.hide();
    const focus = m.layout.bridges?.[0] || m.builder.bridges?.[0] || m.layout.plaza;
    m.orbit.target.set(focus.x, m.builder.groundAt(focus.x, focus.z), focus.z);
    window.__pixelBaseline = { layout: m.layout, colliders: m.colliders, player: { x: m.player.x, z: m.player.z }, buildings: m.layout.buildings.map(b => [b.id, b.x, b.z, b.w, b.d]) };
    m.setTownStyle('pixel'); m.setPixelZoom(0);
    for (let i = 0; i < 30; i++) await a.engine.afterFrame();
  });
  await check('pixel shares layout, collider and player state', () => {
    const a = window.__globe, m = a.director.mode, b = window.__pixelBaseline;
    return { pass: m.layout === b.layout && m.colliders === b.colliders && m.player.x === b.player.x && m.player.z === b.player.z && m.builder.bridges.length > 0 && !a.engine.lastError,
      worldSeed: a.world.homeMap.seed, seed: m.layout.seed, planet: m.route.planet, city: m.route.city, cityName: m.city.name, buildings: m.layout.buildings.length, vegetationInstances: m.pixel.vegetation.count, bridges: m.builder.bridges.length, camera: m.renderCamera.type, error: a.engine.lastError?.message };
  });
  await page.screenshot({ path: path.join(output, 'pixel-diorama.png') });
  await page.evaluate(() => { const m = window.__globe.director.mode; m.setView('walk'); m.setPixelZoom(0); });
  await check('walking responds and camera direction stays fixed', async () => {
    const a = window.__globe, m = a.director.mode, p = { x: m.player.x, z: m.player.z }, q = m.renderCamera.quaternion.clone();
    m.keys.add('w'); for (let i = 0; i < 45; i++) await a.engine.afterFrame(); m.keys.delete('w');
    const moved = Math.hypot(m.player.x - p.x, m.player.z - p.z), angle = q.angleTo(m.renderCamera.quaternion);
    return { pass: moved > .1 && angle < 1e-6 && m.view === 'walk' && !a.engine.lastError, moved, angle, error: a.engine.lastError?.message };
  });
  await page.screenshot({ path: path.join(output, 'pixel-walk.png') });
  await check('bridge deck preserves analytical surface and collision identity', () => {
    const m = window.__globe.director.mode, bridge = m.builder.bridges[0], before = m.builder.surfaceAt(bridge.x, bridge.z), colliders = m.colliders;
    m.setTownStyle('normal'); const normal = m.builder.surfaceAt(bridge.x, bridge.z);
    m.setTownStyle('pixel'); const pixel = m.builder.surfaceAt(bridge.x, bridge.z);
    return { pass: before === normal && normal === pixel && colliders === m.colliders && m.pixel.bridges.group.children.length > 0, surface: pixel };
  });
  await check('building occlusion draws a player silhouette', async () => {
    const a = window.__globe, m = a.director.mode;
    let found = false;
    for (const b of m.layout.buildings) {
      const r = Math.max(b.w, b.d) * .72 + .8;
      m.placePlayer(b.x - r * Math.SQRT1_2, b.z - r * Math.SQRT1_2);
      m.player.speed = 0; m.player.motionSpeed = 0;
      m.pixel.update(0, true); m.updateAvatar(0);
      if (m.pixel.occluded) { found = true; break; }
    }
    for (let i = 0; i < 10; i++) await a.engine.afterFrame();
    m.render();
    return { pass: found && m.pixel.occluded && m.avatar.root.visible && !a.engine.lastError, found, occluded: m.pixel.occluded, error: a.engine.lastError?.message };
  });
  await page.screenshot({ path: path.join(output, 'pixel-silhouette.png') });
  await check('foliage fade changes pixels only near the followed actor', () => {
    const a = window.__globe, m = a.director.mode, r = a.engine.renderer;
    const target = m.pixel.renderer.target, before = new Uint8Array(target.width * target.height * 4), after = before.slice();
    let changed = 0, outsideRadius = 0;
    for (const tree of m.layout.trees.filter(t => /^t_(oak|birch|pine|spruce|fruit)/.test(t.asset) && t.w > 3).slice(0, 35)) {
      m.placePlayer(tree.x - 2.8, tree.z - 2.8); m.pixel.update(0, true); m.updateAvatar(0);
      m.pixel.uniforms.uPixelActor.value = 0; m.pixel.render(); r.readRenderTargetPixels(target, 0, 0, target.width, target.height, before);
      m.pixel.uniforms.uPixelActor.value = 1; m.pixel.render(); r.readRenderTargetPixels(target, 0, 0, target.width, target.height, after);
      const focus = m.pixel.uniforms.uPixelFocus.value, radius = m.pixel.uniforms.uPixelFocusRadius.value;
      for (let i = 0; i < before.length; i += 4) if (before[i] !== after[i] || before[i + 1] !== after[i + 1] || before[i + 2] !== after[i + 2]) {
        changed++;
        const pixel = i / 4, x = pixel % target.width + .5, y = Math.floor(pixel / target.width) + .5;
        if (Math.hypot(x - focus.x, y - focus.y) > radius + 1) outsideRadius++;
      }
      if (changed > 0) break;
    }
    return { pass: changed > 0 && !outsideRadius && !a.engine.lastError, changedPixels: changed, outsideRadius, error: a.engine.lastError?.message };
  });
  await page.screenshot({ path: path.join(output, 'pixel-foliage.png') });
  await check('three zoom presets, scoped HUD and low quality pixel rendering', async () => {
    const a = window.__globe, m = a.director.mode, spans = [];
    for (let i = 0; i < 3; i++) { m.setPixelZoom(i); spans.push(m.pixel.rig.span); }
    a.engine.quality.setPreset('low', false); a.engine.post.setPref('off');
    for (let i = 0; i < 10; i++) await a.engine.afterFrame();
    return { pass: spans[0] < spans[1] && spans[1] < spans[2] && m.pixelActive && m.renderCamera.isOrthographicCamera && m.ui.classList.contains('is-pixel') && !a.engine.lastError,
      spans, font: getComputedStyle(m.ui.querySelector('.wordmark')).fontFamily, target: m.pixel.renderer.resolution, postEnabled: a.engine.post.enabled, error: a.engine.lastError?.message };
  });
  await check('interior uses perspective and restores pixel exterior', async () => {
    const a = window.__globe, m = a.director.mode, door = m.doors.find(d => d.b.blueprint && !d.b.homeRecord);
    await m.enterBuilding(door);
    const inside = !m.pixelActive && m.renderCamera.isPerspectiveCamera && !m.ui.classList.contains('is-pixel');
    await m.exitBuilding(); for (let i = 0; i < 10; i++) await a.engine.afterFrame();
    return { pass: inside && m.pixelActive && m.renderCamera.isOrthographicCamera && m.pixel.active && m.ui.classList.contains('is-pixel') && !a.engine.lastError, inside, view: m.view, error: a.engine.lastError?.message };
  });
  await page.evaluate(async () => {
    const a = window.__globe, m = a.director.mode;
    a.engine.quality.setPreset('high', false); a.engine.post.setPref('auto');
    m.setView('drive'); for (let i = 0; i < 180 && (m.transfer || m.view !== 'drive'); i++) await a.engine.afterFrame();
  });
  await check('vehicle controls and fixed camera', async () => {
    const a = window.__globe, m = a.director.mode;
    if (!m.drive) return { pass: false, reason: 'No player vehicle' };
    const car = m.drive.car, p = { x: car.x, z: car.z }, q = m.renderCamera.quaternion.clone();
    m.keys.add('w'); for (let i = 0; i < 40; i++) await a.engine.afterFrame(); m.keys.delete('w');
    const moved = Math.hypot(car.x - p.x, car.z - p.z), angle = q.angleTo(m.renderCamera.quaternion);
    return { pass: moved > .05 && angle < 1e-6 && !a.engine.lastError, moved, angle, vehicle: m.drive.v.kit?.type, error: a.engine.lastError?.message };
  });
  await page.screenshot({ path: path.join(output, 'pixel-drive.png') });
  await check('repeated style switches retain the same resources and world', async () => {
    const a = window.__globe, m = a.director.mode, layout = m.layout, style = m.pixel;
    // Three uploads geometries/textures lazily: warm both views before comparing allocations.
    for (let i = 0; i < 2; i++) {
      m.setTownStyle('normal'); for (let j = 0; j < 10; j++) await a.engine.afterFrame();
      m.setTownStyle('pixel'); for (let j = 0; j < 10; j++) await a.engine.afterFrame();
    }
    const before = { ...a.engine.renderer.info.memory };
    for (let i = 0; i < 6; i++) {
      m.setTownStyle('normal'); await a.engine.afterFrame();
      m.setTownStyle('pixel'); await a.engine.afterFrame();
    }
    const after = { ...a.engine.renderer.info.memory };
    return { pass: m.layout === layout && m.pixel === style && before.geometries === after.geometries && before.textures === after.textures && !a.engine.lastError, before, after };
  });
  await check('pixel frame cadence and renderer resources are measurable', async () => {
    const { townProfile } = await import('/tools/qa/town_graphics_browser.js');
    const profile = await townProfile({ frames: 90 });
    return { pass: Number.isFinite(profile.fps) && !profile.error, fps: profile.fps, p95Ms: profile.frameMs.p95, drawCalls: profile.drawCalls, triangles: profile.triangles, memory: profile.memory };
  });
  await check('normal style restores materials and simulation state', async () => {
    const a = window.__globe, m = a.director.mode, layout = m.layout, drive = m.drive;
    m.setTownStyle('normal'); for (let i = 0; i < 10; i++) await a.engine.afterFrame();
    return { pass: m.layout === layout && m.drive === drive && m.renderCamera.isPerspectiveCamera && !m.ui.classList.contains('is-pixel') && m.pixel.bindings.every(b => b.mesh.material === b.original) && !a.engine.lastError, error: a.engine.lastError?.message };
  });
  await page.evaluate(() => window.__globe.director.mode.setTownStyle('pixel'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => { window.__globe.director.mode.ctx.tips.hide(); for (let i = 0; i < 10; i++) await window.__globe.engine.afterFrame(); });
  await page.waitForFunction(() => document.querySelector('#tipUi .tip').hidden);
  await check('narrow HUD exposes style, view and zoom controls', () => {
    const m = window.__globe.director.mode, nodes = [...m.ui.querySelectorAll('[data-style], [data-view], [data-pixel-zoom]'), document.querySelector('.mission-toggle'), document.querySelector('.pause-toggle')];
    const overflow = nodes.filter(n => { const r = n.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight; }).map(n => n.textContent);
    const covered = nodes.filter(n => { const r = n.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return hit !== n && !n.contains(hit); }).map(n => n.textContent || n.getAttribute('aria-label'));
    return { pass: !overflow.length && !covered.length && !window.__globe.engine.lastError, overflow, covered };
  });
  await page.screenshot({ path: path.join(output, 'pixel-narrow.png') });
  await check('narrow HUD wraps long city and planet names', async () => {
    const m = window.__globe.director.mode, title = m.ui.querySelector('.wordmark'), meta = m.ui.querySelector('.wordmark__meta');
    const original = title.firstChild.textContent, originalMeta = meta.textContent;
    try {
      title.firstChild.textContent = 'KotaPelabuhanDenganNamaSangatPanjangTanpaSpasi';
      meta.textContent = 'Kota fantasi, Planet Sungai dan Hutan Musim Gugur (Terran)';
      for (let i = 0; i < 5; i++) await window.__globe.engine.afterFrame();
      const nodes = [...m.ui.querySelectorAll('.wordmark, [data-style], [data-view], [data-pixel-zoom]')];
      const overflow = nodes.filter(n => { const r = n.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth || r.bottom > innerHeight; }).map(n => n.textContent);
      return { pass: !overflow.length, overflow, headerHeight: m.ui.querySelector('.topbar').getBoundingClientRect().height };
    } finally { title.firstChild.textContent = original; meta.textContent = originalMeta; }
  });
  await check('global style survives reload and does not leak to planet', async () => {
    const a = window.__globe, m = a.director.mode;
    const route = { ...m.route };
    await a.director.go({ mode: 'planet', planet: route.planet });
    const planet = a.director.mode;
    const clean = !document.body.dataset.townStyle && !document.querySelector('#townUi').classList.contains('is-pixel') && !planet.pixel;
    await a.director.go(route);
    const next = a.director.mode;
    for (let i = 0; i < 5; i++) await a.engine.afterFrame();
    return { pass: clean && next.pixelActive && next.layout.seed === window.__pixelBaseline.layout.seed && !a.engine.lastError, clean, style: next.townStyle, error: a.engine.lastError?.message };
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__globe?.director.mode?.pixelActive && !window.__globe.director.busy, null, { timeout: 60000 });
  await check('persisted preference opens the town in pixel after page reload', () => {
    const a = window.__globe, m = a.director.mode;
    return { pass: m.pixelActive && m.renderCamera.isOrthographicCamera && !a.engine.lastError, style: m.townStyle, camera: m.renderCamera.type };
  });
  if (errors.length) throw Error(errors.join('\n'));
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), environment, checks, errors }, null, 2));
  console.log(JSON.stringify({ pass: true, checks, output }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), environment, checks, errors, failure: error.stack }, null, 2));
  console.error(error); process.exitCode = 1;
} finally { await browser.close(); }
