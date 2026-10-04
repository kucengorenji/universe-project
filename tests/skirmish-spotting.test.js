import test from 'node:test';
import assert from 'node:assert/strict';
import { generateField } from '../src/skirmish/battlefield/generateField.js';
import { Arena } from '../src/skirmish/game/arena.js';
import { Battle } from '../src/skirmish/game/battle.js';
import { Spotting } from '../src/skirmish/game/spotting.js';
import { ROSTER, DEFAULT_SQUAD } from '../src/skirmish/game/roster.js';
import { SPOT_RANGE } from '../src/skirmish/game/rules.js';

const field = generateField(42);
const arena = new Arena(field);
const setup = () => {
  const squad = DEFAULT_SQUAD.map((id, i) => ({ ...ROSTER.find((r) => r.id === id), leader: i === 0, ...field.deploy.fed[i] }));
  const battle = new Battle({ field, squad, difficulty: 'normal' });
  return { battle, spot: new Spotting(battle, arena, 'fed') };
};

/** A spot near a point where a soldier sees it in the open (scans a ring for a clear line). */
function seeingSpot(watcher, target, dist) {
  for (let k = 0; k < 64; k++) {
    const a = (k / 64) * Math.PI * 2;
    const x = target.x + Math.cos(a) * dist, z = target.z + Math.sin(a) * dist;
    if (!arena.walkable(x, z)) continue;
    const save = { x: watcher.x, z: watcher.z };
    Object.assign(watcher, { x, z });
    if (arena.sees(watcher, target)) return { x, z };
    Object.assign(watcher, save);
  }
  return null;
}

test('enemies start unknown unless seen, and only within spotting range', () => {
  const { battle, spot } = setup();
  spot.update();
  const fed = battle.alive('fed');
  for (const e of battle.units.filter((u) => u.side === 'imp')) {
    const k = spot.known.get(e.id);
    if (!k) continue;
    assert.ok(fed.some((w) => Math.hypot(w.x - e.x, w.z - e.z) <= spot.range(w) && arena.sees(w, e)), `${e.id} known without being seen`);
  }
  // put every soldier far away: nothing new is spotted
  const far = setup();
  for (const w of far.battle.alive('fed')) Object.assign(w, { x: field.deploy.fed[0].x, z: field.deploy.fed[0].z });
  for (const e of far.battle.units.filter((u) => u.side === 'imp')) Object.assign(e, { x: e.x, z: field.deploy.fed[0].z - SPOT_RANGE - 40 });
  far.spot.update();
  assert.equal(far.spot.view().length, 0);
});

test('a spotted enemy that drops out of sight stays as a ghost at its last known position', () => {
  const { battle, spot } = setup();
  const w = battle.alive('fed')[0];
  const e = battle.alive('imp').find((u) => u.kind === 'infantry');
  assert.ok(seeingSpot(w, e, 20), 'found a place to see the enemy from');
  spot.update();
  assert.ok(spot.isVisible(e.id));
  const at = { x: e.x, z: e.z };
  // the enemy walks away out of every watcher's range
  for (const o of battle.alive('fed')) Object.assign(o, { x: at.x + 300, z: at.z + 300 });
  e.x += 5;
  spot.update();
  assert.ok(!spot.isVisible(e.id));
  const ghost = spot.view().find((u) => u.id === e.id);
  assert.ok(ghost.ghost);
  assert.deepEqual([ghost.x, ghost.z], [at.x, at.z]);
  assert.notEqual(ghost.x, e.x);
});

test('an enemy that fires gives itself away; the known dead stay where they fell', () => {
  const { battle, spot } = setup();
  const e = battle.alive('imp').find((u) => u.kind === 'infantry');
  for (const o of battle.alive('fed')) Object.assign(o, { x: e.x + 400, z: e.z });
  spot.update();
  assert.ok(!spot.known.has(e.id));
  spot.reveal(e.id);
  assert.ok(spot.isVisible(e.id));
  battle.kill(e, 'test');
  spot.update();
  const dead = spot.view().find((u) => u.id === e.id);
  assert.equal(dead.state, 'dead');
  assert.ok(!dead.ghost);
});
