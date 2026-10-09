// farm.html character sheet, laid out like the reference turnaround: the player alone on a cream
// ground — front, back, left, right, three-quarter — then six expressions, and both as sheets.
//   VALLEY_QA_URL=http://localhost:5199/ PLAYWRIGHT_CORE=<path> node tools/qa/valley_turnaround.mjs
// Output: docs/qa/valley/turnaround/*.png, turnaround.jpg, expressions.jpg. Needs ffmpeg.
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const playwright = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const chromium = playwright.chromium ?? playwright.default.chromium;
const base = process.env.VALLEY_QA_URL || 'http://localhost:5199/';
const output = path.resolve('docs/qa/valley/turnaround');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 600, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
const run = (fn, arg) => page.evaluate(fn, arg);

try {
  await page.goto(new URL('farm.html?time=siang&season=panas', base).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__valley && document.body.classList.contains('ready'), null, { timeout: 60000 });
  await run(() => {
    const { engine, dev, three } = window.__valley;
    engine.quality.setPreset('high', false);
    engine.paused = true;
    document.querySelectorAll('.panel, .hud').forEach((el) => (el.style.display = 'none'));
    // Only the player, on the sheet's cream, lit by the day's sun and sky
    for (const o of dev.scene.children) if (!o.isLight && o !== dev.figure) o.visible = false;
    dev.scene.background = new three.Color('#f3eee4');
    const p = dev.player;
    p.face.blink = 1e9;
    p.look.next = 1e9;
    p.look.yaw = p.look.toYaw = p.look.pitch = p.look.toPitch = 0;
    dev.figure.position.set(0, 0, 0);
  });
  const shoot = async (name, { yaw, distance = 3.1, height = 0.68, face = 'content' }) => {
    await run(({ yaw, distance, height, face }) => {
      const { engine, dev, three } = window.__valley;
      const p = dev.player;
      p.mood = face;
      p.face.current = '';
      dev.figure.rotation.y = 0;
      // Pose: the idle stand, then a camera on a circle round the figure
      for (let k = 0; k < 30; k++) { engine.time += 1 / 60; dev.update(1 / 60, engine.time); }
      dev.figure.position.set(0, 0, 0);
      dev.figure.rotation.y = 0;
      dev.camera.position.set(Math.sin(yaw) * distance, height + 0.1, Math.cos(yaw) * distance);
      dev.camera.lookAt(new three.Vector3(0, height, 0));
      dev.camera.fov = 30;
      dev.camera.updateProjectionMatrix();
      dev.scene.fog.near = 1e4;
      dev.scene.fog.far = 1e5; // no haze on a character sheet
      engine.renderer.render(dev.scene, dev.camera);
    }, { yaw, distance, height, face });
    await page.screenshot({ path: path.join(output, `${name}.png`) });
  };
  const views = [['front', 0], ['back', Math.PI], ['left', -Math.PI / 2], ['right', Math.PI / 2], ['three-quarter', 0.6]];
  for (const [name, yaw] of views) await shoot(name, { yaw });
  const faces = [['neutral', 'content'], ['happy', 'laugh'], ['surprised', 'curious'], ['tired', 'asleep'], ['determined', 'focused'], ['sad', 'worried']];
  for (const [name, face] of faces) await shoot(`face-${name}`, { yaw: 0, distance: 0.95, height: 1.18, face });
  const tile = (names, out, w) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...names.flatMap((n) => ['-i', path.join(output, `${n}.png`)]),
    '-filter_complex', `${names.map((_, i) => `[${i}:v]scale=${w}:-1[v${i}]`).join(';')};${names.map((_, i) => `[v${i}]`).join('')}hstack=inputs=${names.length}`,
    '-frames:v', '1', '-q:v', '3', path.join(output, out)]);
  tile(views.map(([n]) => n), 'turnaround.jpg', 360);
  tile(faces.map(([n]) => `face-${n}`), 'expressions.jpg', 260);
  const lastError = await run(() => window.__valley.engine.lastError?.message);
  if (lastError || errors.length) { console.log('errors', lastError, errors); process.exitCode = 1; }
  console.log('turnaround done');
} finally {
  await browser.close();
}
