import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { disposePerson } from '../src/modes/town/personLifecycle.js';

test('disposing a person frees bone textures while preserving shared outfit and face resources',()=>{
 const geometry=new THREE.BoxGeometry(),material=new THREE.MeshBasicMaterial();
 const scene=new THREE.Scene();
 const person=()=>{
  const root=new THREE.Group(),bone=new THREE.Bone(),mesh=new THREE.SkinnedMesh(geometry,material);
  root.add(bone,mesh);mesh.bind(new THREE.Skeleton([bone]));mesh.skeleton.computeBoneTexture();scene.add(root);
  return {root,mixer:new THREE.AnimationMixer(root),personalMaterial:new THREE.MeshBasicMaterial(),mesh};
 };
 const first=person(),second=person();
 let boneFreed=0,otherBoneFreed=0,sharedFreed=0,privateFreed=0;
 first.mesh.skeleton.boneTexture.addEventListener('dispose',()=>boneFreed++);
 second.mesh.skeleton.boneTexture.addEventListener('dispose',()=>otherBoneFreed++);
 geometry.addEventListener('dispose',()=>sharedFreed++);material.addEventListener('dispose',()=>sharedFreed++);
 first.personalMaterial.addEventListener('dispose',()=>privateFreed++);
 disposePerson(first);disposePerson(first);
 assert.equal(boneFreed,1);assert.equal(privateFreed,1);assert.equal(otherBoneFreed,0);assert.equal(sharedFreed,0);
 assert.deepEqual(scene.children,[second.root]);
 disposePerson(second);geometry.dispose();material.dispose();
});
