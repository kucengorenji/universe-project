import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../map/mapGenerator.js';
import { seedFor } from '../../world/identity.js';
import { riverDistance } from './townPlan.js';

export function planStreetLights(L,K){
  const rng=mulberry32(seedFor(L.seed,'street-lighting-v2'));
  const lamps=L.props.filter(p=>/^[fm]_lamp$/.test(p.asset));
  for(const street of L.streets){
    if(street.kind==='road')continue;
    let carry=8+rng()*8, index=0;
    for(let i=1;i<street.pts.length;i++){
      const a=street.pts[i-1],b=street.pts[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);
      if(!len)continue;
      const dx=(b[0]-a[0])/len,dz=(b[1]-a[1])/len;
      for(;carry<len;carry+=L.modern?26:21,index++){
        for(const side of [index%2?1:-1,index%2?-1:1]){
          const off=street.w/2+.85,x=a[0]+dx*carry-dz*off*side,z=a[1]+dz*carry+dx*off*side;
          if(K.at(x,z).land<.8||riverDistance(L,x,z)<5||K.streetClear(x,z,12)<.2||lamps.some(p=>Math.hypot(x-p.x,z-p.z)<13))continue;
          if(!K.free({x,z,hw:.4,hd:.4,yaw:0},.1))continue;
          const lamp={asset:L.modern?'m_lamp':'f_lamp',x,z,yaw:Math.atan2(dz,dx)-Math.PI/2,w:.5,d:.5};
          L.props.push(lamp);lamps.push(lamp);K.claim({x,z,hw:.25,hd:.25,yaw:0});break;
        }
      }
      carry-=len;
    }
  }
}

/** One ground-glow draw + four nearby unshadowed lights, never one light per pole. */
export class StreetLighting{
  constructor(layout,heightAt){
    this.group=new THREE.Group();this.night=0;
    this.lamps=layout.props.filter(p=>/^[fm]_lamp$/.test(p.asset)).map(p=>({...p,y:heightAt(p.x,p.z),h:layout.modern?5.8:3.2}));
    const canvas=document.createElement('canvas');canvas.width=canvas.height=64;
    const ctx=canvas.getContext('2d'),gradient=ctx.createRadialGradient(32,32,0,32,32,32);
    gradient.addColorStop(0,'rgba(255,239,178,.7)');gradient.addColorStop(.3,'rgba(255,209,126,.36)');gradient.addColorStop(1,'rgba(255,181,72,0)');
    ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);
    this.texture=new THREE.CanvasTexture(canvas);this.texture.colorSpace=THREE.SRGBColorSpace;
    this.material=new THREE.MeshBasicMaterial({map:this.texture,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,opacity:0,polygonOffset:true,polygonOffsetFactor:-1});
    const pieces=[];
    for(const lamp of this.lamps){
      const radius=layout.modern?8:5.5,g=new THREE.PlaneGeometry(radius*2,radius*2,4,4);g.rotateX(-Math.PI/2);g.translate(lamp.x,0,lamp.z);
      const p=g.attributes.position;
      for(let i=0;i<p.count;i++)p.setY(i,heightAt(p.getX(i),p.getZ(i))+.055);
      pieces.push(g);
    }
    this.geometry=pieces.length?mergeGeometries(pieces):new THREE.BufferGeometry();pieces.forEach(g=>g.dispose());
    this.glow=new THREE.Mesh(this.geometry,this.material);this.glow.renderOrder=1;this.group.add(this.glow);
    this.lights=Array.from({length:4},()=>{const light=new THREE.PointLight(layout.modern?0xffd59a:0xffba66,0,18,2);this.group.add(light);return light;});
  }
  update(camera,night){
    this.material.opacity=night*.85;this.glow.visible=night>.01;
    const near=night>.01?this.lamps.map(p=>({p,d:(camera.position.x-p.x)**2+(camera.position.y-p.y-p.h)**2+(camera.position.z-p.z)**2})).filter(p=>p.d<10000).sort((a,b)=>a.d-b.d):[];
    this.lights.forEach((light,i)=>{const lamp=near[i]?.p;light.intensity=lamp?night*48:0;if(lamp)light.position.set(lamp.x,lamp.y+lamp.h,lamp.z);});
  }
  dispose(){this.geometry.dispose();this.material.dispose();this.texture.dispose();this.group.removeFromParent();}
}
