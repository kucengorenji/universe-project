import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPERIMENTS, resolveExperiments, resetExperiments, isOn } from '../src/core/experiments.js';

const storageWith = (value) => ({ getItem: () => value });

test('every experiment is on by default', () => {
  const flags = resolveExperiments();
  assert.deepEqual(Object.keys(flags), Object.keys(EXPERIMENTS));
  assert.ok(Object.values(flags).every((v) => v === true));
  assert.ok(Object.isFrozen(flags));
});

test('the query turns experiments off one by one, all at once, or back on', () => {
  assert.equal(resolveExperiments({ search: '?off=grass,greet' }).grass, false);
  assert.equal(resolveExperiments({ search: '?off=grass,greet' }).night, true);
  assert.ok(Object.values(resolveExperiments({ search: '?exp=none' })).every((v) => v === false));
  assert.equal(resolveExperiments({ search: '?exp=none&on=night' }).night, true);
  assert.equal(resolveExperiments({ search: '?off=nonsense' }).grass, true, 'unknown names are ignored');
});

test('storage can keep an experiment off, and the query still wins', () => {
  const storage = storageWith('{"grass":false,"greet":"no"}');
  const flags = resolveExperiments({ storage });
  assert.equal(flags.grass, false);
  assert.equal(flags.greet, true, 'only real booleans count');
  assert.equal(resolveExperiments({ storage, search: '?on=grass' }).grass, true);
  assert.equal(resolveExperiments({ storage: storageWith('{not json') }).grass, true);
  assert.equal(resolveExperiments({ storage: { getItem() { throw new Error('blocked'); } } }).grass, true);
});

test('isOn reads the flags of the page load and can be reset', () => {
  resetExperiments({ search: '?off=night' });
  assert.equal(isOn('night'), false);
  assert.equal(isOn('grass'), true);
  resetExperiments({ search: '' });
  assert.equal(isOn('night'), true);
  resetExperiments();
});
