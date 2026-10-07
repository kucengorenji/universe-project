import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHomeGroup, setHomeCutaway, disposeHomeGroup } from '../src/modes/home/homeBuilder.js';
import { createHomeBlueprint, sampleRoom, openingTransform, regenerateOpenings, validateHomeBlueprint } from '../src/modes/home/homeBlueprint.js';

const home = options => createHomeBlueprint({ id: 'render-fixture', seed: 'render-geometry', ...options });
const close = (actual, expected, label, epsilon = .002) => assert.ok(Math.abs(actual - expected) <= epsilon, `${label}: ${actual} != ${expected}`);
const meshes = root => { const result = []; root.traverse(o => { if (o.isMesh) result.push(o); }); return result; };
const boxOf = root => { root.updateMatrixWorld(true); return new THREE.Box3().setFromObject(root); };
const ray = (objects, origin, direction, far) => new THREE.Raycaster(origin, direction, 0, far).intersectObjects(objects, false);
const slabsAt = (root, floorId) => meshes(root).filter(o => o.userData.surface === 'floor' && o.userData.floorId === floorId);

test('cutaway keeps low room boundaries while clearing the view and preserving doorway access', () => {
  const bp = home({floors:2,attic:false}),root=createHomeGroup(bp),level=root.userData.levels[0];
  try {
    setHomeCutaway(root,{floorId:level.floorId,cutaway:true});root.updateMatrixWorld(true);
    assert.equal(level.walls.visible,false);assert.equal(level.lowWalls.visible,true);assert.equal(root.userData.levels[1].group.visible,false);
    assert.ok(boxOf(level.lowWalls).max.y<=.56,'low boundaries must keep the interior visible above seat height');
    const door=bp.openings.find(o=>o.floorId===level.floorId&&o.kind==='door'&&o.exterior),p=openingTransform(bp,door);
    const direction=new THREE.Vector3(p.normal.x,0,p.normal.z),origin=new THREE.Vector3(p.x,.25,p.z).addScaledVector(direction,-.4);
    assert.equal(ray(meshes(level.lowWalls),origin,direction,.8).length,0,'a cutaway boundary must not close an entry');
    setHomeCutaway(root,{floorId:level.floorId,cutaway:false});assert.equal(level.lowWalls.visible,false);assert.equal(level.walls.visible,true);
  } finally {disposeHomeGroup(root);}
});

test('actual Three.js geometry is finite and nonempty for orthogonal, angled and curved multistorey homes', () => {
  for (const shape of ['rectangle', 'angled', 'curved']) for (const style of ['classic', 'cottage', 'tropical']) {
    const bp = home({ shape, style, floors: 3, attic: true }), root = createHomeGroup(bp);
    try {
      const list = meshes(root); assert.ok(list.length > 15);
      for (const object of list) {
        const positions = object.geometry.getAttribute('position');
        assert.ok(positions?.count >= 3, `${shape}/${style}: empty geometry`);
        assert.ok(Array.from(positions.array).every(Number.isFinite), `${shape}/${style}: nonfinite vertices`);
        object.geometry.computeBoundingBox(); assert.equal(object.geometry.boundingBox.isEmpty(), false);
        const normal = object.geometry.getAttribute('normal'); if (normal) assert.ok(Array.from(normal.array).every(Number.isFinite));
      }
      assert.equal(root.userData.levels.length, 4);
    } finally { disposeHomeGroup(root); }
  }
});

test('floor slabs occupy the blueprint coordinates rather than mirroring z in world space', () => {
  for (const shape of ['rectangle', 'angled', 'curved']) {
    const bp = home({ shape }), root = createHomeGroup(bp); root.updateMatrixWorld(true);
    try {
      for (const floor of bp.floors) {
        const slabs = slabsAt(root, floor.id); assert.equal(slabs.length, floor.rooms.length);
        for (let i = 0; i < floor.rooms.length; i++) {
          const pts = sampleRoom(floor.rooms[i]), world = boxOf(slabs[i]);
          close(world.min.x, Math.min(...pts.map(p => p.x)), 'slab min x');
          close(world.max.x, Math.max(...pts.map(p => p.x)), 'slab max x');
          close(world.min.z, Math.min(...pts.map(p => p.z)), 'slab min z');
          close(world.max.z, Math.max(...pts.map(p => p.z)), 'slab max z');
          close(world.max.y, floor.elevation, 'slab top y');
        }
      }
    } finally { disposeHomeGroup(root); }
  }
});

