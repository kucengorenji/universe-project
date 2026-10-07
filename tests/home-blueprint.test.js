import test from 'node:test';
import assert from 'node:assert/strict';
import { furnishPendingRooms } from '../src/modes/home/homeFurnishing.js';
import {
  HOME_CATALOG, HOME_STYLES, createHomeBlueprint, varyHomeBlueprint, validateHomeBlueprint,
  sampleRoom, roomAt, footprintBounds, deriveFloorOutline, pointInPolygon,
  placeHomeItem, addHomeItem, openingTransform, editHomeRoom, editHomeRoof,
  editHomeFloorHeight, removeHomeItem,
  reconcileHomeBlueprint, editHomeLevels,
  regenerateOpenings,
} from '../src/modes/home/homeBlueprint.js';

const copy = value => JSON.parse(JSON.stringify(value));
const create = options => createHomeBlueprint({ id: 'fixture', seed: 'cozy-house', ...options });
const empty = bp => ({ ...copy(bp), items: [], yard: { ...copy(bp.yard), items: [] } });
const interiorPoint = room => ({ x: room.points.reduce((s, p) => s + p.x, 0) / room.points.length, z: room.points.reduce((s, p) => s + p.z, 0) / room.points.length });

test('the seed reproducibly generates styled, furnished rooms and a coherent garden', () => {
  for (const style of Object.keys(HOME_STYLES)) {
    const home = create({ style });
    assert.deepEqual(home, create({ style }));
    assert.equal(home.style, style);
    assert.ok(home.items.length > 35);
    assert.ok(home.yard.items.some(i => i.type === 'bench'));
    assert.ok(home.yard.zones.some(z => z.type === 'path'));
    assert.ok(home.floors[0].rooms.some(r => r.type === 'bathroom'));
    assert.ok(home.items.some(i => i.type === 'toilet'));
    assert.equal(validateHomeBlueprint(home).ok, true);
  }
  assert.notDeepEqual(create({ seed: 'another' }).items, create().items);
});

test('1–3 storeys plus attic have continuous elevations, valid openings and stair access', () => {
  for (const floors of [1, 2, 3]) for (const attic of [false, true]) {
    const bp = create({ floors, attic });
    assert.equal(bp.floors.length, floors + Number(attic));
    assert.equal(bp.stairs.length, bp.floors.length - 1);
    assert.equal(bp.floors.at(-1).isAttic, attic);
    assert.equal(validateHomeBlueprint(bp).ok, true);
    assert.ok(bp.openings.filter(o => o.kind === 'door').length >= 4 * bp.floors.length + 1);
  }
  const broken = create({ floors: 3 }); broken.stairs.pop();
  assert.ok(validateHomeBlueprint(broken).issues.some(i => i.code === 'stairs'));
  const disconnected = create(); disconnected.openings = disconnected.openings.filter(o => !o.id.endsWith('back-left:door'));
  assert.ok(validateHomeBlueprint(disconnected).issues.some(i => i.code === 'room-access'));
});

test('rectangle, angled and curved footprints use the same render and collision outline', () => {
  const outlines = [];
  for (const shape of ['rectangle', 'angled', 'curved']) {
    const bp = create({ shape }), floor = bp.floors[0], outline = deriveFloorOutline(floor);
    assert.equal(validateHomeBlueprint(bp).ok, true);
    assert.ok(outline.length >= 4);
    assert.ok(outline.every(p => pointInPolygon(p, bp.plot)));
    assert.ok(floor.rooms.every(r => roomAt(bp, ...Object.values(interiorPoint(r)), floor.id)));
    assert.ok(footprintBounds(bp).width > 9);
    outlines.push(outline);
    if (shape === 'curved') assert.ok(floor.rooms.some(r => sampleRoom(r).length > r.points.length));
  }
  assert.notDeepEqual(outlines[0], outlines[1]);
  assert.notDeepEqual(outlines[0], outlines[2]);
});

