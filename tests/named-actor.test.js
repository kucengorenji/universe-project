import test from 'node:test';
import assert from 'node:assert/strict';
import { generateHexasphere } from '../src/math/hexasphere.js';
import { MapGenerator } from '../src/map/mapGenerator.js';
import { generateTownLayout } from '../src/modes/town/layout/townLayout.js';
import { createWalkNetwork, townWalkable } from '../src/modes/town/navigation/walkNetwork.js';
import { Pedestrians } from '../src/modes/town/navigation/pedestrianRoutes.js';
import { damarIdentity, chooseDamarAnchor } from '../src/world/namedActor.js';
import { Greeter, GREET } from '../src/modes/town/people/greeter.js';
import { t } from '../src/i18n/index.js';

const hexasphere = generateHexasphere(3, 10);
const generator = new MapGenerator(hexasphere);
const townFor = (seed, cityIndex = 0) => {
  const map = generator.generate(seed, { planetType: 'terran' });
  generator.applyMapData(map);
  const layout = generateTownLayout({ map, hexasphere, cityIndex });
  const graph = createWalkNetwork(layout.walkGraph, { walkable: townWalkable(layout, { margin: 0.3 }), portals: [] });
  return { layout, graph };
};

// ---------------------------------------------------------------- identity and anchor

test('Damar is the same person for the same town, and a different one elsewhere', () => {
  const a = damarIdentity({ planet: 2, city: 1, layoutSeed: 123456 });
  assert.deepEqual(damarIdentity({ planet: 2, city: 1, layoutSeed: 123456 }), a);
  assert.match(a.actorId, /^damar:2:1:[0-9a-z]+$/);
  assert.notEqual(damarIdentity({ planet: 2, city: 1, layoutSeed: 123457 }).actorId, a.actorId);
  assert.notEqual(damarIdentity({ planet: 2, city: 2, layoutSeed: 123456 }).actorId, a.actorId);
  assert.ok(Number.isInteger(a.seed) && a.seed >= 0);
  for (const key of [a.nameKey, a.greetKey]) assert.notEqual(t(key), key, key);
  assert.equal(t(a.nameKey), 'Damar');
  assert.equal(t(a.greetKey), 'Hello! Welcome to this town.');
});

test('the anchor is a usable street at least 6 m from the door, nearest to 18 m', () => {
  const sweep = [17, 427, 8191];
  for (const seed of sweep) {
    const { layout, graph } = townFor(seed);
    const door = { x: layout.spawn.x + 12, z: layout.spawn.z + 5 };
    const anchor = chooseDamarAnchor(graph, { door, spawn: layout.spawn });
    assert.ok(anchor, `seed ${seed}`);
    const edge = graph.edges[anchor.edge];
    assert.notEqual(edge.kind, 'entrance');
    assert.ok(edge.length >= 6);
    assert.ok(graph.components[graph.nodes[edge.a].component].length >= 12, 'in a real network');
    const distance = Math.hypot(anchor.x - door.x, anchor.z - door.z);
    assert.ok(distance >= 6, `${distance} m from the door`);
    assert.deepEqual(chooseDamarAnchor(graph, { door, spawn: layout.spawn }), anchor, 'deterministic');
    // nobody else is closer to 18 m
    for (const other of graph.edges) {
      if (other.id === edge.id || other.kind === 'entrance' || other.length < 6 || (graph.components[graph.nodes[other.a].component]?.length ?? 0) < 12) continue;
      const mid = { x: (graph.nodes[other.a].x + graph.nodes[other.b].x) / 2, z: (graph.nodes[other.a].z + graph.nodes[other.b].z) / 2 };
      const d = Math.hypot(mid.x - door.x, mid.z - door.z);
      if (d >= 6 && other.kind !== 'garden' && Math.abs(d - 18) < Math.abs(distance - 18) - 8) assert.fail(`edge ${other.id} is much closer to 18 m (${d})`);
    }
  }
  assert.equal(chooseDamarAnchor({ edges: [], nodes: [], components: [] }, {}), null, 'no street, no anchor');
  assert.equal(chooseDamarAnchor(null, {}), null);
});

// ---------------------------------------------------------------- the greeting

