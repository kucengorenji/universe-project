// farm.html V5 QA (docs/FARM_PLAN.md §7): every season at two times of day from two views, plus
// a winter night and a summer night (fireflies), and a contact sheet of the lot. Fails on page
// errors, shader errors and engine.lastError.
//   VALLEY_QA_URL=http://localhost:5199/ PLAYWRIGHT_CORE=<path> node tools/qa/valley_seasons.mjs
// Output: docs/qa/valley/seasons/*.jpg, sheet.jpg, seasons.json. Needs ffmpeg for the sheet.
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const playwright = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const chromium = playwright.chromium ?? playwright.default.chromium;
const base = process.env.VALLEY_QA_URL || 'http://localhost:5199/';
const output = path.resolve('docs/qa/valley/seasons');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => (m.type() === 'error' || /Shader Error/.test(m.text())) && errors.push(m.text().slice(0, 300)));
const run = (fn, arg) => page.evaluate(fn, arg);
const step = (seconds) => run((seconds) => {
  const { engine, dev } = window.__valley;
  for (let k = 0; k < Math.round(seconds * 60); k++) { engine.time += 1 / 60; dev.update(1 / 60, engine.time); }
  dev.render();
}, seconds);
const shots = [];

try {
  await page.goto(new URL('farm.html?time=pagi&season=semi', base).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__valley && document.body.classList.contains('ready'), null, { timeout: 60000 });
  await run(() => { window.__valley.engine.quality.setPreset('high', false); window.__valley.engine.paused = true; });
  const views = {
    valley: { at: [2, 2], yaw: 0.2, pitch: 46, distance: 40 },
    square: { at: [-1, 31], yaw: 0, pitch: 34, distance: 24 }
  };
  const plan = [];
  for (const season of ['semi', 'panas', 'gugur', 'dingin']) for (const time of ['pagi', 'sore']) for (const view of Object.keys(views)) plan.push({ season, time, view });
  plan.push({ season: 'dingin', time: 'malam', view: 'square' }, { season: 'panas', time: 'malam', view: 'valley' });
  for (const { season, time, view } of plan) {
    const v = views[view];
    await run(({ season, time, v }) => {
      const d = window.__valley.dev;
      d.setSeason(season);
      d.setTime(time);
      d.sky.set(time, { instant: true });
      d.villagers.settle();
      d.figure.position.set(v.at[0], d.ground.surfaceAt(...v.at), v.at[1]);
      d.cam.yawTarget = v.yaw;
      d.cam.pitchTarget = v.pitch * Math.PI / 180;
      d.cam.distanceTarget = v.distance;
      d.cam.panTarget.set(0, 0, 0);
      d.cam.settle(d.figure.position);
    }, { season, time, v });
    await step(2.5); // let the season's air fill in
    const lastError = await run(() => window.__valley.engine.lastError?.message);
    if (lastError) throw Error(`${season} ${time}: ${lastError}`);
    const file = `${season}-${time}-${view}.jpg`;
    await page.screenshot({ path: path.join(output, file), type: 'jpeg', quality: 84 });
    const air = await run(() => window.__valley.dev.effects.alive);
    shots.push({ file, season, time, view, particles: air });
    console.log('captured', file, 'particles', air);
  }
  // Contact sheet: the eight valley/square day shots of each season in a 4 x 4 grid
  const grid = shots.filter((s) => s.time !== 'malam').map((s) => ['-i', path.join(output, s.file)]).flat();
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...grid, '-filter_complex',
    `${shots.filter((s) => s.time !== 'malam').map((_, i) => `[${i}:v]scale=480:-1[v${i}]`).join(';')};${shots.filter((s) => s.time !== 'malam').map((_, i) => `[v${i}]`).join('')}xstack=inputs=16:layout=${Array.from({ length: 16 }, (_, i) => `${(i % 4) * 480}_${Math.floor(i / 4) * 300}`).join('|')}`,
    '-frames:v', '1', '-q:v', '4', path.join(output, 'sheet.jpg')]);
  await writeFile(path.join(output, 'seasons.json'), JSON.stringify({ shots, errors }, null, 2) + '\n');
  if (errors.length) { console.log('errors:', errors); process.exitCode = 1; }
} finally {
  await browser.close();
}
