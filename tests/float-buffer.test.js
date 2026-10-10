import test from 'node:test';
import assert from 'node:assert/strict';
import { FloatBuffer } from '../src/render/floatBuffer.js';

test('a growing float buffer holds exactly what a Float32Array made from the same numbers holds', () => {
  const buffer = new FloatBuffer(8); // tiny on purpose: it has to grow many times
  const numbers = [];
  let seed = 7;
  for (let i = 0; i < 5000; i++) {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    const x = (seed / 4294967296 - 0.5) * 1e4, y = Math.sqrt(i) / 3.1, z = -1 / (i + 1.37);
    buffer.add3(x, y, z);
    numbers.push(x, y, z);
  }
  assert.equal(buffer.length, 15000);
  const done = buffer.finish();
  assert.ok(done instanceof Float32Array);
  assert.equal(done.length, 15000, 'exactly sized, no spare room');
  assert.deepEqual(Buffer.from(done.buffer), Buffer.from(new Float32Array(numbers).buffer), 'bit for bit, so the planet mesh is unchanged');
});

test('finishing copies: the growth buffer can be dropped and the result stays valid', () => {
  const buffer = new FloatBuffer(4);
  buffer.add3(1, 2, 3);
  const done = buffer.finish();
  buffer.add3(9, 9, 9);
  assert.deepEqual([...done], [1, 2, 3]);
  assert.notEqual(done.buffer, buffer.array.buffer);
  assert.equal(new FloatBuffer().finish().length, 0);
});

test('the planet no longer keeps its vertex arrays in plain JS arrays', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/render/planetRenderer.js', import.meta.url), 'utf8');
  assert.match(source, /const land = \{ pos: new FloatBuffer\(\)/);
  assert.match(source, /buf\.pos = buf\.nrm = buf\.col = null/, 'and lets them go once the geometry exists');
});
