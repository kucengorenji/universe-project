import * as THREE from 'three';

// Soft round contact shadows under feet, paws and dropped things (docs/FARM_PLAN.md §2.1): the
// grounding blob of the reference games, on top of the real shadow map. Smaller and fainter the
// higher the thing is off the ground. One instanced batch.

let texture = null;
function blobTexture() {
  if (texture) return texture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const c = canvas.getContext('2d');
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  return (texture = new THREE.CanvasTexture(canvas));
}

export class BlobShadows {
  constructor(capacity = 48) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: blobTexture(), color: '#3a2c44', transparent: true, opacity: 0.42, depthWrite: false }),
      capacity
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.name = 'blob-shadows';
    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._q = new THREE.Quaternion();
  }

  /** targets: [{ object, radius }]; ground: (x, z) => height. */
  update(targets, ground) {
    let n = 0;
    for (const { object, radius } of targets) {
      if (n >= this.mesh.instanceMatrix.count || !object.visible) continue;
      object.getWorldPosition(this._p);
      const floor = ground(this._p.x, this._p.z), lift = Math.max(0, this._p.y - floor);
      const k = 1 / (1 + lift * 1.6);
      this._p.y = floor + 0.03;
      this._s.set(radius * 2 * k, 1, radius * 2 * k);
      this.mesh.setMatrixAt(n++, this._m.compose(this._p, this._q, this._s));
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
