// farm.html V4 QA (docs/FARM_PLAN.md §7): animals and villagers, driven by real key presses
// where the player acts, each behaviour checked against state and recorded as a GIF; then every
// routine is walked to its place for all four times of day, and ten minutes of game time run
// with the player roaming, the clock cycling and no engine error.
//   VALLEY_QA_URL=http://localhost:5199/ PLAYWRIGHT_CORE=<path> node tools/qa/valley_life.mjs
// Output: docs/qa/valley/life/*.gif + *.png and life.json. Needs ffmpeg.
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const playwright = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const chromium = playwright.chromium ?? playwright.default.chromium;
const base = process.env.VALLEY_QA_URL || 'http://localhost:5199/';
const output = path.resolve('docs/qa/valley/life');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const run = (fn, arg) => page.evaluate(fn, arg);
const results = {};

/** Advance the game by hand: seconds of game time at 60 Hz, then draw one frame. */
const step = (seconds) => run((seconds) => {
  const { engine, dev } = window.__valley;
  for (let k = 0; k < Math.round(seconds * 60); k++) { engine.time += 1 / 60; dev.update(1 / 60, engine.time); }
  dev.render();
}, seconds);

const stage = (x, z, yaw, cam = {}) => run(({ x, z, yaw, cam }) => {
  const d = window.__valley.dev;
  d.figure.position.set(x, d.ground.surfaceAt(x, z), z);
  d.figure.rotation.y = yaw;
  d.cam.yawTarget = cam.yaw ?? yaw + Math.PI + 1.0;
  d.cam.pitchTarget = (cam.pitch ?? 30) * Math.PI / 180;
  d.cam.distanceTarget = cam.distance ?? 8;
  d.cam.panTarget.set(...(cam.pan ?? [0, 0, 0]));
  d.cam.settle(d.figure.position);
}, { x, z, yaw, cam });

/** Record `seconds` of game time as a GIF while `act` (async, given the frame index) drives input. */
async function record(name, seconds, act, check, still = 0.6) {
  const dir = path.join(os.tmpdir(), `valley-life-${name}`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir);
  const n = Math.round(seconds * 12);
  for (let i = 0; i < n; i++) {
    await act?.(i);
    await step(1 / 12);
    await page.screenshot({ path: path.join(dir, `${String(i).padStart(3, '0')}.png`) });
  }
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '12', '-i', path.join(dir, '%03d.png'),
    '-vf', 'scale=480:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', path.join(output, `${name}.gif`)]);
  execFileSync('cp', [path.join(dir, `${String(Math.min(n - 1, Math.round(still * 12))).padStart(3, '0')}.png`), path.join(output, `${name}.png`)]);
  const state = await run(check);
  results[name] = state;
  console.log(name, JSON.stringify(state));
  if (!state.ok) throw Error(`${name} failed: ${JSON.stringify(state)}`);
}

