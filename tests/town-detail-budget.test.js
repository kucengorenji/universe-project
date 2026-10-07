import test from 'node:test';
import assert from 'node:assert/strict';
import { TownDetailBudget } from '../src/modes/town/render/detailBudget.js';

test('heavy town reduces distant detail then shadows then cosmetics before allowing DPR loss', () => {
  const b = new TownDetailBudget();
  assert.equal(b.sample({ heavy: true }), true);
  assert.deepEqual(b.current, { lod: .72, shadow: 1, vegetation: 1 });
  b.sample({ heavy: true });
  assert.equal(b.current.vegetation, 1);
  assert.ok(b.current.shadow < 1);
  b.sample({ heavy: true });
  assert.ok(b.current.vegetation < 1);
  b.sample({ heavy: true });
  assert.equal(b.sample({ heavy: true }), false, 'only the exhausted budgets allow resolution reduction');
});

test('recovery waits for full resolution and consecutive GPU headroom, and resets without replacing layout', () => {
  const b = new TownDetailBudget();
  b.sample({ heavy: true }); b.sample({ heavy: true });
  const healthy = { heavy: false, fps: 60, gpuMs: 7, resolutionFull: true };
  assert.equal(b.sample({ ...healthy, resolutionFull: false }), false);
  assert.equal(b.level, 2);
  assert.equal(b.sample(healthy), false);
  assert.equal(b.sample({ ...healthy, gpuMs: 13 }), false);
  assert.equal(b.sample(healthy), false);
  assert.equal(b.sample(healthy), true);
  assert.equal(b.level, 1);
  b.reset();
  assert.equal(b.level, 0);
});

test('a town meeting its frame target keeps quality even when GPU timing flags it heavy', () => {
  const b = new TownDetailBudget();
  assert.equal(b.sample({ heavy: true, fps: 60, gpuMs: 24 }), true);
  assert.equal(b.level, 0);
  for (let i = 0; i < 4; i++) b.sample({ heavy: true, fps: 40, gpuMs: 24 });
  assert.equal(b.level, 4);
  assert.equal(b.sample({ heavy: true, fps: 59, gpuMs: 24, resolutionFull: false }), true,
    'consume the signal instead of allowing another resolution reduction');
  assert.equal(b.level, 4);
  assert.equal(b.sample({ heavy: true, fps: 50, gpuMs: 24 }), false);
});
