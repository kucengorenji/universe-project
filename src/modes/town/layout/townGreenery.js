import { mulberry32 } from '../../../math/random.js';
import { seedFor } from '../../../world/identity.js';
import { describeBuilding, buildingApproach } from '../../../world/buildingBlueprint.js';
import { inConvex } from './wards.js';
import { riverDistance } from './townPlan.js';
import { pavementWidth } from '../scale.js';

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

/**
 * v4 streetscape, after the reference dioramas: terraces in front of shops and taverns, a
 * fountain with benches and kiosks on a modern plaza, bus stops, hydrants and bins along
 * modern streets. Small props: walkers step round them, cars do not stop for them.
 */
function planStreetscape(L,K,dry){
  const rng=mulberry32(seedFor(L.seed,'streetscape-v4'));
  const put=(asset,x,z,yaw,w,d,collider)=>{
    if(!dry(x,z)||pathClearance(L.paths,x,z)<Math.max(w,d)/2+.2)return false;
    if(!K.place(L.props,asset,x,z,yaw,w,d,{collide:false,pad:.2,variant:0,tint:1}))return false;
    if(collider)L.colliders.push(collider);
    return true;
  };
  // Terraces: two tables in front of every shop and tavern, either side of the door
  for(const b of L.buildings){
    if(!/shop|tavern/.test(b.asset))continue;
    const fx=-Math.sin(b.yaw),fz=Math.cos(b.yaw),rx=Math.cos(b.yaw),rz=Math.sin(b.yaw);
    const front=(K.footprints?.[b.asset]?.maxZ??b.d/2)*(b.sz??1)+2.1;
    for(const u of [-1,1]){
      const k=u*Math.max(1.6,Math.min(b.w/2-1.2,3.4));
      const x=b.x+fx*front+rx*k,z=b.z+fz*front+rz*k;
      if(K.streetClear(x,z,8)<.9)continue;
      put(rng()<.5?'g_cafe_a':'g_cafe_b',x,z,b.yaw,2.3,2.3,{type:'circle',x,z,r:1});
    }
  }
  if(!L.modern)return;
  // Plaza: a fountain in the middle, benches facing it, kiosks at the edge
  const p=L.plaza;
  if(p){
    const poly=p.poly?.length>2?p.poly:null;
    const px=poly?poly.reduce((s,q)=>s+q[0],0)/poly.length:p.x,pz=poly?poly.reduce((s,q)=>s+q[1],0)/poly.length:p.z;
    const pr=poly?Math.min(...poly.map(q=>Math.hypot(q[0]-px,q[1]-pz))):p.r;
    if(pr>7&&!L.props.some(o=>Math.hypot(o.x-px,o.z-pz)<4)){
      L.props.push({asset:'g_fountain',x:px,z:pz,yaw:0,w:6.6,d:6.6,variant:0,tint:1});
      L.colliders.push({type:'circle',x:px,z:pz,r:3.4});
      for(let i=0;i<4;i++){
        const a=i*Math.PI/2+Math.PI/4,x=px+Math.cos(a)*5.6,z=pz+Math.sin(a)*5.6;
        L.props.push({asset:'m_bench',x,z,yaw:Math.atan2(-Math.cos(a),Math.sin(a))+Math.PI,w:2,d:.6,variant:0,tint:1});
      }
    }
    if(pr>10)for(const a of [rng()*Math.PI*2,rng()*Math.PI*2+Math.PI]){
      const x=px+Math.cos(a)*pr*.72,z=pz+Math.sin(a)*pr*.72;
      put('g_kiosk',x,z,Math.atan2(-Math.cos(a),Math.sin(a))+Math.PI,2.6,2,{type:'box',x,z,hw:1.3,hd:1,yaw:a+Math.PI/2});
    }
  }
  // Along the streets: bus stops on the busy ones, hydrants at the kerb, bins on the pavement
  const pav=pavementWidth(L);
  for(const s of L.streets){
    if(!['main','collector','residential','grid'].includes(s.kind))continue;
    const busy=s.kind==='main'||s.kind==='collector';
    let run=rng()*40,side=1;
    for(let i=0;i+1<s.pts.length;i++){
      const [ax,az]=s.pts[i],[bx,bz]=s.pts[i+1];
      const len=Math.hypot(bx-ax,bz-az);if(len<1e-3)continue;
      const tx=(bx-ax)/len,tz=(bz-az)/len,nx=-tz,nz=tx;
      for(let d=0;d<len;d+=6){
        run+=6;
        const cx=ax+tx*d,cz=az+tz*d;
        // Front of the prop (+Z local) faces the street
        const yawTo=(sx)=>Math.atan2(sx*nx,-sx*nz);
        if(busy&&run%130<6){
          const x=cx+nx*side*(s.w/2+pav*.62),z=cz+nz*side*(s.w/2+pav*.62);
          put('g_bus_stop',x,z,yawTo(side),3.4,1.6,{type:'box',x,z,hw:1.7,hd:.8,yaw:Math.atan2(tz,tx)});
          side=-side;
        }else if(run%66<6){
          const x=cx+nx*side*(s.w/2+.45),z=cz+nz*side*(s.w/2+.45);
          put('g_hydrant',x,z,yawTo(side),.5,.5,{type:'circle',x,z,r:.25});
        }else if(run%48<6){
          const x=cx-nx*side*(s.w/2+pav*.85),z=cz-nz*side*(s.w/2+pav*.85);
          put('g_bin',x,z,yawTo(-side),.6,.6,{type:'circle',x,z,r:.3});
        }
      }
    }
  }
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
    const area=(x1-x0)*(z1-z0),target=vegetated?(L.layoutVersion>=5?Math.min(12,Math.max(2,Math.round(area/190))):Math.min(32,Math.max(5,Math.round(area/95)))):0;
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

  // v4: every building reaches a street. Where the street is not straight ahead of the door,
  // the path leaves the door, then turns toward the nearest street, clear of the buildings.
  if(L.layoutVersion>=4){
    const linked=new Set(L.paths.filter(p=>p.kind==='frontage').map(p=>p.id));
    const inside=(o,x,z,m)=>{const c=Math.cos(o.yaw),s=Math.sin(o.yaw),dx=x-o.x,dz=z-o.z;return Math.abs(dx*c+dz*s)<o.w/2+m&&Math.abs(-dx*s+dz*c)<o.d/2+m;};
    const clear=(a,b)=>Array.from({length:11},(_,i)=>i/10).every(t=>{
      const x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;
      return dry(x,z)&&!L.buildings.some(o=>inside(o,x,z,.35));
    });
    for(const b of L.buildings){
      if(linked.has(`${b.id}:frontage`))continue;
      const fx=-Math.sin(b.yaw),fz=Math.cos(b.yaw);
      const approach=buildingApproach(b,K.footprints?.[b.asset],1.1)||{x:b.x+fx*(b.d/2+1.1),z:b.z+fz*(b.d/2+1.1)};
      const start=[approach.x,approach.z];
      const out=[start[0]+fx*2.5,start[1]+fz*2.5];
      const hit=nearestStreet(L,...out);
      if(!hit||hit.distance>45)continue;
      const pts=hit.distance<1.5?[start,hit.point]:[start,out,hit.point];
      if(!clear(pts[pts.length-2],pts[pts.length-1])||(pts.length>2&&!clear(start,out)))continue;
      L.paths.push({id:`${b.id}:frontage`,pts,w:1.4,kind:'frontage'});
    }
    // Lot aprons: paving (or a packed-earth yard) round every building, so none stands on bare grass
    L.aprons=L.buildings.map(b=>{
      const f=K.footprints?.[b.asset];
      const sx=b.sx??1,sz=b.sz??1,c=Math.cos(b.yaw),s=Math.sin(b.yaw);
      const cx=f&&Number.isFinite(f.minX)?(f.maxX+f.minX)/2*sx:0,cz=f&&Number.isFinite(f.minZ)?(f.maxZ+f.minZ)/2*sz:0;
      const hw=f&&Number.isFinite(f.minX)?(f.maxX-f.minX)/2*sx:b.w/2,hd=f&&Number.isFinite(f.minZ)?(f.maxZ-f.minZ)/2*sz:b.d/2;
      const farm=/barn|windmill/.test(b.asset),big=/office|apartment|tower|spire|shop|tavern|temple|castle/.test(b.asset);
      const pad=farm?1.8:L.modern?(big?2.2:1.3):(big?1.4:.9);
      return {x:b.x+c*cx-s*cz,z:b.z+s*cx+c*cz,yaw:b.yaw,hw:hw+pad,hd:hd+pad,kind:farm?'yard':big?'plaza':'lot'};
    });
    planStreetscape(L,K,dry);
  }

  // Pocket gardens soften residential lots and shop backs without filling
  // their entrances, road verges, farm parcels or park circulation.
  for(const b of vegetated?L.buildings.filter(b=>/house|cottage|shop|tavern/.test(b.asset)):[]){
    const ca=Math.cos(b.yaw),sa=Math.sin(b.yaw);
    for(let i=0;i<3;i++){
      if(rng()>(L.layoutVersion>=5&&i===0 ? .325 : .65))continue;
      const u=(rng()-.5)*b.w,v=-b.d/2-4-rng()*3;
      const x=b.x+u*ca-v*sa,z=b.z+u*sa+v*ca;
      if(!dry(x,z)||K.streetClear(x,z,15)<2.2||pathClearance(L.paths,x,z)<2)continue;
      const tree=i===0,asset=tree?species[Math.floor(rng()*species.length)]:i===1?'b_bush':'b_flowers';
      const w=tree?2.4+rng()*1.1:1.2;
      if(K.place(L.trees,asset,x,z,rng()*Math.PI*2,w,w,{collide:false,pad:.3,variant:Math.floor(rng()*2),tint:1,habitat:'garden'})&&tree)L.colliders.push({type:'circle',x,z,r:.5});
    }
  }
}
