// Inspect actual exported GLBs rather than trusting Blender source statistics.
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Matrix4,Vector3,Quaternion,Box3} from 'three';
const base=new URL('../',import.meta.url);
const file=new URL('exports/staging/b1/environment_b1_v001.glb',base);
const bytes=readFileSync(file),length=bytes.readUInt32LE(12);
const d=JSON.parse(bytes.subarray(20,20+length));
const local=n=>n.matrix?new Matrix4().fromArray(n.matrix):new Matrix4().compose(new Vector3().fromArray(n.translation||[0,0,0]),new Quaternion().fromArray(n.rotation||[0,0,0,1]),new Vector3().fromArray(n.scale||[1,1,1]));
const errors=[];
function measure(index,parent=new Matrix4()){
 const n=d.nodes[index],matrix=parent.clone().multiply(local(n));
 const box=new Box3(),mats=new Set();let triangles=0,primitives=0;
 for(const p of n.mesh===undefined?[]:d.meshes[n.mesh].primitives){
  for(const attribute of ['POSITION','NORMAL','TEXCOORD_0'])if(p.attributes[attribute]===undefined)errors.push(`${n.name}: missing ${attribute}`);
  const pos=d.accessors[p.attributes.POSITION];box.union(new Box3(new Vector3().fromArray(pos.min),new Vector3().fromArray(pos.max)).applyMatrix4(matrix));
  triangles+=(p.indices!==undefined?d.accessors[p.indices].count:pos.count)/3;primitives++;mats.add(d.materials[p.material].name);
 }
 for(const child of n.children||[]){const r=measure(child,matrix);box.union(r.box);triangles+=r.triangles;primitives+=r.primitives;r.mats.forEach(m=>mats.add(m))}
 return{box,triangles,primitives,mats};
}
const authored=JSON.parse(readFileSync(new URL('qa/reports/b1-authoring.json',base)));
const assets={};
for(let i=0;i<d.nodes.length;i++){
 const match=/^(.*)_LOD([012])$/.exec(d.nodes[i].name||'');if(!match)continue;
 const [,id,level]=match,r=measure(i),expected=authored.variants[id]?.lods[level];
 if(!expected)errors.push(`Unknown LOD ${id}/${level}`);
 else if(r.triangles>expected.ceiling)errors.push(`${id}/${level}: ${r.triangles} triangles > ${expected.ceiling}`);
 const round=v=>v.toArray().map(x=>+x.toFixed(4));
 (assets[id]||={assetId:authored.variants[id]?.assetId,units:'metres',up:'+Y',front:'+Z',lods:{}}).lods[level]={triangles:r.triangles,primitives:r.primitives,bounds:{min:round(r.box.min),max:round(r.box.max)},materials:[...r.mats]};
}
for(const[id,a]of Object.entries(assets))if(Object.keys(a.lods).length!==3)errors.push(`${id}: expected 3 LODs`);
if(Object.keys(assets).length!==25)errors.push('Expected 25 variants');
const materials=d.materials.map(m=>({name:m.name,...m.pbrMetallicRoughness}));
for(const m of materials)if(m.baseColorTexture&&!m.baseColorFactor)errors.push(`${m.name}: textured palette multiplier lost`);
const images=d.images.map(im=>({name:im.name,mimeType:im.mimeType,embedded:im.bufferView!==undefined,bytes:im.bufferView===undefined?null:d.bufferViews[im.bufferView].byteLength}));
if(images.some(im=>!im.embedded))errors.push('GLB image references an external file');
const report={version:1,checkedAt:new Date().toISOString(),file:'exports/staging/b1/environment_b1_v001.glb',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),variantCount:Object.keys(assets).length,meshCount:d.meshes.length,assets,materials,images,checks:{attributes:true,lodCount:true,triangleBudget:!errors.some(e=>e.includes('triangles')),tintFactors:!errors.some(e=>e.includes('multiplier')),glbHeaderLength:bytes.readUInt32LE(8)===bytes.length},errors,status:errors.length?'failed':'structural-pass; visual and runtime integration gates separate'};
writeFileSync(new URL('qa/reports/b1-export.json',base),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({variants:report.variantCount,meshes:report.meshCount,bytes:report.bytes,embeddedImages:images.length,errors},null,2));
if(errors.length)process.exitCode=1;
