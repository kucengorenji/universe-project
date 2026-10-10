import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Interior } from '../src/modes/town/interior/interior.js';

// three keeps a light's shadow map (a 2048² texture for the interior key light) alive until the light is
// disposed. Leaving a room without that left one texture on the GPU per visit (soak: Space 31→32→33).
test('leaving an interior releases the shadow map of every light in its scene', () => {
  const scene = new THREE.Scene();
  const key = new THREE.DirectionalLight(0xffffff, 1);
  key.castShadow = true;
  const fill = new THREE.DirectionalLight(0xffffff, 0.4);
  const hemi = new THREE.HemisphereLight();
  const target = new THREE.WebGLRenderTarget(4, 4);
  let released = 0;
  target.addEventListener('dispose', () => { released++; });
  key.shadow.map = target; // what the renderer attaches on the first shadowed frame
  scene.add(key, key.target, fill, fill.target, hemi, new THREE.Mesh());
  const disposed = [];
  const owned = { dispose: () => disposed.push('owned') };

  Interior.prototype.dispose.call({ disposables: [owned], scene, resident: null });

  assert.equal(released, 1, 'the key light shadow map is disposed');
  assert.deepEqual(disposed, ['owned'], 'the interior still disposes what it owns');
});
