import * as THREE from 'three';
import {streetJunctions} from './streetJunctions.js';

/** Metre-scale road decals, one draw, sharp from a driver's camera. */
export function roadMarkings(layout,heightAt,minY) {
  const positions=[],colors=[],indices=[],junctions=streetJunctions(layout.streets);
  const white=new THREE.Color('#e7e4d6'),yellow=new THREE.Color('#dcc05f');
  const quad=(a,b,width,color)=>{
    const dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(len<1e-5)return;
    const nx=-dz/len*width/2,nz=dx/len*width/2;
    const points=[[a[0]-nx,a[1]-nz],[a[0]+nx,a[1]+nz],[b[0]-nx,b[1]-nz],[b[0]+nx,b[1]+nz]];
    if(layout.plaza&&points.some(p=>Math.hypot(p[0]-layout.plaza.x,p[1]-layout.plaza.z)<layout.plaza.r+.5))return;
    const heights=points.map(p=>heightAt(...p));if(heights.some(y=>y<minY))return;
    const start=positions.length/3;
    points.forEach((p,i)=>{positions.push(p[0],heights[i]+.045,p[1]);colors.push(color.r,color.g,color.b);});
    indices.push(start,start+1,start+2,start+1,start+3,start+2);
  };
  for(const street of layout.streets){
    if(street.kind==='road'||street.w<7)continue;
    let distance=0;
    for(let i=1;i<street.pts.length;i++){
      const a=street.pts[i-1],b=street.pts[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);
      if(!len)continue;
      const nx=-dz/len,nz=dx/len,main=street.kind==='main';
      for(let s=0;s<len;){
        // Split at the dash boundary as well as at terrain sample intervals.
        const phase=(distance+s)%7,step=Math.min(1,len-s,phase<3?3-phase:7-phase);
        const end=s+Math.max(.001,step),mid=(s+end)/2,x=a[0]+dx*mid/len,z=a[1]+dz*mid/len;
        if((main||phase<3)&&!junctions.some(p=>Math.hypot(p.x-x,p.z-z)<p.r+.5)){
          for(const off of main?[-.22,.22]:[0])quad(
            [a[0]+dx*s/len+nx*off,a[1]+dz*s/len+nz*off],
            [a[0]+dx*end/len+nx*off,a[1]+dz*end/len+nz*off],main?.12:.16,main?yellow:white);
        }
        s=end;
      }
      distance+=len;
    }
  }
  for(const p of junctions)for(const leg of p.legs){
    if(leg.w<8)continue;
    const x=p.x+leg.fx*(p.r+2.5),z=p.z+leg.fz*(p.r+2.5);
    for(let side=-leg.w/2+.8;side<leg.w/2-.6;side+=1.2){
      const a=[x-leg.fz*side-leg.fx*1.2,z+leg.fx*side-leg.fz*1.2];
      quad(a,[a[0]+leg.fx*2.4,a[1]+leg.fz*2.4],.5,white);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();
  const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,polygonOffset:true,polygonOffsetFactor:-1});
  const mesh=new THREE.Mesh(geometry,material);mesh.name='road-markings';mesh.receiveShadow=true;mesh.renderOrder=1;
  return {mesh,dispose(){geometry.dispose();material.dispose();mesh.removeFromParent();}};
}