test('row-house plots constrain the generated footprint while retaining essential furniture', () => {
  for (const width of [5, 6, 8]) {
    const plot = [{ x: -width / 2, z: -5 }, { x: width / 2, z: -5 }, { x: width / 2, z: 20 }, { x: -width / 2, z: 20 }];
    const bp = create({ plot, floors: 3, shape: 'curved' });
    assert.ok(footprintBounds(bp).width < width);
    assert.equal(validateHomeBlueprint(bp).ok, true);
    assert.ok(bp.items.some(i => i.type === 'bed'));
    assert.ok(bp.items.some(i => i.type === 'toilet'));
  }
});

test('the plot validator catches obstacles, an escaping wall, and self-intersecting rooms', () => {
  const bp = create({ shape: 'rectangle' }), room = bp.floors[0].rooms[0];
  const result = validateHomeBlueprint(bp, { obstacles: [{ minX: room.points[0].x + .1, maxX: room.points[0].x + 1, minZ: room.points[0].z + .1, maxZ: room.points[0].z + 1 }] });
  assert.equal(result.ok, false); assert.ok(result.issues.some(i => i.code === 'obstacle'));
  const escaping = editHomeRoom(bp, room.id, { points: room.points.map(p => ({ x: p.x - 20, z: p.z })) });
  assert.ok(validateHomeBlueprint(escaping).issues.some(i => i.code === 'plot-boundary'));
  const crossed = editHomeRoom(bp, room.id, { points: [room.points[0], room.points[2], room.points[1], room.points[3]] });
  assert.ok(validateHomeBlueprint(crossed).issues.some(i => i.code === 'room-shape'));
});

test('automatic placement snaps to the floor and rejects wall, collision and door clearance', () => {
  let bp = empty(create({ floors: 1, attic: false, shape: 'rectangle' }));
  bp = addHomeItem(bp, 'chair'); bp = addHomeItem(bp, 'chair');
  assert.equal(bp.items.length, 2);
  const [a, b] = bp.items, floor = bp.floors[0];
  const overlap = placeHomeItem(bp, a.id, b.position);
  assert.equal(overlap.ok, false); assert.match(overlap.reason, /bertabrakan/); assert.equal(overlap.blueprint, bp);
  const wall = placeHomeItem(bp, a.id, { x: 100, z: 100 });
  assert.equal(wall.ok, false); assert.equal(wall.blueprint, bp);
  const entry = bp.openings.find(o => o.exterior && o.kind === 'door'), doorway = openingTransform(bp, entry);
  const blocked = placeHomeItem(bp, a.id, { x: doorway.x, z: doorway.z + doorway.normal.z * .4 });
  assert.equal(blocked.ok, false); assert.match(blocked.reason, /pintu|dinding/);
  const original = placeHomeItem(bp, a.id, { ...a.position, y: 15, rotation: .013 });
  assert.equal(original.ok, true); assert.equal(original.blueprint.items[0].position.y, floor.elevation);
  assert.equal(original.blueprint.items[0].rotation, 0); assert.equal(original.blueprint.items[0].authored, true);
  assert.deepEqual(bp.items[0], a);
});

test('wall decoration and tabletop items follow their matching surfaces', () => {
  let bp = empty(create({ floors: 1, attic: false }));
  bp = addHomeItem(bp, 'table'); bp = addHomeItem(bp, 'vase'); bp = addHomeItem(bp, 'picture');
  const vase = bp.items.find(i => i.type === 'vase'), table = bp.items.find(i => i.type === 'table'), picture = bp.items.find(i => i.type === 'picture');
  assert.ok(vase && picture);
  assert.equal(vase.anchor.targetId, table.id);
  assert.equal(vase.position.y, table.position.y + HOME_CATALOG.table.size[1]);
  assert.equal(picture.anchor.kind, 'wall');
  const rejected = placeHomeItem(bp, vase.id, { x: 0, z: 0 });
  assert.equal(rejected.ok, false); assert.match(rejected.reason, /permukaan/);
  assert.equal(validateHomeBlueprint(bp).ok, true);
});

