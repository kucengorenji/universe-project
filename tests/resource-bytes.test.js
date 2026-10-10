import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, byRoute, markRoute, marks } from '../src/core/resourceBytes.js';

const entry = (name, decoded, { transfer = decoded, encoded = decoded, startTime = 0 } = {}) => ({ name, transferSize: transfer, encodedBodySize: encoded, decodedBodySize: decoded, startTime });

test('resources are totalled and grouped by what they are', () => {
  const s = summarize([
    entry('http://x/models/town.glb', 5000000, { transfer: 1200000, encoded: 1200000 }), entry('http://x/textures/a.png', 700), entry('http://x/assets/game-1.js', 300, { transfer: 0 }),
    entry('http://x/api?x=1', 10)
  ]);
  assert.equal(s.count, 4);
  assert.equal(s.transfer, 1200000 + 700 + 0 + 10);
  assert.deepEqual(Object.keys(s.byKind).sort(), ['model', 'other', 'script', 'texture']);
  assert.equal(s.byKind.model.decoded, 5000000);
  assert.equal(s.largest[0].file, 'town.glb');
  assert.equal(s.largest[0].kind, 'model');
  assert.equal(summarize([]).transfer, 0);
});

test('bytes are split by the route that was loading when each resource started', () => {
  marks.length = 0;
  markRoute('space', 0); markRoute('planet', 100); markRoute('town', 200);
  const rows = byRoute([entry('a.glb', 10, { startTime: 5 }), entry('b.glb', 20, { startTime: 150 }), entry('c.png', 30, { startTime: 250 }), entry('d.png', 40, { startTime: 900 })]);
  assert.deepEqual(rows.map((r) => [r.mode, r.count, r.decoded]), [['space', 1, 10], ['planet', 1, 20], ['town', 2, 70]]);
  marks.length = 0;
});
