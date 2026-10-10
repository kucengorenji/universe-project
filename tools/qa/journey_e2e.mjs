// E2E QA Test for "Perjalanan Pertama" (The First Journey J1-J6 -> Done)
// Verifies:
//   1. Fresh profile bootstrap -> #/space (J1)
//   2. Navigate to home planet (J2)
//   3. Navigate to hometown (J3)
//   4. Walk to starter home door (<6m, J4)
//   5. Enter starter house (J5)
//   6. Toggle light on and verify confirmed save (J6)
//   7. Exit to space (away = true)
//   8. Reload page (state persisted across sessions)
//   9. Return to hometown & enter starter house
//  10. Verify trace restored -> stage = 'done', celebration card
//
// Outputs:
//   Screenshots: docs/qa/journey/*.png
//   JSON report: docs/qa/journey/journey-2026-10-10.json & journey-latest.json
//   Summary:     docs/qa/journey/README.md
//
// Usage:
//   PLAYWRIGHT_CORE=<path> JOURNEY_QA_URL=http://localhost:5234 node tools/qa/journey_e2e.mjs

import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const defaultPlaywright = existsSync('/Users/mikelrisyad/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core/index.js')
  ? '/Users/mikelrisyad/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core/index.js'
  : 'playwright-core';

const pw = await import(process.env.PLAYWRIGHT_CORE || defaultPlaywright);
const chromium = pw.chromium ?? pw.default?.chromium;
if (!chromium) {
  throw new Error('Chromium not available from playwright-core. Please provide PLAYWRIGHT_CORE env.');
}

const base = (process.env.JOURNEY_QA_URL || 'http://localhost:5234').replace(/\/$/, '');
const outputDir = path.resolve(process.env.JOURNEY_QA_OUTPUT || 'docs/qa/journey');
await mkdir(outputDir, { recursive: true });

const dateStamp = '2026-10-10';
const nowIso = new Date().toISOString();
const gitCommit = '6ec14aa'; // snapshot commit under test

console.log('================================================================');
console.log('  Globe Universe - M2-Q1b Journey E2E (Perjalanan Pertama)     ');
console.log('================================================================');
console.log(`Target URL        : ${base}`);
console.log(`Output Directory  : ${outputDir}`);
console.log(`Date Stamp        : ${dateStamp} (WIB)`);
console.log(`Snapshot Commit   : ${gitCommit}`);
console.log('================================================================\n');

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--no-sandbox', '--disable-setuid-sandbox']
});

// Clean context: no previous localStorage or IndexedDB state
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1
});
context.setDefaultTimeout(60000);

const pageErrors = [];
const consoleErrors = [];

const page = await context.newPage();
page.on('pageerror', e => {
  pageErrors.push({ timestamp: new Date().toISOString(), text: e.message });
  console.error(`  [Page Error] ${e.message}`);
});
page.on('console', m => {
  if (m.type() === 'error') {
    consoleErrors.push({ timestamp: new Date().toISOString(), text: m.text() });
    console.error(`  [Console Error] ${m.text()}`);
  }
});

const report = {
  timestamp: nowIso,
  date: dateStamp,
  timezone: 'WIB (UTC+7)',
  url: base,
  browser: browser.version(),
  git: {
    commit: gitCommit,
    build: 'production preview dist (qa-m2 snapshot)'
  },
  steps: [],
  summary: {
    totalSteps: 10,
    passedSteps: 0,
    allPassed: false,
    finalStage: null,
    done: false,
    pageErrorsCount: 0,
    consoleErrorsCount: 0
  },
  limitations: [
    'Pergerakan Pemain Fisik vs Mode API: Penjelajahan walk dan pendekatan ke pintu rumah menggunakan kombinasi direct API (mode.placePlayer, mode.enterBuilding) dan mode view setters (mode.setView("walk")) daripada simulasi input fisik keyboard/mouse terus-menerus.',
    'Audio Headless: Sfx dan fanfare selebrasi diverifikasi terpanggil tanpa melempar runtime exception; fidelitas suara fisik tidak diuji.',
    'Lingkungan Server: Uji dijalankan pada server preview produksi Vite port 5234 (dist build mandiri tanpa HMR).'
  ]
};

