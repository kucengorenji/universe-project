import { addHomeItem, placeHomeItem, pointInPolygon, sampleRoom, validateHomeBlueprint } from './homeBlueprint.js';

const FURNITURE = {
  living: ['sofa', 'table', 'chair', 'rug', 'lamp'],
  bedroom: ['bed', 'wardrobe', 'lamp', 'rug'],
  bathroom: ['sink', 'toilet', 'bath'],
  kitchen: ['kitchen', 'sink', 'table', 'chair'],
  study: ['table', 'chair', 'shelf'],
  loft: ['shelf', 'rug', 'chair'],
  hall: [],
};

/** Fill newly drawn rooms once, retaining every existing item and manual edit. */
export function furnishPendingRooms(bp) {
  const pending = bp.floors.flatMap(floor => floor.rooms
    .filter(room => room.needsFurnishing)
    .map(room => ({ floorId: floor.id, roomId: room.id })));
  if (!pending.length) return bp;

  let next = structuredClone(bp);
  const deleted = new Set(bp.deletedItemIds || []);
  const invalidRooms = new Set(validateHomeBlueprint(bp).issues
    .filter(issue => ['room-shape', 'plot-boundary', 'room-overlap'].includes(issue.code))
    .map(issue => issue.elementId));
  for (const { floorId, roomId } of pending) {
    next.floors.find(floor => floor.id === floorId).rooms.find(room => room.id === roomId).needsFurnishing = false;
    if (invalidRooms.has(roomId)) continue;
    const slots = new Map();
    const room = next.floors.find(floor => floor.id === floorId).rooms.find(room => room.id === roomId);
    for (const type of FURNITURE[room.type] || []) {
      const slot = slots.get(type) || 0;
      slots.set(type, slot + 1);
      const id = `${roomId}:generated:${type}:${slot}`;
      if (deleted.has(id) || next.items.some(item => item.id === id)) continue;
      const existing = next.items.filter(item => item.floorId === floorId && item.type === type &&
        (item.anchor?.targetId === roomId || pointInPolygon(item.position, sampleRoom(room))));
      if (existing.length > slot) continue;

      // Restrict candidates to this room while retaining collision objects,
      // door sockets, stairs and the plot from the complete blueprint.
      const scoped = structuredClone(next);
      scoped.floors.find(floor => floor.id === floorId).rooms = [structuredClone(room)];
      const populated = addHomeItem(scoped, type, floorId);
      if (populated.items.length === scoped.items.length) continue;
      const candidate = {
        ...populated.items.at(-1), id, authored: false,
        anchor: { kind: 'floor', targetId: roomId },
      };

      // Validate again with all room/door boundaries present. A room too small
      // for an item remains usable instead of acquiring invalid furniture.
      const trial = structuredClone(next);
      trial.items.push(candidate);
      const placed = placeHomeItem(trial, id, { ...candidate.position, rotation: candidate.rotation }, { authored: false });
      if (placed.ok) next = placed.blueprint;
    }
  }
  return next;
}
