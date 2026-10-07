import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHomeBlueprint, sampleRoom, pointInPolygon, deriveFloorOutline } from '../src/modes/home/homeBlueprint.js';
import { buildHomeRoof } from '../src/modes/home/homeRoof.js';

const home = options => createHomeBlueprint({ id: 'roof-fixture', seed: 'roof-test', ...options });
const finiteGeometry = g => { for (const name of ['position', 'normal', 'uv']) { const attr = g.getAttribute(name); assert.ok(attr, `missing ${name}`); assert.ok(Array.from(attr.array).every(Number.isFinite), `nonfinite ${name}`); } };
const close = (a, b, epsilon = .002) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const root = roof => { const group = new THREE.Group(), mat = new THREE.MeshBasicMaterial(); group.add(new THREE.Mesh(roof.geometry, mat)); group.add(new THREE.Mesh(roof.gables, mat)); group.updateMatrixWorld(true); return group; };
const hitRoof = (roof, x, z, maximumY = 40) => { const mesh = new THREE.Mesh(roof.geometry, new THREE.MeshBasicMaterial()); mesh.updateMatrixWorld(true); return new THREE.Raycaster(new THREE.Vector3(x, maximumY, z), new THREE.Vector3(0, -1, 0), 0, maximumY + 10).intersectObject(mesh)[0]; };
const discard = roof => { roof.geometry.dispose(); roof.gables.dispose(); };

test('automatic roofs cover the complete top-floor union with one coherent ridge', () => {
  for (const shape of ['rectangle', 'angled', 'curved']) {
    const bp = home({ shape }), top = bp.floors.at(-1), roof = buildHomeRoof(bp);
    try {
      assert.equal(roof.sections.length, 1);
      const section = roof.sections[0], outline = deriveFloorOutline(top);
      assert.ok(pointInPolygon(section.ridge, outline), 'ridge must remain over the building');
      const xs = outline.map(p => p.x); close(section.ridge.x, (Math.min(...xs) + Math.max(...xs)) / 2 + bp.roof.ridgeOffset);
      close(hitRoof(roof, section.ridge.x, section.ridge.z).point.y, section.ridge.y);
      for (const room of top.rooms) { const points = sampleRoom(room), centre = points.reduce((p, q) => ({ x: p.x + q.x / points.length, z: p.z + q.z / points.length }), { x: 0, z: 0 }); assert.ok(hitRoof(roof, centre.x, centre.z), `${room.id} is not covered`); }
      finiteGeometry(roof.geometry); finiteGeometry(roof.gables);
      assert.ok(roof.geometry.getAttribute('position').count > 12);
      assert.ok(roof.trimSegments.every(s => [s.a, s.b].every(p => [p.x, p.y, p.z].every(Number.isFinite))));
    } finally { discard(roof); }
  }
});

test('gable roof halves meet at the edited ridge and roof-wall infill closes both ends', () => {
  const bp = home({ shape: 'rectangle', floors: 1, attic: false }); bp.roof.ridgeOffset = 1.2;
  const roof = buildHomeRoof(bp), section = roof.sections[0], group = root(roof), top = bp.floors[0], y = top.elevation + top.height + bp.roof.rise * .5;
  try {
    const p = section.ridge;
    close(hitRoof(roof, p.x, p.z).point.y, p.y);
    assert.ok(hitRoof(roof, p.x - .5, p.z).point.y < p.y);
    assert.ok(hitRoof(roof, p.x + .5, p.z).point.y < p.y);
    const outline = deriveFloorOutline(top), z0 = Math.min(...outline.map(p => p.z)), z1 = Math.max(...outline.map(p => p.z));
    const front = new THREE.Raycaster(new THREE.Vector3(p.x, y, z1 + 2), new THREE.Vector3(0, 0, -1), 0, 2.2).intersectObjects(group.children);
    const back = new THREE.Raycaster(new THREE.Vector3(p.x, y, z0 - 2), new THREE.Vector3(0, 0, 1), 0, 2.2).intersectObjects(group.children);
    assert.ok(front.length > 0, 'front gable remains open'); assert.ok(back.length > 0, 'back gable remains open');
    const ridgeTrims = roof.trimSegments.filter(s => Math.abs(s.a.x - p.x) < 1e-6 && Math.abs(s.b.x - p.x) < 1e-6 && Math.abs(s.a.y - p.y) < 1e-6);
    assert.ok(ridgeTrims.length > 0);
  } finally { discard(roof); }
});