test('a yard item cannot overlap the house, entry path or neighboring plots', () => {
  const bp = create(), item = bp.yard.items[0], house = footprintBounds(bp);
  assert.equal(placeHomeItem(bp, item.id, house.center).ok, false);
  const t = openingTransform(bp, bp.openings.find(o => o.exterior && o.kind === 'door'));
  assert.equal(placeHomeItem(bp, item.id, { x: t.x, z: t.z + 1 }).ok, false);
  const b = { minX: item.position.x - 1, maxX: item.position.x + 1, minZ: item.position.z - 1, maxZ: item.position.z + 1 };
  assert.equal(placeHomeItem(bp, item.id, item.position, { obstacles: [b] }).ok, false);
});

test('variation preserves authored transforms and structural dependencies without new invalid placements', () => {
  let bp = create();
  const sofa = bp.items.find(i => i.type === 'sofa');
  const moved = placeHomeItem(bp, sofa.id, sofa.position); assert.equal(moved.ok, true); bp = moved.blueprint;
  bp = editHomeRoof(bp, { rise: 3.5, ridgeOffset: .3 });
  const bedroom = bp.floors[0].rooms.find(r => r.type === 'bedroom'); bp = editHomeRoom(bp, bedroom.id, { type: 'study' });
  const varying = varyHomeBlueprint(bp);
  assert.deepEqual(varying.items.find(i => i.id === sofa.id), bp.items.find(i => i.id === sofa.id));
  assert.deepEqual(varying.floors, bp.floors);
  assert.deepEqual(varying.roof, bp.roof);
  assert.equal(validateHomeBlueprint(varying).ok, true);
  assert.equal(varying.variation, 1);
  assert.notDeepEqual(varying.items.filter(i => !i.authored), bp.items.filter(i => !i.authored));
  assert.deepEqual(varyHomeBlueprint(bp), varying);
});

test('floor height edits shift every upper floor and its furniture, and maintain stair continuity', () => {
  const bp = create({ floors: 3 }), next = editHomeFloorHeight(bp, bp.floors[0].id, 3.4);
  assert.equal(next.floors[0].height, 3.4);
  for (let i = 1; i < bp.floors.length; i++) assert.ok(Math.abs(next.floors[i].elevation - bp.floors[i].elevation - .55) < 1e-8);
  const item = bp.items.find(i => i.floorId === bp.floors[2].id);
  assert.ok(Math.abs(next.items.find(i => i.id === item.id).position.y - item.position.y - .55) < 1e-8);
  assert.equal(validateHomeBlueprint(next).ok, true);
  assert.equal(validateHomeBlueprint(editHomeFloorHeight(bp, bp.floors[0].id, 1)).ok, false);
  assert.equal(bp.floors[0].height, 2.85);
});

test('structural changes retain affected items and mark them invalid for Apply', () => {
  const bp = create(), room = bp.floors[0].rooms[0], item = bp.items.find(i => i.anchor.targetId === room.id);
  const next = editHomeRoom(bp, room.id, { points: room.points.map(p => ({ x: p.x - 2, z: p.z })) });
  assert.deepEqual(next.items.find(i => i.id === item.id), item);
  assert.ok(validateHomeBlueprint(next).issues.some(i => i.code === 'placement' && i.elementId === item.id));
  assert.equal(validateHomeBlueprint(editHomeRoof(bp, { rise: -1 })).ok, false);
});

