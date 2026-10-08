// Landing page QA: no WebGL on the landing, five documented levels with working screenshot tabs,
// responsive layout, and the Play Game hand-off. Screenshots for the manual come from
// tools/qa/landing_shots.mjs (run that first when the game's UI changes).
import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const base = process.env.LANDING_QA_URL || 'http://127.0.0.1:5198/';
const output = path.resolve(process.env.LANDING_QA_OUTPUT || 'docs/qa/landing');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [], checks = [], failedRequests = [];
page.on('pageerror', error => errors.push(error.message));
let onLanding = true; // requests made by the game after the hand-off belong to the game's own QA
page.on('response', r => { if (onLanding && r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`); });
const LEVELS = ['orbit', 'planet', 'kota', 'interior', 'rumah'];
try {
  await page.goto(base);
  await page.waitForFunction(() => [...document.images].filter(img => img.loading !== 'lazy').every(img => img.complete && img.naturalWidth > 0));
  await page.evaluate(() => document.fonts.ready);

  const light = await page.evaluate(() => ({
    canvas: document.querySelectorAll('canvas').length,
    gameResources: performance.getEntriesByType('resource').filter(r => /\.(glb|gltf)(?:\?|$)|\/(?:main|game)-[\w-]+\.js/.test(r.name)).map(r => r.name),
    ctas: [...document.querySelectorAll('a[href="/play/"]')].length
  }));
  assert.equal(light.canvas, 0); assert.equal(light.gameResources.length, 0); assert.equal(light.ctas, 3);
  checks.push({ name: 'landing does not initialize WebGL or download game models', pass: true, ...light });

  // Every level documents itself: screenshot, procedural features and a manual.
  const levels = await page.evaluate(ids => ids.map(id => {
    const el = document.getElementById(id);
    return { id, shots: el?.querySelectorAll('[role="tab"]').length || (el?.querySelector('.viewer-frame img') ? 1 : 0),
      features: el?.querySelectorAll('.feature-list li').length, keys: el?.querySelectorAll('.keys kbd').length, rail: !!document.querySelector(`[data-level-link="${id}"]`) };
  }), LEVELS);
  for (const l of levels) assert.ok(l.shots >= 1 && l.features >= 4 && l.keys >= 4 && l.rail, JSON.stringify(l));
  checks.push({ name: 'five levels each have screenshots, procedural features and a manual', pass: true, levels });

  // antislop hard gate: no em dash in text, no dead anchors, flat surfaces (the The1 direction has no shadow, gradient or glass).
  const hygiene = await page.evaluate(() => {
    const text = document.body.innerText + ' ' + document.title + ' ' + [...document.querySelectorAll('meta[content]')].map(m => m.content).join(' ');
    const dead = [...document.querySelectorAll('a[href^="#"]')].map(a => a.getAttribute('href')).filter(h => h.length > 1 && !document.querySelector(h));
    const nonFlat = [...document.querySelectorAll('body *')].filter(el => { const c = getComputedStyle(el); return c.boxShadow !== 'none' || /gradient/.test(c.backgroundImage) || (c.backdropFilter && c.backdropFilter !== 'none') || c.filter !== 'none'; }).map(el => el.className || el.tagName);
    const endless = document.getAnimations().filter(a => a.effect?.getTiming().iterations === Infinity).length;
    return { emDash: text.includes('—'), dead, nonFlat, endlessAnimations: endless };
  });
  assert.ok(!hygiene.emDash && !hygiene.dead.length && !hygiene.nonFlat.length && !hygiene.endlessAnimations, JSON.stringify(hygiene));
  checks.push({ name: 'no em dash, no dead anchors, flat surfaces, no endless animation', pass: true, ...hygiene });

  // R-25: every text run against its effective background (nearest opaque ancestor).
  const contrast = await page.evaluate(() => {
    const rgb = c => c.match(/[\d.]+/g).map(Number);
    const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
    const bgOf = el => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length < 4 || c[3] > .95) { if (c.length >= 3 && (c.length < 4 || c[3] > .95)) return c.slice(0, 3); } } return [217, 217, 217]; };
    const fails = [];
    for (const el of document.querySelectorAll('body *')) {
      if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
      const cs = getComputedStyle(el), fg = rgb(cs.color), bg = bgOf(el);
      if (!el.getClientRects().length) continue;
      const a = lum(fg.slice(0, 3)), b = lum(bg), ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      const px = parseFloat(cs.fontSize), large = px >= 24 || (px >= 18.66 && +cs.fontWeight >= 700);
      if (ratio < (large ? 3 : 4.5)) fails.push(`${el.tagName}.${el.className} ${px}px ${ratio.toFixed(2)}`);
    }
    return fails;
  });
  assert.equal(contrast.length, 0, contrast.join('\n'));
  checks.push({ name: 'text meets WCAG AA contrast on its own background', pass: true });

  // Keyboard: Tab reaches the skip link first and a visible focus ring appears.
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => { const el = document.activeElement, cs = getComputedStyle(el); return { text: el.textContent.trim(), outline: cs.outlineStyle, width: cs.outlineWidth }; });
  assert.ok(/Skip to content|Lewati/.test(focus.text) && focus.outline !== 'none' && parseFloat(focus.width) >= 2, JSON.stringify(focus));
  checks.push({ name: 'keyboard focus is visible, skip link comes first', pass: true, ...focus });

  // Every screenshot referenced by a tab or image exists and is served.
  const srcs = await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-src]')].map(t => t.dataset.src).concat([...document.querySelectorAll('.viewer-frame img, .stage img')].map(i => new URL(i.src).pathname)))]);
  for (const src of srcs) { const r = await page.request.get(new URL(src, base).href); assert.equal(r.status(), 200, src); assert.match(r.headers()['content-type'] || '', /image\//, src); }
  checks.push({ name: 'all screenshots resolve', pass: true, count: srcs.length });

  // Tabs swap the image, caption and counter, and work from the keyboard.
  await page.locator('#kota').scrollIntoViewIfNeeded();
  const tabs = page.locator('#kota [role="tab"]');
  const before = await page.locator('#kota .viewer-frame img').getAttribute('src');
  await tabs.nth(3).click();
  await page.waitForFunction(b => document.querySelector('#kota .viewer-frame img').getAttribute('src') !== b, before);
  const afterClick = await page.evaluate(() => ({ src: document.querySelector('#kota .viewer-frame img').getAttribute('src'), title: document.querySelector('#kota [data-cap-title]').textContent, count: document.querySelector('#kota [data-count]').textContent, selected: document.querySelector('#kota [role="tab"][aria-selected="true"]').textContent }));
  assert.match(afterClick.src, /town-pixel/); assert.equal(afterClick.count, '04 / 06'); assert.equal(afterClick.selected, 'Pixel');
  await tabs.nth(3).focus(); await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => /town-modern/.test(document.querySelector('#kota .viewer-frame img').getAttribute('src')));
  await page.waitForFunction(() => { const i = document.querySelector('#kota .viewer-frame img'); return i.complete && i.naturalWidth > 0; });
  checks.push({ name: 'screenshot tabs switch by click and arrow keys', pass: true, afterClick });

  // Capture and check layout at several widths (scrolling first loads sticky/active states).
  const sweep = () => page.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y < h; y += 500) { scrollTo(0, y); await new Promise(r => setTimeout(r, 40)); } scrollTo(0, 0); });
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await sweep();
    const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      overflow: [...document.querySelectorAll('h1, h2, h3, .pill, .stage img, .viewer-frame, .col, .idx, .chain li, .tech > div')].filter(el => { const r = el.getBoundingClientRect(); return r.width && (r.left < -1 || r.right > innerWidth + 1); }).map(el => el.className || el.tagName) }));
    assert.ok(layout.scrollWidth <= width && !layout.overflow.length, JSON.stringify(layout));
    checks.push({ name: `responsive layout at ${width}px`, pass: true, ...layout });
    if ([1440, 390].includes(width)) {
      await page.evaluate(() => document.querySelectorAll('img[loading="lazy"]').forEach(i => { i.loading = 'eager'; }));
      await page.waitForFunction(() => [...document.images].every(i => i.complete));
      await page.screenshot({ path: path.join(output, `landing-${width}.png`), fullPage: true });
    }
  }

  // Level rail highlights the level in view.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#interior').scrollIntoViewIfNeeded();
  await page.evaluate(() => document.getElementById('interior').scrollIntoView({ block: 'start' }));
  await page.waitForFunction(() => document.querySelector('[data-level-link="interior"]').getAttribute('aria-current') === 'true');
  checks.push({ name: 'level rail follows scroll', pass: true });

  await page.evaluate(() => scrollTo(0, 0));
  onLanding = false;
  await page.locator('.hero .pill').click();
  await page.waitForURL(/\/play\//);
  checks.push({ name: 'hero pill opens /play/', pass: true, url: page.url() });
  // LANDING_SKIP_GAME=1 skips booting the game, for when the game itself is mid-change.
  if (!process.env.LANDING_SKIP_GAME) {
    await page.waitForSelector('#canvas-container canvas');
    const welcome = page.getByRole('button', { name: /Start exploring|Mulai menjelajah/ });
    await welcome.waitFor({ state: 'visible', timeout: 60000 }).catch(() => {});
    if (await welcome.isVisible()) await welcome.click();
    await page.waitForFunction(() => !document.getElementById('cover').classList.contains('is-on'), null, { timeout: 60000 });
    const playing = await page.evaluate(() => ({ activeUi: !!document.querySelector('.mode-ui:not([hidden])'), canvasWidth: document.querySelector('#canvas-container canvas').width, error: window.__globe?.engine.lastError?.message }));
    assert.ok(playing.activeUi && playing.canvasWidth > 0 && !playing.error);
    checks.push({ name: 'Play Game enters the initialized game', pass: true, ...playing });
    await page.screenshot({ path: path.join(output, 'play-game.png') });
  }
  await page.goto(new URL('#/space/2', base).href);
  await page.waitForURL(/\/play\/#\/space\/2/);
  checks.push({ name: 'old root hash routes redirect to the game', pass: true, url: page.url() });
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(failedRequests.length, 0, failedRequests.join('\n'));
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), browser: browser.version(), base, checks, errors, failedRequests }, null, 2));
  console.log(JSON.stringify({ pass: true, checks: checks.map(c => c.name), output }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ checks, errors, failedRequests, failure: error.stack }, null, 2));
  console.error(error); process.exitCode = 1;
} finally { await browser.close(); }