test('a fully round tower room renders curved walls, a matching floor and an open upper stairwell', () => {
  const bp = home({ floors: 2, attic: false });
  for (const floor of bp.floors) floor.rooms = [{ id: `${floor.id}:tower`, type: 'hall', authored: true,
    points: [{ x: 0, z: -3 }, { x: 3, z: 0 }, { x: 0, z: 3 }, { x: -3, z: 0 }],
    curves: { 0: { x: 3, z: -3 }, 1: { x: 3, z: 3 }, 2: { x: -3, z: 3 }, 3: { x: -3, z: -3 } },
  }];
  bp.items = []; bp.openings = [{ id: 'tower:entry', floorId: bp.floors[0].id, roomId: bp.floors[0].rooms[0].id, edge: 2, t: .5, width: 1.05, height: 2.15, sill: 0, kind: 'door', exterior: true }];
  assert.equal(validateHomeBlueprint(bp).ok, true);
  const root = createHomeGroup(bp); root.updateMatrixWorld(true);
  try {
    const floor = bp.floors[1], slabs = slabsAt(root, floor.id), b = boxOf(slabs[0]);
    close(b.min.x, -3, 'round floor min x'); close(b.max.z, 3, 'round floor max z');
    const outerCorner = ray(slabs, new THREE.Vector3(2.9, floor.elevation + .3, 2.9), new THREE.Vector3(0, -1, 0), .5);
    assert.equal(outerCorner.length, 0, 'round floor must not fill its rectangular envelope');
    const stair = bp.stairs[0];
    assert.equal(ray(slabs, new THREE.Vector3(stair.x, floor.elevation + .3, stair.z), new THREE.Vector3(0, -1, 0), .5).length, 0);
    assert.ok(meshes(root.userData.levels[0].walls).every(o => Array.from(o.geometry.getAttribute('position').array).every(Number.isFinite)));
    assert.ok(meshes(root.userData.roof).length > 0);
  } finally { disposeHomeGroup(root); }
});

test('each upper floor has an actual open stairwell, while surrounding hall flooring remains solid', () => {
  const bp = home({ floors: 3, attic: true }), root = createHomeGroup(bp); root.updateMatrixWorld(true);
  try {
    for (const stair of bp.stairs) {
      const floor = bp.floors.find(f => f.id === stair.toFloorId), slabs = slabsAt(root, floor.id);
      const open = ray(slabs, new THREE.Vector3(stair.x, floor.elevation + .4, stair.z), new THREE.Vector3(0, -1, 0), .65);
      assert.equal(open.length, 0, `stairwell ${stair.id} is covered by upper floor geometry`);
      const solid = ray(slabs, new THREE.Vector3(stair.x + stair.width / 2 + .2, floor.elevation + .4, stair.z), new THREE.Vector3(0, -1, 0), .65);
      assert.ok(solid.length > 0, `stairwell ${stair.id} also removed adjoining flooring`);
    }
  } finally { disposeHomeGroup(root); }
});

test('generated shared interior doorways permit a ray to pass through the actual wall geometry', () => {
  const bp = home(), root = createHomeGroup(bp); root.updateMatrixWorld(true);
  try {
    for (const door of bp.openings.filter(o => o.kind === 'door' && !o.exterior)) {
      const t = openingTransform(bp, door), n = t.normal, walls = meshes(root.userData.levels.find(l => l.floorId === door.floorId).walls);
      const hits = ray(walls, new THREE.Vector3(t.x + n.x * .5, t.y + 1, t.z + n.z * .5), new THREE.Vector3(-n.x, 0, -n.z), 1);
      assert.equal(hits.length, 0, `door ${door.id} remains blocked by wall geometry`);
    }
  } finally { disposeHomeGroup(root); }
});