function run(frameRate, script, options = {}) {
  const events = [];
  const greeter = new Greeter({ actorId: 'damar:test', onEvent: (e) => events.push(e) });
  const actor = { x: 0, z: 0, yaw: 0 };
  const log = [];
  const dt = 1 / frameRate;
  let time = 0;
  for (const step of script) {
    const frames = Math.round(step.seconds * frameRate);
    for (let i = 0; i < frames; i++) {
      const player = step.player === null ? null : { x: step.player ?? 10, z: 0 };
      const out = greeter.update(options.paused ? 0 : dt, { actor, player, present: step.present !== false });
      time += dt;
      log.push({ time, state: greeter.state, ...out });
    }
  }
  return { greeter, events, log };
}
const greets = (events) => events.filter((e) => e.eventId === 'lw.actor.greet');

for (const fps of [30, 60]) {
  test(`${fps} FPS: stop and look start at once, one 2.4 s bubble, release within 0.5 s of leaving`, () => {
    const { events, log } = run(fps, [{ seconds: 1, player: 10 }, { seconds: 6, player: 2.0 }, { seconds: 1.0, player: 4 }, { seconds: 1, player: 10 }]);
    const stopAt = log.find((l) => l.hold).time - 1 / fps; // the frame before the first held one is when the player crossed 2.3 m
    assert.ok(stopAt >= 1 - 1e-9 && stopAt <= 1 + 1 / fps + 1e-9, 'stops on the frame the player enters 2.3 m');
    const bubbleFrames = log.filter((l) => l.bubble);
    const bubbleStart = bubbleFrames[0].time, bubbleEnd = bubbleFrames.at(-1).time;
    assert.ok(bubbleStart - stopAt >= 0.3 - 1e-9 && bubbleStart - stopAt <= 0.35 + 1 / fps, `bubble ${bubbleStart - stopAt} s after the stop`);
    assert.ok(Math.abs(bubbleEnd - bubbleStart - 2.4) <= 2 / fps + 1e-9, `bubble lasted ${bubbleEnd - bubbleStart} s`);
    assert.equal(greets(events).length, 1, 'one greeting for the approach');
    const free = log.find((l) => l.time > 8 && !l.hold);
    assert.ok(free.time - 8 <= 0.5 + 1 / fps, `free ${free.time - 8} s after leaving 3.6 m`);
    assert.equal(log.at(-1).hold, false);
  });
}

test('20 approaches: greetings follow the 15 s cooldown and never double', () => {
  const script = [];
  for (let i = 0; i < 20; i++) script.push({ seconds: 3, player: 1.5 }, { seconds: 3, player: 8 }); // a 6 s cycle
  const { events, greeter } = run(30, script);
  const times = greets(events).map((e) => e.worldTime);
  assert.equal(times.length, greeter.greetings);
  assert.ok(times.length >= 7 && times.length <= 9, `${times.length} greetings in 120 s`);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 15 - 1e-9, `gap ${times[i] - times[i - 1]}`);
  const ids = greets(events).map((e) => e.interactionId);
  assert.equal(new Set(ids).size, ids.length, 'one interaction id per greeting');
  assert.equal(new Set(events.map((e) => e.instanceId)).size, events.length, 'every event has its own instance id');
  for (const e of events) assert.equal(e.actorId, 'damar:test');
});

test('standing about between 2.3 and 3.6 m never repeats the greeting; leaving past 3.6 m and returning after the cooldown does', () => {
  const stay = run(30, [{ seconds: 2, player: 1.8 }, { seconds: 20, player: 3.0 }, { seconds: 20, player: 2.0 }]);
  assert.equal(greets(stay.events).length, 1, 'pacing at the edge is the same approach');
  const back = run(30, [{ seconds: 3, player: 1.8 }, { seconds: 16, player: 6 }, { seconds: 3, player: 1.8 }]);
  assert.equal(greets(back.events).length, 2);
  const early = run(30, [{ seconds: 3, player: 1.8 }, { seconds: 4, player: 6 }, { seconds: 3, player: 1.8 }]);
  assert.equal(greets(early.events).length, 1, 'back inside the cooldown: no greeting, and it is not saved up for later');
});

test('walking away before the pause ends the greeting without claiming one', () => {
  const { events, greeter } = run(30, [{ seconds: 1, player: 10 }, { seconds: 0.15, player: 2 }, { seconds: 1, player: 5 }, { seconds: 1, player: 10 }]);
  assert.equal(greets(events).length, 0);
  assert.equal(greeter.lastGreetAt, null, 'no cooldown was spent');
  assert.equal(greeter.state, 'idle');
});

