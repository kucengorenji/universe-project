// farm.html V0 look-dev captures (docs/FARM_PLAN.md §7): every time of day from two camera yaws,
// plus a close view by the house. Fails on page errors and on engine.lastError.
//   VALLEY_QA_URL=http://127.0.0.1:5199/ PLAYWRIGHT_CORE=<path> node tools/qa/valley_lookdev.mjs
// Output: docs/qa/valley/*.jpg + lookdev.json (stats and GPU timing per shot).
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const playwright = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const chromium = playwright.chromium ?? playwright.default.chromium;
const base = process.env.VALLEY_QA_URL || 'http://127.0.0.1:5199/';
const output = path.resolve('docs/qa/valley');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [], shots = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (m) => { if (m.type() === 'error' || /warning/i.test(m.type())) errors.push(`${m.type()}: ${m.text()}`); });

const run = (fn, arg) => page.evaluate(fn, arg);
const frames = (n) => run(async (n) => { for (let i = 0; i < n; i++) await window.__valley.engine.afterFrame(); }, n);

try {
  await page.goto(new URL('farm.html?time=pagi', base).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__valley && document.body.classList.contains('ready'), null, { timeout: 60000 });
  await run(() => window.__valley.engine.quality.setPreset('high', false));
  const views = [
    { name: 'yaw0', yaw: 0, distance: 19, at: [-6.5, -2.5] },
    { name: 'yaw1', yaw: 1, distance: 19, at: [-6.5, -2.5] },
    { name: 'house', yaw: 0, distance: 12, at: [-4.5, -4.8] },
    { name: 'field', yaw: 3, distance: 16, at: [5, -1] },
    { name: 'wide', yaw: 0, distance: 40, at: [0, 0] },
    { name: 'orbit-low', yaw: 0.6, pitch: 22, distance: 15, at: [-6.5, -2.5] },
    { name: 'pan-river', yaw: 0, distance: 22, at: [-6.5, -2.5], pan: [30, 0, 4] },
    { name: 'square', yaw: 0, pitch: 38, distance: 30, at: [-1, 31] },
    { name: 'bridge', yaw: -0.5, pitch: 30, distance: 16, at: [30.5, 13] },
    { name: 'barn', yaw: 0.35, pitch: 34, distance: 22, at: [6, -14] },
    { name: 'valley', yaw: 0.2, pitch: 52, distance: 46, at: [2, 2] }
  ];
  for (const time of ['pagi', 'siang', 'sore', 'malam']) {
    for (const v of views) {
      if (time !== 'pagi' && !['yaw0', 'yaw1'].includes(v.name)) continue;
      await run(({ time, v }) => {
        const d = window.__valley.dev;
        d.setTime(time);
        d.sky.set(time, { instant: true });
        d.cam.yawTarget = v.yaw * Math.PI / 2;
        d.cam.pitchTarget = (v.pitch ?? 40) * Math.PI / 180;
        d.cam.distanceTarget = v.distance;
        d.cam.panTarget.set(...(v.pan ?? [0, 0, 0]));
        d.figure.position.x = v.at[0];
        d.figure.position.z = v.at[1];
        d.figure.position.y = d.ground.heightAt(v.at[0], v.at[1]);
        d.cam.settle(d.figure.position);
      }, { time, v });
      await frames(30);
      const error = await run(() => window.__valley.engine.lastError?.message);
      if (error) throw Error(`${time}-${v.name}: ${error}`);
      const info = await run(() => ({ ...window.__valley.engine.renderer.info.render, gpu: window.__valley.engine.quality.gpuMs ?? null }));
      const file = `${time}-${v.name}.jpg`;
      await page.screenshot({ path: path.join(output, file), type: 'jpeg', quality: 86 });
      shots.push({ file, calls: info.calls, triangles: info.triangles });
      console.log('captured', file, info.calls, 'calls', Math.round(info.triangles / 1000) + 'k tris');
    }
  }
  // Real pointer input: a left drag orbits, a right drag pans, the wheel zooms
  await run(() => { const c = window.__valley.dev.cam; c.yawTarget = 0; c.pitchTarget = 40 * Math.PI / 180; c.panTarget.set(0, 0, 0); c.distanceTarget = 19; c.settle(window.__valley.dev.figure.position); });
  const cam = () => run(() => { const c = window.__valley.dev.cam; return { yaw: c.yawTarget, pitch: c.pitchTarget, pan: c.panTarget.length(), dist: c.distanceTarget }; });
  const before = await cam();
  const drag = async (button, dx, dy) => {
    await page.mouse.move(900, 500);
    await page.mouse.down({ button });
    for (let i = 1; i <= 10; i++) await page.mouse.move(900 + (dx * i) / 10, 500 + (dy * i) / 10);
    await page.mouse.up({ button });
  };
  await drag('left', 240, 60);
  const orbited = await cam();
  await drag('right', -200, 120);
  const panned = await cam();
  await page.mouse.move(900, 500);
  await page.mouse.wheel(0, 300);
  const zoomed = await cam();
  const input = { before, orbited, panned, zoomed };
  if (!(Math.abs(orbited.yaw - before.yaw) > 0.5 && orbited.pitch > before.pitch)) throw Error(`orbit drag did nothing: ${JSON.stringify(input)}`);
  if (!(panned.pan > 2 && Math.abs(panned.yaw - orbited.yaw) < 1e-6)) throw Error(`pan drag did nothing: ${JSON.stringify(input)}`);
  if (!(zoomed.dist > panned.dist)) throw Error(`wheel did not zoom: ${JSON.stringify(input)}`);
  await frames(30);
  await page.screenshot({ path: path.join(output, 'pagi-after-drag.jpg'), type: 'jpeg', quality: 86 });
  console.log('input ok', JSON.stringify(input));
  // V1 actors: turnaround of the four looks, a face close-up per expression, the player mid-stride
  const actorShots = [];
  const lineup = async (name, { yaw, pitch = 14, distance = 5.2, face = 'neutral', at = [-6.5, 0] }) => {
    await run(({ yaw, pitch, distance, face, at }) => {
      const d = window.__valley.dev;
      d.sky.set('siang', { instant: true });
      d.lineup(at, face);
      const c = d.cam;
      c.yawTarget = yaw; c.pitchTarget = pitch * Math.PI / 180; c.distanceTarget = distance; c.panTarget.set(0, 0, 0);
      c.settle(new (window.__valley.three.Vector3)(at[0], d.ground.heightAt(...at) - 0.25, at[1]));
    }, { yaw, pitch, distance, face, at });
    await frames(20);
    await page.screenshot({ path: path.join(output, `actors-${name}.jpg`), type: 'jpeg', quality: 88 });
    actorShots.push(name);
    console.log('captured actors', name);
  };
  await lineup('front', { yaw: 0 });
  await lineup('side', { yaw: Math.PI / 2 });
  await lineup('back', { yaw: Math.PI });
  for (const face of ['smile', 'curious', 'worried', 'asleep']) await lineup(`face-${face}`, { yaw: 0, pitch: 8, distance: 2.4, face, at: [-6.5, 0] });
  // Walk: release the lineup, hold W for a second
  await run(() => { const d = window.__valley.dev; d.frozen = false; d.figure.position.set(-6.5, 0, -1); d.cam.yawTarget = Math.PI / 2; d.cam.pitchTarget = 0.3; d.cam.distanceTarget = 7; d.cam.settle(d.figure.position); });
  await page.keyboard.down('d');
  await frames(45);
  await page.screenshot({ path: path.join(output, 'actors-walk.jpg'), type: 'jpeg', quality: 88 });
  await page.keyboard.up('d');
  await page.keyboard.down('Shift');
  await page.keyboard.down('a');
  await frames(40);
  await page.screenshot({ path: path.join(output, 'actors-run.jpg'), type: 'jpeg', quality: 88 });
  await page.keyboard.up('a');
  await page.keyboard.up('Shift');
  const lastError = await run(() => window.__valley.engine.lastError?.message);
  if (lastError) throw Error(`actors: ${lastError}`);

  // Budget: ten actors in view, GPU time from the quality governor (timer queries)
  await page.goto(new URL('farm.html?time=pagi&crowd=6', base).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__valley && document.body.classList.contains('ready'), null, { timeout: 60000 });
  await run(() => { const d = window.__valley.dev; d.cam.distanceTarget = 34; d.cam.pitchTarget = 0.85; d.figure.position.set(0, d.ground.heightAt(0, 0), 0); d.cam.settle(d.figure.position); });
  await frames(660); // the auto governor reports GPU time after ~7.5 s
  const perf = await run(() => ({ ...window.__valley.dev.perf, actors: window.__valley.dev.stats.actors, calls: window.__valley.engine.renderer.info.render.calls, triangles: window.__valley.engine.renderer.info.render.triangles }));
  await page.screenshot({ path: path.join(output, 'actors-crowd10.jpg'), type: 'jpeg', quality: 86 });
  console.log('crowd perf', JSON.stringify(perf));
  const stats = await run(() => window.__valley.dev.stats);
  await writeFile(path.join(output, 'lookdev.json'), JSON.stringify({ stats, shots, input, actorShots, perf, errors }, null, 2) + '\n');
  if (errors.length) console.log('console errors:', errors);
} finally {
  await browser.close();
}
