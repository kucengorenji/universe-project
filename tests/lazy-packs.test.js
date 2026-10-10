import test from 'node:test';
import assert from 'node:assert/strict';
import { LazyPack, anyWithin } from '../src/modes/town/townPacks.js';
import { TownLife } from '../src/modes/town/townLife.js';
import { resetExperiments } from '../src/core/experiments.js';
import { proofMetrics } from '../src/core/proofMetrics.js';

test('a lazy pack loads on first use, once, and remembers why', async () => {
  let calls = 0;
  const pack = new LazyPack(async () => { calls++; return { furniture: true }; });
  assert.equal(pack.state, 'idle');
  const [a, b] = [pack.start('near-door'), pack.start('enter')];
  assert.equal(a, b, 'a second request joins the first');
  assert.deepEqual(await a, { furniture: true });
  assert.equal(calls, 1);
  assert.equal(pack.ready, true);
  assert.equal(pack.reason, 'near-door');
  assert.deepEqual(await pack.start('enter'), { furniture: true }, 'and gets the same pack later');
  assert.equal(calls, 1);
});

test('a failed load is null, is not retried at once, and can be retried later', async () => {
  let now = 0, calls = 0, fail = true;
  const pack = new LazyPack(async () => { calls++; if (fail) throw new Error('404'); return { ok: 1 }; }, { now: () => now, retryMs: 10000 });
  assert.equal(await pack.start('enter'), null);
  assert.equal(pack.state, 'failed');
  assert.equal(pack.metrics().error, '404');
  now = 5000;
  assert.equal(await pack.start('enter'), null);
  assert.equal(calls, 1, 'no retry storm while the player keeps pushing the door');
  fail = false; now = 10001;
  assert.deepEqual(await pack.start('enter'), { ok: 1 });
  assert.equal(pack.ready, true);
  assert.equal(await new LazyPack(async () => null).start(), null, 'an empty pack counts as a failure');
});

test('doors within range start the loading, farther ones do not', () => {
  const doors = [{ x: 10, z: 0 }, { x: -200, z: 50 }];
  assert.equal(anyWithin(doors, { x: 0, z: 0 }, 40), true);
  assert.equal(anyWithin(doors, { x: 100, z: 0 }, 40), false);
  assert.equal(anyWithin(doors, { x: -170, z: 50 }, 40), true);
  assert.equal(anyWithin(doors, null, 40), false);
  assert.equal(anyWithin([], { x: 0, z: 0 }, 40), false);
});

function life(flag) {
  resetExperiments({ search: flag ? '' : '?off=lazyInterior' });
  const pack = new LazyPack(async () => ({ furniture: true }));
  const l = new TownLife({
    builder: { groundCover: null }, quality: { tier: 'high' }, walkers: { walkers: [] }, rigged: null, crowd: { people: [] },
    walkNetwork: null, layout: { seed: 1, spawn: { x: 0, z: 0 } }, planet: 0, city: 0, ui: {}, prefetch: { pack, doors: [{ x: 10, z: 0 }] }
  });
  return { l, pack };
}

test('walking toward a door starts the furniture load; the diorama and a far walk do not', () => {
  const { l, pack } = life(true);
  for (let i = 0; i < 40; i++) l.update(0.016, { walker: null });
  assert.equal(pack.state, 'idle', 'the diorama is not walking');
  for (let i = 0; i < 40; i++) l.update(0.016, { walker: { x: 200, z: 0 } });
  assert.equal(pack.state, 'idle', '200 m away');
  for (let i = 0; i < 8; i++) l.update(0.016, { walker: { x: 30, z: 0 } });
  assert.equal(pack.state, 'loading');
  assert.equal(pack.reason, 'near-door');
  assert.deepEqual(proofMetrics().lazy.enabled, true);
  assert.equal(proofMetrics().lazy.reason, 'near-door');
  l.dispose();
  assert.equal(proofMetrics().lazy, undefined);
  resetExperiments();
});

test('with the experiment off nothing is prefetched', () => {
  const { l, pack } = life(false);
  for (let i = 0; i < 40; i++) l.update(0.016, { walker: { x: 1, z: 0 } });
  assert.equal(pack.state, 'idle');
  assert.equal(proofMetrics().lazy.enabled, false);
  l.dispose();
  resetExperiments();
});
