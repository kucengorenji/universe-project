/** Junctions of arbitrary polylines; independent of the old modern grid. */
export function streetJunctions(streets) {
  const junctions=[];
  for(let a=0;a<streets.length;a++)for(let b=a+1;b<streets.length;b++){
    const A=streets[a],B=streets[b];
    for(let i=1;i<A.pts.length;i++)for(let j=1;j<B.pts.length;j++){
      const p=A.pts[i-1],q=A.pts[i],r=B.pts[j-1],s=B.pts[j];
      const dx=q[0]-p[0],dz=q[1]-p[1],ex=s[0]-r[0],ez=s[1]-r[1],den=dx*ez-dz*ex;
      if(Math.abs(den)<1e-6)continue;
      const u=((r[0]-p[0])*ez-(r[1]-p[1])*ex)/den,v=((r[0]-p[0])*dz-(r[1]-p[1])*dx)/den;
      if(u<0||u>1||v<0||v>1)continue;
      const x=p[0]+u*dx,z=p[1]+u*dz;
      let hit=junctions.find(h=>Math.hypot(h.x-x,h.z-z)<3);
      if(!hit){hit={x,z,r:0,legs:[]};junctions.push(hit);}
      hit.r=Math.max(hit.r,A.w/2+1.5,B.w/2+1.5);
      for(const [street,index]of [[A,i],[B,j]])for(const side of [-1,1]){
        const end=street.pts[side<0?0:street.pts.length-1];
        if(Math.hypot(end[0]-x,end[1]-z)<2)continue;
        const other=street.pts[Math.max(0,Math.min(street.pts.length-1,side<0?index-2:index+1))];
        const len=Math.hypot(other[0]-x,other[1]-z);if(len<.5)continue;
        const fx=(other[0]-x)/len,fz=(other[1]-z)/len;
        if(!hit.legs.some(l=>l.fx*fx+l.fz*fz>.9))hit.legs.push({fx,fz,w:street.w});
      }
    }
  }
  return junctions.filter(h=>h.legs.length>=3);
}