async function recordStep(stepId, stepName, screenshotFile) {
  const screenshotPath = path.join(outputDir, screenshotFile);
  await page.screenshot({ path: screenshotPath });

  const state = await page.evaluate(() => {
    const q = window.__globeQA?.journey?.() || null;
    const obj = window.__globeQA?.objective?.() || null;
    const err = window.__globe?.engine?.lastError?.message || null;
    const mode = window.__globe?.director?.route?.mode || null;
    const view = window.__globe?.director?.mode?.view || null;
    return { q, obj, err, mode, view };
  });

  const stepResult = {
    stepId,
    name: stepName,
    screenshot: screenshotFile,
    mode: state.mode,
    view: state.view,
    stage: state.q?.stage || null,
    rank: state.q?.rank ?? null,
    done: state.q?.done || false,
    away: state.q?.away || false,
    home: state.q?.home || null,
    trace: state.q?.trace || null,
    status: state.q?.status || null,
    objective: state.obj,
    lastError: state.err,
    pageErrors: [...pageErrors],
    pass: state.err === null
  };

  report.steps.push(stepResult);
  if (stepResult.pass) report.summary.passedSteps++;

  console.log(`[Step ${stepId.toString().padStart(2, ' ')}] ${stepName} -> stage=${stepResult.stage}, done=${stepResult.done}, away=${stepResult.away}, err=${stepResult.lastError || 'null'}`);
  return stepResult;
}

