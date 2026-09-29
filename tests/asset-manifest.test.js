import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { ASSET_FILES, ASSETS } from '../src/render/assetManifest.js';

const PUBLIC = new URL('../public/', import.meta.url);

test('every runtime asset in the manifest exists under public/', () => {
  for (const [key, path] of Object.entries(ASSET_FILES)) {
    assert.ok(existsSync(new URL(path, PUBLIC)), `${key}: public/${path} is missing`);
    assert.ok(ASSETS[key].endsWith(path));
  }
});

test('public/ ships only files the manifest names (plus the favicon)', () => {
  const listed = new Set(Object.values(ASSET_FILES));
  for (const dir of ['models', 'textures']) {
    for (const name of readdirSync(new URL(`${dir}/`, PUBLIC))) {
      const path = `${dir}/${name}`;
      if (path === 'models/scenery.manifest.json') continue; // build report, read by tests only
      assert.ok(listed.has(path), `public/${path} is not loaded by the game; move build sources to tools/`);
    }
  }
});
