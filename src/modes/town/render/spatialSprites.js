import * as THREE from 'three';

// The tail of a stable, spatially mixed prefix fades before its instances stop
// being submitted. Changing density needs no matrix or attribute uploads.
export const SPRITE_DENSITY_FADE = 0.08;

function order(item) {
  let h = Math.imul(Math.round(item.x * 100), 73856093) ^ Math.imul(Math.round(item.z * 100), 19349663);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  return h >>> 0;
}

/** Stable prefixes must sample every clump, rather than keep scatter order. */
export function partitionSprites(items, cellSize) {
  const cells = new Map();
  for (const item of items) {
    const key = `${Math.floor(item.x / cellSize)},${Math.floor(item.z / cellSize)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(item);
  }
  return [...cells.values()].map(cell => cell.sort((a, b) => order(a) - order(b) || a.x - b.x || a.z - b.z || (a.y ?? 0) - (b.y ?? 0)));
}

/** Static sprite batches with conservative world bounds and reversible density. */
export class SpatialSprites {
  constructor(name) {
    this.group = new THREE.Group();
    this.group.name = name;
    this.meshes = [];
    this.batches = [];
    this.density = 1;
    this.activeCount = 0;
    this.lastTime = null;
    this.frustum = new THREE.Frustum();
    this.projection = new THREE.Matrix4();
    this.world = new THREE.Matrix4();
    this.sphere = new THREE.Sphere();
    this.cameraPosition = new THREE.Vector3();
  }

  add(mesh, count, sphere) {
    mesh.frustumCulled = true;
    this.group.add(mesh);
    this.meshes.push(mesh);
    this.batches.push({ mesh, count, sphere: sphere.clone() });
  }

  update(camera, reach, budget = 1, time = 0) {
    const target = THREE.MathUtils.clamp(Number.isFinite(budget) ? budget : 1, 0, 1);
    const dt = this.lastTime === null ? 0 : THREE.MathUtils.clamp(time - this.lastTime, 0, 0.1);
    this.lastTime = time;
    // A drop and recovery both take visible time; frame rate does not alter the ramp.
    this.density += THREE.MathUtils.clamp(target - this.density, -dt * 0.75, dt * 0.75);
    camera.updateMatrixWorld();
    camera.getWorldPosition(this.cameraPosition);
    this.group.updateWorldMatrix(true, false);
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projection);
    const submitted = this.density <= 0 ? 0 : Math.min(1, this.density + SPRITE_DENSITY_FADE);
    this.activeCount = 0;
    for (const batch of this.batches) {
      this.world.multiplyMatrices(this.group.matrixWorld, batch.mesh.matrix);
      this.sphere.copy(batch.sphere).applyMatrix4(this.world);
      const inRange = this.sphere.center.distanceTo(this.cameraPosition) - this.sphere.radius <= reach;
      const visible = submitted > 0 && inRange && this.frustum.intersectsSphere(this.sphere);
      const count = visible ? Math.ceil(batch.count * submitted) : 0;
      if (batch.mesh.isInstancedMesh) batch.mesh.count = count;
      else batch.mesh.geometry.instanceCount = count;
      batch.mesh.visible = count > 0;
      this.activeCount += count;
    }
    return this.density;
  }
}
