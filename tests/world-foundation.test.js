import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldClock } from '../src/world/worldClock.js';
import { WorldStateStore } from '../src/world/stateStore.js';
import { seedFor, buildingId } from '../src/world/identity.js';
import { containsField, dryFootprint } from '../src/world/landUsePlan.js';
import { assignInteractionIds, captureInterior, restoreInterior } from '../src/world/interiorState.js';
import { Vector3 } from 'three';

test('pause freezes time; resume excludes paused duration and sleep persists', () => {
  let time = 100, saved;
  const clock = new WorldClock({ epoch: 0, time: () => time, save: n => saved = n });
  clock.pause(true); time = 145; clock.pause(true);
  assert.equal(clock.now(), 100);
  clock.pause(false); assert.equal(clock.now(), 100);
  clock.skip(3600); assert.equal(clock.now(), 3700);
  const restored = new WorldClock({ epoch: 0, time: () => 155, offset: saved });
  assert.equal(restored.now(), 3710);
  assert.throws(() => clock.skip(Infinity), RangeError);
});

test('journal survives reload and isolates worlds without IndexedDB', async () => {
  const data = new Map();
  const storage = { getItem: k => data.get(k), setItem: (k,v) => data.set(k,v) };
  const opts = { storage, indexedDB: null };
  const a = new WorldStateStore('a', opts);
  await a.set('room', { light: true, item: [1,2,3] });
  const copy = a.get('room'); copy.item[0] = 900;
  assert.equal(a.get('room').item[0], 1);
  const reloaded = new WorldStateStore('a', opts);
  await reloaded.ready;
  assert.deepEqual(reloaded.get('room'), { light: true, item: [1,2,3] });
  assert.equal(new WorldStateStore('b', opts).get('room'), null);
});

test('write failure remains visible while in-memory interactions still work', async () => {
  const s = new WorldStateStore('broken', { indexedDB: null, storage: { getItem: () => '{}', setItem: () => { throw Error('quota'); } } });
  await s.set('room', { light: true });
  assert.match(s.error.message, /quota/);
  assert.equal(s.get('room').light, true);
});

test('building identity is independent of order and decor random stream', () => {
  const b = { asset: 'house', x: 12, z: -30, yaw: 0.7 };
  assert.equal(buildingId(42,b), buildingId(42,{ ...b, tint: 0.2 }));
  assert.notEqual(buildingId(42,b), buildingId(43,b));
  assert.notEqual(seedFor(42,'trees'), seedFor(42,'buildings'));
});

test('rotated fields exclude trees by actual footprint; water through middle rejects land use', () => {
  const f = { x: 0,z: 0,w: 40,d: 4,yaw: Math.PI/4 };
  assert.equal(containsField(f,10,10),true);
  assert.equal(containsField(f,10,-10),false);
  assert.equal(dryFootprint({ x:0,z:0,hw:9,hd:9 }, () => ({land:1}), (x) => Math.abs(x)-1),false);
  assert.equal(dryFootprint({ x:0,z:0,hw:9,hd:9 }, () => ({land:1}), () => 20),true);
});

test('room state restores light, cabinet and loose item after rebuilding', () => {
  const make = () => {
    const interactables = [ { kind:'light',x:0,z:0,on:false }, { kind:'door',x:1,z:0,target:0 }, { kind:'item',asset:'cup',x:2,z:0,mesh:{position:new Vector3(2,1,0)} } ];
    assignInteractionIds(interactables);
    return { interactables, setLamp: (it,on) => it.on=on };
  };
  const a=make(); a.interactables[0].on=true; a.interactables[1].target=1;
  a.interactables[2].mesh.position.set(3,1,4); a.interactables[2].x=3; a.interactables[2].z=4;
  const b=make(); restoreInterior(b,captureInterior(a));
  assert.equal(b.interactables[0].on,true);
  assert.equal(b.interactables[1].open,1);
  assert.deepEqual(b.interactables[2].mesh.position.toArray(),[3,1,4]);
  assert.equal(b.interactables[2].id,a.interactables[2].id);
});

test('hills require mountain context and their inland street grade stays gentle', async () => {
 const {describeRelief,townSurfaceHeight}=await import('../src/world/townRelief.js');
 assert.equal(describeRelief([{x:0,z:0,biome:'plains'}],200,42).enabled,false);
 const relief={enabled:true,amplitude:14,axis:.6,wavelength:260};
 assert.equal(townSurfaceHeight(relief,50,50,.7),1.1);
 for(let x=-300;x<300;x+=5)assert.ok(Math.abs(townSurfaceHeight(relief,x+1,0)-townSurfaceHeight(relief,x,0))<.03);
});