test('immutable operations provide safe snapshots for Undo/Redo and remove dependent surface items', () => {
  const bp = empty(create()), added = addHomeItem(bp, 'table'), decorated = addHomeItem(added, 'vase');
  const table = decorated.items.find(i => i.type === 'table'), removed = removeHomeItem(decorated, table.id);
  assert.equal(bp.items.length, 0); assert.equal(added.items.length, 1); assert.equal(decorated.items.length, 2); assert.equal(removed.items.length, 0);
  const history = [bp, added, decorated, removed];
  assert.deepEqual(history[2], decorated);
  assert.equal(new Set(decorated.items.map(i => i.id)).size, decorated.items.length);
});

test('reconciliation follows edited storey heights without changing authored room, roof or furniture coordinates in plan', () => {
  const bp = create(), next = copy(bp), room = next.floors[0].rooms[0];
  room.authored = true; next.roof.authored = true; next.roof.rise = 3.8;
  const item = next.items.find(i => i.floorId === next.floors[1].id); item.authored = true;
  next.floors[0].height += .4;
  const reconciled = reconcileHomeBlueprint(next), changed = reconciled.items.find(i => i.id === item.id);
  assert.deepEqual(reconciled.floors[0].rooms[0], room);
  assert.deepEqual(reconciled.roof, next.roof);
  assert.equal(changed.position.x, item.position.x); assert.equal(changed.position.z, item.position.z);
  assert.ok(Math.abs(changed.position.y - item.position.y - .4) < 1e-8);
  assert.equal(validateHomeBlueprint(reconciled).ok, true);
});

test('level-count transactions preserve remaining floor edits and remove only discarded dependents', () => {
  let bp = create({ floors: 1, attic: false });
  bp = editHomeRoom(bp, bp.floors[0].rooms[0].id, { type: 'study' }); bp = editHomeRoof(bp, { rise: 3.2 });
  bp.items[0].authored = true;
  const expanded = editHomeLevels(bp, { floors: 3, attic: true });
  assert.equal(expanded.floors.length, 4);
  assert.deepEqual(expanded.floors[0].rooms, bp.floors[0].rooms);
  assert.deepEqual(expanded.items.find(i => i.id === bp.items[0].id), bp.items[0]);
  assert.deepEqual(expanded.roof, bp.roof);
  assert.equal(validateHomeBlueprint(expanded).ok, true);
  const reduced = editHomeLevels(expanded, { floors: 1, attic: false });
  assert.equal(reduced.floors.length, 1); assert.equal(reduced.stairs.length, 0);
  assert.deepEqual(reduced.items, bp.items);
  assert.equal(validateHomeBlueprint(reduced).ok, true);
});

test('manual removal survives variation and deleted IDs never collide with fresh manual additions', () => {
  const bp = create(), removedId = bp.items[0].id, removed = removeHomeItem(bp, removedId), varied = varyHomeBlueprint(removed);
  assert.equal(varied.items.some(i => i.id === removedId), false);
  const a = addHomeItem(removed, 'plant'), b = addHomeItem(removeHomeItem(a, a.items.at(-1).id), 'plant');
  assert.notEqual(a.items.at(-1).id, b.items.at(-1).id);
});

test('concave plot fitting finds a usable region even when its envelope centre is outside the plot', () => {
  const plot = [{ x: -8, z: -8 }, { x: 8, z: -8 }, { x: 8, z: -2 }, { x: -2, z: -2 }, { x: -2, z: 8 }, { x: -8, z: 8 }];
  assert.equal(pointInPolygon({ x: 0, z: 0 }, plot), false);
  for (const shape of ['rectangle', 'angled', 'curved']) assert.equal(validateHomeBlueprint(create({ plot, shape })).ok, true);
});

test('clockwise freehand room boundaries retain inward door normals and valid access', () => {
  const bp = create({ shape: 'rectangle' });
  for (const floor of bp.floors) for (const room of floor.rooms) room.points.reverse();
  bp.openings = regenerateOpenings(bp);
  assert.equal(validateHomeBlueprint(bp).ok, true);
  for (const opening of bp.openings.filter(o => o.kind === 'door')) { const t = openingTransform(bp, opening); const inside = roomAt(bp, t.x + t.normal.x * .1, t.z + t.normal.z * .1, opening.floorId); assert.equal(inside?.id, opening.roomId); }
  assert.ok(deriveFloorOutline(bp.floors[0]).length > 4);
});

