import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalkNetwork, edgePoint, townWalkable, walkRoute } from '../src/modes/town/walkNetwork.js';
import { Pedestrians } from '../src/modes/town/pedestrianRoutes.js';
import { mulberry32, MapGenerator } from '../src/map/mapGenerator.js';
import { generateHexasphere } from '../src/math/hexasphere.js';
import { generateTownLayout } from '../src/modes/town/townLayout.js';
import { describeBuilding } from '../src/world/buildingBlueprint.js';

const line = (pts, kind = 'street', w = 4) => ({ pts: pts.map(([x,z]) => ({ x,z })), kind, w });
const crowd = count => ({ count, people: Array.from({ length: count }, () => ({ x:0,y:0,z:0,phase:0,visible:true })) });
const indexAt = (g,x,z) => g.nodes.findIndex(p => Math.hypot(p.x-x,p.z-z)<.001);

test('walk graph joins crossings, T junctions, collinear overlap and door portals', () => {
  const g = createWalkNetwork([
    line([[-20,0],[20,0]]), line([[0,-20],[0,20]]),
    line([[10,0],[10,12]],'garden'), line([[5,0],[20,0]]), line([[50,0],[65,0]])
  ], { portals: [{ id:'house:door', x:10,z:14,facing:{x:0,z:-1} }] });
  assert.equal(g.nodes[indexAt(g,0,0)].edges.length,4);
  assert.equal(g.nodes[indexAt(g,10,0)].edges.length,3);
  assert.equal(g.components.length,2);
  assert.equal(g.portals[0].reason,null);
  const path = walkRoute(g,indexAt(g,-20,0),g.portals[0].node);
  assert.equal(path.length,44);
  assert.equal(walkRoute(g,indexAt(g,-20,0),indexAt(g,50,0)),null);
  assert.equal(g.edges.length,new Set(g.edges.map(e=>[e.a,e.b].sort((a,b)=>a-b).join(':'))).size);
  assert.deepEqual(walkRoute(g,0,0),{nodes:[0],edges:[],length:0});
});

test('water gaps, occupied entrances, empty input and bridge clearance', () => {
  const walkable = (x,z) => Math.abs(x)>2 && !(x>8&&Math.abs(z-5)<1);
  const g = createWalkNetwork([line([[-15,0],[15,0]])], { walkable,
    portals:[{id:'blocked',x:10,z:5},{id:'behind',x:10,z:8,facing:{x:0,z:1}}] });
  assert.equal(g.components.length,2);
  assert.equal(walkRoute(g,indexAt(g,-15,0),indexAt(g,15,0)),null);
  assert.deepEqual(g.portals.map(p=>p.reason),['blocked-door','no-safe-access']);
  for(const e of g.edges)for(let s=0;s<=e.length;s+=.1){
    const p=edgePoint(g,e,e.a,s);
    assert.ok(walkable(p.x,p.z));
  }
  const empty = createWalkNetwork([line([[0,0],[0,0]])]);
  const c = crowd(4);new Pedestrians(c,1,empty,mulberry32(4),()=>0).update(.1);
  assert.ok(c.people.slice(1).every(p=>!p.visible));
  const clear = townWalkable({dioramaR:100,colliders:[],fields:{sample:()=>({land:0})},rivers:[],bridges:[{x:0,z:0,yaw:Math.PI/4,len:20,w:4}]});
  assert.ok(clear(3,3));assert.ok(!clear(3,-3));
  const lowCoast = townWalkable({dioramaR:100,colliders:[],fields:{sample:()=>({land:.9})},rivers:[],bridges:[]},
    {groundHeight:()=>-.75,minHeight:0});
  assert.ok(!lowCoast(5,0),'land weight alone does not prove terrain is above the water');
  const isolated=createWalkNetwork([line([[0,0],[0,10]],'frontage')],{portals:[{id:'isolated',x:0,z:11}]});
  assert.equal(isolated.portals[0].node,null);assert.equal(isolated.portals[0].reason,'isolated-path');
});

test('walkers branch continuously, preserve routes across crowd tiers and flee on safe paths', () => {
  const graph=createWalkNetwork([line([[-20,0],[20,0]]),line([[0,-20],[0,20]]),line([[20,0],[20,20],[0,20]],'garden')]);
  const a=crowd(8),b=crowd(32);
  const small=new Pedestrians(a,1,graph,mulberry32(45),()=>2),large=new Pedestrians(b,1,graph,mulberry32(45),()=>2);
  for(let tick=0;tick<1800;tick++){
    const previous=a.people.map(p=>({...p}));
    small.update(.1);large.update(.1);
    assert.deepEqual(a.people.slice(1),b.people.slice(1,8));
    for(let i=1;i<a.count;i++)assert.ok(Math.hypot(a.people[i].x-previous[i].x,a.people[i].z-previous[i].z)<.4,'no junction teleport');
  }
  assert.ok(small.walkers.every(w=>w.transitions>4));
  const w=small.walkers[0],p=a.people[w.i],before={...p};
  small.startle(w,p.x+2,p.z+2,5);small.pose(w,null);
  assert.ok(Math.hypot(p.x-before.x,p.z-before.z)<1e-6,'reversing preserves lane');
  small.update(.1);
  assert.ok(Math.hypot(p.x-before.x,p.z-before.z)<1);
  assert.ok(w.flee>0);
});

test('modern and fantasy navigation uses canonical geometry and collision-safe lanes', () => {
  const hexasphere=generateHexasphere(3,10),generator=new MapGenerator(hexasphere);
  const seeds=process.env.GLOBE_NAV_SEEDS?Array.from({length:Number(process.env.GLOBE_NAV_SEEDS)},(_,i)=>17+i*73):[17,427];
  let towns=0,accessible=0;
  for(const seed of seeds){
    const map=generator.generate(seed,{planetType:'terran'});
    for(const cityIndex of [map.cities.findIndex(c=>c.style==='modern'),map.cities.findIndex(c=>c.style!=='modern')].filter(i=>i>=0)){
      const args={map,hexasphere,cityIndex};
      const high=generateTownLayout({...args,detail:1}),low=generateTownLayout({...args,detail:.5});
      const build=L=>createWalkNetwork(L.walkGraph,{walkable:townWalkable(L,{margin:.3}),portals:L.buildings.flatMap(b=>{
        const bp=describeBuilding(b);if(!bp)return[];
        return[{id:bp.portalId,x:bp.entrance.world.x-Math.sin(b.yaw)*.9,z:bp.entrance.world.z+Math.cos(b.yaw)*.9,facing:{x:-Math.sin(b.yaw),z:Math.cos(b.yaw)}}];
      })});
      const graph=build(high);assert.deepEqual(graph,build(low),'quality cannot alter routes or portal IDs');
      assert.ok(graph.edges.length>10);assert.ok(graph.nodes.some(n=>n.edges.length>2),'branching network');
      const safe=townWalkable(high);
      for(const e of graph.edges)for(const [from,side]of [[e.a,1],[e.b,0]])for(let s=0;s<=e.length;s+=.47){
        const p=edgePoint(graph,e,from,s,e.lanes[side]);
        assert.ok(safe(p.x,p.z),`unsafe lane seed ${seed} city ${cityIndex} edge ${e.id} at ${s}`);
      }
      accessible+=graph.portals.filter(p=>p.node!==null).length;towns++;
    }
  }
  assert.ok(towns>=3);assert.ok(accessible>0);
});
