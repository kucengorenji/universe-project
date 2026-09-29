// Adapter for the authored shells in tools/blender/build_town_space.py.
// Bounds exclude roof eaves, balconies and porches. Front is local +Z.
const SHELLS = {
  f_house_small: [6.2,5.6,1], f_house:[7.6,6.6,2], f_house_tall:[7,7.4,3],
  f_townhouse:[6,9.4,3], f_tavern:[11.6,8.6,2], f_shop:[8,7.4,2],
  m_house:[9.6,8.6,2,-1,-.5,-5,3.75], m_shop:[13.4,9.6,2,0,0,4.4,4.8],
  m_apartment:[19,15,6,0,0,0,7.85], m_office:[20.4,20.4,10,0,0,0,10.8]
};
export function localToTown(building, {x,z}) {
 const c=Math.cos(building.yaw),s=Math.sin(building.yaw);
 return {x:building.x+x*c-z*s,z:building.z+x*s+z*c};
}
export function townToLocal(building, {x,z}) {
 const c=Math.cos(building.yaw),s=Math.sin(building.yaw),dx=x-building.x,dz=z-building.z;
 return {x:dx*c+dz*s,z:-dx*s+dz*c};
}
// Gameplay approach lies outside the full asset envelope (porch/eaves), while
// the architectural socket remains on the actual facade for interior mapping.
export function buildingApproach(building, footprint, clearance = .9) {
 const blueprint=describeBuilding(building);if(!blueprint)return null;
 const front=footprint ? footprint.maxZ*(building.sz??1) : building.d/2;
 return localToTown(building,{x:blueprint.entrance.x,z:Math.max(blueprint.entrance.z,front)+clearance});
}
export function describeBuilding(building) {
 const spec=SHELLS[building.asset];if(!spec)return null;
 const [width,depth,baseFloors,cx=0,cz=0,doorX,doorZ]=spec;
 const sx=building.sx??1,sz=building.sz??1;
 const bays=Math.max(1,Math.floor((width-.6)/2.2));
 const x=doorX??(-width/2+width/bays*(Math.floor(bays/2)+.5));
 const entrance={x:x*sx,z:(doorZ??depth/2)*sz};
 const variant=(building.variant??0)%2;
 const floors=baseFloors+(building.asset==='m_shop'?variant:building.asset==='m_apartment'?variant*2:building.asset==='m_office'?variant*3:0);
 return {schemaVersion:1,id:building.id,asset:building.asset,footprint:{w:width*sx,d:depth*sz,cx:cx*sx,cz:cz*sz},
   entrance:{...entrance,world:localToTown(building,entrance)},floors,
   // Interior dimensions exclude structural walls and the attached garage.
   interior:{w:(width-.4)*sx,d:(depth-.4)*sz,
     doorX:(x-cx)*sx},
   portalId:`${building.id}:entrance`};
}
