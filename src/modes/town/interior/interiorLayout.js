import { seedFor } from '../../../world/identity.js';
import { describeBuilding } from '../../../world/buildingBlueprint.js';

const DEFAULT_BOUNDS={
 fu_coffee_table:[1.0,.6],fu_bed:[1.6,2.2],fu_sofa:[2.05,.95],fu_armchair:[.95,.9],fu_chair:[.5,.55],fu_table:[1.65,1.05],
 fu_desk:[1.65,.8],fu_counter:[2.2,.8],fu_wardrobe:[1.3,.65],fu_fridge:[.7,.75],fu_bookshelf:[1.3,.45],
 fu_lamp_floor:[.5,.5],fu_tv:[1.8,.55],fu_fireplace:[1.6,.65],fu_stove:[.7,.7],fu_plant:[.75,.75]
};
// Union the authored variants so changing colours or details cannot block an aisle.
export function measureFurnitureBounds(pack) {
 const bounds={};
 for(const [key,lods] of Object.entries(pack)) {
  const geo=lods[0]||lods[1];if(!geo)continue;
  if(!geo.boundingBox)geo.computeBoundingBox();
  const b=geo.boundingBox,name=key.replace(/_v\d+$/,''),old=bounds[name];
  bounds[name]={minX:Math.min(old?.minX??Infinity,b.min.x),maxX:Math.max(old?.maxX??-Infinity,b.max.x),minZ:Math.min(old?.minZ??Infinity,b.min.z),maxZ:Math.max(old?.maxZ??-Infinity,b.max.z)};
 }
 return bounds;
}
export function overlaps(a,b,pad=0){return Math.abs(a.x-b.x)<a.hw+b.hw+pad && Math.abs(a.z-b.z)<a.hd+b.hd+pad;}
const rotate=(x,z,yaw)=>({x:x*Math.cos(yaw)+z*Math.sin(yaw),z:-x*Math.sin(yaw)+z*Math.cos(yaw)});
export function furnitureFootprint(asset,x,z,yaw,bounds={}){
 const fallback=DEFAULT_BOUNDS[asset]||[1,1];
 const b=bounds[asset]||{minX:-fallback[0]/2,maxX:fallback[0]/2,minZ:-fallback[1]/2,maxZ:fallback[1]/2};
 const center=rotate((b.minX+b.maxX)/2,(b.minZ+b.maxZ)/2,yaw);
 const c=Math.abs(Math.cos(yaw)),s=Math.abs(Math.sin(yaw));
 return {x:x+center.x,z:z+center.z,hw:(b.maxX-b.minX)*c/2+(b.maxZ-b.minZ)*s/2,hd:(b.maxX-b.minX)*s/2+(b.maxZ-b.minZ)*c/2};
}

