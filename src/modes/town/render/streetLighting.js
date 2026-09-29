import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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
