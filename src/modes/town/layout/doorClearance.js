import { buildingApproach } from '../../../world/buildingBlueprint.js';

const positionKey = (x, z) => `${x}:${z}`;

function blocksApproach(collider, approach) {
  const { start, end } = approach;
  const radius = 0.75; // The navigation walker uses 0.7 m, including its safety margin.
  if (collider.type === 'circle') {
    const dx = end.x - start.x, dz = end.z - start.z;
    const t = Math.max(0, Math.min(1, ((collider.x - start.x) * dx + (collider.z - start.z) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(collider.x - start.x - dx * t, collider.z - start.z - dz * t) < collider.r + radius;
  }
  const c = Math.cos(collider.yaw), s = Math.sin(collider.yaw);
  const local = point => ({ x: (point.x - collider.x) * c + (point.z - collider.z) * s, z: -(point.x - collider.x) * s + (point.z - collider.z) * c });
  const a = local(start), b = local(end);
  let near = 0, far = 1;
  for (const [axis, half] of [['x', collider.hw + radius], ['z', collider.hd + radius]]) {
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < 1e-9) {
      if (Math.abs(a[axis]) >= half) return false;
    } else {
      const p = (-half - a[axis]) / delta, q = (half - a[axis]) / delta;
      near = Math.max(near, Math.min(p, q));
      far = Math.min(far, Math.max(p, q));
      if (near >= far) return false;
    }
  }
  return true;
}

/** Omit dressing after planning, so doors clear without moving parcels or consuming another RNG stream. */
export function clearDoorApproaches(layout, footprints) {
  if (layout.layoutVersion < 5) return;
  const approaches = layout.buildings.flatMap(building => {
    const start = buildingApproach(building, footprints[building.asset]);
    if (!start) return [];
    return [{ start, end: { x: start.x - Math.sin(building.yaw) * 2.5, z: start.z + Math.cos(building.yaw) * 2.5 } }];
  });
  const objects = new Map();
  const index = (item, tree = false) => {
    if (item.parked || item.floating || item.deck) return;
    const points = [[item.x, item.z]];
    const f = !tree && footprints[item.asset];
    if (f) {
      const x = (f.minX + f.maxX) / 2, z = (f.minZ + f.maxZ) / 2, c = Math.cos(item.yaw), s = Math.sin(item.yaw);
      points.push([item.x + c * x - s * z, item.z + s * x + c * z]);
    }
    for (const [x, z] of points) {
      const key = positionKey(x, z);
      if (!objects.has(key)) objects.set(key, []);
      objects.get(key).push(item);
    }
  };
  layout.props.forEach(item => index(item));
  layout.trees.forEach(item => index(item, true));
  const removed = new Set();
  const blocked = new Set();
  for (const collider of layout.colliders) {
    const items = objects.get(positionKey(collider.x, collider.z));
    if (!items || !approaches.some(approach => blocksApproach(collider, approach))) continue;
    blocked.add(collider);
    items.forEach(item => removed.add(item));
  }
  layout.props = layout.props.filter(item => !removed.has(item));
  layout.trees = layout.trees.filter(item => !removed.has(item));
  layout.colliders = layout.colliders.filter(collider => !blocked.has(collider));
}
