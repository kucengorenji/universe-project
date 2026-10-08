// Captures the manual screenshots for the landing page from the running game.
//   LANDING_QA_URL=http://127.0.0.1:5198/ PLAYWRIGHT_CORE=<path> node tools/qa/landing_shots.mjs
// Output: public/landing/shots/*.jpg (one per level/feature) + shots.json (what was captured).
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const base = process.env.LANDING_QA_URL || 'http://127.0.0.1:5198/';
const output = path.resolve(process.env.LANDING_SHOTS_OUTPUT || 'public/landing/shots');
const only = process.env.LANDING_SHOTS_ONLY?.split(',');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [], shots = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error' && /shader|webgl|THREE|TypeError|ReferenceError/i.test(message.text())) errors.push(message.text()); });

const frames = (n = 20) => page.evaluate(async n => { for (let i = 0; i < n; i++) await window.__globe.engine.afterFrame(); }, n);
async function shot(name, { frame = 24, chrome = true } = {}) {
  if (only && !only.includes(name)) return;
  await frames(frame);
  const error = await page.evaluate(() => window.__globe.engine.lastError?.message);
  if (error) throw Error(`${name}: ${error}`);
  // Mission/tip/pause chrome is noise in a manual; the mode HUD stays because it is what the text points at.
  await page.evaluate(hide => document.querySelectorAll('#missionUi, #tipUi, #pauseUi, #cover:not(.is-on)').forEach(el => el.style.visibility = hide ? 'hidden' : ''), true);
  await page.screenshot({ path: path.join(output, `${name}.jpg`), type: 'jpeg', quality: 84 });
  shots.push(name); console.log('captured', name);
}
const run = (fn, arg) => page.evaluate(fn, arg);

