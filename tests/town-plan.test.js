import test from 'node:test';
import assert from 'node:assert/strict';
import { generateHexasphere } from '../src/math/hexasphere.js';
import { MapGenerator } from '../src/map/mapGenerator.js';
import { generateTownLayout } from '../src/modes/town/layout/townLayout.js';
import { splitPolygon, TEMPLATES } from '../src/modes/town/layout/blockPlan.js';
import { area } from '../src/modes/town/layout/wards.js';
import { TOWN_LAYOUT_VERSION } from '../src/world/townGeneration.js';

const hexasphere = generateHexasphere(3, 10);
const generator = new MapGenerator(hexasphere);
const seeds = process.env.GLOBE_SWEEP_SEEDS ? Array.from({ length: Number(process.env.GLOBE_SWEEP_SEEDS) }, (_, i) => 17 + i * 73) : [17, 427];

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const heading = (p, q) => Math.atan2(q[1] - p[1], q[0] - p[0]);
function segDist(px, pz, [ax, az], [bx, bz]) {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(ax + dx * t - px, az + dz * t - pz);
}
const corners = (b) => {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [b.x + (u * b.w * c - v * b.d * s) / 2, b.z + (u * b.w * s + v * b.d * c) / 2]);
};
function overlap(a, b) {
  const A = corners(a);
  const B = corners(b);
  for (const poly of [A, B]) {
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = poly[i];
      const [x1, z1] = poly[(i + 1) % 4];
      const nx = z0 - z1;
      const nz = x1 - x0;
      const pa = A.map(([x, z]) => x * nx + z * nz);
      const pb = B.map(([x, z]) => x * nx + z * nz);
      const len = Math.hypot(nx, nz);
      if (Math.max(...pa) < Math.min(...pb) + 0.02 * len || Math.max(...pb) < Math.min(...pa) + 0.02 * len) return false;
    }
  }
  return true;
}
// Tiles hold the fields of the map generated last, so each town regenerates its map
function* towns() {
  for (const seed of seeds) {
    const map = generator.generate(seed, { planetType: 'terran' });
    for (const cityIndex of [map.cities.findIndex((c) => c.style !== 'modern'), map.cities.findIndex((c) => c.style === 'modern')]) {
      if (cityIndex >= 0) yield { seed, map, cityIndex };
    }
  }
}
const firstTown = () => towns().next().value;

test('a line splits a concave polygon into its pieces and labels the cut', () => {
  // An L: the vertical line x = 3 cuts the end off its long arm
  const L = [[0, 0], [4, 0], [4, 1], [2, 1], [2, 3], [0, 3]].map(([x, z]) => ({ x, z, e: 'old' }));
  const { pieces, chords } = splitPolygon(L, 3, 0, 0, 1, 'cut');
  assert.equal(pieces.length, 2);
  assert.equal(chords.length, 1);
  assert.ok(Math.abs(pieces.reduce((s, p) => s + area(p), 0) - area(L)) < 1e-9);
  for (const p of pieces) assert.ok(area(p) > 0, 'pieces stay counter-clockwise');
  assert.ok(pieces.every((p) => p.some((v) => v.e === 'cut')));
  // A horizontal line through both arms of a U gives three pieces and two chords
  const U = [[0, 0], [5, 0], [5, 4], [4, 4], [4, 1], [1, 1], [1, 4], [0, 4]].map(([x, z]) => ({ x, z, e: 'old' }));
  const u = splitPolygon(U, 0, 2, 1, 0, 'cut');
  assert.equal(u.pieces.length, 3);
  assert.equal(u.chords.length, 2);
  assert.ok(Math.abs(u.pieces.reduce((s, p) => s + area(p), 0) - area(U)) < 1e-9);
});

