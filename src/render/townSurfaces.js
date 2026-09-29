import * as THREE from 'three';

// Atlas indices match tools/blender/paint_living_surfaces.py. Preserve authored
// colours, night windows and vehicle paint; texture carries only surface detail.
export function surfaceForMaterial(name = '') {
  const n = name.replace(/^M_/, '');
  if (/glass|lamp|fire|engine|screen|paint|skin|hair/.test(n)) return 0;
  if (/plaster/.test(n)) return 1;
  if (/brick/.test(n)) return 2;
  if (/bark|palm_trunk/.test(n)) return 8;
  if (/wood|timber|door/.test(n)) return 3;
  if (/stone|rock/.test(n)) return 4;
  if (/roof_slate|roof_blue/.test(n)) return 6;
  if (/roof/.test(n)) return 5;
  if (/steel|iron|metal/.test(n)) return 7;
  if (/canvas|fabric|cloth/.test(n)) return 14;
  if (/concrete|asphalt/.test(n)) return 15;
  return 0;
}

export function applySurfaceCoordinates(geometry, tile) {
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  const p = geometry.attributes.position, n = geometry.attributes.normal;
  const values = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)), nz = Math.abs(n.getZ(i));
    const u = nx > nz && nx > ny ? p.getZ(i) : p.getX(i);
    const v = ny > nx && ny > nz ? p.getZ(i) : p.getY(i);
    values.set([u * .5, v * .5, tile], i * 3);
  }
  geometry.setAttribute('surface', new THREE.BufferAttribute(values, 3));
  return geometry;
}

let atlas;
export function loadTownSurfaces(url) {
  return atlas ||= new THREE.TextureLoader().loadAsync(url).then(t => {
    // Neutral modulation data, not a second albedo colour transform.
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 4;
    return t;
  }).catch(error => { atlas = null; throw error; });
}
