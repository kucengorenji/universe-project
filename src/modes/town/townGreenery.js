import { mulberry32 } from '../../map/mapGenerator.js';
import { seedFor } from '../../world/identity.js';
import { describeBuilding, buildingApproach } from '../../world/buildingBlueprint.js';
import { inConvex } from './wards.js';
import { riverDistance } from './townPlan.js';

export function segmentDistance(x,z,a,b) {
  const dx=b[0]-a[0],dz=b[1]-a[1],d=dx*dx+dz*dz;
  const t=d?Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/d)):0;
  const point=[a[0]+dx*t,a[1]+dz*t];
  return {distance:Math.hypot(x-point[0],z-point[1]),point};
}
export function pathClearance(paths,x,z) {
  let distance=Infinity;
  for(const path of paths)for(let i=1;i<path.pts.length;i++)distance=Math.min(distance,segmentDistance(x,z,path.pts[i-1],path.pts[i]).distance-path.w/2);
  return distance;
}
function nearestStreet(L,x,z) {
  let best=null;
  for(const street of L.streets)for(let i=1;i<street.pts.length;i++){
    const hit=segmentDistance(x,z,street.pts[i-1],street.pts[i]);
    if(!best||hit.distance<best.distance)best={...hit,street};
  }
  return best;
}

// Public space is planned before dressing. Paths remain gameplay data at every
// quality level; only the renderer may reduce grass, leaves or distant props.
export function planTownGreenery(L,K) {
  const rng=mulberry32(seedFor(L.seed,'public-gardens-v1'));
  L.paths=[];
  const dry=(x,z)=>K.at(x,z).land>.76&&riverDistance(L,x,z)>3;
  const vegetated=!['lava','barren'].includes(L.planetType);
  const species=L.planetType==='desert'?['t_acacia','t_palm']:L.planetType==='ice'?['t_pine','t_spruce']:['t_oak','t_birch','t_fruit','t_cypress'];
  for(const park of L.parks||[]) {
    park.id=`park:${seedFor(L.seed,park.x,park.z)}`;
    const access=nearestStreet(L,park.x,park.z);
    if(!access||!dry(park.x,park.z)||!park.poly.every(p=>dry(p.x,p.z)))continue;
    const clearLine=(a,b)=>{
      const count=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/2);
      for(let i=0;i<=count;i++){
        const t=i/Math.max(1,count),x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;
        if(!dry(x,z)||!K.free({x,z,hw:.85,hd:.85,yaw:0},0))return false;
      }
      return true;
    };
    const centre=[park.x,park.z];
    if(!clearLine(centre,access.point))continue;
    park.access=access.point;
    L.paths.push({id:`${park.id}:entry`,pts:[access.point,centre],w:L.modern?2.5:1.8,kind:'garden'});
    // Inset polygon makes a loop with open glades rather than random tree fill.
    const loop=park.poly.map(p=>[park.x+(p.x-park.x)*.57,park.z+(p.z-park.z)*.57]);
    loop.push(loop[0]);
    if(loop.every((p,i)=>!i||clearLine(loop[i-1],p))&&clearLine(centre,loop[0])) {
      L.paths.push({id:`${park.id}:loop`,pts:loop,w:1.7,kind:'garden'});
      L.paths.push({id:`${park.id}:cross`,pts:[centre,loop[0]],w:1.7,kind:'garden'});
    }
    const xs=park.poly.map(p=>p.x),zs=park.poly.map(p=>p.z);
    const x0=Math.min(...xs),x1=Math.max(...xs),z0=Math.min(...zs),z1=Math.max(...zs);
    const area=(x1-x0)*(z1-z0),target=vegetated?Math.min(32,Math.max(5,Math.round(area/95))):0;
    // Reserve furniture before planting, so trunks cannot consume its space.
    for(const [asset,w,d]of [['m_bench',2.2,.8],['g_planter',1.6,1.6],['g_pergola',4.4,4]]){
      if(!vegetated&&asset!=='m_bench')continue;
      for(let i=0;i<18;i++){
        const a=i*2.399,r=4+(i%3)*3,x=park.x+Math.cos(a)*r,z=park.z+Math.sin(a)*r;
        if(!inConvex(park.poly,x,z,Math.max(w,d)/2+1)||pathClearance(L.paths,x,z)<Math.hypot(w,d)/2+.4)continue;
        if(K.place(L.props,asset,x,z,a-Math.PI/2,w,d,{variant:0,tint:1}))break;
      }
    }
    const trees=[];
    for(let attempt=0;attempt<target*20&&trees.length<target;attempt++) {
      const x=x0+rng()*(x1-x0),z=z0+rng()*(z1-z0);
      if(!inConvex(park.poly,x,z,2)||!dry(x,z)||pathClearance(L.paths,x,z)<2.1||trees.some(t=>Math.hypot(t.x-x,t.z-z)<3.5))continue;
      const asset=species[Math.floor(rng()*species.length)],w=2.2+rng()*1.8;
      if(K.place(L.trees,asset,x,z,rng()*Math.PI*2,w,w,{collide:false,pad:.1,variant:Math.floor(rng()*2),tint:1,habitat:'park'})){
        trees.push({x,z});L.colliders.push({type:'circle',x,z,r:.55});
        if(L.planetType==='terran'&&rng()<.6)K.place(L.trees,'b_flowers',x+1.7,z+.7,0,1.1,1.1,{collide:false,pad:0,variant:0,tint:1});
      }
    }
  }

  // Frontage paths connect shops/houses to an existing street. Reject paths
  // across another parcel; keep a doorway clear before adding planters.
  for(const b of L.buildings) {
    const shell=describeBuilding(b);if(!shell)continue;
    const p=shell.entrance.world,fx=-Math.sin(b.yaw),fz=Math.cos(b.yaw);
    const approach=buildingApproach(b,K.footprints?.[b.asset],1.1);
    const start=[approach.x,approach.z],hit=nearestStreet(L,...start);
    if(!hit||hit.distance>18||hit.distance<1.2||(hit.point[0]-p.x)*fx+(hit.point[1]-p.z)*fz<0)continue;
    const blocked=L.buildings.some(o=>o!==b&&Array.from({length:7},(_,i)=>i/6).some(t=>{
      const x=start[0]+(hit.point[0]-start[0])*t,z=start[1]+(hit.point[1]-start[1])*t;
      const c=Math.cos(o.yaw),s=Math.sin(o.yaw),dx=x-o.x,dz=z-o.z;
      return Math.abs(dx*c+dz*s)<o.w/2+.7&&Math.abs(-dx*s+dz*c)<o.d/2+.7;
    }));
    const trunkBlocked=L.trees.some(t=>/^(t_|tree_)/.test(t.asset)&&segmentDistance(t.x,t.z,start,hit.point).distance<1.2);
    if(blocked||trunkBlocked||![0,.25,.5,.75,1].every(t=>dry(start[0]+(hit.point[0]-start[0])*t,start[1]+(hit.point[1]-start[1])*t)))continue;
    L.paths.push({id:`${b.id}:frontage`,pts:[start,hit.point],w:1.4,kind:'frontage'});
    if(vegetated&&/shop|tavern/.test(b.asset))for(const sign of [-1,1]){
      const x=start[0]+Math.cos(b.yaw)*sign*2.3,z=start[1]+Math.sin(b.yaw)*sign*2.3;
      if(K.streetClear(x,z,12)>1&&pathClearance(L.paths,x,z)>.9)K.place(L.props,'g_planter',x,z,b.yaw,1.6,1.6,{variant:0,tint:1});
    }
  }

  // Pocket gardens soften residential lots and shop backs without filling
  // their entrances, road verges, farm parcels or park circulation.
  for(const b of vegetated?L.buildings.filter(b=>/house|cottage|shop|tavern/.test(b.asset)):[]){
    const ca=Math.cos(b.yaw),sa=Math.sin(b.yaw);
    for(let i=0;i<3;i++){
      if(rng()>.65)continue;
      const u=(rng()-.5)*b.w,v=-b.d/2-4-rng()*3;
      const x=b.x+u*ca-v*sa,z=b.z+u*sa+v*ca;
      if(!dry(x,z)||K.streetClear(x,z,15)<2.2||pathClearance(L.paths,x,z)<2)continue;
      const tree=i===0,asset=tree?species[Math.floor(rng()*species.length)]:i===1?'b_bush':'b_flowers';
      const w=tree?2.4+rng()*1.1:1.2;
      if(K.place(L.trees,asset,x,z,rng()*Math.PI*2,w,w,{collide:false,pad:.3,variant:Math.floor(rng()*2),tint:1,habitat:'garden'})&&tree)L.colliders.push({type:'circle',x,z,r:.5});
    }
  }
}
