// Town plan preview: renders generateTownLayout() as a top-down SVG, and a PNG
// beside it when playwright can be imported (PLAYWRIGHT_MODULE may point at a
// global install). Streets, blocks, houses, trees, walls and fields only.
//   node tools/plan/preview.mjs --seed 17 [--city 0] [--out plan.svg] [--version 4]
//     [--template auto|area|street|square|ring] [--density sparse|normal|dense] [--radius m] [--png 0]
import { writeFileSync } from 'node:fs';
import { generateHexasphere } from '../../src/math/hexasphere.js';
import { MapGenerator } from '../../src/map/mapGenerator.js';
import { generateTownLayout } from '../../src/modes/town/layout/townLayout.js';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const seed = Number(arg('seed', 17));
const sub = Number(arg('sub', 4));
const version = Number(arg('version', 4));
const out = arg('out', 'plan.svg');
const hexasphere = generateHexasphere(sub, 10);
const map = new MapGenerator(hexasphere).generate(seed, { planetType: 'terran' });
let cityIndex = arg('city', null);
if (cityIndex === null) cityIndex = map.cities.findIndex((c) => c.type === 'capital' && c.style !== 'modern');
cityIndex = Math.max(0, Number(cityIndex));
const density = { sparse: 0.75, normal: 1, dense: 1.3 }[arg('density', 'normal')] ?? 1;
const L = generateTownLayout({ map, hexasphere, cityIndex, layoutVersion: version, options: { template: arg('template', 'auto'), density } });

const R = Math.min(L.dioramaR, Number(arg('radius', L.cityR * 1.35 + 60)));
const px = 1000 / (2 * R);
const P = (x, z) => `${((x + R) * px).toFixed(1)},${((z + R) * px).toFixed(1)}`;
const parts = [];
// Ground: land / water on a coarse raster
const step = R / 70;
for (let x = -R; x < R; x += step) for (let z = -R; z < R; z += step) {
  const s = L.fields.sample(x + step / 2, z + step / 2);
  if (s.land < 0.5) parts.push(`<rect x="${((x + R) * px).toFixed(1)}" y="${((z + R) * px).toFixed(1)}" width="${(step * px + 0.6).toFixed(1)}" height="${(step * px + 0.6).toFixed(1)}" fill="#6f98ad"/>`);
}
for (const f of L.fields2 || []) parts.push(`<rect x="${-f.w / 2 * px}" y="${-f.d / 2 * px}" width="${f.w * px}" height="${f.d * px}" fill="#b9b27e" opacity=".6" transform="translate(${P(f.x, f.z)}) rotate(${(f.yaw * 180) / Math.PI})"/>`);
for (const p of L.parks || []) parts.push(`<polygon points="${p.poly.map((v) => P(v.x, v.z)).join(' ')}" fill="#8fae6a"/>`);
for (const r of L.rivers || []) parts.push(`<polyline points="${r.pts.map(([x, z]) => P(x, z)).join(' ')}" fill="none" stroke="#6f98ad" stroke-width="${r.w * px}" stroke-linecap="round" stroke-linejoin="round"/>`);
const col = { main: '#e9dfc4', ring: '#efe6cf', lane: '#f3ecda', road: '#d8c7a0', collector: '#bdbdbd', residential: '#cfcfcf', grid: '#bdbdbd' };
for (const s of L.streets) parts.push(`<polyline points="${s.pts.map(([x, z]) => P(x, z)).join(' ')}" fill="none" stroke="${col[s.kind] || '#eee'}" stroke-width="${Math.max(1, s.w * px)}" stroke-linecap="round" stroke-linejoin="round"/>`);
if (L.plaza) {
  if (L.plaza.poly?.length > 2) parts.push(`<polygon points="${L.plaza.poly.map(([x, z]) => P(x, z)).join(' ')}" fill="#e8dcc0"/>`);
  else parts.push(`<circle cx="${(L.plaza.x + R) * px}" cy="${(L.plaza.z + R) * px}" r="${L.plaza.r * px}" fill="#e8dcc0"/>`);
}
for (const w of L.walls) parts.push(`<rect x="${-w.len / 2 * px}" y="${-1.2 * px}" width="${w.len * px}" height="${Math.max(1.5, 2.4 * px)}" fill="#6b6660" transform="translate(${P(w.x, w.z)}) rotate(${(w.yaw * 180) / Math.PI})"/>`);
for (const p of L.props) if (p.asset === 'f_wall_tower' || p.asset === 'f_gate') parts.push(`<circle cx="${(p.x + R) * px}" cy="${(p.z + R) * px}" r="${(p.asset === 'f_gate' ? 4 : 3.2) * px}" fill="#5a5550"/>`);
const roof = (b) => (b.ward === 'landmark' ? '#8a5a3c' : /apartment|office|tower/.test(b.asset) ? '#7c8591' : ['#a2553d', '#9a4a36', '#8f5a3f', '#5d6b86', '#a8663f'][b.variant % 5]);
for (const b of L.buildings) parts.push(`<rect x="${-b.w / 2 * px}" y="${-b.d / 2 * px}" width="${b.w * px}" height="${b.d * px}" fill="${roof(b)}" stroke="#3b2a22" stroke-width=".6" transform="translate(${P(b.x, b.z)}) rotate(${(b.yaw * 180) / Math.PI})"/>`);
for (const t of L.trees) if (!t.asset.startsWith('r_')) parts.push(`<circle cx="${((t.x + R) * px).toFixed(1)}" cy="${((t.z + R) * px).toFixed(1)}" r="${Math.max(1, (t.w / 2) * px).toFixed(1)}" fill="#4f7a3e" opacity=".9"/>`);
const title = `${L.name} · v${L.layoutVersion} · ${L.morphology?.kind || ''} ${L.morphology?.template || ''} · ${L.buildings.length} bangunan`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1040" viewBox="0 0 1000 1040"><rect width="1000" height="1040" fill="#c9d3a4"/>${parts.join('')}<rect y="1000" width="1000" height="40" fill="#222"/><text x="12" y="1026" font-family="sans-serif" font-size="18" fill="#eee">${title}</text></svg>`;
writeFileSync(out, svg);
if (out.endsWith('.svg') && arg('png', '1') === '1') {
  try {
    const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1040 } });
    await page.setContent(svg);
    await page.screenshot({ path: out.replace(/\.svg$/, '.png') });
    await browser.close();
  } catch (e) {
    console.warn('png skipped:', e.message);
  }
}
console.log(title, 'cityR', L.cityR.toFixed(0));
