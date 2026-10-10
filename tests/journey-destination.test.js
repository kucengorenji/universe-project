import test from 'node:test';
import assert from 'node:assert/strict';
import { destinationSpot, journeyTargets } from '../src/ui/journeyTargets.js';

test('the hometown shortcut sits 24 px from the left and 12 px under the objective bar', () => {
  assert.deepEqual(destinationSpot({ objectiveBottom: 177, topbarBottom: 80 }), { left: 24, top: 189 });
  assert.deepEqual(destinationSpot({ objectiveBottom: null, topbarBottom: 80 }), { left: 24, top: 92 }, 'no objective: under the top bar');
  assert.deepEqual(destinationSpot({}), { left: 24, top: 76 }, 'nothing measured yet');
});

test('beside a side-panel focus card the shortcut moves next to the card instead of hiding under it', () => {
  assert.deepEqual(destinationSpot({ objectiveBottom: 177, card: { right: 380 } }), { left: 392, top: 189 });
});

test('the shortcut is offered for J2 and for coming back (J6 away), never for J1, J3 to J5 or when done', () => {
  const at = (stage, extra = {}) => journeyTargets({ stage, homeCity: 4, homePlanet: 2, done: false, away: false, ...extra }).city;
  assert.equal(at('j2'), 4);
  assert.equal(at('j6', { away: true }), 4);
  for (const stage of ['j1', 'j3', 'j4', 'j5']) assert.equal(at(stage), null, stage);
  assert.equal(at('j6'), null, 'at home in J6 there is nothing to look for');
  assert.equal(at('j2', { done: true }), null);
});
