import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getToonGradient } from '../../render/assetLibrary.js';
import { HALF, SIZE, RES, WATER_Y, COVER, heightAt, walk } from './generateField.js';
import { paintGround, inPoly } from './groundPaint.js';
import { mulberry32 } from '../../math/random.js';
import { FACTIONS } from '../units/soldierLook.js';

// Builds the 3D battlefield from generateField() data: painted terrain with an apron to the
// horizon, the river and its bridges, the trench with plank revetments, village houses and
// trees from town.glb, fortifications and camps from military.glb, wheat and rough grass.
// Everything repeated is instanced; every material is toon, so the canvas hatching reaches it.

const ROOF = new THREE.Color('#9a5a42');
const TREE_KIND = { t_oak: 3, t_birch: 2, t_pine: 2, t_spruce: 2, t_fruit: 2 };
const TREE_H = { t_oak: 9, t_birch: 9, t_pine: 12, t_spruce: 13, t_fruit: 6 };

/** Toon material for pack geometry: vertex colours, M_paint tinted per instance, roofs painted, M_radiator glowing. */
function packMaterial({ glow = 0 } = {}) {
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() });
  m.onBeforeCompile = (s) => {
    s.uniforms.uRoof = { value: ROOF };
    s.uniforms.uGlow = { value: glow };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float paint;\nattribute float roof;\nattribute float emissive;\nuniform vec3 uRoof;\nvarying float vGlow;')
      .replace('#include <color_vertex>', `
        vColor = color;
        if (roof > 0.5) vColor.rgb = uRoof * (roof > 1.5 ? 0.72 : 1.0);
        #ifdef USE_INSTANCING_COLOR
          vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, paint);
        #endif
        vGlow = emissive;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGlow;\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow * uGlow;');
  };
  m.customProgramCacheKey = () => 'skirmish-pack';
  return m;
}

/** Geometry missing an attribute the pack material reads gets it, filled with zeros. */
function ensureAttrs(geo) {
  const n = geo.attributes.position.count;
  for (const a of ['paint', 'roof', 'emissive']) if (!geo.attributes[a]) geo.setAttribute(a, new THREE.BufferAttribute(new Float32Array(n), 1));
  if (!geo.attributes.color) geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return geo;
}

export class FieldBuilder {
  /**
   * @param field  generateField() output
   * @param packs  { town, military } from loadAssetPack (asset -> {0: geometry})
   */
  constructor(field, packs, { shadows = true } = {}) {
    this.field = field;
    this.packs = packs;
    this.shadows = shadows;
    this.group = new THREE.Group();
    this.group.name = 'battlefield';
    this.disposables = [];
    this.material = packMaterial({ glow: 1 });
    this.disposables.push(this.material);
    this.animated = [];
    this.buildTerrain();
    this.buildWater();
    this.buildTrenches();
    this.buildHouses();
    this.buildTrees();
    this.buildHedges();
    this.buildGrass();
    this.buildMilitary();
  }

  y(x, z) {
    return heightAt(this.field, x, z);
  }

  own(o) {
    if (o.geometry) this.disposables.push(o.geometry);
    if (o.material && o.material !== this.material) this.disposables.push(o.material);
    this.group.add(o);
    return o;
  }

  // ---------------------------------------------------------------- terrain
  buildTerrain() {
    const f = this.field;
    const n = f.n;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, n - 1, n - 1).rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, f.heights[i]);
    geo.computeVertexNormals();
    const canvas = paintGround(f, 2048);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    this.disposables.push(tex);
    const ground = this.own(new THREE.Mesh(geo, new THREE.MeshToonMaterial({ map: tex, gradientMap: getToonGradient() })));
    ground.receiveShadow = this.shadows;
    ground.name = 'ground';
    this.ground = ground;
    this.groundCanvas = canvas;

    // apron: the edge heights fade to rolling country out to the horizon
    const R0 = HALF * Math.SQRT2 + 2, R1 = 900;
    const rings = 14, segs = 96;
    const ap = [];
    const col = [];
    const grass = new THREE.Color('#8fa35c'), far = new THREE.Color('#a9b47a');
    for (let r = 0; r <= rings; r++) {
      const t = r / rings;
      const rad = HALF + (R1 - HALF) * t * t;
      for (let s = 0; s <= segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        let x = Math.cos(a) * rad, z = Math.sin(a) * rad;
        if (r === 0) {
          // the inner ring hugs the square map edge
          const k = HALF / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
          x = Math.cos(a) * k;
          z = Math.sin(a) * k;
        }
        const edge = this.y(THREE.MathUtils.clamp(x, -HALF, HALF), THREE.MathUtils.clamp(z, -HALF, HALF));
        // a plain that falls away gently into the fog: no ridge is drawn against the sky
        const h = THREE.MathUtils.lerp(edge, -2 - 25 * t, Math.min(1, t * 4)) - (r === 0 ? 0.02 : 0);
        ap.push(x, h, z);
        const c = grass.clone().lerp(far, t);
        col.push(c.r, c.g, c.b);
      }
    }
    const idx = [];
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < segs; s++) {
        const a = r * (segs + 1) + s, b = a + segs + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const ageo = new THREE.BufferGeometry();
    ageo.setAttribute('position', new THREE.Float32BufferAttribute(ap, 3));
    ageo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    ageo.setIndex(idx);
    // lit as flat ground: the far slopes sink out of sight without turning dark (and hatched)
    ageo.setAttribute('normal', new THREE.Float32BufferAttribute(Array.from({ length: ap.length / 3 }, () => [0, 1, 0]).flat(), 3));
    const apron = this.own(new THREE.Mesh(ageo, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() })));
    apron.receiveShadow = this.shadows;
  }

  // ---------------------------------------------------------------- water, bridges
  buildWater() {
    const f = this.field;
    if (!f.river) return;
    const pts = walk(f.river.pts, 2);
    const w = f.river.width / 2 + 2.5;
    const pos = [];
    const idx = [];
    pts.forEach((p, i) => {
      pos.push(p.x - p.tz * w, WATER_Y, p.z + p.tx * w, p.x + p.tz * w, WATER_Y, p.z - p.tx * w);
      if (i) idx.push((i - 1) * 2, i * 2, (i - 1) * 2 + 1, i * 2, i * 2 + 1, (i - 1) * 2 + 1); // facing up
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const water = this.own(new THREE.Mesh(geo, new THREE.MeshToonMaterial({ color: '#6f9aa6', gradientMap: getToonGradient() })));
    water.receiveShadow = this.shadows;
    water.name = 'water';

    // stone bridges: a deck on a low arch, parapets either side
    const stone = new THREE.Color('#b8ae98'), dark = new THREE.Color('#8c826e');
    for (const b of f.bridges) {
      const parts = [];
      const box = (w, h, d, x, y, z, c) => {
        const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed();
        g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: g.attributes.position.count }, () => [c.r, c.g, c.b]).flat(), 3));
        parts.push(g);
      };
      const deckY = Math.max(this.y(b.x + Math.sin(b.yaw) * b.length / 2, b.z + Math.cos(b.yaw) * b.length / 2), this.y(b.x - Math.sin(b.yaw) * b.length / 2, b.z - Math.cos(b.yaw) * b.length / 2), 0.1);
      box(b.width, 0.5, b.length + 4, 0, deckY - 0.2, 0, stone);
      for (const s of [-1, 1]) box(0.45, 0.8, b.length + 4, s * (b.width / 2 - 0.2), deckY + 0.4, 0, dark);
      box(b.width - 1, 1.4, 3, 0, WATER_Y + 0.3, 0, dark); // the pier
      const geo2 = ensureAttrs(mergeGeometries(parts));
      geo2.computeVertexNormals();
      const mesh = this.own(new THREE.Mesh(geo2, this.material));
      mesh.position.set(b.x, 0, b.z);
      mesh.rotation.y = b.yaw;
      mesh.castShadow = mesh.receiveShadow = this.shadows;
    }
  }

  // ---------------------------------------------------------------- trenches: plank walls and duckboards
  buildTrenches() {
    const plank = new THREE.BoxGeometry(0.08, 1, 1);
    const items = [];
    for (const t of this.field.trenches) {
      for (const s of walk(t.pts, 1)) {
        for (const side of [-1, 1]) {
          const x = s.x - s.tz * side * (t.width / 2), z = s.z + s.tx * side * (t.width / 2);
          items.push({ x, z, y: this.y(s.x, s.z) + 0.55, yaw: Math.atan2(s.tx, s.tz), sx: 1, sy: 1.4, sz: 1.02 });
        }
        if (Math.round(s.x * 7 + s.z * 3) % 2 === 0) items.push({ x: s.x, z: s.z, y: this.y(s.x, s.z) + 0.05, yaw: Math.atan2(s.tx, s.tz) + Math.PI / 2, sx: 4, sy: 0.08, sz: 0.5 });
      }
    }
    const mat = new THREE.MeshToonMaterial({ color: '#7a5a3a', gradientMap: getToonGradient() });
    const mesh = this.own(new THREE.InstancedMesh(plank, mat, items.length));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    items.forEach((it, i) => mesh.setMatrixAt(i, m.compose(new THREE.Vector3(it.x, it.y, it.z), q.setFromEuler(e.set(0, it.yaw, 0)), new THREE.Vector3(it.sx, it.sy, it.sz))));
    mesh.castShadow = mesh.receiveShadow = this.shadows;
  }

  // ---------------------------------------------------------------- instancing helper
  /**
   * One InstancedMesh per geometry. items: { x, z, yaw, s (uniform scale) | scale: Vector3, y?, color? }
   */
  instance(geo, items, { fit = null, castShadow = true, name = '' } = {}) {
    if (!geo || !items.length) return null;
    ensureAttrs(geo);
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const base = fit ? (fit.w ? fit.w / (bb.max.x - bb.min.x) : fit.h / (bb.max.y - bb.min.y)) : 1;
    const mesh = new THREE.InstancedMesh(geo, this.material, items.length);
    mesh.name = name;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    items.forEach((it, i) => {
      const k = base * (it.s ?? 1);
      p.set(it.x, it.y ?? this.y(it.x, it.z), it.z);
      mesh.setMatrixAt(i, m.compose(p, q.setFromEuler(e.set(0, it.yaw ?? 0, 0)), it.scale ? sc.copy(it.scale).multiplyScalar(base) : sc.setScalar(k)));
      if (it.color) mesh.setColorAt(i, it.color);
    });
    mesh.castShadow = castShadow && this.shadows;
    mesh.receiveShadow = this.shadows;
    mesh.computeBoundingSphere();
    this.group.add(mesh); // pack geometries are shared: never disposed here
    return mesh;
  }

  // ---------------------------------------------------------------- village
  buildHouses() {
    const town = this.packs.town || {};
    const groups = new Map();
    for (const h of this.field.houses) {
      if (h.ruined) continue;
      const name = h.variant >= 0 ? `${h.kind}_v${h.variant}` : h.kind;
      const key = town[name] ? name : town[`${h.kind}_v0`] ? `${h.kind}_v0` : null;
      if (!key) continue;
      // set into the slope: the lowest corner decides
      const y = Math.min(...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => this.y(h.x + (u * h.w) / 2, h.z + (v * h.d) / 2))) - 0.1;
      if (!groups.has(key)) groups.set(key, { w: h.w, items: [] });
      groups.get(key).items.push({ x: h.x, z: h.z, y, yaw: h.yaw });
    }
    for (const [key, g] of groups) this.instance(town[key][0], g.items, { fit: { w: g.w }, name: key });
    if (this.field.windmill) {
      const w = this.field.windmill;
      const mil = this.packs.military;
      const y = this.y(w.x, w.z) - 0.2;
      this.instance(mil.p_windmill_body?.[0], [{ x: w.x, z: w.z, y, yaw: w.yaw }], { name: 'windmill' });
      const sails = this.instance(mil.p_windmill_sails?.[0], [{ x: 0, z: 0, y: 0 }], { name: 'windmill_sails' });
      if (sails) {
        // the hub is 2.7 m in front of the tower, 9.2 m up (military_kit.py)
        const pivot = new THREE.Group();
        pivot.position.set(w.x + Math.sin(w.yaw) * 2.7, y + 9.2, w.z + Math.cos(w.yaw) * 2.7);
        pivot.rotation.y = w.yaw;
        this.group.add(pivot);
        sails.removeFromParent();
        pivot.add(sails);
        this.animated.push((dt) => (sails.rotation.z += dt * 0.35));
      }
    }
  }

  buildTrees() {
    const town = this.packs.town || {};
    const groups = new Map();
    const rng = mulberry32(this.field.seed ^ 0x7ee5);
    for (const t of this.field.trees) {
      const v = Math.floor(rng() * (TREE_KIND[t.kind] || 1));
      const key = town[`${t.kind}_v${v}`] ? `${t.kind}_v${v}` : `${t.kind}_v0`;
      if (!town[key]) continue;
      if (!groups.has(key)) groups.set(key, { h: TREE_H[t.kind], items: [] });
      groups.get(key).items.push({ x: t.x, z: t.z, y: this.y(t.x, t.z) - 0.15, yaw: t.yaw, s: t.s });
    }
    for (const [key, g] of groups) this.instance(town[key][0], g.items, { fit: { h: g.h }, name: key });
  }

  buildHedges() {
    const town = this.packs.town || {};
    const items = [[], []];
    const rng = mulberry32(this.field.seed ^ 0x4ed9e);
    for (const h of this.field.hedges) {
      for (const s of walk(h.pts, 1.3)) items[rng() < 0.5 ? 0 : 1].push({ x: s.x, z: s.z, y: this.y(s.x, s.z) - 0.1, yaw: rng() * 6.28, s: 0.8 + rng() * 0.45 });
    }
    items.forEach((list, v) => this.instance(town[`b_bush_v${v}`]?.[0], list, { fit: { w: 2.0 }, name: 'hedge' }));
  }

  // ---------------------------------------------------------------- tall grass: faceted tufts
  buildGrass() {
    const f = this.field;
    // a tuft: five leaning blades around a centre, 1 m tall
    const pos = [];
    for (let b = 0; b < 5; b++) {
      const a = (b / 5) * Math.PI * 2;
      const lean = 0.18;
      const bx = Math.cos(a) * 0.12, bz = Math.sin(a) * 0.12;
      const tx = bx + Math.cos(a) * lean, tz = bz + Math.sin(a) * lean;
      const px = -Math.sin(a) * 0.07, pz = Math.cos(a) * 0.07;
      pos.push(bx - px, 0, bz - pz, bx + px, 0, bz + pz, tx, 1, tz);
      pos.push(bx + px, 0, bz + pz, bx - px, 0, bz - pz, tx, 1, tz);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    // blades light like the ground under them, not like their own tilt
    const nrm = geo.attributes.normal;
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
    this.disposables.push(geo);
    const rng = mulberry32(f.seed ^ 0x9a55);
    const items = [];
    const wheat = [new THREE.Color('#d8bd6a'), new THREE.Color('#c9a85a'), new THREE.Color('#e0c878')];
    const rough = [new THREE.Color('#7d9146'), new THREE.Color('#91a356'), new THREE.Color('#6f8540')];
    for (const g of f.grass) {
      const xs = g.poly.map((p) => p[0]), zs = g.poly.map((p) => p[1]);
      const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
      const step = g.kind === 'wheat' ? 0.85 : 0.75;
      for (let z = z0; z < z1; z += step) {
        for (let x = x0; x < x1; x += step) {
          const px = x + (rng() - 0.5) * step, pz = z + (rng() - 0.5) * step;
          if (!inPoly(px, pz, g.poly)) continue;
          const pal = g.kind === 'wheat' ? wheat : rough;
          items.push({ x: px, z: pz, h: (g.kind === 'wheat' ? 1.05 : 0.8) * (0.8 + rng() * 0.4), yaw: rng() * 6.28, c: pal[Math.floor(rng() * 3)] });
        }
      }
    }
    if (!items.length) return;
    const mat = new THREE.MeshToonMaterial({ gradientMap: getToonGradient(), side: THREE.DoubleSide });
    // both faces of a blade light like the ground (a double-sided material flips the back face's normal)
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
    };
    this.disposables.push(mat);
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    mesh.name = 'tall_grass';
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    items.forEach((it, i) => {
      p.set(it.x, this.y(it.x, it.z) - 0.05, it.z);
      mesh.setMatrixAt(i, m.compose(p, q.setFromEuler(e.set(0, it.yaw, 0)), s.set(1.1, it.h, 1.1)));
      mesh.setColorAt(i, it.c);
    });
    mesh.receiveShadow = this.shadows;
    this.group.add(mesh);
    this.grassCount = items.length;
  }

  // ---------------------------------------------------------------- fortifications, camps, the tank
  buildMilitary() {
    const f = this.field;
    const mil = this.packs.military || {};
    const byAsset = new Map();
    const add = (asset, it) => {
      if (!byAsset.has(asset)) byAsset.set(asset, []);
      byAsset.get(asset).push(it);
    };
    for (const c of f.cover) add(COVER[c.type].asset, { x: c.x, z: c.z, yaw: c.yaw, y: this.y(c.x, c.z) - 0.05 });
    for (const b of f.bunkers) add('p_bunker', { x: b.x, z: b.z, yaw: b.yaw, y: this.y(b.x, b.z) - 0.25 });
    if (f.watchtower) add('p_watchtower', { x: f.watchtower.x, z: f.watchtower.z, yaw: f.watchtower.yaw });
    for (const c of f.camps) {
      const tint = c.side ? new THREE.Color(FACTIONS[c.side].flag) : new THREE.Color('#e8e0c8');
      add('p_flag_camp', { x: c.x, z: c.z, yaw: Math.PI * 0.25, color: tint });
    }
    for (const [asset, items] of byAsset) {
      // instance colours tint M_paint only; untinted instances keep white
      if (items.some((i) => i.color)) items.forEach((i) => (i.color ||= new THREE.Color(1, 1, 1)));
      this.instance(mil[asset]?.[0], items, { name: asset });
    }
    // the enemy tank: hull and turret, painted in the enemy's colours
    if (f.tank && mil.p_tank_hull) {
      const t = f.tank;
      const tank = new THREE.Group();
      tank.name = 'tank';
      tank.position.set(t.x, this.y(t.x, t.z), t.z);
      tank.rotation.y = t.yaw;
      const paint = new THREE.Color('#5a5d55');
      const hull = this.instance(mil.p_tank_hull[0], [{ x: 0, z: 0, y: 0, color: paint }], { name: 'tank_hull' });
      const turret = this.instance(mil.p_tank_turret[0], [{ x: 0, z: 0, y: 0, color: paint }], { name: 'tank_turret' });
      for (const m of [hull, turret]) m.removeFromParent();
      tank.add(hull);
      const ring = new THREE.Group();
      ring.position.set(0, 1.52, 0.2); // three-space of the hull's turret mark (Blender (0, -0.2, 1.52))
      ring.add(turret);
      tank.add(ring);
      this.group.add(tank);
      this.tank = { group: tank, turret: ring };
    }
  }

  update(dt) {
    for (const fn of this.animated) fn(dt);
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => o.isInstancedMesh && o.dispose());
    for (const d of this.disposables) d.dispose();
  }
}
