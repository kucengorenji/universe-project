import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { decodePng, encodePng, boxDownsample } from '../tools/assets/png.mjs';
import { DERIVED } from '../tools/assets/derive_lowres.mjs';
import { compactTownPaintedSurfaces } from '../src/modes/town/render/paintedStyle.js';

const publicUrl = (path) => new URL(`../public/${path}`, import.meta.url);
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
const record = JSON.parse(readFileSync(new URL('../tools/assets/derived.json', import.meta.url), 'utf8'));

test('the PNG codec round-trips grey, RGB and RGBA images exactly', () => {
  for (const [color, channels] of [[0, 1], [2, 3], [6, 4]]) {
    const width = 37, height = 23, data = Buffer.alloc(width * height * channels);
    let seed = 12345;
    for (let i = 0; i < data.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; data[i] = i % 7 === 0 ? seed & 255 : (i >> 2) & 255; }
    const back = decodePng(encodePng({ width, height, color, data }));
    assert.deepEqual([back.width, back.height, back.color], [width, height, color]);
    assert.ok(back.data.equals(data), `colour type ${color}`);
  }
  const twice = encodePng({ width: 4, height: 4, color: 2, data: Buffer.alloc(48, 9) });
  assert.ok(twice.equals(encodePng({ width: 4, height: 4, color: 2, data: Buffer.alloc(48, 9) })), 'same input, same bytes');
  assert.throws(() => decodePng(Buffer.from('not a png')), /not a PNG/);
});

test('box downsampling is the rounded mean of each block, per channel', () => {
  const image = { width: 2, height: 2, color: 6, data: Buffer.from([0, 0, 0, 255, 1, 1, 1, 255, 1, 1, 1, 255, 1, 1, 1, 254]) };
  const half = boxDownsample(image, 2);
  assert.deepEqual([...half.data], [1, 1, 1, 255], '3/4 rounds up, 1019/4 rounds to 255');
  assert.throws(() => boxDownsample({ ...image, width: 3 }, 2), RangeError);
});

test('every derived file is exactly the box-filtered copy of the file it comes from', () => {
  assert.equal(record.derived.length, DERIVED.length);
  for (const entry of DERIVED) {
    const info = record.derived.find((d) => d.output === entry.output);
    const source = readFileSync(publicUrl(entry.source));
    assert.equal(info.sourceSha256, sha(source), `${entry.output}: its source changed, run tools/assets/derive_lowres.mjs`);
    const expected = boxDownsample(decodePng(source), entry.factor);
    const shipped = decodePng(readFileSync(publicUrl(entry.output)));
    assert.deepEqual([shipped.width, shipped.height, shipped.color], [expected.width, expected.height, expected.color], entry.output);
    assert.ok(shipped.data.equals(expected.data), `${entry.output}: pixels differ from the derivation`);
    assert.equal(info.pixelsSha256, sha(expected.data));
    assert.equal(info.bytes, statSync(publicUrl(entry.output)).size, `${entry.output}: size in derived.json`);
    assert.ok(info.bytes < statSync(publicUrl(entry.source)).size / 2, `${entry.output} is meant to be much smaller`);
  }
});

test('the 256-pixel surface file equals what the town computes from the 512 file at run time, pixel for pixel', () => {
  const source = decodePng(readFileSync(publicUrl('textures/skirmish_surfaces.png')));
  assert.equal(source.color, 2, 'RGB, no colour chunks: the browser decodes it as it is');
  assert.ok(!source.chunks.some((c) => ['iCCP', 'gAMA', 'sRGB', 'cHRM'].includes(c)));
  const depth = source.height / source.width;
  const rgba = Buffer.alloc(source.width * source.height * 4, 255); // what canvas getImageData returns for an opaque image
  for (let i = 0; i < source.width * source.height; i++) { rgba[i * 4] = source.data[i * 3]; rgba[i * 4 + 1] = source.data[i * 3 + 1]; rgba[i * 4 + 2] = source.data[i * 3 + 2]; }
  const fake = { image: { width: source.width, height: source.width, depth, data: new Uint8Array(rgba) }, userData: { means: [] } };
  const runtime = compactTownPaintedSurfaces(fake, 256);
  const shipped = decodePng(readFileSync(publicUrl('textures/skirmish_surfaces_256.png')));
  assert.deepEqual([shipped.width, shipped.height], [256, 256 * depth]);
  const pixels = runtime.image.data;
  assert.equal(pixels.length, 256 * 256 * depth * 4);
  let different = 0;
  for (let i = 0; i < 256 * 256 * depth; i++) for (let c = 0; c < 3; c++) if (pixels[i * 4 + c] !== shipped.data[i * 3 + c]) different++;
  assert.equal(different, 0, 'identical in every channel of every pixel');
  assert.ok(runtime instanceof THREE.DataArrayTexture);
});

test('the Low-tier atlases keep their size ratio and the head atlas keeps its alpha', () => {
  const head = decodePng(readFileSync(publicUrl('textures/soldier_v5_m_head_1024.png')));
  const full = decodePng(readFileSync(publicUrl('textures/soldier_v5_m_head.png')));
  assert.equal(head.color, 6);
  assert.deepEqual([head.width, head.height], [full.width / 2, full.height / 2]);
  assert.ok(head.chunks.includes('sRGB'), 'the colour intent travels with the file');
  let opaque = 0, clear = 0;
  for (let i = 3; i < head.data.length; i += 4) { if (head.data[i] === 255) opaque++; else if (head.data[i] === 0) clear++; }
  assert.ok(opaque > 0 && clear > 0, 'both the painted face and the transparent surround survive');
});