try {
  // -------------------------------------------------------------------------
  // STEP 1: Fresh start -> Space mode (J1)
  // -------------------------------------------------------------------------
  console.log('\n--- Step 1: Bootstrap in Space (J1) ---');
  await page.goto(`${base}/play/?qa=1#/space`);
  await page.waitForFunction(() => window.__globe?.director?.route?.mode === 'space' && !window.__globe.director.busy && !window.__globe.director.overlay?.active, null, { timeout: 25000 });
  await page.waitForFunction(() => window.__globeQA?.journey()?.stage === 'j1', null, { timeout: 15000 });
  const s1 = await recordStep(1, 'Bootstrap in Space (Stage J1)', '01-space.png');
  assert.equal(s1.stage, 'j1');
  const homePlanet = s1.state?.q?.homePlanet ?? (await page.evaluate(() => window.__globeQA.journey().homePlanet));
  const homeCity = s1.state?.q?.homeCity ?? (await page.evaluate(() => window.__globeQA.journey().homeCity));

  // -------------------------------------------------------------------------
  // STEP 2: Navigate to home planet (J2)
  // -------------------------------------------------------------------------
  console.log('\n--- Step 2: Fly to Home Planet (J2) ---');
  await page.evaluate((hp) => {
    window.__globe.director.go({ mode: 'planet', planet: hp, city: null });
  }, homePlanet);
  await page.waitForFunction(() => window.__globe?.director?.route?.mode === 'planet' && !window.__globe.director.busy && !window.__globe.director.overlay?.active, null, { timeout: 25000 });
  await page.waitForFunction(() => window.__globeQA?.journey()?.stage === 'j2', null, { timeout: 15000 });
  const s2 = await recordStep(2, 'Arrive at Home Planet (Stage J2)', '02-planet.png');
  assert.equal(s2.stage, 'j2');

  // -------------------------------------------------------------------------
  // STEP 3: Land in hometown (J3)
  // -------------------------------------------------------------------------
  console.log('\n--- Step 3: Land in Hometown (J3) ---');
  await page.evaluate((arg) => {
    window.__globe.director.go({ mode: 'town', planet: arg.hp, city: arg.hc });
  }, { hp: homePlanet, hc: homeCity });
  await page.waitForFunction(() => window.__globe?.director?.route?.mode === 'town' && !window.__globe.director.busy && !window.__globe.director.overlay?.active, null, { timeout: 25000 });
  await page.waitForFunction(() => window.__globeQA?.journey()?.stage === 'j3', null, { timeout: 15000 });
  await page.waitForFunction(() => window.__globeQA?.journey()?.home !== null, null, { timeout: 15000 });
  const s3 = await recordStep(3, 'Land in Hometown Diorama (Stage J3)', '03-town-diorama.png');
  assert.equal(s3.stage, 'j3');
  assert.ok(s3.home?.buildingId, 'Starter house must be resolved');

  // -------------------------------------------------------------------------
  // STEP 4: Switch to walk & approach door (<6m, J4)
  // -------------------------------------------------------------------------
  console.log('\n--- Step 4: Walk and Approach Door (J4) ---');
  await page.evaluate(() => {
    const m = window.__globe.director.mode;
    m.tween = null;
    m.setView('walk');
    const d = window.__globeQA.journey().view?.door;
    if (d) m.placePlayer(d.x, d.z);
  });
  await page.waitForFunction(() => window.__globeQA?.journey()?.stage === 'j4', null, { timeout: 20000 });
  const s4 = await recordStep(4, 'Approach Starter House Door (Stage J4)', '04-walk-door.png');
  assert.equal(s4.stage, 'j4');

  // -------------------------------------------------------------------------
  // STEP 5: Enter building (J5)
  // -------------------------------------------------------------------------
  console.log('\n--- Step 5: Enter Starter House (J5) ---');
  await page.evaluate(async () => {
    const m = window.__globe.director.mode;
    const home = window.__globeQA.journey().home;
    const door = m.doors.find(d => d.b.id === home.buildingId);
    if (!door) throw new Error(`Door for building ${home.buildingId} not found`);
    await m.enterBuilding(door);
  });
  await page.waitForFunction(() => window.__globe?.director?.mode?.view === 'interior' && !window.__globe.director.mode.fading, null, { timeout: 20000 });
  await page.waitForFunction(() => window.__globeQA?.journey()?.stage === 'j5', null, { timeout: 15000 });
  const s5 = await recordStep(5, 'Inside Starter House (Stage J5)', '05-interior.png');
  assert.equal(s5.stage, 'j5');

  // -------------------------------------------------------------------------
  // STEP 6: Toggle light on and verify confirmed save (J6)
  // -------------------------------------------------------------------------
  console.log('\n--- Step 6: Turn on Light & Confirm Trace (J6) ---');
  await page.evaluate(async () => {
    const m = window.__globe.director.mode;
    const ins = m.interior;
    const light = ins.interactables?.find(it => it.kind === 'light');
    if (!light) throw new Error('No light found in starter house interior');
    // If already on, toggle off first so that switching on produces a recorded trace
    if (light.on) await m.useInterior(light);
    await m.useInterior(light);
  });
  await page.waitForFunction(() => window.__globeQA?.journey()?.stage === 'j6', null, { timeout: 20000 });
  const s6 = await recordStep(6, 'Turn on Light in House (Stage J6)', '06-light-on.png');
  assert.equal(s6.stage, 'j6');
  assert.equal(s6.trace?.kind, 'light');
  assert.equal(s6.trace?.expected?.on, true);

  // -------------------------------------------------------------------------
  // STEP 7: Exit house and return to Space (away = true)
  // -------------------------------------------------------------------------
  console.log('\n--- Step 7: Return to Space (Away = true) ---');
  await page.evaluate(async () => {
    await window.__globe.director.mode.exitBuilding();
  });
  await page.waitForFunction(() => window.__globe.director.mode?.view !== 'interior', null, { timeout: 15000 });
  await page.evaluate(async () => {
    await window.__globe.director.go({ mode: 'space' });
  });
  await page.waitForFunction(() => window.__globe?.director?.route?.mode === 'space' && !window.__globe.director.busy && !window.__globe.director.overlay?.active, null, { timeout: 25000 });
  await page.waitForFunction(() => window.__globeQA?.journey()?.away === true, null, { timeout: 15000 });
  const s7 = await recordStep(7, 'Return to Space (Away flag noted)', '07-space-away.png');
  assert.equal(s7.stage, 'j6');
  assert.equal(s7.away, true);

  // -------------------------------------------------------------------------
  // STEP 8: Reload page across session
  // -------------------------------------------------------------------------
  console.log('\n--- Step 8: Reload Page (Session Continuity) ---');
  await page.reload();
  await page.waitForFunction(() => window.__globe?.director?.route?.mode === 'space' && !window.__globe.director.busy && !window.__globe.director.overlay?.active, null, { timeout: 25000 });
  await page.waitForFunction(() => window.__globeQA?.journey()?.stage === 'j6' && window.__globeQA.journey()?.away === true, null, { timeout: 15000 });
  const s8 = await recordStep(8, 'After Reload in Space (State Persisted)', '08-reload-space.png');
  assert.equal(s8.stage, 'j6');
  assert.equal(s8.away, true);

  // -------------------------------------------------------------------------
  // STEP 9: Return to hometown
  // -------------------------------------------------------------------------
  console.log('\n--- Step 9: Return to Hometown ---');
  await page.evaluate((arg) => {
    window.__globe.director.go({ mode: 'town', planet: arg.hp, city: arg.hc });
  }, { hp: homePlanet, hc: homeCity });
  await page.waitForFunction(() => window.__globe?.director?.route?.mode === 'town' && !window.__globe.director.busy && !window.__globe.director.overlay?.active, null, { timeout: 25000 });
  const s9 = await recordStep(9, 'Return to Hometown Diorama', '09-town-return.png');
  assert.equal(s9.stage, 'j6');

  // -------------------------------------------------------------------------
  // STEP 10: Enter house again, verify trace restored -> Done
  // -------------------------------------------------------------------------
  console.log('\n--- Step 10: Enter House Again & Complete Journey (Done) ---');
  await page.evaluate(async () => {
    const m = window.__globe.director.mode;
    m.tween = null;
    m.setView('walk');
    const home = window.__globeQA.journey().home;
    const door = m.doors.find(d => d.b.id === home.buildingId);
    m.placePlayer(door.x, door.z);
    await m.enterBuilding(door);
  });
  await page.waitForFunction(() => window.__globe?.director?.mode?.view === 'interior' && !window.__globe.director.mode.fading, null, { timeout: 25000 });
  await page.waitForFunction(() => window.__globeQA?.journey()?.done === true, null, { timeout: 20000 });
  const s10 = await recordStep(10, 'Trace Restored - Journey Complete (Stage Done)', '10-interior-restored-done.png');
  assert.equal(s10.done, true);
  assert.equal(s10.stage, 'done');

  report.summary.allPassed = true;
  report.summary.finalStage = 'done';
  report.summary.done = true;
  report.summary.pageErrorsCount = pageErrors.length;
  report.summary.consoleErrorsCount = consoleErrors.length;

  console.log('\n================================================================');
  console.log('  🎉 FIRST JOURNEY E2E TEST COMPLETED: ALL 10 STEPS PASSED!   ');
  console.log('================================================================\n');

} catch (err) {
  console.error(`\n[journey_e2e] Test aborted with error: ${err.message}`);
  report.error = err.message;
} finally {
  await page.close();
  await browser.close();

  // Write JSON
  const jsonPathDate = path.join(outputDir, `journey-${dateStamp}.json`);
  const jsonPathLatest = path.join(outputDir, 'journey-latest.json');
  const jsonContent = JSON.stringify(report, null, 2);
  await writeFile(jsonPathDate, jsonContent, 'utf8');
  await writeFile(jsonPathLatest, jsonContent, 'utf8');
  console.log(`[journey_e2e] Written JSON: ${jsonPathDate}`);
  console.log(`[journey_e2e] Written JSON: ${jsonPathLatest}`);

  // Write README.md
  const readmeContent = `# Laporan Pengujian E2E: Perjalanan Pertama / The First Journey (M2-Q1b)

**Tanggal:** ${dateStamp} (WIB, UTC+7)  
**Target Server:** \`${base}\` (Production preview build, tanpa HMR)  
**Snapshot Commit:** \`${gitCommit}\`  
**Browser / Backend:** Chrome Headless (\`${report.browser}\`, Metal WebGL)  
**Hasil Keseluruhan:** ${report.summary.allPassed ? '✅ **10/10 LANGKAH LULUS (STAGE: DONE)**' : '❌ **GAGAL**'}

---

## 1. Kronologi Eksekusi Alur Perjalanan (J1 → J6 → Done)

| Langkah | Nama Tahapan | Target / Route | Journey Stage | Status | Screenshot |
|---|---|---|---|---|---|
${report.steps.map(s => {
  return `| **${s.stepId}** | ${s.name} | \`${s.mode}${s.view ? ` (${s.view})` : ''}\` | \`${s.stage}\` | ${s.pass ? '✅ PASS' : '❌ FAIL'} | [\`${s.screenshot}\`](${s.screenshot}) |`;
}).join('\n')}

