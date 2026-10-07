import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { partitionSprites, SpatialSprites, SPRITE_DENSITY_FADE } from '../src/modes/town/render/spatialSprites.js';

const camera = () => {
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  cam.lookAt(0, 0, -1);
  return cam;
};

function addBatch(spatial, center, count = 100, radius = 2, instanced = true) {
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshBasicMaterial();
  const mesh = instanced ? new THREE.InstancedMesh(geometry, material, count) : new THREE.Mesh(geometry, material);
  const sphere = new THREE.Sphere(new THREE.Vector3(...center), radius);
  spatial.add(mesh, count, sphere);
  return mesh;
}

test('sprite chunks retain every item and use deterministic prefixes that mix scatter order', () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ x: i, z: i / 100, i }));
  const first = partitionSprites(items, 128)[0];
  const second = partitionSprites(items.slice().reverse(), 128)[0];
  assert.deepEqual(first, second);
  assert.equal(new Set(first).size, items.length);
  assert.ok(first.slice(0, 25).some(item => item.i > 75), 'a smaller budget retains sprites from late scatter clumps');
  const edge = partitionSprites([{ x: -0.1, z: 0 }, { x: 0.1, z: 0 }], 128);
  assert.equal(edge.length, 2, 'negative coordinates keep their own spatial cell');
});

test('camera direction and distance remove submitted instances and restore them without buffer uploads', () => {
  const sprites = new SpatialSprites('test');
  const front = addBatch(sprites, [0, 0, -20]);
  const rear = addBatch(sprites, [0, 0, 20]);
  const far = addBatch(sprites, [0, 0, -200]);
  const versions = sprites.meshes.map(mesh => mesh.instanceMatrix.version);
  const cam = camera();
  sprites.update(cam, 100, 1, 0);
  assert.equal(sprites.activeCount, 100);
  assert.equal(front.count, 100);
  assert.equal(rear.count, 0);
  assert.equal(far.count, 0);
  cam.lookAt(0, 0, 1);
  sprites.update(cam, 100, 1, 0.016);
  assert.equal(front.count, 0);
  assert.equal(rear.count, 100);
  assert.deepEqual(sprites.meshes.map(mesh => mesh.instanceMatrix.version), versions);
});

test('density fades through a stable prefix, changes both instance types, and reverses without geometry churn', () => {
  const sprites = new SpatialSprites('test');
  const instanced = addBatch(sprites, [0, 0, -20]);
  const shaderBatch = addBatch(sprites, [0, 0, -30], 100, 2, false);
  const geometry = instanced.geometry;
  const matrix = instanced.instanceMatrix;
  const cam = camera();
  sprites.update(cam, 100, 1, 0);
  let previous = sprites.activeCount;
  for (let i = 1; i <= 20; i++) {
    sprites.update(cam, 100, 0.25, i * 0.1);
    assert.ok(sprites.activeCount <= previous);
    previous = sprites.activeCount;
  }
  const expected = Math.ceil(100 * (0.25 + SPRITE_DENSITY_FADE));
  assert.equal(instanced.count, expected);
  assert.equal(shaderBatch.geometry.instanceCount, expected);
  assert.equal(sprites.activeCount, expected * 2);
  for (let i = 21; i <= 40; i++) sprites.update(cam, 100, 1, i * 0.1);
  assert.equal(sprites.activeCount, 200);
  assert.equal(instanced.geometry, geometry);
  assert.equal(instanced.instanceMatrix, matrix);
  assert.equal(matrix.version, 0);
  for (let i = 41; i <= 60; i++) sprites.update(cam, 100, 0, i * 0.1);
  assert.equal(sprites.activeCount, 0);
});

test('conservative bounds include tall sprites and group transforms at frustum and range edges', () => {
  const sprites = new SpatialSprites('test');
  // The trunk lies beyond reach, but the large card intersects it and must stay submitted.
  const edge = addBatch(sprites, [0, 0, -105], 100, 10);
  const cam = camera();
  sprites.update(cam, 100, 1, 0);
  assert.equal(edge.count, 100);
  sprites.group.position.set(0, 0, -30);
  sprites.update(cam, 100, 1, 0.1);
  assert.equal(edge.count, 0);
  sprites.group.position.set(0, 0, 0);
  sprites.update(cam, 100, 1, 0.2);
  assert.equal(edge.count, 100);
});
