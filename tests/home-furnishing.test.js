import test from 'node:test';
import assert from 'node:assert/strict';
import { t } from '../src/i18n/index.js';
import {
  createHomeBlueprint, reconcileHomeBlueprint, validateHomeBlueprint,
  removeHomeItem, placeHomeItem,
} from '../src/modes/home/homeBlueprint.js';
import { furnishPendingRooms } from '../src/modes/home/homeFurnishing.js';

const copy = value => structuredClone(value);
const rect = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
function withNewRoom(type = 'living', size = 4, floors = 1) {
  const bp = createHomeBlueprint({ id: 'furnishing', seed: 'rooms', floors, attic: false, shape: 'rectangle', plot: rect(-12, -12, 12, 12) });
  const original = validateHomeBlueprint(bp);
  assert.equal(original.ok, true, `Original fixture: ${original.errors}`);
  const room = { id: 'new-room', type, points: rect(bp.layout.x1, bp.layout.split, bp.layout.x1 + size, bp.layout.split + size), authored: true, needsFurnishing: true };
  bp.floors[0].rooms.push(room);
  const prepared = reconcileHomeBlueprint(bp);
  // The wing is drawn into previously landscaped land. Prepare that test lot
  // by clearing only automatic plants covered by its new footprint; furnishing
  // must retain every item that exists when Generate begins.
  const covered = new Set(validateHomeBlueprint(prepared).issues
    .filter(issue => issue.code === 'placement' && issue.message === t('home.err.yardThroughHouse'))
    .map(issue => issue.elementId));
  for (const item of prepared.yard.items.filter(item => covered.has(item.id))) assert.equal(item.authored, false);
  prepared.yard.items = prepared.yard.items.filter(item => !covered.has(item.id));
  const baseline = validateHomeBlueprint(prepared);
  assert.equal(baseline.ok, true, `Prepared fixture: ${baseline.errors}`);
  return prepared;
}

test('Generate furnishes only new pending rooms with deterministic automatic IDs', () => {
  const essential = { living: 'sofa', bedroom: 'bed', bathroom: 'toilet', kitchen: 'kitchen', study: 'table', loft: 'shelf' };
  for (const [type, expected] of Object.entries(essential)) {
    const bp = withNewRoom(type), snapshot = copy(bp), result = furnishPendingRooms(bp);
    assert.deepEqual(bp, snapshot);
    assert.deepEqual(result, furnishPendingRooms(bp));
    const generated = result.items.filter(item => item.id.startsWith('new-room:generated:'));
    assert.ok(generated.some(item => item.type === expected), type);
    assert.ok(generated.every(item => !item.authored && item.anchor.targetId === 'new-room'));
    assert.ok(generated.every(item => item.id === `new-room:generated:${item.type}:0`));
    assert.deepEqual(result.items.filter(item => !item.id.startsWith('new-room:generated:')), bp.items);
    assert.deepEqual(result.yard, bp.yard);
    assert.equal(result.nextItemId, bp.nextItemId);
    assert.equal(result.floors[0].rooms.at(-1).needsFurnishing, false);
    assert.equal(validateHomeBlueprint(result).ok, true, `${type}: ${validateHomeBlueprint(result).errors}`);
  }
});

test('manual furniture keeps its identity, type and transform while covering its room function', () => {
  let bp = withNewRoom('study');
  const room = bp.floors[0].rooms.at(-1), manual = {
    id: 'manual-chair', type: 'chair', floorId: bp.floors[0].id,
    position: { x: room.points[0].x + 2, y: 0, z: room.points[0].z + 2 },
    rotation: 0, authored: true, anchor: { kind: 'floor', targetId: room.id },
  };
  bp.items.push(manual);
  const placed = placeHomeItem(bp, manual.id, manual.position);
  assert.equal(placed.ok, true);
  bp = placed.blueprint;
  const before = copy(bp.items), result = furnishPendingRooms(bp);
  assert.deepEqual(result.items.filter(item => before.some(old => old.id === item.id)), before);
  assert.deepEqual(result.items.find(item => item.id === manual.id), bp.items.find(item => item.id === manual.id));
  assert.equal(result.items.filter(item => item.type === 'chair' && item.anchor.targetId === room.id).length, 1);
  assert.equal(validateHomeBlueprint(result).ok, true);
});

test('repeated Generate does not duplicate furniture or restore a deleted automatic item', () => {
  const furnished = furnishPendingRooms(withNewRoom());
  assert.equal(furnishPendingRooms(furnished), furnished);
  const id = 'new-room:generated:sofa:0', removed = removeHomeItem(furnished, id);
  assert.equal(furnishPendingRooms(removed), removed);
  const pendingAgain = copy(removed);
  pendingAgain.floors[0].rooms.at(-1).needsFurnishing = true;
  const result = furnishPendingRooms(pendingAgain);
  assert.equal(result.items.some(item => item.id === id), false);
  assert.deepEqual(result.items, removed.items);
  assert.deepEqual(result.deletedItemIds, removed.deletedItemIds);
});

test('small rooms skip unfitting furniture and hall rooms receive no furniture', () => {
  const small = furnishPendingRooms(withNewRoom('bedroom', 1.6));
  assert.equal(small.items.some(item => item.id === 'new-room:generated:bed:0'), false);
  assert.equal(validateHomeBlueprint(small).ok, true, validateHomeBlueprint(small).errors.join('; '));
  const bp = withNewRoom();
  bp.floors[0].rooms.at(-1).type = 'hall';
  const hall = furnishPendingRooms(bp);
  assert.deepEqual(hall.items, bp.items);
  assert.equal(hall.floors[0].rooms.at(-1).needsFurnishing, false);
});

test('generated furniture respects the full house door and stair clearances', () => {
  const bp = withNewRoom('study', 4, 2), room = bp.floors[0].rooms.at(-1);
  const upper = { ...copy(room), id: 'new-upper-room', needsFurnishing: false };
  bp.floors[1].rooms.push(upper);
  bp.stairs.push({ id: 'new-room-stair', fromFloorId: bp.floors[0].id, toFloorId: bp.floors[1].id, x: room.points[0].x + 2, z: room.points[0].z + 2, width: 1, depth: 3 });
  const result = furnishPendingRooms(reconcileHomeBlueprint(bp));
  assert.equal(validateHomeBlueprint(result).ok, true, validateHomeBlueprint(result).errors.join('; '));
  assert.ok(result.items.filter(item => item.id.startsWith('new-room:generated:')).every(item => placeHomeItem(result, item.id, item.position, { authored: false }).ok));
});

test('a pending room outside the plot acquires no automatic furniture', () => {
  const bp = withNewRoom();
  bp.floors[0].rooms.at(-1).points = bp.floors[0].rooms.at(-1).points.map(p => ({ x: p.x + 30, z: p.z }));
  const result = furnishPendingRooms(reconcileHomeBlueprint(bp));
  assert.deepEqual(result.items, bp.items);
  assert.equal(result.floors[0].rooms.at(-1).needsFurnishing, false);
});