test('an opening authored on the second owner of a shared wall survives wall deduplication', () => {
  const bp = home({ shape: 'rectangle', floors: 1, attic: false }), floor = bp.floors[0], hall = floor.rooms.find(r => r.type === 'hall');
  const door = bp.openings.find(o => o.kind === 'door' && !o.exterior && o.roomId === floor.rooms.find(r => r.type === 'living').id), location = openingTransform(bp, door);
  const edge = hall.points.findIndex((a, i) => { const b = hall.points[(i + 1) % hall.points.length]; return Math.abs((a.x + b.x) / 2 - location.x) < 1e-5 && Math.abs((a.z + b.z) / 2 - location.z) < 1e-5; });
  assert.ok(edge >= 0);
  door.roomId = hall.id; door.edge = edge; door.t = .5; door.authored = true;
  assert.equal(validateHomeBlueprint(bp).ok, true, 'the authored door fixture should remain semantically valid');
  const root = createHomeGroup(bp); root.updateMatrixWorld(true);
  try {
    const t = openingTransform(bp, door), n = t.normal;
    const walls = meshes(root.userData.levels[0].walls);
    const hits = ray(walls, new THREE.Vector3(t.x + n.x * .5, t.y + 1, t.z + n.z * .5), new THREE.Vector3(-n.x, 0, -n.z), 1);
    assert.equal(hits.length, 0, 'shared wall deduplication discarded the second room’s doorway cut');
    const segments = root.userData.walkWalls.filter(w => w.floorId === floor.id && Math.abs((w.a.x + w.b.x) / 2 - t.x) < .01 && Math.abs((w.a.z + w.b.z) / 2 - t.z) < .01);
    assert.ok(segments.some(w => w.openings.length > 0), 'walking collider should recognize the shared doorway');
  } finally { disposeHomeGroup(root); }
});

test('an attached extension cuts its door through a partially shared existing wall', () => {
  const bp=home({shape:'rectangle',floors:2,attic:false,plot:[{x:-12,z:-12},{x:12,z:-12},{x:12,z:12},{x:-12,z:12}]}),floor=bp.floors[0],living=floor.rooms.find(r=>r.type==='living'),x=Math.min(...living.points.map(p=>p.x));
  bp.items=[];bp.yard.items=[];floor.rooms.push({id:'extension',type:'study',authored:true,points:[{x:x-3,z:1},{x,z:1},{x,z:3},{x:x-3,z:3}]});
  bp.openings=regenerateOpenings(bp);assert.equal(validateHomeBlueprint(bp).ok,true);
  const door=bp.openings.find(o=>o.roomId==='extension'&&o.kind==='door'),t=openingTransform(bp,door),root=createHomeGroup(bp);root.updateMatrixWorld(true);
  try{
    const walls=meshes(root.userData.levels[0].walls),n=t.normal;
    assert.equal(ray(walls,new THREE.Vector3(t.x+n.x*.5,1,t.z+n.z*.5),new THREE.Vector3(-n.x,0,-n.z),1).length,0,'the original longer wall must share the new opening');
    for(const segment of root.userData.walkWalls.filter(w=>w.floorId===floor.id&&Math.abs(w.a.x-x)<.001&&Math.abs(w.b.x-x)<.001&&Math.min(w.a.z,w.b.z)<t.z&&Math.max(w.a.z,w.b.z)>t.z))assert.ok(segment.openings.some(o=>Math.hypot(o.position.x-t.x,o.position.z-t.z)<.001));
  }finally{disposeHomeGroup(root);}
});

