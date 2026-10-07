import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HOME_CATALOG, HOME_STYLES, sampleRoom, pointInPolygon, openingTransform } from './homeBlueprint.js';
import { loadTexturedPack } from '../../render/texturedAssetLibrary.js';
import { ASSETS } from '../../render/assetManifest.js';
import { buildHomeRoof } from './homeRoof.js';

let packPromise;
export const loadHomePack = () => packPromise ||= loadTexturedPack(ASSETS.homePack,{mergeShades:true});

const surfaces = new Map();
function paintedTexture(kind) {
  if (surfaces.has(kind)) return surfaces.get(kind);
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const c = canvas.getContext('2d');
  c.fillStyle = kind === 'brick' ? '#efdfcf' : kind === 'wood' ? '#e9d9ba' : '#eee8db'; c.fillRect(0, 0, 256, 256);
  let seed = 175;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 2200; i++) { c.fillStyle = 'rgba(91,67,40,' + (random() * .055) + ')'; c.fillRect(random() * 256, random() * 256, 2, 2); }
  if (kind === 'roof') {
    c.fillStyle='#eee0ce';c.fillRect(0,0,256,256);
    for(let row=0;row<8;row++)for(let col=-1;col<7;col++){
      const x=col*43+(row%2)*21.5,y=row*32;
      c.fillStyle='rgba(111,71,47,'+(.05+random()*.06)+')';c.fillRect(x+2,y+2,39,28);
      c.strokeStyle='rgba(111,71,47,.22)';c.beginPath();c.moveTo(x+2,y+3);c.lineTo(x+2,y+24);c.quadraticCurveTo(x+21,y+38,x+41,y+24);c.stroke();
      c.strokeStyle='rgba(255,249,220,.45)';c.beginPath();c.moveTo(x+4,y+5);c.lineTo(x+4,y+21);c.stroke();
    }
  } else if (kind === 'brick') {
    for (let row = 0; row < 8; row++) for (let col = -1; col < 5; col++) {
      const x = col * 64 + (row % 2) * 32;
      c.fillStyle = 'rgba(167,99,68,' + (.10 + random() * .15) + ')'; c.fillRect(x + 2, row * 32 + 2, 60, 28);
      c.strokeStyle = 'rgba(255,255,255,.55)'; c.strokeRect(x + 2, row * 32 + 2, 60, 28);
    }
  } else if (kind === 'wood') {
    c.strokeStyle = 'rgba(114,85,48,.15)'; c.lineWidth = 2;
    for (let y = 0; y < 256; y += 32) { c.beginPath(); c.moveTo(0, y); c.lineTo(256, y); c.stroke(); }
    c.lineWidth = .6;
    for (let i = 0; i < 85; i++) { const y = random() * 256; c.beginPath(); c.moveTo(0, y); c.bezierCurveTo(75,y-3,190,y+4,256,y); c.stroke(); }
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 4;
  surfaces.set(kind, texture); return texture;
}

