import { mulberry32 } from '../../../math/random.js';
import { seedFor } from '../../../world/identity.js';
import { riverDistance } from './townPlan.js';

// Lamp posts along lanes and streets: pure layout data, no three.js.
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
