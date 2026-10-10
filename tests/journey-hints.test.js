import test from 'node:test';
import assert from 'node:assert/strict';
import { describeObjective } from '../src/core/journey.js';

const j5 = (view) => describeObjective({ stage: 'j5', away: false, verifying: false, homeUnavailable: false }, view, {});

test('the J5 hint names what the room really offers', () => {
  assert.deepEqual(j5({ lights: 'off' }).hint, ['journey.j5.hint'], 'a lamp is off: go to it and press E');
  assert.deepEqual(j5({}).hint, ['journey.j5.hint'], 'before the room reports, the lamp hint');
  assert.deepEqual(j5({ lights: 'on' }).hint, ['journey.j5.lightsOn'], 'every lamp already on (night): off, then on');
  assert.deepEqual(j5({ lights: 'none' }).hint, ['journey.j5.noLights'], 'no lamp: the item path');
});

test('carrying an item always wins: the hint says where to put it down', () => {
  for (const lights of ['off', 'on', 'none']) assert.deepEqual(j5({ lights, holding: 'Apple' }).hint, ['journey.j5.carry', { item: 'Apple' }]);
});
