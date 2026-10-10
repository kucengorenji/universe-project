import * as THREE from 'three';

// Constants and scratch objects the town's controllers share (they were module-level in TownMode.js).
// The scratch vectors and matrices are single objects used for temporary maths inside one method at a time.
export const STREET_FOV = 55;
export const HOME_SHELLS = new Set(['f_house_small', 'f_house', 'f_house_tall', 'f_townhouse', 'm_house']);
export const UP = new THREE.Vector3(0, 1, 0);
export const ORIGIN = new THREE.Vector3();
export const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const _v = new THREE.Vector3();
export const _v2 = new THREE.Vector3();
export const _lightRot = new THREE.Matrix4();
export const _lightInv = new THREE.Matrix4();
