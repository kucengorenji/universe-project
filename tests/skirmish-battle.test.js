import test from 'node:test';
import assert from 'node:assert/strict';
import { generateField } from '../src/skirmish/battlefield/generateField.js';
import { Arena } from '../src/skirmish/game/arena.js';
import { Battle } from '../src/skirmish/game/battle.js';
import { planAction } from '../src/skirmish/game/ai.js';
import { ROSTER, DEFAULT_SQUAD } from '../src/skirmish/game/roster.js';
import { BASE_CP, DOWN_TURNS } from '../src/skirmish/game/rules.js';

const field = generateField(42);
const arena = new Arena(field);
const squad = () => DEFAULT_SQUAD.map((id, i) => ({ ...ROSTER.find((r) => r.id === id), leader: i === 0, ...field.deploy.fed[i] }));
const battle = () => new Battle({ field, squad: squad(), difficulty: 'normal' });

test('command points: base plus living leaders; reselecting a unit gives it less AP', () => {
  const b = battle();
  assert.equal(b.cp, BASE_CP + 1);
  const u = b.alive('fed')[0];
  const ap1 = b.select(u);
  const ap2 = b.select(u);
  assert.equal(ap1, u.apMax);
  assert.ok(ap2 < ap1);
  assert.equal(b.cp, BASE_CP - 1);
});

test('a downed soldier can be carried out by a friend, or bleeds out after its turns', () => {
  const b = battle();
  const [a, c] = b.alive('fed');
  b.hit(a, { weapon: 'sniper', part: 'head', dist: 10 });
  b.hit(a, { weapon: 'sniper', part: 'head', dist: 10 });
  assert.equal(a.state, 'down');
  c.x = a.x + 0.5;
  c.z = a.z;
  b.touch(c);
  assert.equal(a.state, 'evac');
  const d = b.alive('fed')[0];
  d.hp = 1;
  b.hit(d, { weapon: 'rifle', part: 'body', dist: 5 });
  assert.equal(d.state, 'down');
  for (let k = 0; k < DOWN_TURNS; k++) {
    b.endTurn();
    b.endTurn();
  }
  assert.equal(d.state, 'dead');
});

test('rifle rounds ping off the tank; a lance in the radiator does triple damage', () => {
  const b = battle();
  const tank = b.unit('tank');
  assert.equal(b.hit(tank, { weapon: 'rifle', part: 'armor', dist: 10 }).damage, 0);
  const r = b.hit(tank, { weapon: 'lance', part: 'weak', dist: 10 });
  assert.equal(r.damage, 900);
  assert.ok(r.crit);
});

test('standing on the enemy flag at the end of an action wins, with a rank', () => {
  const b = battle();
  const u = b.alive('fed')[0];
  b.select(u);
  const camp = b.camps.find((c) => c.id === 'enemy');
  [u.x, u.z] = [camp.x + 1, camp.z];
  b.endAction(u);
  assert.equal(b.over.winner, 'fed');
  assert.equal(b.over.rank, 'A');
});

test('the arena: sight is blocked by houses and terrain, units cannot walk into water', () => {
  const h = field.houses[0];
  const a = { x: h.x - Math.sin(h.yaw) * 12, y: arena.ground(h.x, h.z) + 1.5, z: h.z - Math.cos(h.yaw) * 12 };
  const c = { x: h.x + Math.sin(h.yaw) * 12, y: a.y, z: h.z + Math.cos(h.yaw) * 12 };
  assert.equal(arena.los(a, c), false);
  if (field.river) {
    const [x, z] = field.river.pts[Math.floor(field.river.pts.length / 2)];
    if (!arena.onBridge(x, z)) assert.equal(arena.walkable(x, z), false);
  }
});

test('the enemy AI plans an action within its AP, quickly', () => {
  const b = battle();
  b.endTurn(); // enemy turn
  const t = performance.now();
  const plan = planAction(b, arena);
  assert.ok(performance.now() - t < 3000, 'plans in under 3 s');
  assert.ok(plan && plan.unit.side === 'imp');
  let len = 0, [px, pz] = [plan.unit.x, plan.unit.z];
  for (const [x, z] of plan.path) {
    len += Math.hypot(x - px, z - pz);
    [px, pz] = [x, z];
  }
  assert.ok(len <= plan.unit.apMax + 1.5, `path ${len.toFixed(1)} m within AP ${plan.unit.apMax}`);
});

test('the attack estimate matches the hits it predicts and changes nothing', () => {
  const b = battle();
  const shooter = b.alive('fed').find((u) => u.cls === 'scout');
  const target = b.alive('imp').find((u) => u.kind === 'infantry');
  const hp = target.hp;
  const body = b.estimate(shooter, target, { part: 'body', dist: 10 });
  const head = b.estimate(shooter, target, { part: 'head', dist: 10 });
  assert.equal(target.hp, hp);
  assert.ok(head.crit && !body.crit);
  assert.equal(head.perHit, body.perHit * 2);
  assert.equal(body.total, Math.min(hp, body.perHit * body.shots));
  const r = b.hit(target, { weapon: shooter.weapon, part: 'body', dist: 10, shooter });
  assert.equal(r.damage, body.perHit);
  const tank = b.units.find((u) => u.kind === 'tank');
  if (tank) {
    assert.ok(b.estimate(shooter, tank, { part: 'armor', dist: 10 }).ping);
    const lancer = b.alive('fed').find((u) => u.cls === 'lancer');
    const weak = b.estimate(lancer, tank, { part: 'weak', dist: 10 });
    assert.ok(weak.crit && weak.perHit > b.estimate(lancer, tank, { part: 'armor', dist: 10 }).perHit);
  }
});
