import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PixelCamera } from '../src/modes/town/render/pixelCamera.js';
import { orthographicLodScale, pixelResolution, readTownStyle, saveTownStyle } from '../src/modes/town/render/pixelConfig.js';
import { treePixels, surfacePixels } from '../src/modes/town/render/pixelAssets.js';
import { pixelBuildingOccluded } from '../src/modes/town/render/pixelOcclusion.js';

test('pixel preferences remain separate from world data and survive unavailable storage', () => {
  const records = new Map([['world', 'unchanged']]);
  const storage = { getItem: key => records.get(key), setItem: (key, value) => records.set(key, value) };
  assert.equal(readTownStyle(storage), 'normal');
  saveTownStyle('pixel', storage); assert.equal(readTownStyle(storage), 'pixel');
  assert.equal(records.get('world'), 'unchanged');
  const denied = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.equal(readTownStyle(denied), 'normal'); assert.equal(saveTownStyle('pixel', denied), 'pixel');
});

test('pixel camera keeps orientation and projected object size while following, with three independent zoom presets', () => {
  const rig = new PixelCamera(1440, 900, 160), p = new THREE.Vector3(0, 3, 0);
  rig.setView('walk'); rig.update(p, 0, true);
  const rotation = rig.camera.quaternion.clone();
  const projectedHeight = () => new THREE.Vector3(0, 2, 0).project(rig.camera).y - new THREE.Vector3(0, 0, 0).project(rig.camera).y;
  const before = projectedHeight();
  rig.update(new THREE.Vector3(150, 7, -80), 0, true);
  assert.ok(rotation.angleTo(rig.camera.quaternion) < 1e-7);
  assert.ok(Math.abs(before - projectedHeight()) < 1e-8);
  rig.setZoom(0); assert.ok(projectedHeight() > before);
  rig.setView('drive'); assert.equal(rig.levels.drive, 1);
  rig.setView('walk'); assert.equal(rig.levels.walk, 0);
  rig.resize(390, 844); assert.ok(Math.abs(rig.camera.right / rig.camera.top - 390 / 844) < 1e-10);
});

test('orthographic LOD uses projection, independent of eye distance, and reacts to zoom', () => {
  const camera = new THREE.OrthographicCamera(-20, 20, 15, -15, .1, 1000);
  const first = orthographicLodScale(camera);
  camera.position.set(300, 300, 300); assert.equal(orthographicLodScale(camera), first);
  camera.zoom = 2; assert.equal(orthographicLodScale(camera), first * 2);
  assert.equal(orthographicLodScale(new THREE.PerspectiveCamera()), 0);
});

test('building occlusion detects small nearby houses along a long orthographic ray, respects roof height and rotated footprints', () => {
  const from = { x: -6, y: 1, z: -6 }, to = { x: 210, y: 297, z: 210 };
  const house = { x: 0, z: 0, hw: 3, hd: 3, top: 9, yaw: Math.PI / 4 };
  assert.equal(pixelBuildingOccluded(from, to, [house]), true);
  assert.equal(pixelBuildingOccluded({ ...from, y: 25 }, to, [house]), false);
  assert.equal(pixelBuildingOccluded({ ...from, z: -35 }, to, [house]), false);
  assert.equal(pixelBuildingOccluded(from, to, []), false);
});

test('source pixel resolution does not depend on output DPR and covers non-divisible viewports', () => {
  for (const [width, height] of [[1440, 900], [1920, 1080], [390, 844], [1, 1]]) {
    const result = pixelResolution(width, height);
    assert.ok(Number.isInteger(result.scale) && result.scale >= 2);
    assert.ok(result.width * result.scale >= width && result.height * result.scale >= height);
    assert.ok(result.width * result.scale - width < result.scale);
  }
});

test('pixel nature and semantic surfaces are reproducible assets with transparent cutouts and distinct species', () => {
  const oak = treePixels('oak');
  assert.deepEqual(oak.data, treePixels('oak').data);
  assert.notDeepEqual(oak.data, treePixels('autumn').data);
  assert.notDeepEqual(oak.data, treePixels('pine').data);
  const alpha = oak.data.filter((_, index) => index % 4 === 3);
  assert.ok(alpha.includes(0) && alpha.includes(255));
  const surfaces = surfacePixels();
  assert.equal(surfaces.data.length, 32 * 32 * 16 * 4);
  assert.deepEqual(surfaces.data, surfacePixels().data);
});
