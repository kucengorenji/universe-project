import test from 'node:test';
import assert from 'node:assert/strict';
import { GrassContact, attack, recovery, influence, bladeOffset, PUSH_RADIUS, MAX_TIP_OFFSET, MAX_BEND_DEG, RECOVERY_S, STAMP_SPACING } from '../src/modes/town/render/grassContact.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
const vec = () => { const v = { v: [0, 0, 0, 0], set(...a) { this.v = a; } }; return v; };

test('the bend reaches full strength within 100 ms of contact', () => {
  assert.equal(attack(0), 0);
  near(attack(0.05), 0.5);
  assert.equal(attack(0.1), 1);
  assert.equal(attack(3), 1);
  assert.equal(attack(-1), 0);
});

test('recovery: at least 80 % back at 0.8 s and fully at rest by 1.2 s', () => {
  assert.equal(recovery(0), 1);
  assert.ok(recovery(0.8) <= 0.2, `at 0.8 s ${recovery(0.8)}`);
  assert.ok(recovery(1.0) <= 0.05);
  assert.equal(recovery(1.2), 0);
  assert.ok(RECOVERY_S <= 1.2);
  let previous = 1;
  for (let t = 0; t <= 1.2; t += 0.05) { assert.ok(recovery(t) <= previous + 1e-12, 'never bends back up'); previous = recovery(t); }
});

test('blades feel a pusher only inside its radius, smoothly, and tip offset stays within 0.20 m', () => {
  assert.equal(influence(PUSH_RADIUS), 0);
  assert.equal(influence(2), 0);
  assert.equal(influence(0), 1);
  assert.ok(influence(0.2) > influence(0.4));
  const pusher = { x: 0, z: 0, strength: 1 };
  const under = bladeOffset({ x: 0.05, z: 0 }, pusher);
  assert.ok(under.amount <= MAX_TIP_OFFSET && under.amount > 0.18);
  assert.ok(under.x > 0, 'pushed away from the foot');
  assert.equal(bladeOffset({ x: 1, z: 0 }, pusher).amount, 0);
  assert.equal(bladeOffset({ x: 0.1, z: 0 }, { ...pusher, strength: 0 }).amount, 0);
  assert.equal(bladeOffset({ x: 0.1, z: 0 }, pusher, { tip: 0 }).amount, 0, 'the root never moves');
  assert.ok(bladeOffset({ x: 0.1, z: 0 }, pusher, { tip: 0.5 }).amount < bladeOffset({ x: 0.1, z: 0 }, pusher, { tip: 1 }).amount);
  assert.ok(bladeOffset({ x: 0, z: 0 }, pusher).x > 0, 'a blade exactly under the foot still falls somewhere');
  // 25 degrees at most on a 0.5 m blade
  assert.ok(Math.atan2(MAX_TIP_OFFSET, 0.5) * 180 / Math.PI <= MAX_BEND_DEG);
});

test('walking leaves footprints that fade out by themselves', () => {
  const c = new GrassContact();
  let x = 0;
  for (let i = 0; i < 20; i++) { c.update(1 / 30, { x, z: 0 }); x += 1.6 / 30; }
  assert.ok(c.metrics.stamps >= 1, 'a footprint every 0.45 m');
  assert.ok(c.active >= 2);
  assert.equal(c.pushers()[0].strength, 1, 'the live pusher is at full strength after 0.6 s');
  assert.ok(c.strengthAt(0, 0) > 0.3, 'where the player was is still bent');
  for (let i = 0; i < 40; i++) c.update(1 / 30, null); // 1.33 s off the grass
  assert.equal(c.active, 0, 'nothing stays bent');
  assert.equal(c.strengthAt(0, 0), 0);
  assert.equal(c.strengthAt(x, 0), 0);
});

test('after the player leaves, 80 % is back at 0.8 s and 95 % by 1.2 s', () => {
  const c = new GrassContact();
  for (let i = 0; i < 12; i++) c.update(1 / 30, { x: 0, z: 0 }); // stand still on the blade
  assert.equal(c.strengthAt(0, 0), 1);
  const at = (seconds) => { const d = new GrassContact(); for (let i = 0; i < 12; i++) d.update(1 / 30, { x: 0, z: 0 }); for (let t = 0; t < seconds - 1e-9; t += 1 / 60) d.update(1 / 60, null); return d.strengthAt(0, 0); };
  assert.ok(at(0.8) <= 0.2 + 1e-6, `strength at 0.8 s: ${at(0.8)}`);
  assert.ok(at(1.2) <= 0.05);
});

test('slots are capped (six, or four on Low) and the oldest footprint goes first', () => {
  for (const slots of [6, 4]) {
    const c = new GrassContact({ slots });
    for (let i = 0; i < 120; i++) c.update(1 / 30, { x: i * 0.2, z: 0 }); // a sprint
    assert.ok(c.pushers().length <= slots);
    assert.ok(c.metrics.peakActive <= slots);
    assert.equal(c.pushers()[0].x, 119 * 0.2, 'the live pusher is never dropped');
  }
});

test('a paused frame freezes the fade, and reset leaves no bent blade', () => {
  const c = new GrassContact();
  for (let i = 0; i < 10; i++) c.update(1 / 30, { x: i * 0.3, z: 0 });
  c.update(0, null);
  const frozen = c.pushers().map((p) => p.strength);
  c.update(0, null);
  assert.deepEqual(c.pushers().map((p) => p.strength), frozen, 'dt = 0: nothing recovers while paused');
  c.reset();
  assert.equal(c.active, 0);
  assert.equal(c.strengthAt(0, 0), 0);
});

test('twenty passes leave nothing behind and the shader array is always fully written', () => {
  const c = new GrassContact();
  const vectors = Array.from({ length: 6 }, vec);
  for (let pass = 0; pass < 20; pass++) {
    for (let i = 0; i < 60; i++) c.update(1 / 30, { x: i * 0.05, z: pass * 0.01 });
    for (let i = 0; i < 40; i++) c.update(1 / 30, null);
    assert.equal(c.active, 0, `pass ${pass}`);
  }
  c.update(1 / 30, { x: 3, z: 4 });
  c.writeTo(vectors);
  assert.deepEqual(vectors[0].v, [3, 4, PUSH_RADIUS, 0.3333333333333333]);
  assert.deepEqual(vectors[5].v, [0, 0, 0, 0], 'unused slots are zeroed, never stale');
  assert.ok(STAMP_SPACING > 0.3 && STAMP_SPACING < PUSH_RADIUS);
});