// Pure floor blueprint, generated independently per floor and independent of
// graphics settings. Circulation and stair landings are reserved before props.
export function generateInteriorLayout({building,kind,seed,floor=0,bounds={}}){
 const envelope=describeBuilding(building);
 if(!envelope)throw Error(`Unknown enterable shell: ${building.asset}`);
 if(!Number.isInteger(floor)||floor<0||floor>=envelope.floors)throw RangeError('Invalid floor');
 const W=envelope.interior.w,D=envelope.interior.d;
 const doorX=Math.max(-W/2+.75,Math.min(W/2-.75,envelope.interior.doorX));
 const hall={x:W<5.3?.28:0,z:0,hw:W<5.3?.5:.7,hd:D/2};
 const entry={x:0,z:D/2-.65,hw:W/2,hd:.65};
 const stair=envelope.floors>1?{x:W/2-1.35,z:-D/2+1.75,hw:1.35,hd:1.75}:null;
 const reserved=[hall,...(floor===0?[entry]:[]),...(stair?[stair]:[])];
 const split=(seedFor(seed,floor,'partition')%3-1)*Math.min(.55,D*.07);
 const partitions=D>6.4&&W>5.2?[{x:-W/4-.4,z:split,hw:W/4-.4,hd:.08},...(!stair?[{x:W/4+.4,z:split,hw:W/4-.4,hd:.08}]:[])]:[];
 const role=kind==='office'?'office':floor>0?'bedroom':kind==='shop'?'shop':kind==='tavern'?'tavern':'living';
 const plan={version:2,buildingId:building.id,floor,floors:envelope.floors,W,D,doorX,
  spawn:{x:floor?W/2-2.1:doorX,z:floor?-D/2+2.85:D/2-.75,yaw:Math.PI},
  rooms:[{id:`floor:${floor}:front`,use:role,z0:split,z1:D/2},{id:`floor:${floor}:back`,use:floor?'sleep':'service',z0:-D/2,z1:split}],
  partitions,reserved,furniture:[],stairs:[],envelope};
 if(stair){
  if(floor+1<envelope.floors)plan.stairs.push({id:`floor:${floor}:up`,x:W/2-2.1,z:-D/2+2.85,target:floor+1});
  if(floor>0)plan.stairs.push({id:`floor:${floor}:down`,x:W/2-2.1,z:-D/2+1.0,target:floor-1});
 }
 const occupied=[...partitions],approaches=[];
 // flush: backed against the wall (hearths, cupboards, cookers), never pulled into the room.
 // decor: nothing to use (plants), so no approach point; it still must not cut anything off.
 const add=(asset,kind,id,{flush=false,decor=false}={})=>{
  const candidates=[];
  for(const yaw of [0,Math.PI,Math.PI/2,-Math.PI/2]){
   const footprint=furnitureFootprint(asset,0,0,yaw,bounds),side=Math.abs(Math.sin(yaw))>.5;
   for(let i=0;i<=8;i++)for(const inset of flush?[0]:[0,.3,.7]){
    const t=-1+i/4;
    const cx=side?(yaw>0?-1:1)*(W/2-footprint.hw-.18-inset):t*(W/2-footprint.hw-.18);
    const cz=side?t*(D/2-footprint.hd-.18):(yaw===0?-1:1)*(D/2-footprint.hd-.18-inset);
    candidates.push({x:cx-footprint.x,z:cz-footprint.z,yaw});
   }
  }
  const order=candidates.map((p,i)=>({...p,sort:seedFor(seed,floor,id,i)})).sort((a,b)=>a.sort-b.sort);
  for(const p of order){const node=place(asset,kind,id,p,decor);if(node)return node;}
  return null;
 };
 const place=(asset,kind,id,p,decor=false)=>{
  const box=furnitureFootprint(asset,p.x,p.z,p.yaw,bounds);
  if(Math.abs(box.x)+box.hw>W/2-.12||Math.abs(box.z)+box.hd>D/2-.12)return null;
  if([...reserved,...occupied,...approaches].some(r=>overlaps(box,r,.08)))return null;
  const raw=bounds[asset],dim=DEFAULT_BOUNDS[asset]||[1,1];
  const fronts=decor?[null]:kind==='bed'?
   [rotate((raw?.maxX??dim[0]/2)+.48,0,p.yaw),rotate((raw?.minX??-dim[0]/2)-.48,0,p.yaw)]:
   [rotate(0,(raw?.maxZ??dim[1]/2)+.48,p.yaw)];
  for(const front of fronts){
   const approach=front&&{x:p.x+front.x,z:p.z+front.z,hw:.36,hd:.36};
   if(approach&&(Math.abs(approach.x)+.32>W/2-.02||Math.abs(approach.z)+.32>D/2-.02||occupied.some(r=>overlaps(approach,r,.04))))continue;
   const node={id:`floor:${floor}:${id}`,asset,kind,x:p.x,z:p.z,yaw:p.yaw,box,approach,variant:seedFor(seed,floor,id,'style')%2};
   plan.furniture.push(node);
   if(unreachableTargets(plan).length){plan.furniture.pop();continue;}
   occupied.push(box);if(approach)approaches.push(approach);return node;
  }
  return null;
 };
 // Against the same wall right next to an anchor piece (a kitchen run), else anywhere flush
 const beside=(anchor,asset,kind,id)=>{
  if(anchor){
   const yaw=anchor.yaw,fp=furnitureFootprint(asset,0,0,yaw,bounds),side=Math.abs(Math.sin(yaw))>.5;
   for(const s of [1,-1]){
    const p=side?
     {x:(yaw>0?-1:1)*(W/2-fp.hw-.18)-fp.x,z:anchor.box.z+s*(anchor.box.hd+fp.hd+.03)-fp.z,yaw}:
     {x:anchor.box.x+s*(anchor.box.hw+fp.hw+.03)-fp.x,z:(yaw===0?-1:1)*(D/2-fp.hd-.18)-fp.z,yaw};
    const node=place(asset,kind,id,p);
    if(node)return node;
   }
  }
  return add(asset,kind,id,{flush:true});
 };
 const bedroom=(floor>0&&kind!=='office')||kind==='cottage';
 const compact=W*D<48;
 if(bedroom)add('fu_bed','bed','bed');
 add('fu_lamp_floor','light','lamp');
 if(role==='shop'){add('fu_counter','surface','counter');add('fu_bookshelf','prop','shelf');}
 else if(kind==='office'){add('fu_desk','surface','desk');add('fu_chair','seat','chair');}
 else {add(compact?'fu_chair':bedroom?'fu_armchair':'fu_sofa','seat','seat');add(compact?'fu_coffee_table':'fu_table','surface','table');}
 add('fu_wardrobe','cabinet','cabinet');
 if(!plan.furniture.some(f=>f.kind==='surface'))add('fu_coffee_table','surface','small-table');
 if(floor===0&&!compact)add('fu_counter','surface','kitchen');
 // Dressing, appended last so the pieces above (and saved interaction ids) never move
 const modern=building.asset.startsWith('m_');
 const flush={flush:true};
 const kitchen=plan.furniture.find(f=>f.id.endsWith(':kitchen'));
 if(kitchen){const stove=beside(kitchen,'fu_stove','prop','stove');if(modern)beside(stove||kitchen,'fu_fridge','fridge','fridge');}
 if(role==='living'||role==='tavern')add(modern?'fu_tv':'fu_fireplace',modern?'media':'fire','hearth',flush);
 if(role!=='shop')add('fu_bookshelf','prop','bookcase',flush);
 if(role==='office')for(let i=2;i<=Math.min(6,Math.floor(W*D/60));i++)add('fu_desk','surface',`desk-${i}`);
 add('fu_plant','prop','plant',{decor:true});
 if(!compact)add('fu_plant','prop','plant-2',{decor:true});
 if(W*D>110){add('fu_armchair','seat','armchair-2');add('fu_plant','prop','plant-3',{decor:true});add('fu_plant','prop','plant-4',{decor:true});}
 return plan;
}

