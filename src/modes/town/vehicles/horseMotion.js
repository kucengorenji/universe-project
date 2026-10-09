import * as THREE from 'three';

// Rigid upper/lower leg regions remain in one instanced draw call per horse LOD.
// Forward travel, not elapsed time, drives the diagonal trot; parked horses stand still.
export function horseGait(distance, speed, offset = 0) {
  return [distance * Math.PI * 2 / 1.15 + offset * .3, THREE.MathUtils.smoothstep(Math.abs(speed), .05, .8)];
}

const deform = /* glsl */`
attribute float horsePart;
attribute vec2 aHorseMotion;
vec3 horseRotate(vec3 p, float a) {
  float c = cos(a), s = sin(a);
  return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
}
vec3 horsePose(vec3 p, bool normal) {
  if (horsePart < .5) return p;
  float leg = floor((horsePart - 1.0) / 2.0);
  bool lower = mod(horsePart, 2.0) < .5;
  bool right = mod(leg, 2.0) > .5;
  bool rear = leg > 1.5;
  float offset = (right != rear) ? .5 : 0.0;
  float t = fract(aHorseMotion.x / 6.28318530718 + offset);
  float swing = max(0.0, (t - .6) / .4);
  float hip = (t < .6 ? mix(-.48, .48, t / .6) : .48 * cos(swing * 3.14159265359)) * aHorseMotion.y;
  float knee = sin(swing * 3.14159265359) * .9 * aHorseMotion.y;
  vec3 pivot = vec3(right ? .235 : -.235, .80, rear ? -.38 : .30);
  if (lower) {
    vec3 joint = vec3(pivot.x, .44, pivot.z);
    p = normal ? horseRotate(p, knee) : joint + horseRotate(p - joint, knee);
  }
  return normal ? horseRotate(p, hip) : pivot + horseRotate(p - pivot, hip);
}
`;

function patch(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n' + deform)
    .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = horsePose(objectNormal, true);')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = horsePose(transformed, false);');
}
const materials = new WeakMap();
export function horseMaterials(base) {
  if (materials.has(base)) return materials.get(base);
  const material = base.clone();
  material.defaultAttributeValues = { ...base.defaultAttributeValues };
  material.onBeforeCompile = shader => { base.onBeforeCompile(shader); patch(shader); };
  material.customProgramCacheKey = () => base.customProgramCacheKey() + '-horse-trot-v1';
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  const distance = new THREE.MeshDistanceMaterial();
  for (const shadow of [depth, distance]) {
    shadow.onBeforeCompile = patch;
    shadow.customProgramCacheKey = () => 'horse-trot-shadow-v1';
  }
  const result = { material, depth, distance };
  materials.set(base, result);
  return result;
}

export function attachHorseMotion(mesh) {
  const { material, depth, distance } = horseMaterials(mesh.material);
  mesh.material = material;
  mesh.customDepthMaterial = depth;
  mesh.customDistanceMaterial = distance;
  if (!mesh.geometry.attributes.horsePart) mesh.geometry.setAttribute('horsePart', new THREE.BufferAttribute(new Float32Array(mesh.geometry.attributes.position.count), 1));
  const motion = new THREE.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count * 2), 2).setUsage(THREE.DynamicDrawUsage);
  mesh.geometry.setAttribute('aHorseMotion', motion);
  return motion;
}
