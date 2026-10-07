import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Fleet } from '../src/modes/town/vehicles/fleet.js';
import { Car, VEHICLE_TYPES } from '../src/modes/town/vehicles/vehicle.js';

const model = (segments) => {
  const g = new THREE.SphereGeometry(1, segments, Math.max(2, segments / 2));
  g.setAttribute('paint', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(1), 1));
  g.setAttribute('emissive', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1));
  g.computeBoundingSphere();
  return g;
};
const kit = (paint = '#b8433a', horse = false) => ({
  physics: 'sedan', body: 'body', paint: new THREE.Color(paint),
  wheels: [{ kind: 'wheel', x: 0.8, y: 0.34, z: 1.4, r: 0.34, w: 0.28, steer: true }],
  parts: [{ asset: 'roof', x: 0, y: 1.5, z: -0.3, sx: 1, sy: 1, sz: 1, paint: new THREE.Color('#ffffff') }],
  horses: horse ? [{ x: 0, z: 2, paint: new THREE.Color('#7b5236') }] : []
});
const setup = ({ shadows = true, singleLevel = false } = {}) => {
  const pack = Object.fromEntries(['body', 'wheel', 'roof', 'vh_horse'].map((name) => [name, singleLevel ? { 2: model(4) } : { 0: model(16), 1: model(8), 2: model(4) }]));
  const scene = new THREE.Scene();
  const material = new THREE.MeshBasicMaterial();
  const builder = { townPack: pack, material, quality: { settings: { detail: 1, shadows } }, groundAt: () => 0 };
  const fleet = new Fleet(builder, scene, { shadows, rng: () => 0.5 });
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 4000);
  return { fleet, camera, pack, scene, builder };
};
const moveCamera = (camera, v, size) => camera.position.set(v.car.x, 0, v.car.z + v.lodRadius / size);
const renderedMatrix = (slot) => {
  const matrix = new THREE.Matrix4();
  slot.inst.getMatrixAt(slot.i, matrix);
  return matrix;
};
const equalMatrix = (a, b) => a.elements.every((n, i) => Math.abs(n - b.elements[i]) < 1e-4);

test('fleet uses compact geometry LODs, stable logical slots, and preserves paint during regrouping', () => {
  const { fleet, camera, pack } = setup();
  const near = fleet.add({ kit: kit('#b8433a'), x: 0, z: 0, yaw: 0, mode: 'parked' });
  const far = fleet.add({ kit: kit('#3f6fb0'), x: 0, z: 1000, yaw: 0, mode: 'parked' });
  fleet.build();
  const slots = near.slots.slice();
  camera.position.set(0, 0, 5);
  fleet.updateLod(camera);
  assert.equal(near.lod, 0);
  assert.equal(far.lod, 2);
  assert.equal(near.slots[0].inst.geometry.attributes.position, pack.body[0].attributes.position);
  assert.equal(far.slots[0].inst.geometry.attributes.position, pack.body[2].attributes.position);
  assert.equal(near.slots[0].inst.castShadow, true);
  assert.equal(far.slots[0].inst.castShadow, false);
  assert.deepEqual(fleet.lodStats.vehicles, [1, 0, 1]);
  assert.equal(fleet.meshes.reduce((n, m) => n + m.inst.count, 0), near.slots.length + far.slots.length);
  const triangles = (slot) => (slot.inst.geometry.index?.count ?? slot.inst.geometry.attributes.position.count) / 3;
  assert.ok(triangles(far.slots[0]) < triangles(near.slots[0]) / 4, 'distant body submits much less geometry');

  camera.position.set(0, 0, 995);
  fleet.updateLod(camera);
  assert.deepEqual(near.slots, slots, 'logical parts are not replaced');
  for (const v of [near, far]) for (const slot of v.slots) {
    const actualPaint = slot.inst.geometry.attributes.aPaint.array.subarray(slot.i * 3, slot.i * 3 + 3);
    actualPaint.forEach((n, i) => assert.ok(Math.abs(n - slot.paint[i]) < 1e-6));
    assert.ok(equalMatrix(renderedMatrix(slot), slot.matrix), 'moving matrix and paint occupy the same compact slot');
  }
  fleet.hide(far);
  fleet.updateLod(camera);
  assert.equal(fleet.lodStats.submitted, near.slots.length, 'hidden car has no submitted zero-scale instances');
  assert.ok(far.slots.every((s) => s.inst === null && s.i === -1));
  fleet.dispose();
});

