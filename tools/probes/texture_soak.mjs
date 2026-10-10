// Repeats space → planet → town diorama → walk → interior for N rounds on the dev server and fails
// when textures pile up. It hooks WebGL createTexture/deleteTexture, so a leak is named by where its
// texture was uploaded, not only counted.
//   npm run dev -- --port 5241 --strictPort
//   PLAYWRIGHT_CORE=/path/to/playwright-core/index.js node tools/probes/texture_soak.mjs [--rounds 4] [--base http://localhost:5241]
// Checks (round 1 warms the shared caches and is ignored):
//   1. no texture born in round >= 2 is still alive in a later round (an exact leak detector);
//   2. the texture count is identical in rounds 2..N for the same mode. Left out of that comparison:
//      the planet mode (city labels are created lazily while the camera turns and vary per visit) and
//      64x64 textures (the street-light glow is only uploaded on frames where the clock says night,
//      so its presence follows the time of day, not the number of visits).
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const ROUNDS = Number(arg('rounds', 4));
const BASE = arg('base', 'http://localhost:5241');
const SETTLE = Number(arg('settle', 5000));
const mod = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const chromium = mod.chromium ?? mod.default?.chromium;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.addInitScript(() => {
  const live = new Map();
  window.__texLive = live;
  window.__phase = 'boot';
  const short = (stack) => stack.split('\n').filter((l) => /\/src\//.test(l)).slice(0, 4).map((l) => l.replace(/^.*\/(src\/[^?:]*)[^:]*:(\d+):\d+.*$/, '$1:$2')).join(' < ');
  for (const Ctx of [window.WebGL2RenderingContext, window.WebGLRenderingContext].filter(Boolean)) {
    const p = Ctx.prototype;
    const bound = new Map();
    const create = p.createTexture;
    p.createTexture = function () { const t = create.call(this); live.set(t, { phase: window.__phase, stack: short(new Error().stack || ''), dims: '' }); return t; };
    const del = p.deleteTexture;
    p.deleteTexture = function (t) { live.delete(t); return del.call(this, t); };
    const bind = p.bindTexture;
    p.bindTexture = function (target, t) { bound.set(target, t); return bind.call(this, target, t); };
    for (const fn of ['texImage2D', 'texImage3D', 'texStorage2D', 'texStorage3D']) {
      const orig = p[fn];
      if (!orig) continue;
      p[fn] = function (...a) {
        const rec = live.get(bound.get(a[0]));
        if (rec && !rec.dims) rec.dims = `${fn}:${(fn.startsWith('texStorage') ? [a[3], a[4], a[5]] : [a[3], a[4]]).filter((v) => typeof v === 'number').join('x')}`;
        return orig.apply(this, a);
      };
    }
  }
});

await page.goto(`${BASE}/play/?lang=en#/space`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__globe?.journey && window.__globe.director.mode && !window.__globe.director.busy, null, { timeout: 90000 });
if (await page.locator('.intro:not([hidden]) [data-act="start"]').count()) await page.locator('.intro [data-act="start"]').click();
const home = await page.evaluate(() => window.__globe.journey.homePlanet);
const idle = () => page.waitForFunction(() => !window.__globe.director.busy && !window.__globe.director.overlay?.active, null, { timeout: 90000 });
const view = (name) => page.waitForFunction((n) => window.__globe.director.mode?.view === n && !window.__globe.director.mode.fading, name, { timeout: 60000 });
const steps = {
  space: async () => { await page.evaluate(() => window.__globe.director.go({ mode: 'space' })); await idle(); },
  planet: async () => { await page.evaluate((h) => window.__globe.director.go({ mode: 'planet', planet: h, city: null }), home); await idle(); },
  diorama: async () => { await page.evaluate((h) => window.__globe.director.go({ mode: 'town', planet: h, city: 0 }), home); await idle(); await view('diorama'); await page.evaluate(() => { window.__globe.director.mode.tween = null; }); },
  walk: async () => { await page.evaluate(() => { const m = window.__globe.director.mode; m.tween = null; m.setView('walk'); }); await view('walk'); },
  interior: async () => { await page.evaluate(async () => { const m = window.__globe.director.mode; m.tween = null; const d = m.doors?.[0]; if (d) await m.enterBuilding(d); }); await view('interior'); },
};
const snap = async () => {
  await page.waitForTimeout(SETTLE);
  return page.evaluate(() => ({
    info: window.__globe.engine.renderer.info.memory.textures,
    err: window.__globe.engine.lastError?.message ?? null,
    live: [...window.__texLive.values()].map((r) => ({ phase: r.phase, dims: r.dims, stack: r.stack }))
  }));
};

const info = {};
const stale = [];
const shapes = {};
const counts = {};
const sprite = (t) => t.dims.endsWith(':64x64');
const shapeOf = (live) => { const m = {}; for (const t of live) { if (sprite(t)) continue; const k = `${t.dims} ${t.stack}`.trim(); m[k] = (m[k] ?? 0) + 1; } return m; };
for (let round = 1; round <= ROUNDS; round++) {
  for (const name of Object.keys(steps)) {
    await page.evaluate((p) => { window.__phase = p; }, `r${round}.${name}`);
    await steps[name]();
    const s = await snap();
    (info[name] ??= []).push(s.info);
    (counts[name] ??= []).push(s.live.filter((t) => !sprite(t)).length);
    (shapes[name] ??= []).push(shapeOf(s.live));
    if (s.err) errors.push(`lastError in round ${round} ${name}: ${s.err}`);
    for (const t of s.live) {
      const born = /^r(\d+)\./.exec(t.phase);
      if (born && Number(born[1]) >= 2 && Number(born[1]) < round) stale.push(`round ${round} ${name}: born ${t.phase} ${t.dims} ${t.stack}`);
    }
  }
}
await browser.close();

console.log('renderer.info.memory.textures per round');
for (const [name, v] of Object.entries(info)) console.log(`  ${name.padEnd(9)} ${v.join(' ')}`);
const failures = [];
for (const [name, v] of Object.entries(info)) {
  if (name === 'planet') continue;
  const settled = counts[name].slice(1);
  if (settled.some((n) => n !== settled[0])) {
    const base = shapes[name][1];
    const moved = shapes[name].slice(2).flatMap((now, i) => Object.keys({ ...base, ...now }).filter((k) => (now[k] ?? 0) !== (base[k] ?? 0)).map((k) => `round ${i + 3}: ${(now[k] ?? 0) - (base[k] ?? 0) > 0 ? '+' : ''}${(now[k] ?? 0) - (base[k] ?? 0)} ${k}`));
    failures.push(`${name}: textures drift between rounds 2..${ROUNDS} (${settled.join(' → ')}, without 64x64)\n    ${moved.slice(0, 8).join('\n    ')}`);
  }
}
if (stale.length) failures.push(`${stale.length} texture(s) outlive the round that created them:\n    ${[...new Set(stale)].slice(0, 8).join('\n    ')}`);
if (errors.length) failures.push(`errors: ${errors.join('; ')}`);
if (failures.length) { console.log('FAIL\n  ' + failures.join('\n  ')); process.exit(1); }
console.log(`OK: ${ROUNDS} rounds, texture delta 0 in space/diorama/walk/interior, nothing outlives its round`);
