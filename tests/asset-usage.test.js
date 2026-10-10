import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { ASSET_FILES } from '../src/render/assetManifest.js';
import { TOWN_ENTRY_ASSET_KEYS } from '../src/modes/town/townPacks.js';

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

test('the town entry list matches what the entry path really asks for, and leaves the furniture out', () => {
  const packs = sources.find(({ path }) => path === 'modes/town/townPacks.js').text;
  const entryBody = packs.slice(packs.indexOf('export const loadTownPacks'), packs.indexOf('export class LazyPack'));
  const fromPacks = keysUsedIn(entryBody);
  const people = sources.find(({ path }) => path === 'modes/town/people/skirmishPeople.js').text;
  const fromPeople = keysUsedIn(people.slice(people.indexOf('export const loadTownPeople'), people.indexOf('export function installTownWalk')));
  assert.deepEqual([...new Set([...fromPacks, ...fromPeople])].sort(), [...TOWN_ENTRY_ASSET_KEYS].sort());
  assert.ok(!TOWN_ENTRY_ASSET_KEYS.includes('furniturePack'));
  assert.ok(!TOWN_ENTRY_ASSET_KEYS.includes('homePack'));
  const mode = sources.find(({ path }) => path === 'modes/town/TownMode.js').text;
  assert.ok(!/ASSETS\./.test(mode), 'TownMode names no asset itself: loading lives in townPacks.js');
});

test('entering a town fetches no more than 36.9 MB of files, 1.18 MB less than before the furniture went lazy', () => {
  const total = TOWN_ENTRY_ASSET_KEYS.reduce((sum, key) => sum + bytes(key), 0);
  assert.ok(total <= 36900299, `the town entry set is ${total} bytes: if a pack was added on purpose, say so and raise this number`);
  assert.equal(bytes('furniturePack'), 801628, 'the furniture pack is what moved out of the entry path (plus the 375272-byte interior atlas that nothing read)');
});
