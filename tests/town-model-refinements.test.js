import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applySurfaceCoordinates, surfaceForMaterial } from '../src/render/townSurfaces.js';
import { refineTownModel } from '../src/modes/town/render/modelRefinements.js';

const bytes = readFileSync(new URL('../public/models/town.glb', import.meta.url));
const authoredPack = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), '');

// Decode actual authored material semantics, as assetLibrary does, for the
// selected models. The test has no DOM, texture loader or procedural stand-in.
function authoredGeometry(name) {
  const holder = authoredPack.scene.getObjectByName(name);
  const root = holder.children.find(node => /_LOD0$/.test(node.name));
  root.updateMatrixWorld(true);
  const toLocal = root.matrixWorld.clone().invert(), parts = [];
  root.traverse(node => {
    if (!node.isMesh) return;
    let geometry = node.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toLocal, node.matrixWorld));
    if (geometry.index) geometry = geometry.toNonIndexed();
    for (const key of Object.keys(geometry.attributes)) if (key !== 'position') geometry.deleteAttribute(key);
    const count = geometry.attributes.position.count, material = node.material.name;
    const roof = /^M_roof_/.test(material) ? /_dark$/.test(material) ? 2 : 1 : 0;
    geometry.setAttribute('roof', new THREE.BufferAttribute(new Float32Array(count).fill(roof), 1));
    geometry.setAttribute('emissive', new THREE.BufferAttribute(new Float32Array(count).fill(/glass/.test(material) ? 0.7 : 0), 1));
    geometry.setAttribute('paint', new THREE.BufferAttribute(new Float32Array(count), 1));
    const colours = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) node.material.color.toArray(colours, i * 3);
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    applySurfaceCoordinates(geometry, surfaceForMaterial(material));
    parts.push(geometry);
  });
  const geometry = mergeGeometries(parts, false);
  geometry.computeVertexNormals(); geometry.computeBoundingBox();
  geometry.userData = { ...holder.userData };
  for (const part of parts) part.dispose();
  return geometry;
}

const selected = ['f_house_small_v0', 'f_house_small_v1', 'f_house_small_v2',
  'f_house_v0', 'f_house_v1', 'f_house_v2', 'f_house_tall_v0', 'f_house_tall_v1',
  'm_house_v0', 'm_house_v1', 'm_house_v2'];

test('authored town models keep new revisions intact and refine only legacy roof faces', () => {
  for (const name of selected) {
    const original = authoredGeometry(name);
    const refined = refineTownModel(name, original, 0);
    if (original.userData.townAssetRevision) {
      assert.equal(refined, original, `${name}: replacement details are already authored`);
      original.dispose();
      continue;
    }
    assert.notEqual(refined, original, `${name}: actual roof faces found`);
    const metadata = refined.userData.townRefinement;
    assert.ok(metadata.addedTriangles > 0);
    assert.ok(metadata.addedTriangles <= metadata.sourceTriangles * 0.15, `${name}: triangle growth`);
    assert.equal(metadata.kind, name.startsWith('m_') ? 'solar-cell-dividers' : 'rounded-ridge-tiles');
    refined.computeBoundingBox();
    assert.ok(original.boundingBox.equals(refined.boundingBox), `${name}: physical footprint and height bounds`);
    for (const key of Object.keys(original.attributes)) {
      const before = original.attributes[key], after = refined.attributes[key];
      assert.deepEqual(after.array.subarray(0, before.array.length), before.array,
        `${name}: existing ${key}, including door/window vertices, remains exact`);
      assert.equal(after.count, refined.attributes.position.count, `${name}: ${key} covers all vertices`);
      assert.notEqual(after.array, before.array, `${name}: cached pack buffers stay independent`);
    }
    assert.equal(refineTownModel(name, original, 1), original);
    assert.equal(refineTownModel(name, original, 2), original);
    assert.equal(refineTownModel(name, refined, 0), refined, 'already refined geometry stays stable');
    original.dispose(); refined.dispose();
  }
});

function legacyPanelGeometry() {
  const body = new THREE.BoxGeometry(4, 8, 4, 4, 4, 4).toNonIndexed().translate(0, 4, 0);
  const panel = new THREE.PlaneGeometry(2, 1.6).toNonIndexed().rotateX(-Math.PI / 2 + 0.25).translate(0, 8.3, 0);
  for (const [geometry, glass] of [[body, false], [panel, true]]) {
    const count = geometry.attributes.position.count;
    geometry.deleteAttribute('uv');
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(.5), 3));
    for (const name of ['roof', 'paint', 'emissive']) geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(count).fill(name === 'emissive' && glass ? .7 : 0), 1));
    applySurfaceCoordinates(geometry, glass ? 0 : 10);
  }
  const geometry = mergeGeometries([body, panel], false);
  geometry.computeBoundingBox();
  body.dispose(); panel.dispose();
  return geometry;
}

test('new modern panel fingers are metal and do not inherit window emission or vehicle paint', () => {
  const original = legacyPanelGeometry();
  const refined = refineTownModel('m_house_v0', original, 0);
  assert.notEqual(refined, original, 'legacy panel is refined');
  for (let i = original.attributes.position.count; i < refined.attributes.position.count; i++) {
    assert.equal(refined.attributes.surface.getZ(i), 7);
    assert.equal(refined.attributes.emissive.getX(i), 0);
    assert.equal(refined.attributes.paint.getX(i), 0);
    assert.equal(refined.attributes.roof.getX(i), 0);
    assert.ok(refined.attributes.position.getY(i) > 6, 'dividers stay on the authored roof panels');
  }
  original.dispose(); refined.dispose();
});

test('unselected models and meshes without authored ridge or panel faces remain unchanged', () => {
  const original = authoredGeometry('f_house_v0');
  assert.equal(refineTownModel('f_temple', original, 0), original);
  const plain = new THREE.BoxGeometry(4, 4, 4).toNonIndexed();
  assert.equal(refineTownModel('f_house_v0', plain, 0), plain);
  original.dispose(); plain.dispose();
});
