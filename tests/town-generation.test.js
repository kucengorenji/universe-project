import test from 'node:test';
import assert from 'node:assert/strict';
import { generateHexasphere } from '../src/math/hexasphere.js';
import { MapGenerator } from '../src/map/mapGenerator.js';
import { generateTownLayout } from '../src/modes/town/townLayout.js';
import { dryFootprint, containsField } from '../src/world/landUsePlan.js';
import { riverDistance } from '../src/modes/town/townPlan.js';
import { pathClearance } from '../src/modes/town/townGreenery.js';

test('fixture towns retain gameplay across detail tiers and keep farms dry', () => {
 const hexasphere=generateHexasphere(3,10), generator=new MapGenerator(hexasphere);
 let count=0;const styles=new Set();
 const seeds=process.env.GLOBE_SWEEP_SEEDS ? Array.from({length:Number(process.env.GLOBE_SWEEP_SEEDS)},(_,i)=>17+i*73) : [17,427,8191];
 for(const seed of seeds) {
  const map=generator.generate(seed,{planetType:'terran'});
  const ids=[map.cities.findIndex(c=>c.style==='modern'),map.cities.findIndex(c=>c.style!=='modern')].filter(i=>i>=0);
  for(const cityIndex of ids) {
   const args={map,hexasphere,cityIndex};
   const high=generateTownLayout({...args,detail:1}), low=generateTownLayout({...args,detail:.5});
   assert.deepEqual(high.buildings,low.buildings,`buildings seed ${seed} city ${cityIndex}`);
   assert.deepEqual(high.streets,low.streets);
   assert.deepEqual(high.paths,low.paths,'public paths cannot move with quality');
   assert.deepEqual(high.trees,low.trees,'trunks and rocks cannot move with quality');
   assert.deepEqual(high.colliders,low.colliders,'walkable space cannot change with quality');
   assert.equal(new Set(high.buildings.map(b=>b.id)).size,high.buildings.length);
   assert.ok(high.buildings.length>0);
   for(const f of high.fields2)assert.ok(dryFootprint({x:f.x,z:f.z,hw:f.w/2,hd:f.d/2,yaw:f.yaw},(x,z)=>high.fields.sample(x,z),(x,z)=>riverDistance(high,x,z),4));
   for(const tree of high.trees.filter(t=>t.habitat==='park'))assert.ok(pathClearance(high.paths,tree.x,tree.z)>1.2,'park trunk leaves paths clear');
   for(const park of high.parks.filter(p=>p.access)){
    assert.ok(high.paths.some(p=>p.id===`${park.id}:entry`),'every planted park has street access');
    assert.ok(high.fields.sample(park.x,park.z).land>.76,'park on dry ground');
   }
   for(const rock of high.trees.filter(t=>t.asset.startsWith('r_'))){
    assert.ok(!high.fields2.some(f=>containsField(f,rock.x,rock.z)),'rocks avoid farm parcels');
    assert.ok(high.fields.sample(rock.x,rock.z).land>.76,'rocks stay off water');
   }
   if(high.modern)assert.equal(high.morphology.kind,'grown-neighbourhoods','modern streets grow from regional approaches');
   count++;styles.add(high.modern?'modern':'fantasy');
  }
 }
 assert.equal(styles.size,2);assert.ok(count>=4);
});