test('roof section overrides follow their semantic rooms when storeys or attic are changed', () => {
  const bp = create({ floors: 2, attic: true }), oldTop = bp.floors.at(-1);
  bp.roof.authored = true; bp.roof.sections = Object.fromEntries(oldTop.rooms.map((room, i) => [room.id, { type: i % 2 ? 'hip' : 'gable', rise: 1.6 + i * .2, ridgeOffset: i * .1, overhang: .25, authored: true }]));
  for (const edited of [editHomeLevels(bp, { floors: 3, attic: true }), editHomeLevels(bp, { floors: 1, attic: false })]) {
    assert.deepEqual(Object.keys(edited.roof.sections).sort(), edited.floors.at(-1).rooms.map(r => r.id).sort());
    edited.floors.at(-1).rooms.forEach((room, i) => assert.deepEqual(edited.roof.sections[room.id], bp.roof.sections[oldTop.rooms[i].id]));
    assert.deepEqual(varyHomeBlueprint(edited).roof, edited.roof);
  }
  const added = copy(bp); added.floors.at(-1).rooms.push({ ...copy(oldTop.rooms[0]), id: 'manual:roof-room', authored: true });
  const reconciled = reconcileHomeBlueprint(added);
  assert.ok(reconciled.roof.sections['manual:roof-room']);
  const removed = copy(bp); removed.floors.at(-1).rooms.pop();
  const repaired = reconcileHomeBlueprint(removed);
  assert.equal(repaired.roof.sections[oldTop.rooms.at(-1).id], undefined);
  assert.ok(removed.floors.at(-1).rooms.every(r => repaired.roof.sections[r.id]));
});

test('narrow row houses retain a physical passage beside each stacked stair and usable landing access', () => {
  for (const width of [5, 6, 8]) {
    const bp = create({ floors: 3, attic: true, plot: [{ x: -width / 2, z: -6 }, { x: width / 2, z: -6 }, { x: width / 2, z: 12 }, { x: -width / 2, z: 12 }] });
    assert.equal(validateHomeBlueprint(bp).ok, true);
    for (const stair of bp.stairs) {
      const floor = bp.floors.find(f => f.id === stair.toFloorId), hall = floor.rooms.find(r => r.type === 'hall'), xs = hall.points.map(p => p.x), leftGap = stair.x - stair.width / 2 - Math.min(...xs), rightGap = Math.max(...xs) - stair.x - stair.width / 2;
      assert.ok(leftGap >= .38 && rightGap >= .38, 'stair bypass must clear the player’s two-sided wall margin');
      const sideX = stair.x + stair.width / 2 + .2;
      for (const z of [stair.z - stair.depth / 2 - .2, stair.z, stair.z + stair.depth / 2 + .2]) assert.equal(roomAt(bp, sideX, z, floor.id)?.id, hall.id);
      assert.ok(bp.items.some(i => i.type === 'bed'));
    }
  }
});

test('roof reconciliation retains exposed lower-room overrides without assigning them to an unrelated upper room', () => {
  const bp = create({ shape: 'rectangle', floors: 2, attic: false }), living = bp.floors[0].rooms.find(r => r.type === 'living');
  living.points[0].x -= 2; living.points[3].x -= 2; living.authored = true;
  const override = { type: 'hip', rise: 1.1, ridgeOffset: .2, overhang: .15, authored: true };
  bp.roof.sections = { [living.id]: override }; bp.roof.authored = true;
  const next = reconcileHomeBlueprint(bp);
  assert.deepEqual(next.roof.sections[living.id], override);
  assert.ok(next.floors.at(-1).rooms.every(r => !next.roof.sections[r.id]), 'a lower-wing override must preserve the automatic upper union roof');
  const addedFloor = editHomeLevels(next, { floors: 3, attic: true });
  assert.deepEqual(addedFloor.roof.sections[living.id], override);
  assert.deepEqual(varyHomeBlueprint(addedFloor).roof, addedFloor.roof);
});

