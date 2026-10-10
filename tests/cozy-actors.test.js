import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { soldierTemplate } from '../src/skirmish/units/vcSoldiers.js';
import { makeTownPerson, installTownWalk, animateTownPerson, disposeTownPerson } from '../src/modes/town/people/skirmishPeople.js';
import { RECIPES } from '../src/modes/town/vehicles/vehicleKit.js';

const parse = async name => {
  const bytes = readFileSync(new URL(`../public/models/${name}.glb`, import.meta.url));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), '');
};

test('all vehicle recipes retain three LODs, wheel pivots, sockets and tintable bodies', async () => {
  const gltf = await parse('town');
  for (const recipe of Object.values(RECIPES)) {
    const root = gltf.scene.getObjectByName(recipe.body);
    assert.equal(root.userData.cozyVehicleRevision, 2, recipe.body);
    assert.ok(root.userData.smoothCrease > 0);
    for (const lod of [0, 1, 2]) {
      const body = root.getObjectByName(`${recipe.body}_LOD${lod}`);
      assert.ok(body, `${recipe.body} LOD${lod}`);
      const wheel = gltf.scene.getObjectByName(`${recipe.wheel}_LOD${lod}`);
      assert.ok(wheel);
      const box = new THREE.Box3().setFromObject(wheel);
      assert.ok(Math.abs(box.min.x + box.max.x) < .15, 'wheel remains centred on axle');
      let radius = 0;
      wheel.traverse(o => {
        if (!o.isMesh) return;
        const p = o.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) radius = Math.max(radius, Math.hypot(p.getY(i), p.getZ(i)));
      });
      assert.ok(radius >= .99 && radius < 1.01, 'wheel unit radius is preserved');
      for (const accessory of recipe.acc) for (const name of accessory.pick) assert.ok(gltf.scene.getObjectByName(name), name);
    }
  }
});

test('town reuses both skirmish bodies with valid civilian pieces and stable locomotion/rest poses', async () => {
  const pack = {};
  for (const sex of ['m', 'f']) {
    pack[sex] = soldierTemplate(await parse(`soldier_v5_${sex}`), new THREE.Texture(), new THREE.Texture());
    const originalJog = pack[sex].clips.find(clip => clip.name === 'walk');
    const motion = await parse(`town_walk_${sex}`);
    assert.equal(motion.animations.length, 1);
    assert.equal(motion.animations[0].name, 'town_walk');
    installTownWalk(pack[sex], motion.animations, sex);
    assert.notEqual(pack[sex].clips.find(clip => clip.name === 'walk'), originalJog, 'town uses the real walk rather than the combat jog');
    assert.ok(pack[sex].clipSpeed.walk >= .9 && pack[sex].clipSpeed.walk <= 1.1);
  }
  let sexes = new Set();
  for (let seed = 1; seed < 9; seed++) {
    const p = makeTownPerson(pack, { seed, shadows: false });
    sexes.add(p.bodyScale);
    assert.equal(p.gun, null, 'civilian has no weapon');
    const pieceUv = p.mesh.geometry.attributes.uv1;
    const pieces = p.mesh.userData.pieces;
    for (let i = 0; i < p.mesh.geometry.index.count; i += 3) {
      const piece = pieces[Math.floor(1 - pieceUv.getY(p.mesh.geometry.index.getX(i)))];
      assert.ok(!piece.startsWith('kit_') && !piece.startsWith('helm_'), 'civilian excludes military kit');
    }
    assert.ok(p.actions.idle && p.actions.walk && p.actions.run);
    for (const [speed, options] of [[0, {}], [1.4, {}], [4.6, {}], [2, { jump: .6 }], [0, { pose: 'sit' }], [0, { pose: 'sleep' }], [1.4, {}]]) {
      for (let frame = 0; frame < 120; frame++) animateTownPerson(p, 1 / 60, speed, options);
      p.root.updateMatrixWorld(true);
      if (options.pose === 'sit') assert.ok(p.bones.hip_L.node.quaternion.angleTo(p.bones.hip_L.rest) > 1.3, 'sitting bends the thigh');
      if (options.pose === 'sleep') assert.ok(p.bones.hips.node.quaternion.angleTo(p.bones.hips.rest) > 1.4, 'sleeping lies horizontally');
      for (const { node } of Object.values(p.bones)) assert.ok(node.matrixWorld.elements.every(Number.isFinite));
      const weight = ['idle', 'walk', 'run'].reduce((sum, name) => sum + p.actions[name].getEffectiveWeight(), 0);
      assert.ok(Math.abs(weight - 1) < 1e-6, 'locomotion remains normalized');
      assert.ok(Math.abs(p.actions.walk.time / p.actions.walk.getClip().duration - p.actions.run.time / p.actions.run.getClip().duration) < 1e-6, 'walk/run share a stride phase');
      for (let i = 0; i < p.mesh.geometry.attributes.position.count; i += 503) assert.ok(p.mesh.getVertexPosition(i, new THREE.Vector3()).toArray().every(Number.isFinite));
    }
    disposeTownPerson(p);
  }
  assert.equal(sexes.size, 2, 'male and female skirmish models are both reused');
});
