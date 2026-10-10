import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import TownMode from '../src/modes/town/TownMode.js';
import { mixin } from '../src/modes/town/controllers/mixin.js';
import { undefinedIdentifiers } from './helpers/undefinedIdentifiers.mjs';

const town = new URL('../src/modes/town/', import.meta.url);
const lines = (url) => readFileSync(url, 'utf8').split('\n').length;
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const url = new URL(name, dir);
  return statSync(url).isDirectory() ? walk(new URL(`${name}/`, dir)) : name.endsWith('.js') ? [url] : [];
});
const controllers = readdirSync(new URL('controllers/', town)).filter((n) => n.endsWith('.js')).map((n) => new URL(`controllers/${n}`, town));

test('TownMode is a thin orchestrator and every controller stays small', () => {
  assert.ok(lines(new URL('TownMode.js', town)) <= 900, `TownMode.js has ${lines(new URL('TownMode.js', town))} lines`);
  assert.ok(controllers.length >= 8);
  for (const url of controllers) assert.ok(lines(url) < 400, `${url.pathname.split('/').pop()} has ${lines(url)} lines`);
});

test('each controller says what it is for and exports one class of methods (a name defined twice is refused by mixin)', () => {
  for (const url of controllers.filter((u) => !/(mixin|shared)\.js$/.test(u.pathname))) {
    const text = readFileSync(url, 'utf8');
    assert.match(text.split('\n')[0], /^\/\/ \S/, `${url.pathname.split('/').pop()} starts with a line on its responsibility`);
    assert.equal(text.match(/^export class /gm)?.length, 1, 'one class per controller');
  }
});

// What the Director, the journey, the QA tools (window.__globe.director.mode.*) and the tests call on a town.
const PUBLIC_API = ['prepare'];
const INSTANCE_API = [
  'enter', 'arrived', 'update', 'render', 'resize', 'depart', 'exit',
  'setView', 'setViewSilently', 'flyCamera', 'dioramaPose', 'placePlayer', 'panDiorama', 'updateFollowCamera', 'cameraClearance',
  'enterBuilding', 'exitBuilding', 'useInterior', 'changeInteriorFloor', 'saveInterior', 'saveInteriorLocation', 'restoreInteriorLocation', 'transition', 'findDoors', 'nearestDoor', 'updateInterior',
  'enterVehicle', 'exitVehicle', 'updateDrive', 'startRoadArrival', 'checkRoadOut',
  'bindInput', 'unbindInput', 'intent', 'interact', 'updatePrompt', 'updateWalk', 'footsteps',
  'openPlanner', 'closePlanner', 'setTownStyle', 'setPixelZoom',
  'prepareAuthoredHomes', 'addAuthoredHomes', 'setupHomeEntry', 'showHomeMessage', 'toggleHomeSelection', 'pickHomeAt',
  'updateEnvironment', 'updateDepthRange', 'adaptQuality'
];

test('the town keeps the members other code relies on', () => {
  for (const name of PUBLIC_API) assert.equal(typeof TownMode[name], 'function', `static ${name}`);
  for (const name of INSTANCE_API) assert.equal(typeof TownMode.prototype[name], 'function', name);
  for (const name of ['fading', 'pixelActive', 'renderCamera']) {
    const descriptor = Object.getOwnPropertyDescriptor(TownMode.prototype, name);
    assert.equal(typeof descriptor?.get, 'function', `${name} stays a getter`);
  }
});

test('mixin copies methods and getters, skips the constructor and refuses a name defined twice', () => {
  class Target { own() { return 'own'; } }
  class Group { constructor() { this.never = true; } hello() { return 'hello'; } get answer() { return 42; } }
  mixin(Target, Group);
  const t = new Target();
  assert.deepEqual([t.hello(), t.answer, t.own(), t.never], ['hello', 42, 'own', undefined]);
  class Other { hello() { return 'again'; } }
  assert.throws(() => mixin(Target, Other), /Target\.hello is defined twice/);
});

test('no module of the game uses a name it never imported or declared', () => {
  const problems = [];
  for (const url of walk(new URL('../src/', import.meta.url))) {
    const missing = undefinedIdentifiers(readFileSync(url, 'utf8'));
    if (missing.length) problems.push(`${url.pathname.split('/src/')[1]}: ${missing.join(', ')}`);
  }
  assert.deepEqual(problems, []);
});

test('the identifier check itself catches a missing import, a missing local and a name used only in a default value', () => {
  const found = undefinedIdentifiers(`import { a } from 'x';
    export class K { m(p) { const q = a + missingOne; const { z, y = missingTwo } = p; for (const i of p) { q + i; } try {} catch (e) { e; } return z + y + p.c + q + undeclaredThree; } }`);
  assert.deepEqual(found, ['missingOne', 'missingTwo', 'undeclaredThree']);
  assert.deepEqual(undefinedIdentifiers('const f = (x = 1) => { var late = x; return late + Math.max(x, 2); };'), []);
});
