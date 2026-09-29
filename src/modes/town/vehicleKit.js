import * as THREE from 'three';

// Vehicles assembled from a kit (town.glb): a body without wheels, wheels
// (unit radius and width, axis X), accessories and horses. A recipe says
// where the wheels go, which accessories may be fitted and which paints the
// body comes in, so a handful of models make a street full of different cars.
// Positions are in the vehicle's frame: x right, y up, z forward (metres).

const PAINTS = {
  car: ['#b8433a', '#3f6fb0', '#eeeeea', '#2c2d31', '#b9bec4', '#e0b030', '#3f7d4d', '#dd7a33', '#2f8a8a', '#6e2a30', '#d5c9a8', '#27406a'],
  van: ['#eeeeea', '#b9bec4', '#3f6fb0', '#b8433a', '#e0b030'],
  truck: ['#b8433a', '#3f6fb0', '#b9bec4', '#2c2d31', '#3f7d4d', '#8a6a44'],
  sport: ['#d8342a', '#f0c020', '#ef7a1f', '#2a5fd0', '#1f1f22', '#7ac23a'],
  bus: ['#e0b030', '#eeeeea', '#3f7d4d', '#b8433a', '#3f6fb0'],
  accent: ['#b8433a', '#027b49', '#3f6fb0', '#fbb833', '#2c2d31'],
  horse: ['#7b5236', '#4e3524', '#a0764e', '#2e2622', '#c9b59a', '#8a5a3a'],
  cargo: ['#d6c9a4', '#8a9a6a', '#6f7f8f', '#b8a07a']
};

const ROOF = (y, z, len = 1.2, wide = 1.3) => ({ pick: ['va_roof_rack', 'va_roof_rack', 'va_roof_box'], p: 0.16, at: [0, y, z], scale: [wide, 1, len] });

export const RECIPES = {
  sedan: { body: 'vb_sedan', physics: 'sedan', paints: 'car', wheel: 'vw_road', r: 0.34, w: 0.28, x: 0.805, axles: [1.4, -1.35], acc: [ROOF(1.54, -0.32)] },
  taxi: { body: 'vb_sedan', physics: 'sedan', paints: ['#e8b320'], wheel: 'vw_road', r: 0.34, w: 0.28, x: 0.805, axles: [1.4, -1.35], acc: [{ pick: ['va_taxi_sign'], p: 1, at: [0, 1.54, -0.3] }] },
  police: {
    body: 'vb_sedan', physics: 'police', paints: ['#f2f2ee'], wheel: 'vw_road', r: 0.34, w: 0.28, x: 0.805, axles: [1.4, -1.35],
    acc: [{ pick: ['va_lightbar'], p: 1, at: [0, 1.54, -0.3] }, { pick: ['va_police_stripes'], p: 1, at: [0, 0.47, -0.1] }]
  },
  hatch: { body: 'vb_hatch', physics: 'hatch', paints: 'car', wheel: 'vw_road', r: 0.32, w: 0.26, x: 0.77, axles: [1.2, -1.2], acc: [ROOF(1.59, -0.65, 1.1, 1.2)] },
  suv: {
    body: 'vb_suv', physics: 'suv', paints: 'truck', wheel: 'vw_truck', r: 0.42, w: 0.3, x: 0.87, axles: [1.5, -1.5],
    acc: [{ pick: ['va_roof_rails'], p: 0.75, at: [0, 1.94, -0.8] }, { pick: ['va_bullbar'], p: 0.3, at: [0, 0.2, 2.45] }, { pick: ['va_roof_box'], p: 0.15, at: [0, 1.99, -0.8] }]
  },
  van: {
    body: 'vb_van', physics: 'van', paints: 'van', wheel: 'vw_road', r: 0.36, w: 0.28, x: 0.88, axles: [1.55, -1.6],
    acc: [{ pick: ['va_ladder'], p: 0.35, at: [0.3, 2.3, -0.6] }, { pick: ['va_stripe'], p: 0.55, at: [0, 1.1, -0.6], scale: [1, 1, 2.6], paint: 'accent' }]
  },
  pickup: {
    body: 'vb_pickup', physics: 'pickup', paints: 'truck', wheel: 'vw_truck', r: 0.42, w: 0.3, x: 0.855, axles: [1.65, -1.7],
    acc: [{ pick: ['va_cargo', 'va_crates'], p: 0.6, at: [0, 1.15, -1.6], paint: 'cargo' }, { pick: ['va_bullbar'], p: 0.25, at: [0, 0.25, 2.72] }]
  },
  bus: { body: 'vb_bus', physics: 'bus', paints: 'bus', wheel: 'vw_truck', r: 0.5, w: 0.34, x: 1.125, axles: [3.5, -3.1], acc: [{ pick: ['va_ac_unit'], p: 1, at: [0, 3.55, -0.5] }] },
  sport: { body: 'vb_sport', physics: 'sport', paints: 'sport', wheel: 'vw_sport', r: 0.34, w: 0.3, x: 0.87, axles: [1.35, -1.35], acc: [{ pick: ['va_spoiler'], p: 0.75, at: [0, 0.8, -2.05] }] },
  cart: {
    body: 'vb_cart', physics: 'cart', wheel: 'vw_wood', r: 0.62, w: 0.12, x: 0.95, axles: [-0.6], steer: 0, horses: [[0, 1.8]],
    acc: [{ pick: ['va_hay', 'va_hay', 'va_crates'], p: 0.75, at: [0, 1.08, -0.8] }]
  },
  wagon: {
    body: 'vb_wagon', physics: 'wagon', wheel: 'vw_wood', r: 0.55, w: 0.12, x: 1.0, axles: [0.4, -2.0], horses: [[-0.55, 2.1], [0.55, 2.1]],
    acc: [{ pick: ['va_barrels', 'va_crates', 'va_hay'], p: 0.85, at: [0, 1.14, -0.8] }]
  },
  caravan: { body: 'vb_caravan', physics: 'caravan', wheel: 'vw_wood', r: 0.6, w: 0.12, x: 1.05, axles: [0.2, -2.1], horses: [[-0.55, 2.4], [0.55, 2.4]], acc: [] }
};