test('room sections retain individual roof types and physically valid edited ridges', () => {
  const bp = home({ shape: 'curved' }), top = bp.floors.at(-1); bp.roof.sections = {};
  for (const [i, room] of top.rooms.entries()) bp.roof.sections[room.id] = { type: ['gable', 'hip', 'cone'][i % 3], rise: 1.4 + i * .2, overhang: .2, ridgeOffset: i % 2 ? -99 : 99, authored: true };
  const roof = buildHomeRoof(bp);
  try {
    assert.equal(roof.sections.length, top.rooms.length);
    for (const section of roof.sections) { const room = top.rooms.find(r => r.id === section.roomId); assert.ok(room); assert.equal(section.type, bp.roof.sections[room.id].type); assert.ok(pointInPolygon(section.ridge, sampleRoom(room))); close(section.ridge.y, top.elevation + top.height + bp.roof.sections[room.id].rise); }
    finiteGeometry(roof.geometry); finiteGeometry(roof.gables);
  } finally { discard(roof); }
});

test('a full round tower gets a complete cone with its apex inside the circular volume', () => {
  const bp = home({ floors: 1, attic: false }), top = bp.floors[0]; top.rooms = [{ id: 'tower', type: 'hall', points: [{ x: 0, z: -3 }, { x: 3, z: 0 }, { x: 0, z: 3 }, { x: -3, z: 0 }], curves: { 0: { x: 3, z: -3 }, 1: { x: 3, z: 3 }, 2: { x: -3, z: 3 }, 3: { x: -3, z: -3 } } }];
  bp.roof.type = 'cone'; bp.roof.rise = 3; bp.roof.overhang = .2;
  const roof = buildHomeRoof(bp);
  try {
    assert.equal(roof.sections[0].type, 'cone'); assert.ok(pointInPolygon(roof.sections[0].ridge, sampleRoom(top.rooms[0])));
    close(hitRoof(roof, 0, 0).point.y, top.height + 3);
    for (const [x, z] of [[2, 0], [0, 2], [-2, 0], [0, -2], [1.5, 1.5]]) assert.ok(hitRoof(roof, x, z));
    assert.equal(hitRoof(roof, 3, 3), undefined, 'cone must not fill the circular envelope corners');
    finiteGeometry(roof.geometry); finiteGeometry(roof.gables);
  } finally { discard(roof); }
});