try {
  await page.goto(new URL('play/', base).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__globe && !window.__globe.director.busy, null, { timeout: 60000 });
  const welcome = page.getByRole('button', { name: 'Mulai menjelajah' });
  if (await welcome.isVisible()) await welcome.click();
  await run(() => { const a = window.__globe; a.world.sunAt = () => ({ x: -.45, y: .8, z: .4 }); a.engine.quality.setPreset('high', false); });
  // One fixture world for every shot: a fantasy town with a river and bridge, found deterministically like the pixel QA.
  const fixture = await run(async () => {
    const a = window.__globe;
    // Build the real towns (the standalone generator call can disagree with TownMode's own arguments).
    for (const seed of [42, 74291, 12345, 20260929, 173, 1001, 20261008]) {
      a.world.regenerateHome(seed); await a.world.ready;
      for (let t = 0; t < 50 && a.world.homeMap?.seed !== seed; t++) await new Promise(r => setTimeout(r, 100));
      if (a.world.homeMap?.seed !== seed) continue;
      const cities = a.world.mapFor(a.world.homeIndex).cities;
      for (let i = 0; i < cities.length; i++) {
        if (cities[i].style === 'modern') continue;
        await a.director.go({ mode: 'town', planet: a.world.homeIndex, city: i });
        const m = a.director.mode;
        if (m.layout?.bridges?.length && !m.layout.modern && m.city.style !== 'modern') return { seed, city: i, name: m.city.name };
      }
    }
    return null;
  });
  if (!fixture) throw Error('No fantasy bridge town fixture');
  console.log('fixture', fixture);
  await run(async seed => {
    const a = window.__globe; a.world.regenerateHome(seed); await a.world.ready;
    for (let t = 0; t < 50 && a.world.homeMap?.seed !== seed; t++) await new Promise(r => setTimeout(r, 100));
  }, fixture.seed);

  // 01: Space: the star system the world seed generates.
  await run(async () => { const a = window.__globe; await a.director.go({ mode: 'space', planet: null }); a.director.mode.ctx.tips?.hide?.(); });
  await shot('space-system', { frame: 90 });

  // 02: Space: the system map (M).
  await run(() => document.querySelector('[data-act=map]').click());
  await shot('space-map', { frame: 60 });
  await run(() => document.querySelector('[data-act=map]').click());

  // 03: Planet globe.
  await run(async () => { const a = window.__globe; await a.director.go({ mode: 'planet', planet: a.world.homeIndex }); a.director.mode.ctx.tips?.hide?.(); });
  await shot('planet-globe', { frame: 60 });

  // 04: Other planet types come from the same generator with different parameters.
  for (const type of ['desert', 'ice', 'lava', 'barren', 'ocean']) {
    const index = await run(async type => {
      const a = window.__globe, system = a.world.system, p = system.planets.find(p => p.type === type && p.landable);
      if (!p) return -1;
      await a.director.go({ mode: 'planet', planet: p.index }); a.director.mode.ctx.tips?.hide?.();
      return p.index;
    }, type);
    if (index >= 0) await shot(`planet-${type}`, { frame: 60 }); else console.log('no planet of type', type);
  }

  const gotoTown = (city = fixture.city, style = 'normal') => run(async ({ city, style }) => {
    const a = window.__globe;
    await a.director.go({ mode: 'town', planet: a.world.homeIndex, city });
    const m = a.director.mode; m.tween = null; m.ctx.tips.hide();
    m.setTownStyle(style);
  }, { city, style });

  // 05: Town diorama (normal).
  await gotoTown();
  const verified = await run(() => { const m = window.__globe.director.mode; return { bridges: m.layout.bridges?.length, modern: !!m.layout.modern, name: m.city.name, seed: window.__globe.world.homeMap.seed }; });
  if (!verified.bridges || verified.modern) throw Error('Fixture town is not a fantasy bridge town: ' + JSON.stringify(verified));
  await shot('town-diorama', { frame: 60 });

  // 06: Town planner (2D master plan).
  await run(() => window.__globe.director.mode.openPlanner());
  await shot('town-planner', { frame: 30 });
  await run(() => { const m = window.__globe.director.mode; m.closePlanner(); });

  // 07: Walking on the street.
  await run(async () => {
    const a = window.__globe, m = a.director.mode;
    m.setView('walk'); for (let i = 0; i < 60 && m.transfer; i++) await a.engine.afterFrame();
    // Stand in the middle of the longest main street, facing along it.
    const street = [...m.layout.streets].filter(s => s.kind === 'main').sort((p, q) => q.pts.length - p.pts.length)[0] || m.layout.streets[0];
    const i = Math.max(0, Math.floor(street.pts.length / 2) - 1), [x0, z0] = street.pts[i], [x1, z1] = street.pts[i + 1] || street.pts[i];
    m.placePlayer((x0 + x1) / 2, (z0 + z1) / 2);
    m.player.yaw = Math.atan2(x1 - x0, z1 - z0); if (m.follow) m.follow.yaw = m.player.yaw + Math.PI;
  });
  await shot('town-walk', { frame: 80 });

  // 08: Driving.
  await run(async () => { const a = window.__globe, m = a.director.mode; m.setView('drive'); for (let i = 0; i < 180 && (m.transfer || m.view !== 'drive'); i++) await a.engine.afterFrame(); });
  await shot('town-drive', { frame: 40 });

  // 09: Pixel style.
  await gotoTown(fixture.city, 'pixel');
  await run(() => { const m = window.__globe.director.mode; m.setPixelZoom(0); const f = m.layout.bridges[0] || m.layout.plaza; m.orbit.target.set(f.x, m.builder.groundAt(f.x, f.z), f.z); });
  await shot('town-pixel', { frame: 60 });

  // 10: Modern city (same generator, different archetype).
  const modern = await run(() => window.__globe.world.mapFor(window.__globe.world.homeIndex).cities.findIndex(c => c.style === 'modern'));
  if (modern >= 0) { await gotoTown(modern, 'normal'); await shot('town-modern', { frame: 60 }); }

  // 11: Inside a house (procedural floor plan, dollhouse view).
  await gotoTown(fixture.city, 'normal');
  await run(async () => { const a = window.__globe, m = a.director.mode, door = m.doors.find(d => d.b.blueprint && !d.b.homeRecord); await m.enterBuilding(door); });
  await shot('interior', { frame: 60 });
  await run(async () => { await window.__globe.director.mode.exitBuilding(); });

  // 12–14: Home builder: pick a house in the town, then plan / diorama / explore.
  await gotoTown(fixture.city, 'normal');
  await run(async () => {
    const a = window.__globe, m = a.director.mode;
    m.setView('diorama'); m.tween = null;
    const HOME_SHELLS = new Set(['f_house_small', 'f_house', 'f_house_tall', 'f_townhouse', 'm_house']);
    const Vec3 = m.renderCamera.position.constructor;
    const cam = m.renderCamera, rect = a.engine.renderer.domElement.getBoundingClientRect();
    const candidates = m.layout.buildings.filter(b => HOME_SHELLS.has(b.asset))
      .map(b => { const v = new Vec3(b.x, m.builder.groundAt(b.x, b.z) + 4, b.z).project(cam); return { b, v, d: Math.hypot(v.x, v.y) }; })
      .filter(c => c.v.z < 1 && Math.abs(c.v.x) < .8 && Math.abs(c.v.y) < .8).sort((p, q) => p.d - q.d);
    window.__homePick = candidates.slice(0, 12).map(c => ({ x: rect.left + (c.v.x + 1) / 2 * rect.width, y: rect.top + (1 - c.v.y) / 2 * rect.height }));
  });
  const picks = await run(() => window.__homePick);
  let inHome = false;
  for (const p of picks) {
    await run(p => { const m = window.__globe.director.mode; m.toggleHomeSelection(true); m.pickHomeAt(p.x, p.y); }, p);
    await page.waitForTimeout(1500);
    inHome = await run(() => window.__globe.director.mode?.constructor?.name === 'HomeMode' || location.hash.startsWith('#/home'));
    if (inHome) break;
  }
  if (!inHome) throw Error('Could not open the home builder from the town');
  await page.waitForFunction(() => !window.__globe.director.busy, null, { timeout: 60000 });
  await shot('home-plan', { frame: 30 });
  await run(() => { const m = window.__globe.director.mode; m.commit(m.bp); m.ui.querySelector('[data-act=generate]').click(); });
  await run(async () => { const m = window.__globe.director.mode; m.camera.position.lerp(m.orbit.target, .3); m.orbit.update(); });
  await shot('home-diorama', { frame: 60 });
  // Roof on: the finished house as it appears in the town.
  await run(async () => { const m = window.__globe.director.mode, box = m.ui.querySelector('[data-field=cutaway]'); box.checked = false; box.dispatchEvent(new Event('change', { bubbles: true })); m.camera.position.lerp(m.orbit.target, -.1); m.orbit.update(); });
  await shot('home-exterior', { frame: 60 });

  if (errors.length) throw Error(errors.join('\n'));
  await writeFile(path.join(output, 'shots.json'), JSON.stringify({ capturedAt: new Date().toISOString(), browser: browser.version(), fixture, shots, errors }, null, 2));
  console.log(JSON.stringify({ pass: true, shots, output }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, '_failure.png') }).catch(() => {});
  console.error(error); process.exitCode = 1;
} finally { await browser.close(); }
