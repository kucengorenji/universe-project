import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.HOME_QA_PLAYWRIGHT || '/Users/mikelrisyad/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1 });
const errors = [], fixtures = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await page.goto((process.env.HOME_QA_URL || 'http://127.0.0.1:5192') + '/tools/blender/home/qa/viewer.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.homeAssetQA?.loaded, { timeout: 30000 });
  for (const level of [0, 1, 2]) {
    const data = await page.evaluate(level => window.setHomeAssetFixture({ level }), level);
    await page.waitForTimeout(300);
    if (data.missingUV) errors.push('UV absent after game loader');
    if (Object.values(data.mergedParts).some(lods => Object.values(lods).some(n => n !== 1))) errors.push('palette material batching failed');
    await page.screenshot({ path: new URL(`qa/runtime_lod${level}.png`, import.meta.url).pathname });
    fixtures.push(data);
  }
  for (const [name, state] of Object.entries({ sofa: { asset: 'sofa' }, bed: { asset: 'bed' }, window: { asset: 'window' }, vase: { asset: 'vase' },
    wire: { asset: 'sofa', wireMode: true }, collider: { asset: 'bed', colliderMode: true }, night: { nightMode: true } })) {
    fixtures.push(await page.evaluate(state => window.setHomeAssetFixture(state), state));
    await page.waitForTimeout(300);
    await page.screenshot({ path: new URL(`qa/runtime_${name}.png`, import.meta.url).pathname });
  }
  await page.evaluate(() => window.setHomeAssetFixture({}));
  await page.waitForTimeout(500);
  const profile = await page.evaluate(() => window.profileHomeAssets());
  const context = await page.evaluate(() => ({ hidden: document.hidden, userAgent: navigator.userAgent,
    gpu: (() => {const gl=document.querySelector('canvas').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null})() }));
  errors.push(...await page.evaluate(() => window.homeAssetErrors));
  const report = { status: errors.length ? 'FAIL' : 'PASS', testedAt: new Date().toISOString(),
    loader: 'loadTexturedPack(..., { mergeShades: true })', fixtures, profile, context, errors,
    limitation: 'Asset gallery fixture only; complete home geometry/editor/collision interaction performance is tested separately.' };
  writeFileSync(new URL('qa/browser.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, context, profile, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally { await browser.close(); }
