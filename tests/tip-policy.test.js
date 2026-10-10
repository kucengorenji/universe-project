import test from 'node:test';
import assert from 'node:assert/strict';
import { TIP_CONTEXT, contextKey, tipMatches, TipPresence, TIP_MS, RESUME_AFTER_MS } from '../src/core/tipPolicy.js';

test('a tip belongs to one place or way of moving', () => {
  assert.equal(contextKey('space'), 'space');
  assert.equal(contextKey('town', 'walk'), 'town.walk');
  assert.equal(contextKey('town'), 'town.diorama');
  assert.ok(tipMatches('interior', 'town.interior'));
  assert.ok(!tipMatches('interior', 'space'), 'the house tip never shows in space');
  assert.ok(!tipMatches('walk', 'town.interior'), 'the walking tip never shows indoors');
  assert.ok(!tipMatches('drive', 'town.walk'));
  for (const id of Object.keys(TIP_CONTEXT)) assert.ok(tipMatches(id, TIP_CONTEXT[id]));
});

test('leaving the place of a tip ends it at once, whatever time it had left', () => {
  const p = new TipPresence();
  p.start('interior', 0);
  assert.deepEqual(p.step({ now: 100, suppressed: false, matches: true }), { visible: true, over: false });
  assert.deepEqual(p.step({ now: 200, suppressed: false, matches: false }), { visible: false, over: true });
  assert.equal(p.id, null);
});

test('a tip steps aside for a prompt, keeps its remaining time and returns after a quiet second', () => {
  const p = new TipPresence();
  p.start('walk', 0);
  p.step({ now: 4000, suppressed: false, matches: true });
  assert.equal(p.step({ now: 4000, suppressed: true, matches: true }).visible, false, 'hidden the moment the prompt shows');
  assert.equal(p.remaining, TIP_MS - 4000);
  assert.equal(p.step({ now: 9000, suppressed: true, matches: true }).over, false, 'a long prompt does not use the tip up');
  assert.equal(p.step({ now: 9100, suppressed: false, matches: true }).visible, false, 'not back yet');
  assert.equal(p.step({ now: 9100 + RESUME_AFTER_MS - 1, suppressed: false, matches: true }).visible, false);
  assert.equal(p.step({ now: 9100 + RESUME_AFTER_MS, suppressed: false, matches: true }).visible, true, 'back after one second');
  const rest = TIP_MS - 4000;
  assert.equal(p.step({ now: 9100 + RESUME_AFTER_MS + rest - 1, suppressed: false, matches: true }).visible, true);
  assert.equal(p.step({ now: 9100 + RESUME_AFTER_MS + rest, suppressed: false, matches: true }).over, true, 'then only the time it had left');
});

test('a prompt that flickers does not bring the tip back early', () => {
  const p = new TipPresence();
  p.start('walk', 0);
  p.step({ now: 100, suppressed: true, matches: true });
  p.step({ now: 600, suppressed: false, matches: true });
  p.step({ now: 900, suppressed: true, matches: true }); // the gap restarts
  assert.equal(p.step({ now: 1500, suppressed: false, matches: true }).visible, false);
  assert.equal(p.step({ now: 1500 + RESUME_AFTER_MS, suppressed: false, matches: true }).visible, true);
});

test('a tip whose time was used up before the prompt came is finished, not resumed', () => {
  const p = new TipPresence({ duration: 1000 });
  p.start('walk', 0);
  assert.equal(p.step({ now: 1500, suppressed: true, matches: true }).over, true);
});
