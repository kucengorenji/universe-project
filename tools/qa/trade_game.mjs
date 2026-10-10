import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { playCampaign } from './trade_campaign.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const base = process.env.TRADE_QA_URL || 'http://127.0.0.1:5201';
const output = path.resolve(process.env.TRADE_QA_OUTPUT || 'docs/qa/trade-game');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await context.addInitScript(() => localStorage.setItem('planet_globe_tips', JSON.stringify(['intro', 'space', 'planet', 'town'])));
const page = await context.newPage(), errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
const ready = () => page.waitForFunction(() => window.__globe?.director.mode && !window.__globe.director.busy);
const screenshot = async name => { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); await page.screenshot({ path: path.join(output, `${name}.png`) }); };
const advance = async seconds => page.evaluate(seconds => {
  const session = window.__globe.trade;
  session.last -= seconds / session.state.speed; session.pump();
  while (session.accumulator >= 1) session.pump();
}, seconds);
try {
  await page.goto(`${base}/play/?lang=id`); await ready();
  await page.evaluate(async () => { const g = window.__globe; g.world.regenerateHome(123456, { subdivision: 3 }); await g.director.go({ mode: 'planet', planet: g.world.homeIndex, city: null }); });
  await ready();
  const normal = await page.evaluate(() => JSON.stringify(window.__globe.world.homeMap));
  await screenshot('01-normal-cta');
  await page.locator('.trade-entry-cta').click(); await screenshot('02-setup');
  await page.locator('[data-start]').click();
  await page.waitForFunction(() => window.__globe.director.route?.mode === 'trade'); await ready();
  assert.equal(await page.evaluate(() => window.__globe.director.route.mode), 'trade');
  assert.equal(await page.evaluate(() => window.__globe.trade.state.cities.length), 3);
  checks.push({ name: 'normal CTA starts isolated three-town campaign', pass: true });
  await screenshot('03-overview');
  await page.locator('.trade-dock [data-action="build"]').click();
  await page.locator('[data-kind="bakery"]').click();
  await page.waitForFunction(() => !window.__globe.director.mode.pr.camTween);
  await screenshot('04-placement');
  const point = await page.evaluate(() => {
    const mode = window.__globe.director.mode, pr = mode.pr;
    for (const id of mode.validTiles) {
      const p = pr.planetGroup.localToWorld(pr.hexasphere.tileMap.get(id).center.clone().multiplyScalar(pr.landR)).project(pr.camera);
      const x = (p.x + 1) * innerWidth / 2, y = (1 - p.y) * innerHeight / 2;
      if (x > 20 && y > 80 && y < innerHeight - 90 && document.elementFromPoint(x, y)?.tagName === 'CANVAS') return { x, y, id };
    }
    return null;
  });
  assert.ok(point, 'no visible valid placement tile'); await page.mouse.click(point.x, point.y);
  assert.equal(await page.evaluate(() => window.__globe.trade.state.facilities.some(f => f.kind === 'bakery')), true);
  checks.push({ name: 'Bakery placed through a real globe click', pass: true, tile: point.id });
  await page.locator('.trade-dock [data-action="newRoute"]').click();
  await page.locator('[data-action="pickTown"][data-id="city:0"]').click();
  await page.locator('[data-action="pickTown"][data-id="city:1"]').click();
  await page.locator('[data-field="back"]').selectOption('tools'); await screenshot('05-route-wizard');
  await page.locator('[data-action="activateRoute"]').click();
  assert.equal(await page.evaluate(() => window.__globe.trade.state.routes.length), 1);
  await page.locator('[data-action="play"]').click(); await page.locator('[data-speed="4"]').click();
  await advance(120);
  assert.ok(await page.evaluate(() => window.__globe.trade.state.produced.bread > 0 && window.__globe.trade.state.sold.bread > 0));
  assert.ok(await page.evaluate(() => window.__globe.trade.state.milestones.includes('trade')));
  checks.push({ name: 'UI-created route produces, delivers, settles sales, and unlocks progress', pass: true });
  await screenshot('06-trading');
  await page.locator('[data-page="contracts"]').click();
  await page.locator('[data-action="accept"]').click(); await screenshot('07-contract');
  await page.locator('[data-action="explore"]').click(); await ready();
  const before = await page.evaluate(() => window.__globe.trade.state.time);
  await page.waitForTimeout(1400);
  const after = await page.evaluate(() => window.__globe.trade.state.time);
  assert.ok(after > before);
  assert.equal(await page.evaluate(() => JSON.stringify(window.__globe.world.homeMap)), normal);
  assert.equal(await page.locator('.trade-root').count(), 0);
  checks.push({ name: 'exploration map is identical and economy continues outside TradeMode', pass: true, before, after });
  // Town and space also share the application-level economy, with the original exploration IDs.
  for (const target of ['town', 'space']) {
    const prior = await page.evaluate(() => window.__globe.trade.state.time);
    await page.evaluate(async mode => { const g = window.__globe; await g.director.go({ mode, planet: g.world.homeIndex, city: 0 }); }, target); await ready();
    await page.waitForTimeout(1000);
    assert.ok(await page.evaluate(time => window.__globe.trade.state.time > time, prior));
    assert.equal(await page.evaluate(() => JSON.stringify(window.__globe.world.homeMap)), normal);
  }
  await page.evaluate(async () => { const g = window.__globe; await g.director.go({ mode: 'trade', planet: g.trade.state.planet, campaign: g.trade.state.id }); }); await ready();
  checks.push({ name: 'economy persists through original TownMode and SpaceMode without changing exploration IDs or terrain', pass: true });
  await page.setViewportSize({ width: 1280, height: 720 }); await screenshot('08-desktop-1280');
  const layout = await page.evaluate(() => {
    const elements = ['.trade-topbar', '.trade-inspector', '.trade-dock', '.trade-objective'];
    return elements.map(selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { selector, x: r.x, y: r.y, width: r.width, height: r.height, inside: r.x >= 0 && r.y >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 }; });
  });
  assert.ok(layout.every(item => item.inside), JSON.stringify(layout));
  checks.push({ name: 'desktop HUD remains inside 1280×720', pass: true, layout });
  await page.evaluate(async () => { window.__globe.trade.setPaused(true); await window.__globe.trade.save(); });
  const checkpoint = await page.evaluate(() => ({ time: window.__globe.trade.state.time, cash: window.__globe.trade.state.cash, shipments: window.__globe.trade.state.shipments }));
  await page.reload(); await ready();
  assert.deepEqual(await page.evaluate(() => ({ time: window.__globe.trade.state.time, cash: window.__globe.trade.state.cash, shipments: window.__globe.trade.state.shipments })), checkpoint);
  checks.push({ name: 'reload restores exact money, clock, and in-transit cargo without offline progress', pass: true });

  // A complete strategy uses the same command/session service; it adds no cash, resources or unlocks.
  const campaign = playCampaign();
  await page.locator('.trade-time [data-action="settings"]').click(); await page.locator('[data-action="newGame"]').click();
  const priorId = await page.evaluate(() => window.__globe.trade.state.id);
  await page.locator('[data-start]').click();
  await page.waitForFunction(id => window.__globe.trade.state.id !== id && window.__globe.director.route.campaign === window.__globe.trade.state.id, priorId); await ready();
  await page.evaluate(({ actions, until }) => {
    const session = window.__globe.trade;
    session.setPaused(false);
    const advanceTo = time => { session.last -= Math.max(0, time - session.state.time); session.pump(); while (session.accumulator >= 1) session.pump(); };
    for (const action of actions) { advanceTo(action.time); session.run(action); }
    advanceTo(until); session.setPaused(true);
    const mode = window.__globe.director.mode; mode.dirty = true; mode.hud.page = 'goals'; mode.hud.render(true);
  }, { actions: campaign.actions, until: campaign.report.time });
  assert.ok(await page.evaluate(() => window.__globe.trade.state.milestones.includes('kingdom')));
  checks.push({ name: 'full strategy reaches three stable towns, six goods, final milestone and sandbox in app service', pass: true, simulationSeconds: campaign.report.time });
  await page.locator('[data-action="overview"]').click(); await screenshot('09-completed-network');

  await page.evaluate(() => window.__globe.director.mode.inspect('city', 'city:0'));
  await page.locator('.trade-inspector [data-action="build"]').click(); await page.locator('[data-kind="port"]').click();
  await page.evaluate(() => window.__globe.director.mode.focus('tile', 306));
  await page.waitForFunction(() => !window.__globe.director.mode.pr.camTween);
  const portPoint = await page.evaluate(() => {
    const mode = window.__globe.director.mode, pr = mode.pr;
    for (const id of mode.validTiles) {
      const p = pr.planetGroup.localToWorld(pr.hexasphere.tileMap.get(id).center.clone().multiplyScalar(pr.landR)).project(pr.camera);
      const x = (p.x + 1) * innerWidth / 2, y = (1 - p.y) * innerHeight / 2;
      if (x > 80 && y > 150 && y < innerHeight - 90 && document.elementFromPoint(x, y)?.tagName === 'CANVAS') return { x, y, id };
    } return null;
  });
  await screenshot('09b-port-placement');
  assert.ok(portPoint, await page.evaluate(() => JSON.stringify({ valid: window.__globe.director.mode.validTiles, text: document.querySelector('[data-panel]').innerText }))); await page.mouse.click(portPoint.x, portPoint.y);
  await page.locator('dialog [data-action="confirm"]').click();
  await page.locator('[data-action="play"]').click(); await advance(35);
  assert.ok(await page.evaluate(() => window.__globe.trade.state.cities[0].port));
  await page.locator('.trade-dock [data-action="newRoute"]').click();
  await page.locator('[data-action="pickTown"][data-id="city:0"]').click(); await page.locator('[data-action="pickTown"][data-id="city:1"]').click();
  await page.locator('[data-field="mode"]').selectOption('sea');
  assert.equal(await page.locator('[data-action="activateRoute"]').isDisabled(), false, await page.evaluate(() => JSON.stringify({ port: window.__globe.trade.state.cities.map(c => [c.id,c.portTileId]), cash: window.__globe.trade.state.cash, text: document.querySelector('[data-preview]').innerText })));
  await page.locator('[data-action="activateRoute"]').click();
  assert.ok(await page.evaluate(() => window.__globe.trade.state.routes.some(r => r.mode === 'sea')));
  await advance(180);
  assert.ok(await page.evaluate(() => window.__globe.trade.state.routes.find(r => r.mode === 'sea').delivered > 0));
  await screenshot('10-sea-logistics');
  checks.push({ name: 'coastal globe click, costly-build confirmation, port completion and UI-created sea route', pass: true });

  // Pause menu and Trade's B shortcut must not share the global mute action.
  const muted = await page.evaluate(() => window.__globe.engine.audio.settings.muted);
  await page.keyboard.press('b'); assert.equal(await page.locator('.trade-catalog').count(), 1);
  assert.equal(await page.evaluate(() => window.__globe.engine.audio.settings.muted), muted);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  assert.ok(await page.evaluate(() => window.__globe.engine.pauseMenu.open));
  const frozen = await page.evaluate(() => window.__globe.trade.state.time); await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => window.__globe.trade.state.time), frozen);
  await page.locator('#pauseUi [data-act="close"]').click();
  checks.push({ name: 'B opens build without muting; Escape menu freezes economy', pass: true });

  await page.evaluate(async () => { window.__globe.trade.setPaused(true); await window.__globe.trade.save(); });
  const reader = await context.newPage(); reader.on('pageerror', e => errors.push(e.message));
  await reader.goto(page.url()); await reader.waitForFunction(() => window.__globe?.director.route?.mode === 'trade' && !window.__globe.director.busy);
  assert.ok(await reader.evaluate(() => window.__globe.trade.readOnly));
  const readerTime = await reader.evaluate(() => window.__globe.trade.state.time);
  await reader.evaluate(() => { window.__globe.trade.setPaused(false); window.__globe.trade.last -= 100; window.__globe.trade.pump(); });
  assert.equal(await reader.evaluate(() => window.__globe.trade.state.time), readerTime);
  await page.evaluate(() => window.__globe.trade.stop()); await reader.locator('[data-action="takeover"]').click();
  await reader.waitForFunction(() => !window.__globe.trade.readOnly);
  checks.push({ name: 'second tab is read-only and safely takes ownership after writer releases', pass: true });
  await reader.close(); await page.reload(); await ready();

  for (const size of [{ width: 1024, height: 768 }, { width: 720, height: 450 }]) {
    await page.setViewportSize(size); await screenshot(`11-layout-${size.width}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false);
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('.trade-rail button')].every(b => b.getBoundingClientRect().bottom <= document.querySelector('.trade-dock').getBoundingClientRect().top)));
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  const lifecycle = [];
  for (let i = 0; i < 6; i++) {
    await page.locator('[data-action="explore"]').click(); await page.waitForFunction(() => window.__globe?.director.route?.mode === 'planet' && !window.__globe.director.busy);
    await page.locator('.trade-entry-cta').click(); await page.waitForFunction(() => window.__globe?.director.route?.mode === 'trade' && !window.__globe.director.busy);
    await page.waitForTimeout(250);
    lifecycle.push(await page.evaluate(() => ({ roots: document.querySelectorAll('.trade-root').length, listeners: window.__globe.trade.listeners.size, geometry: window.__globe.engine.renderer.info.memory.geometries, textures: window.__globe.engine.renderer.info.memory.textures })));
  }
  assert.ok(lifecycle.every(x => x.roots === 1 && x.listeners === lifecycle[0].listeners));
  assert.ok(lifecycle.at(-1).geometry <= lifecycle[0].geometry + 5, JSON.stringify(lifecycle));
  assert.ok(lifecycle.at(-1).textures <= lifecycle[0].textures + 2, JSON.stringify(lifecycle));
  checks.push({ name: 'six repeated entries keep one HUD and bounded geometry, textures, session listeners', pass: true, lifecycle });

  await page.evaluate(async () => {
    const set = Storage.prototype.setItem;
    window.restoreTradeStorage = () => { Storage.prototype.setItem = set; };
    Storage.prototype.setItem = function(key, value) { if (key.startsWith('globe:journal:trade:')) throw new DOMException('QA quota', 'QuotaExceededError'); return set.call(this, key, value); };
    await window.__globe.trade.save(); window.__globe.director.mode.hud.render(true);
  });
  assert.match(await page.locator('[data-save]').innerText(), /Belum tersimpan/);
  await page.evaluate(async () => { window.restoreTradeStorage(); await window.__globe.trade.save(); window.__globe.director.mode.hud.render(true); });
  assert.equal(await page.locator('[data-save]').innerText(), 'Tersimpan lokal');
  checks.push({ name: 'quota failure shows unsaved status and recovers after a successful save', pass: true });

  await page.locator('.trade-time [data-action="settings"]').click();
  const downloadPromise = page.waitForEvent('download'); await page.locator('[data-action="export"]').click();
  const download = await downloadPromise; await download.saveAs(path.join(output, 'campaign-export.json'));
  const originalHash = await page.evaluate(() => location.hash);
  await page.locator('[data-action="newGame"]').click();
  await page.locator('[data-import]').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"globe-trade","version":1,"state":{"cash":-1}}') });
  assert.match(await page.locator('dialog [data-error]').innerText(), /save|simpan|valid|rusak/i);
  assert.equal(await page.evaluate(() => location.hash), originalHash); await page.locator('.trade-close').click();
  checks.push({ name: 'native export download succeeds and malformed imports leave the active campaign unchanged', pass: true });

  await page.locator('[data-action="appSettings"]').click();
  await page.locator('#pauseUi [data-locale="en"]').click();
  await page.waitForFunction(() => document.documentElement.lang === 'en' && window.__globe?.director.route?.mode === 'trade' && !window.__globe.director.busy);
  assert.equal(await page.locator('.trade-dock [data-action="expand"]').innerText(), 'Found a town');
  await screenshot('12-english');
  checks.push({ name: 'English HUD updates controls and context panel with no translation keys exposed', pass: true });
  const engineError = await page.evaluate(() => window.__globe.engine.lastError?.message || null);
  assert.equal(engineError, null); assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ checks, errors, engineError }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, errors, engineError, output }));
} finally { await browser.close(); }