try {
  await page.goto(new URL('farm.html?time=siang', base).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__valley && document.body.classList.contains('ready'), null, { timeout: 60000 });
  await run(() => {
    const { engine } = window.__valley;
    engine.quality.setPreset('high', false);
    engine.paused = true; // stepped by hand from here on
    let s = 11;
    Math.random = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  });
  await step(0.5);

  // A chicken bolts from a running player
  const hen = await run(() => { const c = window.__valley.dev.chickens[0].root.position; return [c.x, c.z]; });
  // Camera straight behind (yaw -90 degrees looks along +x), so W runs at the hen
  await stage(hen[0] - 4.5, hen[1], Math.PI / 2, { yaw: -Math.PI / 2, distance: 9 });
  let before = await run(() => window.__valley.dev.chickens[0].root.position.distanceTo(window.__valley.dev.figure.position));
  await page.keyboard.down('Shift');
  await page.keyboard.down('w');
  await record('chicken-flee', 1.6, null, () => {
    const d = window.__valley.dev, c = d.chickens[0];
    return { ok: (c.startles || 0) > 0, startles: c.startles || 0, state: c.state };
  }, 0.9);
  await page.keyboard.up('w');
  await page.keyboard.up('Shift');

  // Seeds in hand, standing still: the hens come closer
  await step(3);
  const flock = await run(() => window.__valley.dev.chickens.map((c) => [c.root.position.x, c.root.position.z]));
  const mid = [flock.reduce((s, c) => s + c[0], 0) / 3, flock.reduce((s, c) => s + c[1], 0) / 3];
  await stage(mid[0], mid[1] + 3.5, Math.PI, { yaw: 1.2, distance: 8 });
  await page.keyboard.press('3');
  before = await run(() => Math.min(...window.__valley.dev.chickens.map((c) => c.root.position.distanceTo(window.__valley.dev.figure.position))));
  await record('chicken-seeds', 4, null, () => {
    const d = window.__valley.dev, near = Math.min(...d.chickens.map((c) => c.root.position.distanceTo(d.figure.position)));
    return { ok: near < 1.6, nearest: +near.toFixed(2) };
  }, 2.5);
  results['chicken-seeds'].before = +before.toFixed(2);
  await page.keyboard.press('1');

  // Lift a hen and throw her: she flaps down and runs off
  const target = await run(() => { const d = window.__valley.dev, c = d.chickens[1].root.position; return [c.x, c.z]; });
  await run(() => { window.__valley.dev.chickens.forEach((c) => { c.wait = 99; c.target = null; }); });
  await stage(target[0], target[1] + 0.7, Math.PI, { yaw: 1.3, distance: 7 });
  await record('chicken-lift', 1.0, (i) => i === 0 && page.keyboard.press('e'), () => {
    const d = window.__valley.dev;
    return { ok: d.actions.carrying?.kind === 'chicken' && d.actions.carrying.animal.held, carrying: d.actions.carrying?.kind };
  }, 0.8);
  await record('chicken-throw', 2.2, (i) => i === 0 && page.keyboard.press('e'), () => {
    const d = window.__valley.dev, c = d.chickens[1];
    return { ok: !c.held && !d.actions.carrying, state: c.state };
  }, 0.6);

  // Pet the cow: a heart, a wagging tail
  const cow = await run(() => { const c = window.__valley.dev.animals.find((a) => a.species === 'cow'); c.wait = 99; c.target = null; return [c.root.position.x, c.root.position.z]; });
  await stage(cow[0] - 1.5, cow[1], Math.PI / 2, { yaw: 2.4, distance: 7 });
  await record('cow-pet', 2.0, (i) => i === 0 && page.keyboard.press('e'), () => {
    const d = window.__valley.dev, c = d.animals.find((a) => a.species === 'cow');
    return { ok: c.mood > 0 && d.actions.log.some((l) => l.what === 'pet' && l.detail === 'cow'), mood: +c.mood.toFixed(2) };
  }, 1.1);

  // The dog follows the player across the yard
  await stage(-3, -2, 0, { yaw: Math.PI, distance: 14, pitch: 40 });
  await step(2);
  await page.keyboard.down('w');
  await record('dog-follow', 3.5, null, () => {
    const d = window.__valley.dev, dog = d.animals.find((a) => a.species === 'dog');
    const gap = dog.root.position.distanceTo(d.figure.position);
    return { ok: gap < 4.5, gap: +gap.toFixed(2), state: dog.state };
  }, 3);
  await page.keyboard.up('w');

  // Morning: walk up to the shop, the seller turns and greets; E for a chat
  await run(() => { const d = window.__valley.dev; d.setTime('pagi'); d.sky.set('pagi', { instant: true }); d.villagers.settle(); });
  const shop = await run(() => window.__valley.dev.villagers.anchor.shopFront);
  // Camera looking along +x: W walks towards the seller
  await stage(shop[0] - 3.4, shop[1] + 0.6, Math.PI / 2, { yaw: -Math.PI / 2, distance: 7, pitch: 24 });
  await page.keyboard.down('w');
  await record('npc-greet', 1.6, (i) => i === 9 && page.keyboard.up('w'), () => {
    const d = window.__valley.dev, v = d.villagers.list[0];
    return { ok: v.engaged && !document.getElementById('balloon').hidden, engaged: v.engaged, text: document.getElementById('balloonText').textContent };
  }, 1.3);
  await run(() => { const d = window.__valley.dev, v = d.villagers.list[0].p.root.position, p = d.figure.position; d.figure.rotation.y = Math.atan2(v.x - p.x, v.z - p.z); });
  await record('npc-talk', 2.0, (i) => i === 0 && page.keyboard.press('e'), () => {
    const d = window.__valley.dev;
    return { ok: d.actions.log.some((l) => l.what === 'talk'), text: document.getElementById('balloonText').textContent };
  }, 0.5);

  // Every routine reaches its place, for all four times of day
  results.routines = {};
  for (const time of ['pagi', 'siang', 'sore', 'malam']) {
    await run((time) => { const d = window.__valley.dev; d.setTime(time); d.sky.set(time, { instant: true }); d.figure.position.set(-30, 0, 30); }, time);
    await step(120); // the elder walks at 0.75 m/s, and some routes are 50 m along the paths
    const state = await run(() => window.__valley.dev.villagers.list.filter((v) => v.routine).map((v) => ({
      who: v.look, mode: v.mode, visible: v.p.root.visible, left: v.plan.length, at: [+v.p.root.position.x.toFixed(1), +v.p.root.position.z.toFixed(1)]
    })));
    results.routines[time] = state;
    console.log('routine', time, JSON.stringify(state));
    if (state.some((s) => s.mode === 'walk')) throw Error(`${time}: someone never arrived`);
    if (time === 'malam' && state.some((s) => s.visible)) throw Error('malam: everyone should be home');
    if (time === 'sore') {
      await stage(-1, 31, Math.PI, { yaw: 0.3, distance: 13, pitch: 30 });
      await step(0.2);
      await page.screenshot({ path: path.join(output, 'routine-sore.png') });
    }
  }

  // Ten minutes of game time: the player roams, acts now and then, the clock turns every 2.5 min
  const session = await run(async () => {
    const { engine, dev } = window.__valley, times = ['pagi', 'siang', 'sore', 'malam'];
    let t0 = performance.now(), worst = 0;
    for (let s = 0; s < 600 * 30; s++) {
      const sec = s / 30;
      if (s % (150 * 30) === 0) dev.setTime(times[(sec / 150) % 4]);
      if (s % 120 === 0) {
        dev.keys.clear();
        const keys = ['w', 'a', 's', 'd'];
        dev.keys.add(keys[(s / 120) % 4]);
        if ((s / 120) % 3 === 0) dev.keys.add('shift');
      }
      if (s % 300 === 150) (s % 600 === 150 ? dev.actions.useTool() : dev.actions.interact());
      const a = performance.now();
      engine.time += 1 / 30;
      dev.update(1 / 30, engine.time);
      worst = Math.max(worst, performance.now() - a);
    }
    dev.keys.clear();
    return { seconds: 600, wallMs: Math.round(performance.now() - t0), worstUpdateMs: +worst.toFixed(2), actions: dev.actions.log.length, shipped: dev.pickups.shipped, lastError: engine.lastError?.message ?? null };
  });
  results.session = session;
  console.log('session', JSON.stringify(session));
  if (session.lastError) throw Error(session.lastError);
  await writeFile(path.join(output, 'life.json'), JSON.stringify({ results, errors }, null, 2) + '\n');
  if (errors.length) console.log('console errors:', errors);
} finally {
  await browser.close();
}
