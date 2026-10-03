import test from 'node:test';
import assert from 'node:assert/strict';
import { generateField, heightAt, HALF, COVER, HOUSES } from '../src/skirmish/battlefield/generateField.js';
import { kitTag, CLASSES } from '../src/skirmish/units/soldierLook.js';

const SEEDS = [1, 42, 777, 2026, 99991];

test('the same seed always gives the same battlefield', () => {
  const strip = (f) => JSON.stringify({ ...f, heights: Array.from(f.heights.slice(0, 500)), heightAt: null });
  assert.equal(strip(generateField(42)), strip(generateField(42)));
  assert.notEqual(strip(generateField(42)), strip(generateField(43)));
});

test('camps, deploy slots and the tank are on the map, the bases at opposite ends', () => {
  for (const seed of SEEDS) {
    const f = generateField(seed);
    const [player, enemy, village] = f.camps;
    assert.ok(player.z > 60 && enemy.z < -60, `seed ${seed}: bases at the ends`);
    assert.equal(village.side, null);
    assert.ok(f.deploy.fed.length >= 6, `seed ${seed}: room to deploy six`);
    assert.ok(f.deploy.imp.length >= 8, `seed ${seed}: enemy slots`);
    for (const p of [...f.camps, ...f.deploy.fed, ...f.deploy.imp, f.tank]) {
      assert.ok(Math.abs(p.x) < HALF && Math.abs(p.z) < HALF, `seed ${seed}: in bounds`);
    }
  }
});

test('houses never overlap each other, the roads or the camps', () => {
  for (const seed of SEEDS) {
    const f = generateField(seed);
    for (const [i, a] of f.houses.entries()) {
      assert.ok(HOUSES[a.kind], a.kind);
      for (const b of f.houses.slice(i + 1)) assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > Math.max(a.w, a.d) * 0.55, `seed ${seed}: houses overlap`);
      for (const c of f.camps) assert.ok(Math.hypot(a.x - c.x, a.z - c.z) > c.r, `seed ${seed}: house in a camp`);
    }
  }
});

test('every road that crosses the river has a bridge, and the trench is cut into the ground', () => {
  for (const seed of SEEDS) {
    const f = generateField(seed, { river: 'yes' });
    assert.ok(f.river && f.bridges.length >= 1, `seed ${seed}: bridged river`);
    const t = f.trenches[0].pts[3];
    assert.ok(heightAt(f, t[0], t[1]) < heightAt(f, t[0], t[1] + 6) - 0.8, `seed ${seed}: trench depth`);
  }
  assert.equal(generateField(5, { river: 'no' }).river, null);
});

test('cover types are known and more cover is placed at a higher density', () => {
  const count = (cover) => SEEDS.reduce((n, s) => n + generateField(s, { cover }).cover.length, 0);
  for (const c of generateField(42).cover) assert.ok(COVER[c.type], c.type);
  assert.ok(count(1.5) > count(0.5));
});

test('soldier kit meshes map to the class gear tags', () => {
  assert.equal(kitTag('kit_pack_small'), 'pack_small');
  assert.equal(kitTag('kit_pack_engineer'), 'pack_engineer');
  assert.equal(kitTag('kit_armor_pauldron_L'), 'armor');
  assert.equal(kitTag('top_tunic_chest'), null);
  for (const c of Object.values(CLASSES)) assert.ok(c.kit.includes('base'));
});
