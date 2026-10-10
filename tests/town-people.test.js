import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTownPerson, needsFemaleBody, SkirmishPeople } from '../src/modes/town/people/skirmishPeople.js';
import { usesLowAtlases } from '../src/modes/town/townPacks.js';
import { resetExperiments } from '../src/core/experiments.js';

const seedWhere = (female) => { for (let seed = 1; seed < 500; seed++) if (needsFemaleBody(seed) === female) return seed; throw new Error('no such seed'); };

test('about half of the town looks need the women\'s body, and the answer depends only on the seed', () => {
  let women = 0;
  for (let seed = 1; seed <= 400; seed++) {
    assert.equal(needsFemaleBody(seed), needsFemaleBody(seed));
    if (needsFemaleBody(seed)) women++;
  }
  assert.ok(women > 120 && women < 280, `${women} of 400`);
});

test('a person who needs a body that has not loaded is not made, and nobody else is made in their place', () => {
  const woman = seedWhere(true);
  assert.equal(makeTownPerson({ m: {} }, { seed: woman }), null);
  const pack = { m: {}, f: null };
  const people = new SkirmishPeople(pack, { add() {} }, { count: 4, shadows: false, seed: 1 });
  people.identities.set(7, woman);
  const crowd = [{ x: 1, z: 1, height: 1, yaw: 0 }];
  for (let i = 1; i < 8; i++) crowd[i] = { x: 2, z: 2, height: 1, yaw: 0 };
  const womenOnly = [7].map((i) => ({ i }));
  people.assign(womenOnly, crowd, { x: 0, z: 0 });
  assert.equal(people.pool.length, 0, 'the named woman waits for the body, the pool does not substitute');
});

test('the 1024 atlases are for the Low preset only, and only while the experiment is on', () => {
  resetExperiments({ search: '' });
  assert.equal(usesLowAtlases({ preset: 'low' }), true);
  for (const preset of ['auto', 'high', 'medium']) assert.equal(usesLowAtlases({ preset }), false, preset);
  assert.equal(usesLowAtlases(null), false);
  resetExperiments({ search: '?off=lowAtlas' });
  assert.equal(usesLowAtlases({ preset: 'low' }), false);
  resetExperiments();
});