test('automatic facades have front and back windows on exterior walls without overlapping the entrance', () => {
  const bp = create({ shape: 'rectangle' }), floor = bp.floors[0];
  const windows = bp.openings.filter(o => o.floorId === floor.id && o.kind === 'window').map(o => ({ opening: o, at: openingTransform(bp, o) }));
  assert.ok(windows.some(w => w.at.normal.z < -.9), 'front facade has no window');
  assert.ok(windows.some(w => w.at.normal.z > .9), 'back facade has no window');
  for (const { opening, at } of windows) assert.equal(roomAt(bp, at.x - at.normal.x * .15, at.z - at.normal.z * .15, floor.id), null, `${opening.id} was generated on an interior wall`);
  const entry = bp.openings.find(o => o.exterior && o.kind === 'door');
  assert.equal(bp.openings.some(o => o.kind === 'window' && o.roomId === entry.roomId && o.edge === entry.edge), false);
  assert.equal(validateHomeBlueprint(bp).ok, true);
});

test('an attached extension removes automatic facade windows whose exterior has become another room', () => {
  const bp = create({ shape: 'rectangle', floors: 1, attic: false, plot: [{ x: -12, z: -8 }, { x: 12, z: -8 }, { x: 12, z: 12 }, { x: -12, z: 12 }] });
  const floor = bp.floors[0], living = floor.rooms.find(r => r.type === 'living'), x = living.points[0].x;
  floor.rooms.push({ id: 'addon', type: 'study', authored: true, points: [{ x: x - 3, z: 1 }, { x, z: 1 }, { x, z: 3 }, { x: x - 3, z: 3 }] });
  bp.openings = regenerateOpenings(bp);
  assert.equal(bp.openings.some(o => o.id === `${living.id}:window`), false, 'the original window and glass would block the new interior doorway');
  const door = bp.openings.find(o => o.roomId === 'addon' && o.kind === 'door'); assert.ok(door);
  const at = openingTransform(bp, door);
  assert.equal(roomAt(bp, at.x - at.normal.x * .15, at.z - at.normal.z * .15, floor.id)?.id, living.id);
});

test('variation rerolls automatic furniture in manually drawn rooms rather than emptying them', () => {
  const bp = create({ shape: 'rectangle', floors: 1, attic: false, plot: [{ x: -12, z: -8 }, { x: 12, z: -8 }, { x: 12, z: 12 }, { x: -12, z: 12 }] });
  bp.yard.items = [];
  const floor = bp.floors[0], x = floor.rooms.find(r => r.type === 'living').points[0].x;
  floor.rooms.push({ id: 'manual:studio', type: 'study', authored: true, needsFurnishing: true, points: [{ x: x - 4, z: 1 }, { x, z: 1 }, { x, z: 4 }, { x: x - 4, z: 4 }] });
  const reconciled = reconcileHomeBlueprint(bp), furnished = furnishPendingRooms(reconciled);
  const furniture = furnished.items.filter(i => i.anchor.targetId === 'manual:studio');
  assert.ok(furniture.length >= 2); assert.ok(furniture.every(i => !i.authored));
  const varied = varyHomeBlueprint(furnished), next = varied.items.filter(i => i.anchor.targetId === 'manual:studio');
  assert.deepEqual(next.map(i => i.id).sort(), furniture.map(i => i.id).sort());
  assert.notDeepEqual(next.map(i => i.position), furniture.map(i => i.position));
  assert.equal(varied.floors[0].rooms.find(r => r.id === 'manual:studio').needsFurnishing, false);
  assert.equal(validateHomeBlueprint(varied).ok, true);
});