test('gable infill closes the front and back of the roof below the ridge', () => {
  const bp = home({ shape: 'rectangle', floors: 1, attic: false }), top = bp.floors.at(-1), root = createHomeGroup(bp); root.updateMatrixWorld(true);
  try {
    const roofMeshes = meshes(root.userData.roof);
    const pts = top.rooms.flatMap(room => sampleRoom(room)), minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x)), minZ = Math.min(...pts.map(p => p.z)), maxZ = Math.max(...pts.map(p => p.z));
    const x = (minX + maxX) / 2 + (bp.roof.ridgeOffset || 0), y = top.elevation + top.height + bp.roof.rise * .45;
    const front = ray(roofMeshes, new THREE.Vector3(x, y, maxZ + 3), new THREE.Vector3(0, 0, -1), 3.6);
    const back = ray(roofMeshes, new THREE.Vector3(x, y, minZ - 3), new THREE.Vector3(0, 0, 1), 3.6);
    assert.ok(front.length > 0, 'front building gable is open');
    assert.ok(back.length > 0, 'back building gable is open');
  } finally { disposeHomeGroup(root); }
});

test('all LODs keep the edited structural silhouette and roof extent', () => {
  const bp = home({ shape: 'curved', style: 'tropical' });
  for (const floor of bp.floors) { const room = floor.rooms.find(r => r.type === 'living') || floor.rooms.find(r => r.id.includes('front-left')); room.points[0].x -= .45; room.points[3].x -= .45; room.authored = true; }
  bp.openings = regenerateOpenings(bp); bp.roof.ridgeOffset = .25; bp.roof.rise = 2.7; bp.roof.authored = true;
  const roots = [0, 1, 2].map(lod => createHomeGroup(bp, { lod }));
  try {
    for (const root of roots) root.updateMatrixWorld(true);
    for (let i = 0; i < bp.floors.length; i++) {
      const reference = boxOf(roots[0].userData.levels[i].walls);
      for (const root of roots.slice(1)) { const actual = boxOf(root.userData.levels[i].walls); for (const axis of ['x', 'y', 'z']) { close(actual.min[axis], reference.min[axis], `LOD wall min ${axis}`, .035); close(actual.max[axis], reference.max[axis], `LOD wall max ${axis}`, .035); } }
    }
    const reference = boxOf(roots[0].userData.roof);
    for (const root of roots.slice(1)) { const actual = boxOf(root.userData.roof); for (const axis of ['x', 'y', 'z']) { close(actual.min[axis], reference.min[axis], `LOD roof min ${axis}`, .035); close(actual.max[axis], reference.max[axis], `LOD roof max ${axis}`, .035); } }
  } finally { roots.forEach(disposeHomeGroup); }
});

test('disposing a home frees owned geometry and materials once while preserving shared textured pack resources', () => {
  const geometry = new THREE.BoxGeometry(2.05, .95, .88), sharedMaterial = new THREE.MeshStandardMaterial({ color: 0xaabbcc }), texture = new THREE.Texture(); sharedMaterial.map = texture;
  let sharedGeometryDisposed = 0, sharedMaterialDisposed = 0, sharedTextureDisposed = 0;
  geometry.addEventListener('dispose', () => sharedGeometryDisposed++); sharedMaterial.addEventListener('dispose', () => sharedMaterialDisposed++); texture.addEventListener('dispose', () => sharedTextureDisposed++);
  const pack = { sofa: { 0: [{ geometry, material: sharedMaterial }] } }, root = createHomeGroup(home(), { pack });
  const owned = new Set(meshes(root).filter(o => !o.userData.shared).map(o => o.geometry)), counts = new Map();
  for (const resource of [...owned, ...root.userData.ownedMaterials]) { counts.set(resource, 0); resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1)); }
  const scene = new THREE.Scene(); scene.add(root); disposeHomeGroup(root);
  assert.equal(root.parent, null);
  assert.ok([...counts.values()].every(count => count === 1));
  assert.equal(sharedGeometryDisposed, 0); assert.equal(sharedMaterialDisposed, 0); assert.equal(sharedTextureDisposed, 0);
  geometry.dispose(); sharedMaterial.dispose(); texture.dispose();
});
