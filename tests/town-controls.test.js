import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Car,VEHICLE_TYPES} from '../src/modes/town/vehicles/vehicle.js';
import {trafficPose,advanceTraffic} from '../src/modes/town/navigation/trafficRoute.js';
import {buildingApproach,townToLocal} from '../src/world/buildingBlueprint.js';
import {townGenerationVersion,TOWN_LAYOUT_VERSION} from '../src/world/townGeneration.js';
import {locomotionClips,animatePerson} from '../src/modes/town/people/peopleMotion.js';
import {streetJunctions} from '../src/modes/town/layout/streetJunctions.js';

test('organic road markings identify T junctions without counting parallel roads',()=>{
 const streets=[{w:12,pts:[[-20,0],[20,0]]},{w:8,pts:[[0,0],[0,20]]},{w:8,pts:[[-20,30],[20,30]]}];
 const junctions=streetJunctions(streets);
 assert.equal(junctions.length,1);assert.equal(junctions[0].legs.length,3);
 assert.deepEqual([junctions[0].x,junctions[0].z],[0,0]);
});

const flat={heightAt:()=>0,resolve:(x,z)=>({x,z}),blocked:()=>false};
function run(car,seconds,input,hz=60,world=flat){for(let i=0;i<seconds*hz;i++)car.update(1/hz,input,world);return car;}
test('driving accelerates, brakes, reverses and remains stable at 30/60/120Hz',()=>{
 const results=[30,60,120].map(hz=>{
  const car=run(new Car(VEHICLE_TYPES.sedan),2,{forward:1,right:0},hz);
  assert.ok(car.speed>15&&car.speed<22,`responsive two-second acceleration ${car.speed}`);
  run(car,.6,{forward:-1,right:0},hz);assert.ok(car.forwardSpeed<5,'brakes first');
  run(car,2,{forward:-1,right:0},hz);assert.ok(car.forwardSpeed<-3,'then reverses');
  run(car,2,{forward:1,right:.5},hz);
  assert.ok(Number.isFinite(car.yaw)&&Math.abs(car.roll)<.16);
  return car;
 });
 for(const car of results.slice(1))assert.ok(Math.hypot(car.x-results[0].x,car.z-results[0].z)<.01);
 const wall={...flat,resolve:(x,z,r)=>({x,z:Math.min(z,10-r)})};
 const hit=run(new Car(VEHICLE_TYPES.sedan),3,{forward:1,right:0},60,wall);
 assert.ok(hit.z<10&&Math.abs(hit.yaw)<.001,'head-on contact does not add random yaw');
});

test('traffic lane offsets and road-end turns are continuous',()=>{
 const r={line:{pts:[{x:0,z:0},{x:0,z:20},{x:8,z:40}]},lens:[0,20,20+Math.hypot(8,20)],total:20+Math.hypot(8,20),s:19.99,dir:1,lane:2};
 const before=trafficPose(r);r.s=20.01;const after=trafficPose(r);
 assert.ok(Math.hypot(after.x-before.x,after.z-before.z)<.05,'no corner lane teleport');
 r.s=r.total-.01;let previous=trafficPose(r),turned=false;
 for(let i=0;i<250;i++){
  advanceTraffic(r,2/60,1/60);const pose=trafficPose(r);
  assert.ok(Math.hypot(pose.x-previous.x,pose.z-previous.z)<.05,'no U-turn lane teleport');
  previous=pose;if(r.dir===-1)turned=true;
 }
 assert.ok(turned);
});

test('door approaches clear measured porches and saved rooms pin their original parcel version',()=>{
 const b={asset:'f_house',x:17,z:-5,yaw:1.1,w:8,d:8,sx:1.2,sz:1.1};
 const p=buildingApproach(b,{maxZ:5.1});
 assert.ok(townToLocal(b,p).z>5.1*1.1+.8);
 const records=new Map([['interior:2:town:99:building:old',{cabinet:true}]]);
 const state={records,get:k=>records.get(k),set:(k,v)=>records.set(k,v)};
 assert.equal(townGenerationVersion(state,2,99),1);
 assert.equal(townGenerationVersion(state,2,100),TOWN_LAYOUT_VERSION);
 // A town remembered at v2 keeps it while it has rooms, and moves up when it has none
 records.set('town-layout:2:101',{version:2});records.set('interior:2:town:101:building:x',{});
 assert.equal(townGenerationVersion(state,2,101),2);
 records.set('town-layout:2:102',{version:2});
 assert.equal(townGenerationVersion(state,2,102),TOWN_LAYOUT_VERSION);
 assert.equal(records.get('town-layout:2:102').version,TOWN_LAYOUT_VERSION);
 assert.deepEqual(records.get('interior:2:town:99:building:old'),{cabinet:true});
 assert.equal(townGenerationVersion(state,2,99),1);
});

test('authored walk/run clips retain moving bones and a shared contact phase',async()=>{
 const bytes=readFileSync(new URL('../tools/blender/legacy/character.glb',import.meta.url));
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),'');
 const source=gltf.animations.find(a=>a.name==='walk').tracks.map(t=>Array.from(t.values));
 const clips=locomotionClips(gltf),root=gltf.scene,mixer=new THREE.AnimationMixer(root),actions={};
 for(const clip of clips){actions[clip.name]=mixer.clipAction(clip).play();actions[clip.name].setEffectiveWeight(0);}
 const person={root,mixer,actions,gaitPhase:0,animSpeed:0};
 const leg=root.getObjectByName('thighL');
 assert.ok(leg,'fixture has a leg bone');
 animatePerson(person,.1,1.4);const first=leg.quaternion.clone();
 for(let i=0;i<20;i++)animatePerson(person,1/60,3.4);
 assert.ok(first.angleTo(leg.quaternion)>.03,'manual clip phase still animates the rig');
 assert.ok(Math.abs(actions.walk.time/actions.walk.getClip().duration-actions.run.time/actions.run.getClip().duration)<1e-6);
 assert.deepEqual(gltf.animations.find(a=>a.name==='walk').tracks.map(t=>Array.from(t.values)),source,'shared source clips stay untouched');
 for(let i=0;i<60;i++)animatePerson(person,1/60,0);
 assert.ok(actions.idle.getEffectiveWeight()>.99);
});
