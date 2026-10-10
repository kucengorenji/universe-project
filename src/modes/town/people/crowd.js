import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../../math/random.js';
import { appearanceFor } from './peopleAppearance.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Stylised people, drawn as instanced body parts (4 draw calls for the whole
// crowd, however many walkers there are). Distant silhouettes share the near humanoids' proportions;
// frame: legs and arms swing with the walk cycle, the body bobs.
//
// The player avatar is person #0 of the same crowd, unless a rigged model is
// provided (see TownMode), in which case #0 is hidden.

const PART = {
  // name: [geometry builder, pivot (x, y, z) in the body frame]
  head: () => {
    const parts = [
      new THREE.SphereGeometry(.15, 10, 6).scale(.9, 1.12, .85).translate(0, .16, 0).toNonIndexed(),
      new THREE.SphereGeometry(.156, 10, 4, 0, Math.PI * 2, 0, Math.PI * .47).scale(.94, 1.15, .9).translate(0, .16, -.008).toNonIndexed()
    ];
    parts.forEach((part, i) => part.setAttribute('aHair', new THREE.BufferAttribute(new Float32Array(part.attributes.position.count).fill(i), 1)));
    const g = mergeGeometries(parts);
    parts.forEach(part => part.dispose());
    return g;
  },
  torso: () =>
    mergeGeometries([
      new RoundedBoxGeometry(.44, .52, .26, 1, .045).translate(0, .26, 0),
      new RoundedBoxGeometry(.40, .16, .24, 1, .03).translate(0, -.06, 0)
    ]),
  arm: () => new RoundedBoxGeometry(.11, .58, .12, 1, .035).translate(0, -.27, 0),
  leg: () => new RoundedBoxGeometry(.15, .82, .16, 1, .04).translate(0, -.41, -.02)
};

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _c = new THREE.Color();

export class Crowd {
  constructor(count, { modern, seed, shadows }) {
    this.count = count;
    this.people = [];
    this.group = new THREE.Group();
    const mat = new THREE.MeshToonMaterial({ color: 0xffffff });
    this.material = mat;
    const make = (geo, n, material = mat) => {
      const m = new THREE.InstancedMesh(geo, material, n);
      m.castShadow = shadows;
      m.frustumCulled = false; // people move: bounds would go stale
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
      return m;
    };
    this.headMaterial = mat.clone();
    this.headMaterial.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aHair;\nattribute vec3 aHairColor;')
        .replace('#include <color_vertex>', '#include <color_vertex>\nvColor.rgb = mix(vColor.rgb, aHairColor, aHair);');
    };
    this.headMaterial.customProgramCacheKey = () => 'cozy-crowd-hair';
    const headGeometry = PART.head();
    this.hairColors = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    headGeometry.setAttribute('aHairColor', this.hairColors);
    this.head = make(headGeometry, count, this.headMaterial);
    this.torso = make(PART.torso(), count);
    this.arms = make(PART.arm(), count * 2);
    this.legs = make(PART.leg(), count * 2);
    const rng = mulberry32(seed);
    for (let i = 0; i < count; i++) {
      rng(); rng(); rng(); // retain the established motion/height random stream
      const appearance = appearanceFor(seed*131+i);
      const skin = appearance.skin;
      _c.set(appearance.hair).toArray(this.hairColors.array, i * 3);
      const shirt = appearance.top;
      const pants = appearance.legs;
      const height = 0.92 + rng() * 0.16;
      this.head.setColorAt(i, _c.set(skin));
      this.torso.setColorAt(i, _c.set(shirt));
      this.arms.setColorAt(i * 2, _c.set(shirt));
      this.arms.setColorAt(i * 2 + 1, _c.set(shirt));
      this.legs.setColorAt(i * 2, _c.set(pants));
      this.legs.setColorAt(i * 2 + 1, _c.set(pants));
      this.people.push({ x: 0, y: 0, z: 0, yaw: 0, phase: rng() * 10, speed: 0, height, visible: true, jump: 0 });
    }
    [this.head, this.torso, this.arms, this.legs].forEach((m) => (m.instanceColor.needsUpdate = true));
    this.hairColors.needsUpdate = true;
  }

  /** Recolour person i (the player wears the faction colour). */
  dress(i, { shirt, pants, skin }) {
    if (skin !== undefined) this.head.setColorAt(i, _c.set(skin));
    if (shirt !== undefined) {
      this.torso.setColorAt(i, _c.set(shirt));
      this.arms.setColorAt(i * 2, _c.set(shirt));
      this.arms.setColorAt(i * 2 + 1, _c.set(shirt));
    }
    if (pants !== undefined) {
      this.legs.setColorAt(i * 2, _c.set(pants));
      this.legs.setColorAt(i * 2 + 1, _c.set(pants));
    }
    [this.head, this.torso, this.arms, this.legs].forEach((m) => (m.instanceColor.needsUpdate = true));
  }

  /** Write every person's pose into the instance buffers. */
  pose() {
    for (let i = 0; i < this.count; i++) {
      const p = this.people[i];
      if (!p.visible) {
        _m.makeScale(0, 0, 0);
        this.head.setMatrixAt(i, _m);
        this.torso.setMatrixAt(i, _m);
        this.arms.setMatrixAt(i * 2, _m);
        this.arms.setMatrixAt(i * 2 + 1, _m);
        this.legs.setMatrixAt(i * 2, _m);
        this.legs.setMatrixAt(i * 2 + 1, _m);
        continue;
      }
      const run = THREE.MathUtils.clamp(p.speed / 3.2, 0, 1.6);
      const swing = Math.sin(p.phase) * Math.min(1,p.speed/.8) * (.32 + run * .17);
      const bob = (1-Math.cos(p.phase*2)) * .012 * Math.min(1,p.speed) + p.jump;
      const k = p.height;
      // Body frame: position, yaw (front = +Z), uniform height scale
      const body = _m2.compose(_v.set(p.x, p.y + bob, p.z), _q.setFromEuler(_e.set(0, p.yaw, 0)), _s.setScalar(k));
      const part = (mesh, idx, px, py, pz, rx = 0) => {
        _m.compose(_v.set(px, py, pz), _q.setFromEuler(_e.set(rx, 0, 0)), _s.set(1, 1, 1));
        mesh.setMatrixAt(idx, _m.premultiply(body));
      };
      const lean = Math.min(0.14, p.speed * 0.024);
      part(this.torso, i, 0, .94, 0, lean);
      part(this.head, i, 0, 1.47, lean * 0.4);
      part(this.arms, i * 2, -.285, 1.42, 0, swing);
      part(this.arms, i * 2 + 1, .285, 1.42, 0, -swing);
      part(this.legs, i * 2, -.1, .86, 0, -swing * 1.1);
      part(this.legs, i * 2 + 1, .1, .86, 0, swing * 1.1);
    }
    [this.head, this.torso, this.arms, this.legs].forEach((m) => (m.instanceMatrix.needsUpdate = true));
  }

  dispose() {
    [this.head, this.torso, this.arms, this.legs].forEach((m) => {
      m.geometry.dispose();
      m.dispose();
    });
    this.material.dispose();
    this.headMaterial.dispose();
  }
}

// Keep the crowd renderer independent of the pure navigation controller.
export { Pedestrians } from '../navigation/pedestrianRoutes.js';
