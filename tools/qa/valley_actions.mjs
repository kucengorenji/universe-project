// farm.html V3 QA (docs/FARM_PLAN.md §7): every action driven by real key presses, checked
// against the world state it must change, and recorded as a short GIF per action.
//   VALLEY_QA_URL=http://localhost:5199/ PLAYWRIGHT_CORE=<path> node tools/qa/valley_actions.mjs
// Output: docs/qa/valley/actions/*.gif (+ a still per action) and actions.json. Needs ffmpeg.
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const playwright = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const chromium = playwright.chromium ?? playwright.default.chromium;
const base = process.env.VALLEY_QA_URL || 'http://localhost:5199/';
const output = path.resolve('docs/qa/valley/actions');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const run = (fn, arg) => page.evaluate(fn, arg);
const frames = (n) => run(async (n) => { for (let i = 0; i < n; i++) await window.__valley.engine.afterFrame(); }, n);
const results = {};

/** Put the player at (x, z) facing yaw (three.js rotation.y), the camera close behind-left. */
const stage = (x, z, yaw, cam = {}) => run(({ x, z, yaw, cam }) => {
  const d = window.__valley.dev;
  d.figure.position.set(x, d.ground.surfaceAt(x, z), z);
  d.figure.rotation.y = yaw;
  d.cam.yawTarget = cam.yaw ?? yaw + Math.PI + 1.15; // from the side: the arms and the tool show
  d.cam.pitchTarget = (cam.pitch ?? 30) * Math.PI / 180;
  d.cam.distanceTarget = cam.distance ?? 6.5;
  d.cam.panTarget.set(...(cam.pan ?? [0, 0, 0]));
  d.cam.settle(d.figure.position);
}, { x, z, yaw, cam });

/** Press a key, record `seconds` of frames as a GIF. */
async function record(name, key, seconds, check, still = 0.55) {
  const dir = path.join(os.tmpdir(), `valley-${name}`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir);
  await frames(10);
  // The game clock is paused and stepped by hand: a screenshot takes longer than a frame, and a
  // running clock would squeeze the action into the first few captures
  await run(() => { window.__valley.engine.paused = true; });
  await page.keyboard.press(key);
  const n = Math.round(seconds * 12);
  for (let i = 0; i < n; i++) {
    await run(() => {
      const { engine, dev } = window.__valley;
      for (let k = 0; k < 5; k++) { engine.time += 1 / 60; dev.update(1 / 60, engine.time); } // 12 captures per second of game time
      dev.render();
    });
    await page.screenshot({ path: path.join(dir, `${String(i).padStart(3, '0')}.png`) });
  }
  await run(() => { window.__valley.engine.paused = false; });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '12', '-i', path.join(dir, '%03d.png'),
    '-vf', 'scale=480:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
    path.join(output, `${name}.gif`)]);
  // The still is the action's key moment (seconds after the key press)
  execFileSync('cp', [path.join(dir, `${String(Math.min(n - 1, Math.round(still * 12))).padStart(3, '0')}.png`), path.join(output, `${name}.png`)]);
  const state = await run(check);
  results[name] = state;
  console.log(name, JSON.stringify(state));
  if (!state.ok) throw Error(`${name} failed: ${JSON.stringify(state)}`);
}

try {
  await page.goto(new URL('farm.html?time=siang', base).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__valley && document.body.classList.contains('ready'), null, { timeout: 60000 });
  await run(() => { window.__valley.dev.engine.quality.setPreset('high', false); Math.random = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })(); });
  const cell = (c, r) => run(({ c, r }) => window.__valley.dev.field.center(c, r), { c, r });

  // Hoe an empty cell (column 7, row 6), standing south of it facing north
  let [x, z] = await cell(7, 6);
  await stage(x, z + 0.8, Math.PI);
  await page.keyboard.press('1');
  await record('hoe', 'Space', 1.3, () => { const d = window.__valley.dev, i = 6 * d.field.cols + 7; return { ok: d.field.tilled[i] === 1, tilled: d.field.tilled[i] }; }, 0.3);
  await page.keyboard.press('2');
  await record('water', 'Space', 1.6, () => { const d = window.__valley.dev, i = 6 * d.field.cols + 7; return { ok: d.field.wet[i] > 0.9, wet: +d.field.wet[i].toFixed(3) }; }, 0.75);
  await page.keyboard.press('3');
  await record('plant', 'Space', 1.2, () => { const d = window.__valley.dev, i = 6 * d.field.cols + 7; return { ok: d.field.crop[i] === 1, crop: d.field.crop[i] }; }, 0.45);

  // Harvest a ripe turnip (column 0, row 1) and carry it
  [x, z] = await cell(0, 1);
  await stage(x, z + 0.8, Math.PI);
  await record('harvest', 'e', 1.4, () => { const d = window.__valley.dev; return { ok: d.actions.carrying?.kind === 'crop_ripe' && d.field.crop[1 * d.field.cols] === 0, carrying: d.actions.carrying?.kind }; }, 1.0);

  // Throw it into the shipping bin from 3.8 m
  const bin = await run(() => window.__valley.dev.pickups.bin);
  await stage(bin.x, bin.z - 3.8, 0, { yaw: Math.PI / 2 + 0.35, distance: 7.5, pitch: 22, pan: [0, 0, 1.9] });
  await record('ship', 'e', 2.0, () => { const d = window.__valley.dev; return { ok: d.pickups.shipped === 1 && !d.actions.carrying, shipped: d.pickups.shipped }; }, 0.75);

  // Lift a stone, then throw it onto the grass
  await stage(-4.2, -2.85, Math.PI);
  await record('lift', 'e', 1.0, () => { const d = window.__valley.dev; return { ok: d.actions.carrying?.kind === 'stone_small', carrying: d.actions.carrying?.kind }; }, 0.8);
  await run(() => { window.__valley.dev.figure.rotation.y = Math.PI / 2; });
  await record('throw', 'e', 2.0, () => {
    const d = window.__valley.dev, it = d.pickups.items.find((i) => i.kind === 'stone_small' && i.state === 'ground' && i.p.x > -2);
    return { ok: !!it && !d.actions.carrying, landed: it && [+it.p.x.toFixed(2), +it.p.z.toFixed(2)] };
  }, 0.5);

  // Shake the apple tree: it rocks, leaves fall, an apple drops
  const tree = await run(() => window.__valley.dev.lods.find((l) => l.asset === 'tree_apple').positions.find((p) => p.x > 15));
  await stage(tree.x, tree.z + 1.25, Math.PI, { yaw: 0.85, distance: 11, pitch: 26 });
  const apples = await run(() => window.__valley.dev.pickups.count('apple'));
  await record('shake', 'e', 2.4, () => {
    const d = window.__valley.dev;
    return { ok: d.actions.log.some((l) => l.what === 'shake') && d.pickups.count('apple') > 0, apples: d.pickups.count('apple') };
  }, 0.6);
  results.shake.applesBefore = apples;
  if (results.shake.apples <= apples) throw Error('no apple dropped');

  const lastError = await run(() => window.__valley.engine.lastError?.message);
  if (lastError) throw Error(lastError);
  results.log = await run(() => window.__valley.dev.actions.log);
  await writeFile(path.join(output, 'actions.json'), JSON.stringify({ results, errors }, null, 2) + '\n');
  if (errors.length) console.log('console errors:', errors);
} finally {
  await browser.close();
}
