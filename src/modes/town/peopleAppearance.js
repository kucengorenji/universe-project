import * as THREE from 'three';
import { seedFor } from '../../world/identity.js';
import { getToonGradient } from '../../render/assetLibrary.js';
const palettes={skin:[0xf1c9a5,0xd9a47a,0xa8714a,0x7a4c2e,0xf5d6bd],hair:[0x30221b,0x9b6238,0xd9b25c,0xa8502c,0xb8b8b4],top:[0x3f6fb0,0xc4513a,0xe9dcbf,0x477652,0x82619b,0x353e52],legs:[0x3b4e7a,0x5a4a3a,0x2f3440,0x69756d],shoes:[0x38291f,0x22252b,0xa28a6a]};
const bases={
 casual_m:[0xd9a47a,0x3b2a1e,0x3f6fb0,0x3b4e7a,0x3a2a1c],casual_f:[0xf1c9a5,0xd9b25c,0x9a4f8f,0xf1c9a5,0x5a3b22],
 worker:[0xa8714a,0x3b2a1e,0xf2f2ee,0x2f3240,0x3a2a1c],business:[0x7a4c2e,0x3b2a1e,0x2f3440,0x2f3440,0x2f2f33],
 elder:[0xf1c9a5,0xb8b8b4,0x8a6040,0x3b4e7a,0x3a2a1c],peasant:[0xd9a47a,0xa8502c,0x8a6a3e,0x5a3a24,0x3a2a1c],
 guard:[0xa8714a,0x3b2a1e,0x9aa3ad,0x2f3240,0x3a2a1c],townsfolk_f:[0x7a4c2e,0xa8502c,0x2f3f5f,0x7a4c2e,0x5a3b22]
};
export function appearanceFor(seed){return Object.fromEntries(Object.entries(palettes).map(([k,p])=>[k,p[seedFor(seed,k)%p.length]]));}
export function appearanceMaterial(outfit,seed){
 const base=bases[outfit];if(!base)return null;
 const chosen=appearanceFor(seed), keys=Object.keys(palettes);
 // Bare legs retain the selected skin. A suit remains one coherent fabric.
 const replacements=keys.map((key,i)=>new THREE.Color(chosen[keys[base.indexOf(base[i])]]));
 const mat=new THREE.MeshToonMaterial({vertexColors:true,gradientMap:getToonGradient()});
 mat.userData.setSeed = next => {
  const palette=appearanceFor(next);
  replacements.forEach((color,i)=>color.set(palette[keys[base.indexOf(base[i])]]));
 };
 mat.onBeforeCompile=shader=>{
  shader.uniforms.uOriginal={value:base.map(x=>new THREE.Color(x))};shader.uniforms.uAppearance={value:replacements};
  shader.fragmentShader='uniform vec3 uOriginal[5]; uniform vec3 uAppearance[5];\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
    for(int i=0;i<5;i++){if(distance(vColor.rgb,uOriginal[i])<0.015){diffuseColor.rgb=uAppearance[i];break;}}
  `);
 };
 mat.customProgramCacheKey=()=> 'people-palette-v1';
 return mat;
}

let faceTexture, faceMaterial;
const faceGeometries=new Map();
export function makeFace(seed){
 const skin=appearanceFor(seed).skin;
 if(!faceTexture){
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=320;
  const c=canvas.getContext('2d');
  for(let row=0;row<5;row++)for(let mood=0;mood<4;mood++){
   c.save();c.translate(mood*64,row*64);c.fillStyle='#'+palettes.skin[row].toString(16).padStart(6,'0');c.fillRect(0,0,64,64);
   c.strokeStyle='#302a27';c.lineWidth=3;c.lineCap='round';
   for(const x of [18,46]){c.beginPath();if(mood===3){c.moveTo(x-4,22);c.lineTo(x+4,22)}else{c.moveTo(x,20);c.lineTo(x,26)}c.stroke()}
   c.beginPath();c.moveTo(23,45);c.quadraticCurveTo(32,mood===1?56:mood===2?38:46,41,45);c.stroke();c.restore();
  }
  faceTexture=new THREE.CanvasTexture(canvas);faceTexture.colorSpace=THREE.SRGBColorSpace;
  faceMaterial=new THREE.MeshToonMaterial({map:faceTexture,gradientMap:getToonGradient()});
 }
 const mood=seedFor(seed,'expression')%3, row=palettes.skin.indexOf(skin),key=row*4+mood;
 if(!faceGeometries.has(key)){
  const geo=new THREE.PlaneGeometry(.18,.15),uv=geo.attributes.uv;
  for(let i=0;i<uv.count;i++)uv.setXY(i,(mood+.02+uv.getX(i)*.96)/4,1-(row+1)/5+(.02+uv.getY(i)*.96)/5);
  faceGeometries.set(key,geo);
 }
 const face=new THREE.Mesh(faceGeometries.get(key),faceMaterial);face.position.set(0,.18,.133);return face;
}
