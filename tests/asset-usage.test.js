import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { ASSET_FILES } from '../src/render/assetManifest.js';
import { townAssetKeys } from '../src/modes/town/townPacks.js';

const SRC = new URL('../src/', import.meta.url);
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const url = new URL(name, dir);
  return statSync(url).isDirectory() ? walk(new URL(`${name}/`, dir)) : /\.(js|html)$/.test(name) ? [url] : [];
});
const files = walk(SRC).filter((url) => !url.pathname.endsWith('/render/assetManifest.js'));
const sources = files.map((url) => ({ path: url.pathname.split('/src/')[1], text: readFileSync(url, 'utf8') }));
const keysUsedIn = (text) => new Set([...text.matchAll(/(?<![\w/.-])ASSET(?:S|_FILES)\.([a-z][A-Za-z0-9]*)(?!\w*\.md)/g)].map((m) => m[1]));
const bytes = (key) => statSync(new URL(`../public/${ASSET_FILES[key]}`, import.meta.url)).size;

test('every file the manifest ships has a module that loads it', () => {
  const used = new Set(sources.flatMap(({ text }) => [...keysUsedIn(text)]));
  const unused = Object.keys(ASSET_FILES).filter((key) => !used.has(key));
  assert.deepEqual(unused, [], 'manifest entries nothing loads: move the file out of public/ (see tools/blender/legacy)');
  const unknown = [...used].filter((key) => !(key in ASSET_FILES));
  assert.deepEqual(unknown, [], 'ASSETS.<key> that the manifest does not define');
});

test('nothing indexes the manifest dynamically, so the usage check above cannot be bypassed', () => {
  const dynamic = sources.filter(({ text }) => /\bASSET(?:S|_FILES)\s*\[|Object\.(?:keys|values|entries)\(\s*ASSET/.test(text)).map(({ path }) => path);
  assert.deepEqual(dynamic, []);
});

const keysOf = ({ entry, deferred }) => [...entry, ...deferred];
const sum = (keys) => keys.reduce((total, key) => total + bytes(key), 0);

test('the town entry lists match what the entry path really asks for, and leave out what is not needed to see the town', () => {
  const packs = sources.find(({ path }) => path === 'modes/town/townPacks.js').text;
  const entryBody = packs.slice(packs.indexOf('export const loadTownPacks'), packs.indexOf('export class LazyPack'));
  const people = sources.find(({ path }) => path === 'modes/town/people/skirmishPeople.js').text;
  const peopleBody = people.slice(people.indexOf('const bodyUrls'), people.indexOf('/** Town owns its templates'));
  const inCode = [...new Set([...keysUsedIn(entryBody), ...keysUsedIn(peopleBody)])].sort();
  const declared = new Set();
  for (const low of [false, true]) for (const deferFemale of [false, true]) keysOf(townAssetKeys({ low, deferFemale })).forEach((key) => declared.add(key));
  assert.deepEqual([...declared].sort(), inCode, 'townAssetKeys() and the loaders name the same files');
  for (const low of [false, true]) {
    const { entry, deferred } = townAssetKeys({ low });
    for (const key of ['furniturePack', 'homePack', 'soldierPackF', 'townWalkF']) assert.ok(!entry.includes(key), `${key} is not needed to see the town`);
    assert.deepEqual(keysOf(townAssetKeys({ low, deferFemale: false })).sort(), keysOf({ entry, deferred }).sort(), 'deferring moves files, it does not drop any');
  }
  const mode = sources.find(({ path }) => path === 'modes/town/TownMode.js').text;
  assert.ok(!/ASSETS\./.test(mode), 'TownMode names no asset itself: loading lives in townPacks.js');
});

// Ratchets: lower them when the entry gets lighter, raise them only on purpose and say why.
test('entering a town: Normal fetches at most 22.59 MB before it is on screen, Low at most 19.75 MB (was 36.90 MB)', () => {
  const normal = townAssetKeys({ low: false }), low = townAssetKeys({ low: true });
  assert.ok(sum(normal.entry) <= 22587789, `Normal entry ${sum(normal.entry)} bytes`);
  assert.ok(sum(low.entry) <= 19749056, `Low entry ${sum(low.entry)} bytes`);
  assert.ok(sum(low.entry) < sum(normal.entry));
  assert.ok(sum(normal.deferred) <= 9828706, 'the women\'s body, right after the town is on screen');
  assert.ok(sum(low.deferred) <= 7068170);
  assert.ok(sum(keysOf(normal)) <= 32416495, 'everything the town needs, Normal');
  assert.ok(sum(keysOf(low)) <= 26817226, 'everything the town needs, Low');
  assert.equal(bytes('furniturePack'), 801628, 'the furniture loads when a door is near, not here');
});

test('the Low files are the 1024 copies, the surface file is the 256 copy, and each is far lighter than its original', () => {
  for (const [low, original] of [['soldierAtlasLow', 'soldierAtlas'], ['soldierHeadLow', 'soldierHead'], ['soldierAtlasFLow', 'soldierAtlasF'], ['soldierHeadFLow', 'soldierHeadF'], ['envSurfacesTown', 'envSurfaces']]) {
    assert.ok(bytes(low) < bytes(original) / 2, `${low} is ${bytes(low)} bytes against ${bytes(original)}`);
  }
});
