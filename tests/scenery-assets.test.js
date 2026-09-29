import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

test('textured scenery stays within budget and contains complete indexed LODs',()=>{
 const bytes=readFileSync(new URL('../public/models/scenery.glb',import.meta.url));
 assert.ok(bytes.length<1400*1024,`pack ${bytes.length} bytes`);
 const doc=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
 const manifest=JSON.parse(readFileSync(new URL('../public/models/scenery.manifest.json',import.meta.url)));
 assert.equal(manifest.bytes,bytes.length);
 assert.equal(manifest.sha256,createHash('sha256').update(bytes).digest('hex'));
 assert.equal(Object.keys(manifest.assets).length,20);
 assert.equal(doc.images.length,2);assert.equal(doc.materials.length,2);
 assert.ok(doc.materials.some(m=>m.alphaMode==='MASK'&&m.alphaCutoff===.45));
 const tri=node=>{
  let n=0;if(node.mesh!==undefined)for(const p of doc.meshes[node.mesh].primitives){
   assert.ok(p.attributes.NORMAL!==undefined);assert.ok(p.attributes.TEXCOORD_0!==undefined);assert.ok(p.indices!==undefined);
   n+=doc.accessors[p.indices].count/3;
  }
  return n+(node.children||[]).reduce((s,i)=>s+tri(doc.nodes[i]),0);
 };
 for(const name of ['t_oak','t_birch','t_pine','t_spruce','t_cypress','t_palm','t_acacia','t_fruit','f_dock','m_dock']){
  const counts=[0,1,2].map(l=>{const n=doc.nodes.find(n=>n.name===`${name}_LOD${l}`);assert.ok(n);return tri(n)});
  assert.ok(counts[0]>counts[1]&&counts[1]>counts[2],`${name} ${counts}`);
 }
 for(const name of ['b_bush','b_flowers','m_bench','g_planter','g_pergola','g_crate']){
  const counts=[0,1,2].map(l=>{const n=doc.nodes.find(n=>n.name===`${name}_LOD${l}`);assert.ok(n);return tri(n)});
  assert.ok(counts[0]>=counts[1]&&counts[1]>=counts[2]);
 }
 for(const asset of Object.values(manifest.assets))if(asset.family==='tree'){
  const near=asset.lods[0].bounds,far=asset.lods[2].bounds;
  const height=(far.max[1]-far.min[1])/(near.max[1]-near.min[1]);
  assert.ok(height>.85&&height<1.2,'far trees retain their near silhouette height');
  for(const axis of [0,2]){
   const span=(far.max[axis]-far.min[axis])/(near.max[axis]-near.min[axis]);
   assert.ok(span>.55&&span<1.3,'far canopy cannot collapse to a small ball');
  }
 }
});