test('concave hip roofs cover both wings without filling the missing quadrant', () => {
  const bp = home({ floors: 1, attic: false }), top = bp.floors[0], outline = [{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 2 }, { x: 2, z: 2 }, { x: 2, z: 6 }, { x: 0, z: 6 }];
  top.rooms = [{ id: 'concave-volume', type: 'hall', points: outline }]; bp.roof.type = 'hip'; bp.roof.overhang = 0;
  const roof = buildHomeRoof(bp);
  try {
    assert.ok(pointInPolygon(roof.sections[0].ridge, outline));
    for (const [x, z] of [[1, 1], [1, 5], [5, 1], [1.5, 3], [3, 1.5]]) assert.ok(hitRoof(roof, x, z), `hip roof misses ${x},${z}`);
    assert.equal(hitRoof(roof, 4, 4), undefined, 'a triangle fan incorrectly fills the concave notch');
    const p = roof.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i += 3) { const centre = { x: (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, z: (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3 }; assert.ok(pointInPolygon(centre, outline)); }
    finiteGeometry(roof.geometry); finiteGeometry(roof.gables);
  } finally { discard(roof); }
});

test('shape and style changes keep finite roof geometry and the same silhouette across LODs', () => {
  for (const shape of ['rectangle', 'angled', 'curved']) for (const type of ['gable', 'hip', 'cone']) {
    const bp = home({ shape, style: 'tropical' }); bp.roof.type = type; bp.roof.rise = 2.4; bp.roof.ridgeOffset = .35;
    const roofs = [0, 1, 2].map(lod => buildHomeRoof(bp, { lod }));
    try {
      for (const roof of roofs) { finiteGeometry(roof.geometry); finiteGeometry(roof.gables); assert.deepEqual(roof.sections.map(s => s.ridge), roofs[0].sections.map(s => s.ridge)); }
      for (const roof of roofs.slice(1)) for (const axis of ['x', 'y', 'z']) { close(roof.geometry.boundingBox.min[axis], roofs[0].geometry.boundingBox.min[axis]); close(roof.geometry.boundingBox.max[axis], roofs[0].geometry.boundingBox.max[axis]); }
    } finally { roofs.forEach(discard); }
  }
});

test('a partially exposed lower-storey extension is roofed without putting roof triangles through the upper building', () => {
  const bp = home({ shape: 'rectangle', floors: 2, attic: false, plot: [{ x: -12, z: -8 }, { x: 12, z: -8 }, { x: 12, z: 12 }, { x: -12, z: 12 }] });
  const lower = bp.floors[0], upper = bp.floors[1], room = lower.rooms.find(r => r.type === 'living');
  room.points[0].x -= 3; room.points[3].x -= 3; room.authored = true;
  const roof = buildHomeRoof(bp);
  try {
    const section = roof.sections.find(s => s.roomId === room.id);
    assert.ok(section, 'lower extension roof is missing'); assert.equal(section.floorId, lower.id); assert.equal(section.exposed, true);
    const points = sampleRoom(room), probeX = Math.min(...points.map(p => p.x)) + 1, probeZ = points.reduce((sum, p) => sum + p.z / points.length, 0);
    const hit = hitRoof(roof, probeX, probeZ); assert.ok(hit, 'exposed room is open to the sky');
    assert.ok(hit.point.y >= lower.elevation + lower.height && hit.point.y < upper.elevation + upper.height);
    const pos = roof.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i += 3) {
      if ([0, 1, 2].some(n => pos.getY(i + n) >= upper.elevation + upper.height - .001)) continue;
      const centre = { x: (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, z: (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3 };
      assert.equal(upper.rooms.some(r => pointInPolygon(centre, sampleRoom(r))), false, 'lower roof passes through an upper room');
    }
    finiteGeometry(roof.geometry); finiteGeometry(roof.gables);
  } finally { discard(roof); }
});

test('a fully exposed attached lower room keeps its own authored roof and only covered rooms skip lower roofs', () => {
  const bp = home({ shape: 'rectangle', floors: 2, attic: false, plot: [{ x: -12, z: -8 }, { x: 12, z: -8 }, { x: 12, z: 12 }, { x: -12, z: 12 }] }), floor = bp.floors[0], living = floor.rooms.find(r => r.type === 'living'), leftX = living.points[0].x;
  const room = { id: 'lower:porch', type: 'living', points: [{ x: leftX - 3, z: 1 }, { x: leftX, z: 1 }, { x: leftX, z: 3 }, { x: leftX - 3, z: 3 }], authored: true };
  floor.rooms.push(room); bp.roof.authored = true; bp.roof.sections = { [room.id]: { type: 'hip', rise: 1.1, overhang: .15, ridgeOffset: .2, authored: true } };
  const roof = buildHomeRoof(bp);
  try {
    const section = roof.sections.find(s => s.roomId === room.id); assert.ok(section); assert.equal(section.type, 'hip'); close(section.rise, 1.1);
    assert.equal(roof.sections.filter(s => s.floorId === floor.id).length, 1, 'covered lower rooms created unnecessary roofs');
    assert.equal(roof.sections.filter(s => s.floorId === bp.floors[1].id).length, 1, 'a lower-wing override must preserve the single automatic upper roof');
    assert.ok(hitRoof(roof, leftX - 1.5, 2)); finiteGeometry(roof.geometry);
  } finally { discard(roof); }
});