/** Which recipes a town draws its vehicles from (weights). */
export const FLEETS = {
  modern: [['sedan', 6], ['hatch', 4], ['suv', 3], ['van', 2], ['pickup', 2], ['taxi', 1], ['police', 1], ['sport', 1]],
  fantasy: [['cart', 4], ['wagon', 2], ['caravan', 1]],
  bus: [['bus', 1]]
};

const color = (hex) => new THREE.Color(hex);
const pickOf = (list, rng) => list[Math.floor(rng() * list.length)];

export function pickRecipe(list, rng) {
  let total = 0;
  for (const [, w] of list) total += w;
  let r = rng() * total;
  for (const [k, w] of list) {
    r -= w;
    if (r <= 0) return k;
  }
  return list[0][0];
}

/** One vehicle from a recipe: body paint, wheels, fitted accessories, horses. */
export function assemble(type, rng) {
  const R = RECIPES[type] || RECIPES.sedan;
  const paints = Array.isArray(R.paints) ? R.paints : PAINTS[R.paints] || ['#ffffff'];
  const wheels = [];
  R.axles.forEach((z, k) => {
    for (const s of [-1, 1]) wheels.push({ kind: R.wheel, x: s * R.x, y: R.r, z, r: R.r, w: R.w, steer: k === (R.steer ?? 0) && R.axles.length > 1 });
  });
  const parts = [];
  for (const a of R.acc || []) {
    if (rng() > a.p) continue;
    const [sx, sy, sz] = a.scale || [1, 1, 1];
    parts.push({ asset: pickOf(a.pick, rng), x: a.at[0], y: a.at[1], z: a.at[2], sx, sy, sz, paint: a.paint ? color(pickOf(PAINTS[a.paint], rng)) : color('#ffffff') });
  }
  const horses = (R.horses || []).map(([x, z]) => ({ x, z, paint: color(pickOf(PAINTS.horse, rng)) }));
  return { type, physics: R.physics, body: R.body, paint: color(pickOf(paints, rng)), wheels, parts, horses };
}

// ---------------------------------------------------------------- a single assembled vehicle (outside the fleet)

/** A geometry sharing a pack model's buffers, so an instanced attribute can be added without touching the pack. */
export function wrapGeometry(src) {
  const g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(src.attributes)) g.setAttribute(k, a);
  g.index = src.index;
  g.boundingSphere = src.boundingSphere;
  g.boundingBox = src.boundingBox;
  return g;
}

let kitMat = null;
/** Toon material that reads the kit's paint (for scenes without the town's prop material). */
export function kitMaterial(makeToon) {
  if (kitMat) return kitMat;
  kitMat = makeToon({ vertexColors: true });
  kitMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float paint;\nattribute vec3 aPaint;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvColor.rgb *= mix(vec3(1.0), aPaint, paint);');
  };
  kitMat.customProgramCacheKey = () => 'vehicle-kit';
  return kitMat;
}

const _km = new THREE.Matrix4();
const _kr = new THREE.Matrix4();
const _kq = new THREE.Quaternion();
const _kv = new THREE.Vector3();

/** The kit vehicle as one group of single instances (so the paint path is the same as the fleet's). */
export function buildKitModel(kit, pack, material) {
  const group = new THREE.Group();
  const add = (asset, matrix, paint) => {
    const lods = pack?.[asset];
    if (!lods) return null;
    const geo = wrapGeometry(lods[0] || lods[1]);
    geo.setAttribute('aPaint', new THREE.InstancedBufferAttribute(new Float32Array(paint.toArray()), 3));
    const mesh = new THREE.InstancedMesh(geo, material, 1);
    mesh.setMatrixAt(0, matrix);
    mesh.frustumCulled = false;
    group.add(mesh);
    return mesh;
  };
  const white = new THREE.Color(1, 1, 1);
  add(kit.body, new THREE.Matrix4(), kit.paint);
  for (const p of kit.parts) add(p.asset, new THREE.Matrix4().compose(_kv.set(p.x, p.y, p.z), _kq.identity(), new THREE.Vector3(p.sx, p.sy, p.sz)), p.paint);
  for (const h of kit.horses) add('vh_horse', new THREE.Matrix4().makeTranslation(h.x, 0, h.z), h.paint);
  const wheels = kit.wheels.map((w) => ({ w, mesh: add(w.kind, new THREE.Matrix4(), white) })).filter((x) => x.mesh);
  const model = { group, wheels };
  poseKitWheels(model, 0, 0);
  return model;
}

/** Roll the wheels by the distance travelled and steer the front ones (angle > 0 turns left). */
export function poseKitWheels(model, dist, steer) {
  for (const { w, mesh } of model.wheels) {
    _km.makeTranslation(w.x, w.y, w.z);
    if (w.steer) _km.multiply(_kr.makeRotationY(steer));
    _km.multiply(_kr.makeRotationX(dist / w.r));
    _km.multiply(_kr.makeScale(w.w, w.r, w.r));
    mesh.setMatrixAt(0, _km);
    mesh.instanceMatrix.needsUpdate = true;
  }
}
