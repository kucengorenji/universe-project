import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry } from 'three';
import { surfaceForMaterial, applySurfaceCoordinates } from '../src/render/townSurfaces.js';

test('shared surface atlas keeps architectural materials separate from gameplay colours',()=>{
 for(const name of ['M_glass','M_lamp','M_paint','M_skin','M_screen'])assert.equal(surfaceForMaterial(name),0);
 assert.equal(surfaceForMaterial('M_plaster_cream'),1);
 assert.equal(surfaceForMaterial('M_brick_red'),2);
 assert.equal(surfaceForMaterial('M_wood_dark'),3);
 assert.equal(surfaceForMaterial('M_roof_slate'),6);
 const box=new BoxGeometry(4,6,8),positions=Array.from(box.attributes.position.array);
 applySurfaceCoordinates(box,4);
 assert.deepEqual(Array.from(box.attributes.position.array),positions,'projection never alters model or collider bounds');
 const uv=box.attributes.surface;
 assert.equal(uv.count,box.attributes.position.count);
 for(let i=0;i<uv.count;i++){assert.equal(uv.getZ(i),4);assert.ok(Number.isFinite(uv.getX(i))&&Number.isFinite(uv.getY(i)));}
 assert.ok(new Set(Array.from(uv.array).filter((_,i)=>i%3!==2)).size>2,'all box faces have nondegenerate planar coordinates');
 box.dispose();
});
