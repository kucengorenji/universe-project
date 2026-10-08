import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applySurfaceCoordinates } from '../../../render/townSurfaces.js';

/** Planks follow the existing analytical deck, preserving the bridge's collision and ramps. */
export function pixelBridgeDecks(builder) {
  const group = new THREE.Group(); group.name = 'Town.pixelBridgeDecks';
  const parts = [], color = new THREE.Color();
  for (const bridge of builder.bridges) {
    const length = bridge.tB - bridge.tA, count = Math.ceil(length / .65), step = length / count;
    for (let i = 0; i < count; i++) {
      const t = bridge.tA + (i + .5) * step;
      const y = builder.bridgeHeight(bridge, t);
      const slope = (builder.bridgeHeight(bridge, Math.min(bridge.tB, t + .15)) - builder.bridgeHeight(bridge, Math.max(bridge.tA, t - .15))) / .3;
      const geometry = new THREE.BoxGeometry(step - .025, .06, Math.max(1, bridge.hw * 2 - .7)).toNonIndexed();
      geometry.rotateZ(Math.atan(slope)); geometry.rotateY(-Math.atan2(bridge.s, bridge.c));
      geometry.translate(bridge.x + bridge.c * t, y + .045, bridge.z + bridge.s * t);
      color.set(i % 5 === 0 ? '#cfaa6a' : i % 3 === 0 ? '#ad854e' : '#bf985d');
      const colors = new Float32Array(geometry.attributes.position.count * 3);
      for (let k = 0; k < geometry.attributes.position.count; k++) color.toArray(colors, k * 3);
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      applySurfaceCoordinates(geometry, 3); parts.push(geometry);
    }
  }
  const owned = [];
  if (parts.length) {
    const geometry = mergeGeometries(parts); parts.forEach(part => part.dispose());
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geometry, material); mesh.receiveShadow = true;
    group.add(mesh); owned.push(geometry, material);
  }
  return { group, dispose: () => owned.forEach(item => item.dispose()) };
}
