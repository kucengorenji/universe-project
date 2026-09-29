const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function center(r, distance) {
  const s=clamp(distance,0,r.total);
  let k=1;
  while(k<r.lens.length-1&&r.lens[k]<s)k++;
  const a=r.line.pts[k-1],b=r.line.pts[k],t=(s-r.lens[k-1])/(r.lens[k]-r.lens[k-1]||1);
  return {x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t};
}

/** Continuous lane offset, even across the vertices of the painted polyline. */
export function trafficPose(r) {
  const p=center(r,r.s),a=center(r,r.s-2),b=center(r,r.s+2);
  const length=Math.hypot(b.x-a.x,b.z-a.z)||1;
  const fx=(b.x-a.x)/length*r.dir,fz=(b.z-a.z)/length*r.dir;
  const angle=r.turn??0,c=Math.cos(angle),s=Math.sin(angle);
  return {x:p.x-fz*r.lane*c+fx*r.lane*s,z:p.z+fx*r.lane*c+fz*r.lane*s,
    yaw:Math.atan2(fx*c+fz*s,fz*c-fx*s)};
}

/** Round the road's end cap instead of teleporting into the opposite lane. */
export function advanceTraffic(r, distance, dt) {
  if(r.turn!==undefined){
    r.turn+=r.lane>.1?distance/r.lane:(distance>0?dt*Math.PI:0);
    if(r.turn>=Math.PI){r.turn=undefined;r.dir*=-1;}
    return;
  }
  r.s+=distance*r.dir;
  if(r.s>r.total||r.s<0){r.s=clamp(r.s,0,r.total);r.turn=0;}
}
