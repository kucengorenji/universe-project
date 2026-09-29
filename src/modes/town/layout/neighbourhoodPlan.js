// A modern town grows around regional approaches and local collectors. Short
// residential branches meet those roads at T junctions; no city-wide square grid.
export function planNeighbourhoods(L, K, fillFronts) {
  const {rng,noise,inCity,at,addStreet,streetClear,place,claim,free}=K;
  // Carriageway widths. v3 sizes them for a town of a few thousand people:
  // two 3-4 m lanes on through roads, a 5.5 m shared street on a residential
  // branch. v2 (16/13 m arterials) stays for towns whose saved rooms need it.
  const W=L.layoutVersion>=3
    ?{main:L.capital?10:8,loop:6.5,collector:7,residential:[5.5,.5],plazaR:L.capital?14:10}
    :{main:L.capital?16:13,loop:8,collector:9,residential:[6.5,1.5],plazaR:L.capital?18:14};
  const tau=Math.PI*2, angles=L.exits.map(e=>e.angle), plazaR=W.plazaR;
  // v3: a one-tile town is a through road and its side streets, not four arterials and a ring
  const hamlet=L.layoutVersion>=3&&L.size<=1&&!L.capital;
  while(angles.length<(hamlet?2:4)){
    let best=0,gap=-1;
    for(let i=0;i<32;i++){
      const a=i*tau/32+rng()*.12;
      const sep=Math.min(9,...angles.map(b=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)))));
      if(sep>gap){gap=sep;best=a;}
    }
    angles.push(best);
  }
  L.plaza={x:0,z:0,r:plazaR};
  claim({x:0,z:0,hw:plazaR*.72,hd:plazaR*.72,yaw:0},false);
  const dry=(x,z)=>inCity(x,z,.4)&&at(x,z).land>.68;
  const arterial=[];
  for(const angle of angles){
    const pts=[[Math.cos(angle)*plazaR*.75,Math.sin(angle)*plazaR*.75]];
    let heading=angle;
    for(let n=0;n<110;n++){
      const [x,z]=pts.at(-1);
      heading+=noise.noise(x*.005,z*.005,angle)*.075+Math.atan2(Math.sin(angle-heading),Math.cos(angle-heading))*.13;
      const next=[x+Math.cos(heading)*9,z+Math.sin(heading)*9];
      if(!dry(...next))break;
      pts.push(next);
    }
    if(pts.length>2)arterial.push(addStreet(pts,W.main,'main'));
  }
  // A small circulation loop joins the approaches around the civic square.
  const loop=Array.from({length:65},(_,i)=>[Math.cos(i*tau/64)*plazaR,Math.sin(i*tau/64)*plazaR]);
  addStreet(loop,W.loop,'collector');
  for(const fraction of [.48,.8]){
    if(L.cityR<130&&fraction===.8)continue;
    if(hamlet)continue;
    let run=[];
    for(let i=0;i<=96;i++){
      const a=i*tau/96,phase=L.seed*.017+fraction*3;
      const r=L.cityR*fraction*(1+noise.noise(Math.cos(a)*1.4,Math.sin(a)*1.4,8)*.42+Math.sin(a*2+phase)*.16);
      const p=[Math.cos(a)*r*1.08+Math.sin(phase)*L.cityR*.08,Math.sin(a)*r*.9+Math.cos(phase)*L.cityR*.07];
      const gap=fraction===.8&&Math.cos(a+phase)>.9;
      if(!gap&&dry(...p))run.push(p);
      else{if(run.length>3)addStreet(run,W.collector,'collector');run=[];}
    }
    if(run.length>3)addStreet(run,W.collector,'collector');
  }
  const bases=[...L.streets];
  for(const base of bases){
    let distance=35+rng()*30;
    for(let i=1;i<base.pts.length;i++){
      const a=base.pts[i-1],b=base.pts[i];distance+=Math.hypot(b[0]-a[0],b[1]-a[1]);
      if(distance<(hamlet?40:68)+rng()*(hamlet?18:26)||Math.hypot(...b)<plazaR+(hamlet?24:40))continue;
      distance=0;
      const tangent=Math.atan2(b[1]-a[1],b[0]-a[0]);
      for(const side of [-1,1]){
        if(rng()<.2)continue;
        let heading=tangent+side*(1.1+rng()*.5),pts=[b];
        const length=40+rng()*90;
        for(let d=0;d<length;d+=7){
          const p=pts.at(-1);heading+=noise.noise(p[0]*.013,p[1]*.013,5)*.09;
          const q=[p[0]+Math.cos(heading)*7,p[1]+Math.sin(heading)*7];
          if(!dry(...q)||Math.hypot(...q)<plazaR+12)break;
          // Meet an existing road explicitly instead of ending just beside it.
          let hit=null;
          for(const s of K.segs){
            if(s.street===base)continue;
            const dx=s.bx-s.ax,dz=s.bz-s.az,t=Math.max(0,Math.min(1,((q[0]-s.ax)*dx+(q[1]-s.az)*dz)/(dx*dx+dz*dz||1)));
            const x=s.ax+dx*t,z=s.az+dz*t,dist=Math.hypot(x-q[0],z-q[1]);
            if(dist<7&&(!hit||dist<hit.dist))hit={x,z,dist};
          }
          if(hit){if(d>14)pts.push([hit.x,hit.z]);break;}
          pts.push(q);
        }
        if(pts.length>3)addStreet(pts,W.residential[0]+rng()*W.residential[1],'residential');
      }
    }
  }
  // Reserve pocket parks before parcels, with different sizes and orientation.
  for(let i=0;i<90&&L.parks.length<Math.max(3,L.size);i++){
    const a=rng()*tau,r=L.cityR*(.25+rng()*.6),x=Math.cos(a)*r,z=Math.sin(a)*r,half=9+rng()*9;
    if(!dry(x,z)||streetClear(x,z,45)<half+2||!free({x,z,hw:half,hd:half,yaw:0},1))continue;
    const poly=[[-half,-half],[half,-half],[half,half],[-half,half]].map(([u,v])=>({x:x+u,z:z+v}));
    L.parks.push({x,z,poly,style:'public'});
  }
  const typeAt = r => {
    const t=r/Math.max(80,L.cityR),roll=rng();
    // A hamlet has a shop row and houses; no office towers
    if(hamlet)return t<.36&&roll<.45?['m_shop',14,10]:roll<.12?['m_apartment',20,16]:['m_house',12,10];
    if(t<.36)return roll<.25?['m_tower_a',30,30]:roll<.65?['m_office',22,22]:['m_shop',14,10];
    if(t<.67)return roll<.48?['m_apartment',20,16]:roll<.8?['m_shop',14,10]:['m_house',12,10];
    return roll<.8?['m_house',12,10]:['m_shop',14,10];
  };
  fillFronts(L,{...K,typeAt,cityTh:.42,list:L.buildings,kinds:['main','collector','residential']});
  L.landmark=L.buildings.find(b=>b.asset==='m_tower_a')||L.buildings[0];
  L.morphology={version:2,kind:'grown-neighbourhoods',arterials:arterial.length};
  L.spawn={x:0,z:plazaR*.65,yaw:0};
}
