/**
 * Run: node tools/qa/home_navigation.mjs
 *
 * Navigation logic QA, not a browser/render/performance test. This loads the
 * current HomeMode class after removing its browser-only import statements;
 * Three.js, the model and builder are the actual modules, not replacements.
 * Only DOM presentation callbacks are stubbed. Every navigation assertion
 * invokes the real walkSpawn/walkSurface/update methods with builder walkWalls.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import * as Model from '../../src/modes/home/homeBlueprint.js';
import { createHomeGroup, disposeHomeGroup } from '../../src/modes/home/homeBuilder.js';

const source = await readFile(new URL('../../src/modes/home/HomeMode.js', import.meta.url), 'utf8');
const controller = source.replace(/^import .*;\n/gm, '').replace('export default class HomeMode', 'class HomeMode');
const HomeMode = new Function('THREE', 'Model', 'loadHomePack', `${controller}\nreturn HomeMode;`)(THREE, Model, () => Promise.resolve(null));
const close = (actual, expected, message) => assert.ok(typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - expected) < .00001, `${message}: ${actual} != ${expected}`);
const fixture = (seed, shape) => {
  const bp = Model.createHomeBlueprint({ id: `walk-${seed}`, seed, shape, floors: 3, attic: true });
  const home = createHomeGroup(bp);
  const mode = new HomeMode({}, {});
  Object.assign(mode, { bp, home, floorId: bp.floors[0].id, view: 'walk', camera: new THREE.PerspectiveCamera(), walkPitch: 0 });
  mode.updateUI = () => {}; // DOM changes are covered by the browser workflow.
  return { mode, bp, home };
};

const report = { fixtures: 0, spawns: 0, stairTrips: 0, doorSweeps: 0, yardCollisions: 0, sprintWalls: [], diagonalDistance: null };
for (const shape of ['rectangle', 'angled', 'curved']) for (const seed of ['17', 'cozy-house', 'stairs']) {
  const { mode, bp, home } = fixture(seed, shape);
  try {
    assert.equal(Model.validateHomeBlueprint(bp).ok, true, `${seed}/${shape}: fixture`);
    for (const floor of bp.floors) {
      mode.floorId = floor.id;
      const spawn = mode.walkSpawn();
      close(mode.walkSurface(spawn.x, spawn.z, floor.elevation), floor.elevation, `${seed}/${shape}: spawn ${floor.id}`);
      assert.ok(!bp.stairs.some(s => Math.abs(spawn.x - s.x) < s.width / 2 + .1 && Math.abs(spawn.z - s.z) < s.depth / 2 + .1));
      report.spawns++;
    }

    for (const stair of bp.stairs) {
      const low = bp.floors.find(f => f.id === stair.fromFloorId), high = bp.floors.find(f => f.id === stair.toFloorId);
      for (const ascending of [true, false]) {
        const start = ascending ? low : high, end = ascending ? high : low;
        mode.floorId = start.id;
        mode.walkPosition = new THREE.Vector3(stair.x, start.elevation, stair.z + (ascending ? -1 : 1) * (stair.depth / 2 + .25));
        mode.walkYaw = ascending ? Math.PI : 0;
        mode.keys = new Set(['KeyW']);
        for (let frame = 0; frame < 180; frame++) mode.update(1 / 60);
        close(mode.walkPosition.y, end.elevation, `${seed}/${shape}: stair ${stair.id}, ascending=${ascending}`);
        assert.equal(mode.floorId, end.id, `${seed}/${shape}: landing should select ${end.id}`);
        report.stairTrips++;
      }
    }

    for (const door of bp.openings.filter(o => o.kind === 'door')) {
      const p = Model.openingTransform(bp, door), floor = bp.floors.find(f => f.id === door.floorId);
      for (let step = -5; step <= 5; step++) {
        const distance = step * .05;
        assert.notEqual(mode.walkSurface(p.x + p.normal.x * distance, p.z + p.normal.z * distance, floor.elevation), null, `${seed}/${shape}: blocked door ${door.id}`);
      }
      report.doorSweeps++;
    }
    for (const item of bp.yard.items) {
      assert.equal(mode.walkSurface(item.position.x, item.position.z, 0), null, `${seed}/${shape}: yard item ${item.id}`);
      report.yardCollisions++;
    }
    assert.equal(mode.walkSurface(Math.max(...bp.plot.map(p => p.x)) + 1, 0, 0), null, 'cannot leave plot');
    report.fixtures++;
  } finally { disposeHomeGroup(home); }
}

{
  const { mode, bp, home } = fixture('17', 'rectangle');
  try {
    const room = bp.floors[0].rooms.find(r => r.type === 'bathroom'), a = room.points[0], b = room.points[1];
    const x = (a.x + b.x) / 2, wallZ = (a.z + b.z) / 2;
    assert.equal(mode.walkSurface(x, wallZ + .2, 0), 0, 'wall fixture start is free');
    for (const dt of [1 / 60, .05, .1]) {
      mode.walkPosition = new THREE.Vector3(x, 0, wallZ + .2);
      mode.walkYaw = 0;
      mode.keys = new Set(['KeyW', 'ShiftLeft']);
      mode.update(dt);
      assert.ok(mode.walkPosition.z >= wallZ, `sprint crossed solid exterior wall at dt=${dt}`);
      report.sprintWalls.push({ dt, wallZ, endZ: mode.walkPosition.z });
    }

    // A clear yard area isolates speed from furniture and staircase constraints.
    mode.bp = structuredClone(bp);
    mode.bp.items = []; mode.bp.yard.items = [];
    const start = new THREE.Vector3(Math.min(...bp.plot.map(p => p.x)) + .6, 0, Math.max(...bp.plot.map(p => p.z)) - .6);
    mode.walkPosition = start.clone(); mode.walkYaw = 0;
    mode.keys = new Set(['KeyW', 'KeyD', 'ShiftLeft']);
    mode.update(.1);
    report.diagonalDistance = Math.hypot(mode.walkPosition.x - start.x, mode.walkPosition.z - start.z);
    close(report.diagonalDistance, .4, 'diagonal sprint has the same speed as straight sprint');
  } finally { disposeHomeGroup(home); }
}

console.log(JSON.stringify({ status: 'PASS', ...report }, null, 2));
