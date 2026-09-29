import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Box3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describeBuilding,localToTown,townToLocal } from '../src/world/buildingBlueprint.js';
import { generateInteriorLayout,unreachableTargets,overlaps,measureFurnitureBounds } from '../src/modes/town/interior/interiorLayout.js';
const fixtures=[['f_house_small','cottage'],['f_house','house'],['f_house_tall','house'],['f_townhouse','house'],['f_shop','shop'],['f_tavern','tavern'],['m_house','house'],['m_shop','shop'],['m_apartment','apartment'],['m_office','office']];
test('authored door sockets preserve placement through scaling and rotation',()=>{
 for(const [asset]of fixtures){
  const building={asset,id:'b',x:23,z:-65,yaw:1.23,sx:.87,sz:1.12,variant:1};
  const b=describeBuilding(building),local=townToLocal(building,b.entrance.world);
  assert.ok(Math.abs(local.x-b.entrance.x)<1e-8&&Math.abs(local.z-b.entrance.z)<1e-8);
  const round=localToTown(building,local);assert.ok(Math.hypot(round.x-b.entrance.world.x,round.z-b.entrance.world.z)<1e-8);
  assert.ok(b.interior.w<=b.footprint.w&&b.interior.d<=b.footprint.d);
 }
 assert.equal(describeBuilding({asset:'m_house',id:'b',x:0,z:0,yaw:0}).entrance.x,-5);
});
test('shipped furniture meshes fit the shell and leave all interactions reachable',async()=>{
 const bytes=readFileSync(new URL('../public/models/furniture.glb',import.meta.url));
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),'');
 gltf.scene.updateMatrixWorld(true);
 const pack={};
 for(const holder of gltf.scene.children){
  const root=holder.children.find(n=>n.name.endsWith('_LOD0'));
  const toLocal=root.matrixWorld.clone().invert(),box=new Box3();
  root.traverse(node=>{if(node.isMesh){const geo=node.geometry.clone().applyMatrix4(toLocal.clone().multiply(node.matrixWorld));geo.computeBoundingBox();box.union(geo.boundingBox);geo.dispose();}});
  pack[holder.name]={0:{boundingBox:box}};
 }
 const bounds=measureFurnitureBounds(pack);
 for(const [asset,kind]of fixtures)for(let seed=0;seed<12;seed++){
  const building={asset,id:'b',x:0,z:0,yaw:0,sx:.78+(seed%4)*.146,sz:.8+Math.floor(seed/4)*.19,variant:seed%2};
  for(const floor of new Set([0,describeBuilding(building).floors-1])){
   const p=generateInteriorLayout({building,kind,seed,floor,bounds});
   assert.deepEqual(unreachableTargets(p),[],`${asset}:${seed}:${floor} mesh access`);
   assert.ok(p.furniture.some(f=>f.kind==='light'),`${asset}:${seed}:${floor} mesh lamp`);
   if((floor>0&&kind!=='office')||kind==='cottage')assert.ok(p.furniture.some(f=>f.kind==='bed'),`${asset}:${seed}:${floor} mesh bed`);
   for(const item of p.furniture){
    assert.ok(Math.abs(item.box.x)+item.box.hw<p.W/2&&Math.abs(item.box.z)+item.box.hd<p.D/2);
   }
  }
 }
});
test('floor plans preserve envelopes, access and item identity across regeneration',()=>{
 for(const [asset,kind]of fixtures)for(let seed=0;seed<10;seed++){
  const building={asset,id:'b',x:0,z:0,yaw:0,sx:.78+(seed%4)*.146,sz:.8+Math.floor(seed/4)*.19,variant:seed%2};
  const levels=describeBuilding(building).floors;
  for(const floor of new Set([0,levels-1])){
   const p=generateInteriorLayout({building,kind,seed,floor});
   assert.deepEqual(p,generateInteriorLayout({building,kind,seed,floor}));
   assert.deepEqual(unreachableTargets(p),[],`${asset}:${seed}:${floor} access`);
   assert.ok(p.furniture.some(f=>f.kind==='light'),`${asset}:${seed}:${floor} lamp`);
   if((floor>0&&kind!=='office')||kind==='cottage')assert.ok(p.furniture.some(f=>f.kind==='bed'),`${asset}:${seed}:${floor} bed`);
   for(let i=0;i<p.furniture.length;i++){
    const a=p.furniture[i].box;assert.ok(Math.abs(a.x)+a.hw<=p.W/2&&Math.abs(a.z)+a.hd<=p.D/2);
    for(let j=i+1;j<p.furniture.length;j++)assert.equal(overlaps(a,p.furniture[j].box),false);
   }
   assert.equal(p.stairs.length,(floor>0?1:0)+(floor+1<levels?1:0));
  }
 }
});