test('planned towns have smooth streets, rows of houses clear of them and a smooth wall', () => {
  for (const { seed, map, cityIndex } of towns()) {
    const L = generateTownLayout({ map, hexasphere, cityIndex });
    const where = `seed ${seed} city ${cityIndex}`;
    assert.equal(L.layoutVersion, TOWN_LAYOUT_VERSION);
    assert.equal(L.morphology.kind, 'bisected-neighbourhood');
    assert.ok(TEMPLATES.includes(L.morphology.template));
    assert.ok(L.buildings.length > 10, where);
    // No zigzag: a street never turns one way and straight back again
    for (const s of L.streets) {
      if (s.kind === 'road') continue;
      for (let i = 1; i + 2 < s.pts.length; i++) {
        const t1 = wrap(heading(s.pts[i], s.pts[i + 1]) - heading(s.pts[i - 1], s.pts[i]));
        const t2 = wrap(heading(s.pts[i + 1], s.pts[i + 2]) - heading(s.pts[i], s.pts[i + 1]));
        assert.ok(!(Math.abs(t1) > 0.2 && Math.abs(t2) > 0.2 && Math.sign(t1) !== Math.sign(t2)), `zigzag in a ${s.kind} street, ${where}`);
      }
    }
    // Houses stand clear of every street and of each other
    const blocks = L.buildings.filter((b) => !b.asset.startsWith('f_castle'));
    for (const b of blocks) {
      if (Math.hypot(b.x, b.z) > L.cityR * 1.7) continue; // farmsteads outside town
      for (const [x, z] of corners(b)) {
        for (const s of L.streets) {
          if (s.kind === 'road') continue;
          for (let i = 0; i + 1 < s.pts.length; i++) assert.ok(segDist(x, z, s.pts[i], s.pts[i + 1]) > s.w / 2 - 0.05, `${b.asset} on a ${s.kind} street, ${where}`);
        }
      }
    }
    for (let i = 0; i < L.buildings.length; i++) for (let j = i + 1; j < L.buildings.length; j++) {
      const a = L.buildings[i];
      const b = L.buildings[j];
      if (Math.hypot(a.x - b.x, a.z - b.z) > (Math.hypot(a.w, a.d) + Math.hypot(b.w, b.d)) / 2) continue;
      assert.ok(!overlap(a, b), `${a.asset} overlaps ${b.asset}, ${where}`);
    }
    // The wall follows the rounded town edge: neighbouring pieces barely turn
    for (let i = 0; i + 1 < L.walls.length; i++) {
      const a = L.walls[i];
      const b = L.walls[i + 1];
      if (Math.hypot(a.x - b.x, a.z - b.z) > 12) continue;
      assert.ok(Math.abs(wrap(a.yaw - b.yaw)) < 0.3, `wall kinks, ${where}`);
    }
  }
});

test('templates and density are choosable and deterministic', () => {
  const { map, cityIndex } = firstTown();
  const counts = {};
  for (const template of TEMPLATES) {
    const a = generateTownLayout({ map, hexasphere, cityIndex, options: { template } });
    const b = generateTownLayout({ map, hexasphere, cityIndex, options: { template } });
    assert.equal(a.morphology.template, template);
    assert.deepEqual(a.buildings, b.buildings);
    assert.ok(a.buildings.length > 10);
  }
  for (const [density, value] of [['sparse', 0.75], ['normal', 1], ['dense', 1.3]]) {
    const L = generateTownLayout({ map, hexasphere, cityIndex, options: { template: 'area', density: value } });
    counts[density] = L.buildings.filter((b) => Math.hypot(b.x, b.z) < L.cityR).length;
  }
  assert.ok(counts.dense > counts.normal && counts.normal > counts.sparse, JSON.stringify(counts));
});

test('saved towns keep their generator: version 2 still plans the old way', () => {
  const { map, cityIndex } = firstTown();
  const L = generateTownLayout({ map, hexasphere, cityIndex, layoutVersion: 2 });
  assert.notEqual(L.morphology?.kind, 'bisected-neighbourhood');
});
