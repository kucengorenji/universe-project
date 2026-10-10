import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SEASON_LINES, ROUTINES } from '../src/valley/world/villagers.js';

const PALETTE = JSON.parse(readFileSync(new URL('../src/valley/valleyPalette.json', import.meta.url)));
const SEASONS = ['semi', 'panas', 'gugur', 'dingin'];
const hex = /^#[0-9a-f]{6}$/i;

test('four seasons, each a complete set of palette tokens (docs/FARM_PLAN.md §2.2)', () => {
  assert.deepEqual(Object.keys(PALETTE.seasons), SEASONS);
  for (const name of SEASONS) {
    const s = PALETTE.seasons[name];
    for (const k of ['grass', 'grassLight', 'grassDark', 'hill', 'hillFar']) assert.match(s.surface[k], hex, `${name}.surface.${k}`);
    for (const k of Object.keys(s.surface)) assert.ok(k in PALETTE.surface, `${name}: ${k} is not a surface token`);
    assert.match(s.foliage.color, hex);
    assert.ok(s.foliage.mix >= 0 && s.foliage.mix <= 1);
    assert.ok(s.flowers.share >= 0 && s.flowers.share <= 1 && s.flowers.colors.every((c) => hex.test(c)));
    assert.ok([0, 1].includes(s.blossom) && [0, 1].includes(s.snow));
    assert.ok(['petal', 'firefly', 'autumnLeaf', 'snow'].includes(s.particles));
  }
  // Only spring blooms, only winter snows, and flowers thin out towards winter
  assert.deepEqual(SEASONS.map((n) => PALETTE.seasons[n].blossom), [1, 0, 0, 0]);
  assert.deepEqual(SEASONS.map((n) => PALETTE.seasons[n].snow), [0, 0, 0, 1]);
  const shares = SEASONS.map((n) => PALETTE.seasons[n].flowers.share);
  assert.ok(shares.every((v, i) => i === 0 || v <= shares[i - 1]), `flower shares ${shares}`);
});

test('every villager has a line for every season', () => {
  for (const who of Object.keys(ROUTINES)) for (const season of SEASONS) assert.ok(SEASON_LINES[who]?.[season], `${who} ${season}`);
});