function palette(bp) {
  const p = HOME_STYLES[bp.style]?.palette || {};
  return { wall: p.wall || (bp.style === 'classic' ? 0xd5a58c : bp.style === 'cottage' ? 0xe0d3b2 : 0xeadbc2), roof: p.roof || (bp.style === 'tropical' ? 0x758479 : 0xa95743), wood: p.wood || 0x906044, floor: p.floor || 0xd8bd91 };
}
function material(color, kind, options = {}) { return new THREE.MeshStandardMaterial({ color, map: kind ? paintedTexture(kind) : null, roughness: .92, ...options }); }
const polyShape = points => { const s = new THREE.Shape(); points.forEach((p,i)=>i ? s.lineTo(p.x,p.z) : s.moveTo(p.x,p.z)); s.closePath(); return s; };
function mesh(geometry, mat, group, position, rotation) {
  const m = new THREE.Mesh(geometry, mat); if(position) m.position.set(...position); if(rotation) m.rotation.set(...rotation);
  m.castShadow = m.receiveShadow = true; group.add(m); return m;
}
function appendBox(bucket, size, position, yaw = 0) {
  const g = new THREE.BoxGeometry(...size);
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...position),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw),new THREE.Vector3(1,1,1)));
  bucket.push(g);
}
function appendBeam(bucket,width,a,b) {
  const v=new THREE.Vector3().subVectors(b,a),g=new THREE.BoxGeometry(width,v.length(),width);
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a,b).multiplyScalar(.5),new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),v.normalize()),new THREE.Vector3(1,1,1)));bucket.push(g);
}
function mergeBucket(bucket, mat, group) {
  if (!bucket.length) return;
  const joined = mergeGeometries(bucket); bucket.forEach(g=>g.dispose()); return mesh(joined,mat,group);
}
export function createHomeGroup(bp,{lod=0,pack=null}={}) {
  const root=new THREE.Group();root.name='home-'+bp.id;
  const colors=palette(bp), mats={wall:material(colors.wall,bp.style==='classic'?'brick':'paper'),floor:material(colors.floor,'wood'),roof:material(colors.roof,'roof',{side:THREE.DoubleSide}),trim:material(0xf5ead8,'wood'),wood:material(colors.wood,'wood'),glass:material(0x91b7bd,null,{roughness:.3}),garden:material(0x859661,'paper'),path:material(0xdbcfb7,'paper')};
  root.userData={blueprint:bp,levels:[],items:new Map(),walkWalls:[],ownedMaterials:Object.values(mats),lod};
  const plot=bp.plot?.length ? bp.plot : [{x:-10,z:-10},{x:10,z:-10},{x:10,z:10},{x:-10,z:10}];
  const ground=new THREE.Group();root.add(ground);
  mats.garden.side=mats.path.side=THREE.DoubleSide;
  mesh(new THREE.ExtrudeGeometry(polyShape(plot),{depth:.22,bevelEnabled:true,bevelSize:.08,bevelThickness:.02,bevelSegments:lod?1:3,steps:1}),mats.garden,ground,[0,-.025,0],[Math.PI/2,0,0]);
  for(const zone of bp.yard?.zones||[]) { if(!zone.points?.length) continue; const m=mesh(new THREE.ShapeGeometry(polyShape(zone.points)),zone.type==='path'?mats.path:mats.garden,ground,[0,.012,0],[-Math.PI/2,0,0]); m.rotation.x=Math.PI/2; }
  const fence=[];
  if(lod<2)for(let i=0;i<plot.length;i++) {
    const a=plot[i],b=plot[(i+1)%plot.length],len=Math.hypot(b.x-a.x,b.z-a.z),yaw=Math.atan2(b.x-a.x,b.z-a.z),n=Math.ceil(len/.8);
    for(let j=0;j<n;j++){const t=j/n,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;if(i===2&&Math.abs(x)<1.4)continue;appendBox(fence,[.09,.85,.09],[x,.425,z],yaw);}
    for(const y of [.32,.65])for(let j=0;j<n;j++){const t=(j+.5)/n,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;if(i===2&&Math.abs(x)<1.4)continue;appendBox(fence,[.07,.08,len/n+.01],[x,y,z],yaw);}
  }
  mergeBucket(fence,mats.trim,ground);
  const seenWalls=new Set();
  for(const floor of bp.floors) {
    const group=new THREE.Group(),walls=new THREE.Group(),lowWalls=new THREE.Group();root.add(group);group.add(walls,lowWalls);lowWalls.visible=false;
    group.userData.floorId=floor.id;
    root.userData.levels.push({floorId:floor.id,index:floor.index,group,walls,lowWalls});
    const wallPieces=[],lowWallPieces=[],trimPieces=[],glassPieces=[];
    for(const room of floor.rooms) {
      const points=sampleRoom(room); if(points.length<3)continue;
      const shape=polyShape(points);
      for(const stair of bp.stairs||[]) if(stair.toFloorId===floor.id) {
        const hole=[{x:stair.x-stair.width/2,z:stair.z-stair.depth/2},{x:stair.x+stair.width/2,z:stair.z-stair.depth/2},{x:stair.x+stair.width/2,z:stair.z+stair.depth/2},{x:stair.x-stair.width/2,z:stair.z+stair.depth/2}];
        if(hole.every(p=>pointInPolygon(p,points))) { const path=new THREE.Path();hole.slice().reverse().forEach((p,i)=>i?path.lineTo(p.x,p.z):path.moveTo(p.x,p.z));path.closePath();shape.holes.push(path); }
      }
      const slab=mesh(new THREE.ExtrudeGeometry(shape,{depth:.12,bevelEnabled:false}),mats.floor,group,[0,floor.elevation,0],[Math.PI/2,0,0]);slab.userData.surface='floor';slab.userData.floorId=floor.id;
      for(let edge=0;edge<room.points.length;edge++) {
        const a=room.points[edge],b=room.points[(edge+1)%room.points.length],control=room.curves?.[edge],sub=control?(lod?8:20):1;
        const edgeLength=Math.hypot(b.x-a.x,b.z-a.z);if(edgeLength<.00001)continue;
        const openings=(bp.openings||[]).filter(o=>o.floorId===floor.id&&o.roomId===room.id&&o.edge===edge);
        for(const opening of (bp.openings||[]).filter(o=>o.floorId===floor.id&&o.roomId!==room.id)){
          const owner=floor.rooms.find(r=>r.id===opening.roomId),oa=owner?.points[opening.edge],ob=owner?.points[(opening.edge+1)%owner?.points.length],socket=openingTransform(bp,opening);
          if(!oa||!ob||!socket)continue;
          const close=(p,q)=>Math.hypot(p.x-q.x,p.z-q.z)<.0001;
          const dx=b.x-a.x,dz=b.z-a.z,lengthSq=dx*dx+dz*dz,projected=((socket.x-a.x)*dx+(socket.z-a.z)*dz)/lengthSq;
          const collinear=!control&&!owner.curves?.[opening.edge]&&Math.abs(dx*(ob.z-oa.z)-dz*(ob.x-oa.x))<.0001&&projected>=0&&projected<=1&&Math.hypot(socket.x-a.x-projected*dx,socket.z-a.z-projected*dz)<.001;
          if((close(oa,a)&&close(ob,b))||(close(oa,b)&&close(ob,a))||collinear){
            const t=collinear?projected:close(oa,a)?opening.t:1-opening.t;
            if(!openings.some(o=>Math.abs(o.t-t)<.0001&&o.kind===opening.kind))openings.push({...opening,t,roomId:room.id,edge});
          }
        }
        let drewEdge=false;
        for(let seg=0;seg<sub;seg++) {
          const at=t=>control?{x:(1-t)**2*a.x+2*(1-t)*t*control.x+t*t*b.x,z:(1-t)**2*a.z+2*(1-t)*t*control.z+t*t*b.z}:{x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t};
          const p=at(seg/sub),q=at((seg+1)/sub),length=Math.hypot(q.x-p.x,q.z-p.z),key=floor.id+':'+[p,q].map(v=>v.x.toFixed(3)+','+v.z.toFixed(3)).sort().join(':');if(seenWalls.has(key))continue;seenWalls.add(key);
          drewEdge=true;root.userData.walkWalls.push({floorId:floor.id,a:p,b:q,openings:openings.filter(o=>o.kind==='door').map(o=>({position:at(o.t),width:o.width}))});
          const yaw=Math.atan2(q.x-p.x,q.z-p.z),t0=seg/sub,t1=(seg+1)/sub,cuts=[t0,t1];
          for(const o of openings){cuts.push(Math.max(t0,Math.min(t1,o.t-o.width/(2*edgeLength))),Math.max(t0,Math.min(t1,o.t+o.width/(2*edgeLength))));}
          cuts.sort((x,y)=>x-y);
          for(let j=0;j<cuts.length-1;j++) {
            const l=cuts[j],r=cuts[j+1];if(r-l<.0001)continue;const mid=(l+r)/2,pp=at(mid),width=length*(r-l)/(t1-t0)+.01;
            const opening=openings.find(o=>Math.abs(mid-o.t)<o.width/(2*edgeLength)),sill=opening?.sill||0,top=opening?Math.min(floor.height,sill+opening.height):0;
            if(lod===0){const h=Math.min(.55,opening?sill:floor.height);if(h>.01)appendBox(lowWallPieces,[.18,h,width],[pp.x,floor.elevation+h/2,pp.z],yaw);if(opening&&top<.55)appendBox(lowWallPieces,[.18,.55-top,width],[pp.x,floor.elevation+(top+.55)/2,pp.z],yaw);}
            if(!opening)appendBox(wallPieces,[.18,floor.height,width],[pp.x,floor.elevation+floor.height/2,pp.z],yaw);
            else {
              if(sill>.01)appendBox(wallPieces,[.18,sill,width],[pp.x,floor.elevation+sill/2,pp.z],yaw);
              if(top<floor.height)appendBox(wallPieces,[.18,floor.height-top,width],[pp.x,floor.elevation+top+(floor.height-top)/2,pp.z],yaw);
            }
          }
          if(lod===0)appendBox(trimPieces,[.22,.09,length],[ (p.x+q.x)/2,floor.elevation+.08,(p.z+q.z)/2 ],yaw);
        }
        if(drewEdge)for(const o of openings) {
          const t=o.t,center=control?{x:(1-t)**2*a.x+2*(1-t)*t*control.x+t*t*b.x,z:(1-t)**2*a.z+2*(1-t)*t*control.z+t*t*b.z}:{x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t},yaw=Math.atan2(b.x-a.x,b.z-a.z),base=floor.elevation+(o.sill||0);
          for(const sign of [-1,1])appendBox(trimPieces,[.23,o.height+.12,.085],[center.x+Math.sin(yaw)*sign*o.width/2,base+o.height/2,center.z+Math.cos(yaw)*sign*o.width/2],yaw);
          appendBox(trimPieces,[.23,.085,o.width+.12],[center.x,base+o.height,center.z],yaw);
          if(o.kind==='window'){
            appendBox(glassPieces,[.035,o.height,o.width],[center.x,base+o.height/2,center.z],yaw);
            appendBox(trimPieces,[.10,o.height,.045],[center.x,base+o.height/2,center.z],yaw);
            appendBox(trimPieces,[.10,.045,o.width],[center.x,base+o.height/2,center.z],yaw);
            appendBox(trimPieces,[.32,.07,o.width+.2],[center.x,base,center.z],yaw);
          }
        }
      }
    }
    mergeBucket(wallPieces,mats.wall,walls);mergeBucket(trimPieces,mats.trim,walls);mergeBucket(glassPieces,mats.glass,walls);mergeBucket(lowWallPieces,mats.wall,lowWalls);
  }
  for(const stair of bp.stairs||[]) {
    const low=bp.floors.find(f=>f.id===stair.fromFloorId),high=bp.floors.find(f=>f.id===stair.toFloorId);if(!low||!high)continue;
    const count=lod?10:17,steps=[];
    for(let i=0;i<count;i++)appendBox(steps,[stair.width,.10,stair.depth/count+.025],[stair.x,low.elevation+(i+1)/count*(high.elevation-low.elevation)-.05,stair.z-stair.depth/2+(i+.5)*stair.depth/count]);
    mergeBucket(steps,mats.wood,root.userData.levels.find(l=>l.floorId===stair.fromFloorId).group);
  }
  const roofGroup=new THREE.Group();root.add(roofGroup);root.userData.roof=roofGroup;
  const roof=buildHomeRoof(bp,{lod}),roofEdges=[];
  roofGroup.userData.sections=roof.sections;
  if(roof.geometry.attributes.position.count)mesh(roof.geometry,mats.roof,roofGroup);else roof.geometry.dispose();
  for(const segment of roof.trimSegments)appendBeam(roofEdges,.12,new THREE.Vector3(segment.a.x,segment.a.y,segment.a.z),new THREE.Vector3(segment.b.x,segment.b.y,segment.b.z));
  mergeBucket(roofEdges,mats.wood,roofGroup);
  if(roof.gables.attributes.position.count){const gm=material(colors.wall,bp.style==='classic'?'brick':'paper',{side:THREE.DoubleSide});root.userData.ownedMaterials.push(gm);mesh(roof.gables,gm,roofGroup);}else roof.gables.dispose();
  const allItems=[...(lod?[]:bp.items),...(bp.yard?.items||[])];
  for(const item of allItems) {
    const spec=HOME_CATALOG[item.type];if(!spec)continue;const holder=new THREE.Group();holder.userData.itemId=item.id;holder.userData.floorId=item.floorId;holder.position.copy(item.position);holder.rotation.y=item.rotation||0;
    const level=root.userData.levels.find(l=>l.floorId===item.floorId);(level?.group||ground).add(holder);root.userData.items.set(item.id,holder);
    const source=pack?.[item.type]?.[Math.min(lod,2)]||pack?.[item.type]?.[0];
    if(source?.length) {
      const content=new THREE.Group(),box=new THREE.Box3();
      const orientation=item.type==='bath'?Math.PI/2:0,turn=new THREE.Matrix4().makeRotationY(orientation);
      for(const part of source) { part.geometry.computeBoundingBox();box.union(part.geometry.boundingBox.clone().applyMatrix4(turn));const m=new THREE.Mesh(part.geometry,part.material);m.rotation.y=orientation;m.userData.shared=true;m.castShadow=m.receiveShadow=true;content.add(m); }
      const actual=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3()),[w,h,d]=spec.size;
      content.scale.set(w/(actual.x||1),h/(actual.y||1),d/(actual.z||1));content.position.set(-center.x*content.scale.x,-box.min.y*content.scale.y,-center.z*content.scale.z);holder.add(content);
    }
    else {
      const [w,h,d]=spec.size;
      const color=item.type==='plant'||item.type==='planter'?0x617d51:item.type==='sofa'?0xaaba91:item.type==='bed'?0xddd3b8:0xab805d;
      const mat=material(color,'wood');root.userData.ownedMaterials.push(mat);
      if(item.type==='plant') { mesh(new THREE.CylinderGeometry(w*.25,w*.2,h*.35,12),mats.wood,holder,[0,h*.175,0]);mesh(new THREE.SphereGeometry(w*.48,lod?8:16,lod?6:12),mat,holder,[0,h*.65,0]); }
      else { const geometry=new THREE.BoxGeometry(w,h,d,2,2,2);mesh(geometry,mat,holder,[0,h/2,0]); }
    }
    if(spec.surface==='surface') holder.userData.surfaceHeight=(spec.size[1]||.7)+item.position.y;
  }
  return root;
}

export function setHomeCutaway(root,{floorId,cutaway=false}={}) {
  const bp=root.userData.blueprint,index=bp.floors.findIndex(f=>f.id===floorId);
  for(const level of root.userData.levels){level.group.visible=!cutaway||level.index<=(index<0?0:index);level.walls.visible=!cutaway||level.index<(index<0?0:index);level.lowWalls.visible=cutaway&&level.index===(index<0?0:index);}
  root.userData.roof.visible=!cutaway;
}
export function disposeHomeGroup(root) {
  const geometries=new Set();root.traverse(o=>{if(o.geometry&&!o.userData.shared)geometries.add(o.geometry);});geometries.forEach(g=>g.dispose());
  root.userData.ownedMaterials?.forEach(m=>m.dispose());root.removeFromParent();
}