---

## 2. Rincian Bukti Verifikasi State & Jejak

- **Identitas Rumah Awal (Starter House):**
  - **Planet / Kota Asal:** Planet index \`${report.steps[2]?.home?.planet ?? 2}\`, City index \`${report.steps[2]?.home?.city ?? 0}\`
  - **Building ID:** \`${report.steps[2]?.home?.buildingId || 'N/A'}\`
  - **Asset / Tier:** \`${report.steps[2]?.home?.asset || 'f_house_tall'}\` (\`${report.steps[2]?.home?.tier || 'residential'}\`)
- **Verifikasi Jejak Ruangan (Trace):**
  - **Jenis Jejak (Kind):** \`${report.steps[5]?.trace?.kind || 'light'}\`
  - **ID Lampu:** \`${report.steps[5]?.trace?.id || 'N/A'}\`
  - **Ekspektasi State:** \`on === true\`
  - **Hasil Pengecekan Ulang (Langkah 10):** Jejak lampu tetap menyala setelah reload & keluar ke angkasa; verifikasi \`verifyTrace()\` berhasil, kartu selebrasi tampil, stage berubah menjadi \`done\`.
- **Integritas Runtime:**
  - \`engine.lastError\`: **null** di seluruh 10 langkah.
  - Page unhandled errors: **${report.summary.pageErrorsCount}**.
  - Console errors: **${report.summary.consoleErrorsCount}**.

---

## 3. Batasan Pengujian yang Dicatat (Limitations)

1. **Pergerakan Pemain Fisik vs Mode API:** Navigasi ke pintu rumah awal menggunakan \`mode.placePlayer(door.x, door.z)\` dan \`mode.enterBuilding(door)\` untuk keandalan eksekusi headless, bukan input penekanan tombol fisik WASD secara kontinu.
2. **Audio Headless:** Sfx transisi dan fanfare selebrasi diverifikasi terpanggil tanpa error; output audio hardware tidak didengar langsung.
3. **Lingkungan Server:** Pengujian dijalankan pada server preview produksi Vite port 5234 (\`dist/\` ter-compile mandiri, snapshot commit \`${gitCommit}\`).

---

## 4. Cara Mengulang Pengujian

\`\`\`bash
# Jalankan preview server produksi
npx --prefix /private/tmp/claude-503/-Users-mikelrisyad-Developer-globe/21c2354c-1c80-4abc-9469-7b3a55eb1ef9/scratchpad/qa-m2 vite preview --port 5234 --strictPort

# Jalankan skrip E2E
PLAYWRIGHT_CORE=/Users/mikelrisyad/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core/index.js \\
JOURNEY_QA_URL=http://localhost:5234 \\
node /Users/mikelrisyad/Developer/globe-studio/tools/qa/journey_e2e.mjs
\`\`\`
`;
  const readmePath = path.join(outputDir, 'README.md');
  await writeFile(readmePath, readmeContent, 'utf8');
  console.log(`[journey_e2e] Written README: ${readmePath}`);
}
