import { localToTown, townToLocal } from '../../world/buildingBlueprint.js';
import { footprintBounds, pointInPolygon } from '../home/homeBlueprint.js';

// Houses the player designed replace the generated shell on their lot: the old shell's
// collider and the trees inside the yard go, and the building carries its record, bounds
// and a new collider. Changes `layout` in place and returns the homes it applied.
export function applyAuthoredHomes(homes, layout, footprints) {
  for (const home of homes) {
    if (!home.applied) continue;
    const b = layout.buildings.find(building => building.id === home.buildingId);
    if (!b) continue;
    const f = footprints[b.asset];
    const ca = Math.cos(b.yaw), sa = Math.sin(b.yaw), sx = b.sx ?? 1, sz = b.sz ?? 1;
    const cx = f ? (f.minX + f.maxX) / 2 * sx : 0, cz = f ? (f.minZ + f.maxZ) / 2 * sz : 0;
    const x = b.x + ca * cx - sa * cz, z = b.z + sa * cx + ca * cz;
    const hw = f ? (f.maxX - f.minX) / 2 * sx : b.w / 2, hd = f ? (f.maxZ - f.minZ) / 2 * sz : b.d / 2;
    layout.colliders = layout.colliders.filter(c => !(c.type === 'box' && Math.hypot(c.x - x, c.z - z) < .25 && Math.abs(c.hw - hw) < .25 && Math.abs(c.hd - hd) < .25));
    b.homeRecord = home;
    b.homeBounds = footprintBounds(home.applied);
    b.homeHeight = Math.max(...home.applied.floors.map(floor => floor.elevation + floor.height)) + (home.applied.roof?.rise || 0);
    b.w = b.homeBounds.width;
    b.d = b.homeBounds.depth;
    const center = localToTown(home.origin, b.homeBounds.center);
    b.homeCollider = { type: 'box', x: center.x, z: center.z, hw: b.w / 2 + .12, hd: b.d / 2 + .12, yaw: home.origin.yaw };
    layout.colliders.push(b.homeCollider);
  }
  const removedTrees = layout.trees.filter(tree => homes.some(home => home.applied && pointInPolygon(townToLocal(home.origin, tree), home.applied.plot)));
  layout.trees = layout.trees.filter(tree => !removedTrees.includes(tree));
  layout.colliders = layout.colliders.filter(c => c.type !== 'circle' || !removedTrees.some(tree => Math.hypot(c.x - tree.x, c.z - tree.z) < .01));
return homes;
}
