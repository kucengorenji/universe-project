import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/core/engine.js';

function engine() {
  const updates=[];
  return {nextDraw:0,lastDraw:-Infinity,last:0,time:0,frameHooks:[],updates,
    quality:{beginGpu(){},endGpu(){},sample(){}},
    mode:{update(dt){updates.push(dt);},render(){}},
  };
}

test('60 FPS scheduler preserves its budget on 60–144 Hz displays',()=>{
  for(const hz of [60,75,90,120,144]){
    const e=engine();
    for(let frame=0;frame<hz*3;frame++)Engine.prototype.frame.call(e,frame*1000/hz);
    assert.ok(Math.abs(e.updates.length-180)<=1,`${hz} Hz produced ${e.updates.length/3} FPS`);
    assert.ok(e.updates.every(dt=>dt<=.1));
  }
});

test('a stalled frame does not trigger a burst of catch-up renders',()=>{
  const e=engine();Engine.prototype.frame.call(e,100);Engine.prototype.frame.call(e,600);
  assert.equal(e.updates.at(-1),.1);
  const count=e.updates.length;
  for(const ts of [601,602,605,610])Engine.prototype.frame.call(e,ts);
  assert.equal(e.updates.length,count);
  Engine.prototype.frame.call(e,617);assert.equal(e.updates.length,count+1);
});