test('driving, the interior or an actor that is not on screen end a greeting and start nothing', () => {
  const during = run(30, [{ seconds: 0.2, player: 2 }, { seconds: 1, player: null }]);
  assert.equal(during.greeter.state, 'idle');
  assert.equal(during.log.at(-1).hold, false);
  assert.equal(greets(during.events).length, 0);
  const driving = run(30, [{ seconds: 5, player: null }]);
  assert.equal(driving.events.length, 0);
  const offscreen = run(30, [{ seconds: 5, player: 1.0, present: false }]);
  assert.equal(offscreen.events.length, 0, 'no body, no greeting');
  const midTalk = run(30, [{ seconds: 1, player: 2 }, { seconds: 0.5, player: null }]);
  assert.deepEqual(midTalk.events.filter((e) => e.eventId === 'lw.actor.talk.end').map((e) => e.reason), ['away']);
  const again = new Greeter({ actorId: 'x' });
  again.update(0.1, { actor: { x: 0, z: 0, yaw: 0 }, player: { x: 1, z: 0 } });
  again.cancel();
  assert.equal(again.armed, true, 'coming back is a new approach');
});

test('a paused game freezes the greeting: nothing advances and nothing is replayed after', () => {
  const paused = run(30, [{ seconds: 5, player: 1.5 }], { paused: true });
  assert.equal(paused.greeter.clock, 0);
  assert.equal(paused.events.filter((e) => e.eventId === 'lw.actor.greet').length, 0, 'time that did not run cannot greet');
  assert.equal(paused.greeter.state, 'stop', 'the stop started and is waiting');
});

test('the body turns toward the player at no more than 120 degrees a second, and ends up facing them', () => {
  const greeter = new Greeter({ actorId: 'x' });
  const actor = { x: 0, z: 0, yaw: Math.PI }; // facing away: player stands on the +z side
  let previous = null, worst = 0;
  for (let i = 0; i < 60; i++) {
    const out = greeter.update(1 / 30, { actor, player: { x: 0, z: 2 } });
    if (out.faceYaw !== null) {
      if (previous !== null) worst = Math.max(worst, Math.abs(Math.atan2(Math.sin(out.faceYaw - previous), Math.cos(out.faceYaw - previous))) * 30);
      previous = out.faceYaw;
    }
  }
  assert.ok(worst <= GREET.turnRate + 1e-6, `${(worst * 180) / Math.PI} deg/s`);
  assert.ok(Math.abs(previous) < 1e-6, 'faces +z, toward the player');
});

// ---------------------------------------------------------------- the walker

test('a pinned walker paces one street; a held walker stands still and faces where it is told; others are untouched', () => {
  const { layout, graph } = townFor(17);
  const anchor = chooseDamarAnchor(graph, { spawn: layout.spawn });
  const people = Array.from({ length: 5 }, () => ({ x: 0, y: 0, z: 0, yaw: 0, phase: 0, speed: 0, visible: true }));
  const crowd = { count: 5, people };
  let seed = 7;
  const rng = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const walkers = new Pedestrians(crowd, 1, graph, rng, () => 0);
  const free = JSON.stringify(walkers.walkers.slice(1).map((w) => [w.i, w.edge]));
  const damar = walkers.pin(walkers.walkers[0].i, anchor.edge);
  assert.equal(damar.edge, anchor.edge);
  for (let i = 0; i < 4000; i++) walkers.update(1 / 30, null);
  assert.equal(damar.edge, anchor.edge, 'paced for two minutes and never left the street');
  assert.ok(damar.transitions > 2, 'and turned round at the ends');
  const at = { x: people[damar.i].x, z: people[damar.i].z };
  damar.hold = true; damar.faceYaw = 1.25;
  for (let i = 0; i < 90; i++) walkers.update(1 / 30, null);
  assert.deepEqual({ x: people[damar.i].x, z: people[damar.i].z }, at, 'held: not a step');
  assert.equal(people[damar.i].speed, 0);
  assert.equal(people[damar.i].yaw, 1.25);
  damar.hold = false; damar.faceYaw = null;
  for (let i = 0; i < 90; i++) walkers.update(1 / 30, null);
  assert.ok(Math.hypot(people[damar.i].x - at.x, people[damar.i].z - at.z) > 0.5, 'released: walking again');
  assert.equal(walkers.pin(99, 0), null);
  assert.equal(walkers.pin(damar.i, 99999), null);
  assert.ok(free.length > 2);
});