export function unreachableTargets(plan){
 const step=.22,radius=.32,W=plan.W,D=plan.D;
 const nx=Math.ceil(W/step),nz=Math.ceil(D/step);
 const boxes=[...plan.partitions,...plan.furniture.map(f=>f.box)];
 // The stair tread footprint is on the outer side of the reserved stairwell.
 if(plan.floors>1)boxes.push({x:W/2-.65,z:-D/2+1.45,hw:.55,hd:1.3});
 const point=(i,j)=>({x:-W/2+(i+.5)*W/nx,z:-D/2+(j+.5)*D/nz});
 const free=(p)=>Math.abs(p.x)<W/2-radius&&Math.abs(p.z)<D/2-radius&&!boxes.some(b=>Math.abs(p.x-b.x)<b.hw+radius&&Math.abs(p.z-b.z)<b.hd+radius);
 const index=p=>[Math.max(0,Math.min(nx-1,Math.floor((p.x+W/2)/W*nx))),Math.max(0,Math.min(nz-1,Math.floor((p.z+D/2)/D*nz)))];
 const [si,sj]=index(plan.spawn),queue=[[si,sj]],seen=new Set();
 if(free(point(si,sj)))seen.add(sj*nx+si);else queue.length=0;
 for(let k=0;k<queue.length;k++){const [i,j]=queue[k];for(const [di,dj]of[[1,0],[-1,0],[0,1],[0,-1]]){const a=i+di,b=j+dj,key=b*nx+a;if(a<0||a>=nx||b<0||b>=nz||seen.has(key)||!free(point(a,b)))continue;seen.add(key);queue.push([a,b]);}}
 return [...plan.furniture.filter(f=>f.approach).map(f=>({id:f.id,...f.approach})),...plan.stairs].filter(p=>{const[i,j]=index(p);return !seen.has(j*nx+i)}).map(p=>p.id);
}
