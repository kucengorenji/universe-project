import { buildingId } from '../../../world/identity.js';
import { describeBuilding, buildingApproach, localToTown } from '../../../world/buildingBlueprint.js';
import { openingTransform } from '../../home/homeBlueprint.js';

// Front doors of every building the player can go into, as portals: where to stand to
// use the door, which way is out, and the blueprint the interior is built from.
// Plain data in, plain data out (no three.js), so it can be checked without a browser.

/**
 * `enterable` maps shell asset names to true; `hasInteriors` is false while the furniture pack
 * is missing (then no building can be entered).
 */
export function findTownDoors(layout, footprints, { enterable, hasInteriors = true }) {
  const doors = [];
  layout.buildings.forEach((b, i) => {
    if (!enterable[b.asset] || !hasInteriors) return;
    b.id ||= buildingId(layout.seed, b);
    if (b.homeRecord) {
      const bp = b.homeRecord.applied, bounds = b.homeBounds;
      const ground = bp.floors.find(floor => floor.index === 0) || bp.floors[0];
      const door = bp.openings.find(opening => opening.kind === 'door' && opening.exterior !== false && opening.floorId === ground.id);
      const socket = door ? openingTransform(bp, door) : { x: bounds.center.x, z: bounds.maxZ };
      const normal = socket.normal ? { x: -socket.normal.x, z: -socket.normal.z } : { x: 0, z: 1 };
      let reach = .95;
      if (normal.x > .01) reach = Math.max(reach, (bounds.maxX - socket.x) / normal.x + .95);
      if (normal.x < -.01) reach = Math.max(reach, (bounds.minX - socket.x) / normal.x + .95);
      if (normal.z > .01) reach = Math.max(reach, (bounds.maxZ - socket.z) / normal.z + .95);
      if (normal.z < -.01) reach = Math.max(reach, (bounds.minZ - socket.z) / normal.z + .95);
      const approach = localToTown(b.homeRecord.origin, { x: socket.x + normal.x * reach, z: socket.z + normal.z * reach });
      const direction = localToTown({ x: 0, z: 0, yaw: b.yaw }, normal);
      b.blueprint = { id: b.id, floors: bp.floors.length, portalId: `${b.id}:entrance`, footprint: { w: bounds.width, d: bounds.depth } };
      doors.push({ b, i, ...approach, outYaw: Math.atan2(direction.x, direction.z) });
      return;
    }
    b.blueprint = describeBuilding(b);
    const fx = -Math.sin(b.yaw);
    const fz = Math.cos(b.yaw);
    const approach = buildingApproach(b, footprints[b.asset]);
    if (approach) doors.push({ b, i, ...approach, outYaw: Math.atan2(fx, fz) });
  });
  return doors;
}

/** The door closest to (x, z) within `reach` metres, or null. */
export function nearestDoor(doors, x, z, reach = 2.4) {
  let best = null;
  let bestD = reach;
  for (const d of doors) {
    const dd = Math.hypot(d.x - x, d.z - z);
    if (dd < bestD) {
      bestD = dd;
      best = d;
    }
  }
  return best;
}