test('fleet LOD hysteresis survives camera jitter and orbit rotation, with adaptive far detail', () => {
  const { fleet, camera } = setup({ shadows: false });
  const v = fleet.add({ kit: kit(), x: 0, z: 0, yaw: 0, mode: 'parked' });
  fleet.build();
  moveCamera(camera, v, 0.071);
  fleet.updateLod(camera);
  assert.equal(v.lod, 0);
  moveCamera(camera, v, 0.061);
  fleet.updateLod(camera);
  assert.equal(v.lod, 0, 'small move across the threshold retains detail');
  moveCamera(camera, v, 0.05);
  fleet.updateLod(camera);
  assert.equal(v.lod, 1);
  moveCamera(camera, v, 0.067);
  fleet.updateLod(camera);
  assert.equal(v.lod, 1, 'returning slightly across the boundary does not toggle');
  moveCamera(camera, v, 0.075);
  fleet.updateLod(camera);
  assert.equal(v.lod, 0);

  const orbit = new THREE.Vector3(25, 0, 0);
  camera.position.set(25, 20, 60);
  fleet.updateLod(camera, orbit);
  const level = v.lod;
  camera.position.set(85, 20, 0);
  fleet.updateLod(camera, orbit);
  assert.equal(v.lod, level, 'rotating the diorama does not swap near/far vehicle detail');
  moveCamera(camera, v, 0.09);
  fleet.updateLod(camera);
  assert.equal(v.lod, 0);
  fleet.updateLod(camera, null, 0.45);
  assert.equal(v.lod, 0, 'adaptive budget preserves close vehicle detail');
  moveCamera(camera, v, 0.012);
  fleet.updateLod(camera);
  assert.equal(v.lod, 1);
  fleet.updateLod(camera, null, 0.45);
  assert.equal(v.lod, 2, 'budget lowers distant geometry without affecting vehicle simulation');
  fleet.dispose();
});

test('traffic keeps moving and animating at low LOD, and bounds follow its current position', () => {
  const { fleet, camera } = setup();
  const v = fleet.add({ kit: kit('#7b5236', true), type: 'cart', x: 0, z: 0, yaw: 0, mode: 'traffic', line: { w: 6, pts: [{ x: 0, z: 0 }, { x: 0, z: 100 }] }, s: 10, dir: 1 });
  fleet.build();
  camera.position.set(0, 0, -1000);
  fleet.updateLod(camera);
  assert.equal(v.lod, 2);
  const oldZ = v.car.z, oldDistance = v.dist;
  const wheel = v.slots.find((s) => s.wheel), horse = v.slots.find((s) => s.horse);
  const oldWheel = wheel.matrix.clone();
  fleet.update(1 / 30, []);
  fleet.updateLod(camera);
  assert.ok(v.car.z > oldZ && v.dist > oldDistance, 'traffic is not frozen at a distance');
  assert.equal(v.lod, 2);
  assert.ok(!equalMatrix(oldWheel, wheel.matrix), 'wheel rolls at low LOD');
  assert.ok(horse.matrix.elements[13] > 0, 'horse trot is preserved');
  assert.ok(equalMatrix(renderedMatrix(wheel), wheel.matrix));

  v.car.x = 1500;
  fleet.write(v);
  fleet.flush();
  for (const slot of v.slots) {
    assert.equal(slot.inst.frustumCulled, true);
    const sphere = slot.inst.geometry.boundingSphere.clone().applyMatrix4(slot.matrix);
    assert.ok(slot.inst.boundingSphere.center.distanceTo(sphere.center) + sphere.radius <= slot.inst.boundingSphere.radius + 1e-4, 'updated bound contains the moving part');
  }
  fleet.dispose();
});

test('taking and parking a distant vehicle preserves identity and immediately restores player detail', () => {
  const { fleet, camera } = setup();
  const v = fleet.add({ kit: kit(), x: 1200, z: 0, yaw: 0, mode: 'parked' });
  fleet.build();
  fleet.updateLod(camera, null, 0.45);
  const originalSlots = v.slots.slice(), id = v.id, originalKit = v.kit;
  assert.equal(v.lod, 2);
  const car = new Car(VEHICLE_TYPES.sedan, { x: 1200, z: 0 });
  car.vz = 10;
  car.steer = 0.2;
  fleet.drive(v, car);
  assert.equal(v.lod, 0);
  assert.equal(v.slots[0].inst.castShadow, true);
  fleet.update(1 / 60, []);
  fleet.updateLod(camera, null, 0.45);
  assert.equal(v.lod, 0);
  assert.ok(v.dist > 0);
  assert.equal(v.steerVis, -0.2);
  assert.equal(v.car, car);
  assert.equal(v.id, id);
  assert.equal(v.kit, originalKit);
  assert.deepEqual(v.slots, originalSlots);
  assert.equal(fleet.nearest(car.x, car.z), null, 'player car is not offered as another vehicle');
  fleet.park(v, car);
  fleet.updateLod(camera, null, 0.45);
  assert.equal(fleet.nearest(car.x, car.z), v);
  assert.equal(v.lod, 2);
  fleet.dispose();
});

