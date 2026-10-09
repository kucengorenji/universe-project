import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FieldState, CELL, DRY_SECONDS } from '../src/valley/world/fieldState.js';
import { stepFlight, GRAVITY, THROW } from '../src/valley/world/pickups.js';
import { CLIPS, ClipPlayer, samplePose, clipBones } from '../src/valley/anim/clips.js';

const field = { x: 9, z: -7.5, w: 8, d: 6 };

test('field grid: cells cover the field, points map to the right cell and back', () => {
  const f = new FieldState(field);
  assert.equal(f.cols, Math.floor(8 / CELL));
  assert.equal(f.rows, Math.floor(6 / CELL));
  for (const [c, r] of [[0, 0], [3, 5], [f.cols - 1, f.rows - 1]]) {
    const [x, z] = f.center(c, r);
    const hit = f.cellAt(x, z);
    assert.deepEqual([hit.c, hit.r], [c, r]);
  }
  assert.equal(f.cellAt(field.x + field.w, field.z), null);
});

test('field rules: hoe, seeds, harvest only where they make sense', () => {
  const f = new FieldState(field, { planted: [[3]] });
  const ripe = f.cellAt(...f.center(0, 0)).i, empty = f.cellAt(...f.center(4, 4)).i;
  assert.equal(f.plant(empty), false, 'seeds need tilled soil');
  assert.equal(f.till(ripe), false, 'the hoe does not dig up a crop');
  assert.equal(f.till(empty), true);
  assert.equal(f.plant(empty), true);
  assert.equal(f.plant(empty), false, 'one crop per cell');
  assert.equal(f.harvest(empty), false, 'a sprout is not ripe');
  assert.equal(f.harvest(ripe), true);
  assert.equal(f.crop[ripe], 0);
  assert.equal(f.tilled[ripe], 1, 'the soil stays tilled after a harvest');
});

test('wet soil dries back over DRY_SECONDS', () => {
  const f = new FieldState(field);
  const i = f.cellAt(...f.center(2, 2)).i;
  f.water(i);
  for (let t = 0; t < DRY_SECONDS / 2; t += 0.5) f.update(0.5);
  assert.ok(Math.abs(f.wet[i] - 0.5) < 0.01, `half-way ${f.wet[i]}`);
  for (let t = 0; t < DRY_SECONDS; t += 0.5) f.update(0.5);
  assert.equal(f.wet[i], 0);
  assert.equal(f.update(0.5), false, 'nothing left drying');
});

test('a throw from over the head lands where the ballistic arc says, then bounces lower', () => {
  const h = 1.7, ground = () => 0;
  const item = { p: new THREE.Vector3(0, h, 0), v: new THREE.Vector3(0, THROW.up, THROW.forward), r: 0.1 };
  let first = null, bounces = 0, rest = null;
  for (let t = 0; t < 5 && !rest; t += 1 / 240) {
    const hit = stepFlight(item, 1 / 240, ground);
    if (hit?.kind === 'bounce') { bounces++; first ??= { z: item.p.z, impact: hit.impact }; }
    if (hit?.kind === 'rest') rest = item.p.clone();
  }
  // Analytic landing of the centre at height r: h - r + up t - g t^2 / 2 = 0
  const t = (THROW.up + Math.sqrt(THROW.up ** 2 + 2 * GRAVITY * (h - 0.1))) / GRAVITY;
  assert.ok(Math.abs(first.z - THROW.forward * t) < 0.05, `landed at ${first.z.toFixed(2)}, expected ${(THROW.forward * t).toFixed(2)}`);
  assert.ok(bounces >= 1 && bounces <= 3, `${bounces} bounces`);
  assert.ok(rest && rest.z > first.z && rest.z < first.z + 1.5, 'it skids on a little and stops');
});

test('clips: events fire once each, in order, on their frames', () => {
  for (const [name, clip] of Object.entries(CLIPS)) {
    const p = { bones: {}, root: { scale: { y: 1 } } };
    for (const b of clipBones(clip)) p.bones[b] = { node: new THREE.Object3D(), rest: new THREE.Quaternion() };
    const player = new ClipPlayer(p);
    const fired = [];
    player.play(name, { onEvent: (e) => fired.push([+player.time.toFixed(3), e]) });
    for (let t = 0; t < clip.duration + 0.5; t += 1 / 60) player.update(1 / 60);
    assert.deepEqual(fired.map(([, e]) => e), clip.events.map(([, e]) => e), name);
    fired.forEach(([t], k) => assert.ok(t >= clip.events[k][0] && t < clip.events[k][0] + 1 / 30, `${name} event ${k} late at ${t}`));
    // Non-held clips end on the neutral pose; held ones keep their last pose
    const end = samplePose(clip, clip.duration);
    if (!clip.hold) assert.ok(Object.values(end).every((v) => v.every((x) => Math.abs(x) < 1e-9)), `${name} does not end neutral`);
  }
});

test('clips: an action locks movement, the carry overlay never does', () => {
  const p = { bones: { shoulder_L: { node: new THREE.Object3D(), rest: new THREE.Quaternion() } } };
  const player = new ClipPlayer(p);
  player.play('hoe');
  assert.equal(player.busy, true);
  for (let t = 0; t < CLIPS.hoe.duration + 0.1; t += 1 / 60) player.update(1 / 60);
  assert.equal(player.busy, false);
  player.play('lift');
  player.update(0.1);
  assert.equal(player.busy, true, 'lifting holds you until the load is up');
  for (let t = 0; t < CLIPS.lift.duration; t += 1 / 60) player.update(1 / 60);
  assert.equal(player.busy, false);
  player.play('carry');
  player.update(0.1);
  assert.equal(player.busy, false, 'you can walk with a load');
});