test('single-LOD packs reuse one batch and disposal releases fleet wrappers without disposing pack buffers', () => {
  const { fleet, camera, pack, scene } = setup({ shadows: false, singleLevel: true });
  const v = fleet.add({ kit: kit(), x: 0, z: 0, yaw: 0, mode: 'parked' });
  let packDisposed = 0, wrappersDisposed = 0, instancesDisposed = 0;
  for (const lods of Object.values(pack)) lods[2].addEventListener('dispose', () => packDisposed++);
  fleet.build();
  assert.equal(fleet.meshes.length, 6, 'body, wheel and roof each resolve to one mesh per shadow band');
  for (const { inst } of fleet.meshes) {
    inst.geometry.addEventListener('dispose', () => wrappersDisposed++);
    inst.addEventListener('dispose', () => instancesDisposed++);
  }
  moveCamera(camera, v, 0.1);
  fleet.updateLod(camera);
  const body = v.slots[0].inst;
  moveCamera(camera, v, 0.001);
  fleet.updateLod(camera);
  assert.equal(v.slots[0].inst, body, 'fallback levels do not duplicate the same geometry');
  fleet.dispose();
  assert.equal(scene.children.length, 0);
  assert.equal(packDisposed, 0);
  assert.equal(wrappersDisposed, 6);
  assert.equal(instancesDisposed, 6);
});

test('live quality presets restore fleet shadows and shadow adaptation is independent of geometry', () => {
  const { fleet, camera, builder } = setup({ shadows: false });
  const v = fleet.add({ kit: kit(), x: 0, z: 0, yaw: 0, mode: 'parked' });
  fleet.build();
  camera.position.set(0, 0, 70);
  fleet.updateLod(camera);
  assert.equal(v.castsShadow, false);
  assert.ok(fleet.meshes.every(({ inst }) => !inst.receiveShadow));
  builder.quality.settings.shadows = true;
  fleet.updateLod(camera);
  assert.equal(v.castsShadow, true, 'low to high restores shadow casting');
  assert.ok(fleet.meshes.every(({ inst }) => inst.receiveShadow));
  const fullLevel = v.lod;
  fleet.updateLod(camera, null, 0.45, 1);
  assert.equal(v.castsShadow, true, 'geometry reduction alone does not lower shadow relevance');
  fleet.updateLod(camera, null, 1, 0.4);
  assert.equal(v.lod, fullLevel);
  assert.equal(v.castsShadow, false, 'shadow budget independently reduces distant casting');
  builder.quality.settings.shadows = false;
  fleet.updateLod(camera);
  assert.ok(fleet.meshes.every(({ inst }) => !inst.receiveShadow));
  fleet.dispose();
});

test('deferred fleet updates compact once after LOD classification while standalone updates stay immediate', () => {
  const { fleet, camera } = setup();
  const v = fleet.add({ kit: kit(), x: 0, z: 0, yaw: 0, mode: 'traffic', line: { w: 6, pts: [{ x: 0, z: 0 }, { x: 0, z: 100 }] }, s: 10, dir: 1 });
  fleet.build();
  camera.position.set(0, 0, 10);
  fleet.updateLod(camera);
  const slot = v.slots[0];
  const before = slot.inst.instanceMatrix.version;
  fleet.update(1 / 60, [], { deferFlush: true });
  assert.equal(slot.inst.instanceMatrix.version, before, 'simulation writes logical matrices without an intermediate upload');
  fleet.updateLod(camera);
  assert.equal(slot.inst.instanceMatrix.version, before + 1, 'final classification marks one upload');
  assert.ok(equalMatrix(renderedMatrix(slot), slot.matrix));
  fleet.update(1 / 60, []);
  assert.equal(slot.inst.instanceMatrix.version, before + 2, 'standalone update retains immediate render semantics');
  fleet.dispose();
});
