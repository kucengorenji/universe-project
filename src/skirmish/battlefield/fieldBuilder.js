import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getToonGradient } from '../../render/assetLibrary.js';
import { HALF, SIZE, RES, WATER_Y, COVER, heightAt, walk, lineDist } from './generateField.js';
import { paintGround, paintGroundClasses, inPoly } from './groundPaint.js';
import { mulberry32 } from '../../math/random.js';
import { FACTIONS } from '../units/soldierLook.js';
import { envMaterial, SURFACE } from './envKit.js';

// Builds the 3D battlefield from generateField() data: painted terrain with an apron to the
// horizon, the river and its bridges, the trench with plank revetments, village houses, trees,
// hedges and cover from the painted environment kit (envKit.js; town.glb and military.glb stand in
// for anything the kit lacks), the rest of the fortifications and the camps from military.glb,
// wheat and rough grass.
// Everything repeated is instanced; every material is toon, so the canvas hatching reaches it.

const ROOF = new THREE.Color('#9a5a42');
// green summer variants only (t_oak_v2 and t_birch_v1 are autumn trees, t_fruit blossoms pink)
const TREE_KIND = { t_oak: 2, t_birch: 1, t_pine: 2, t_spruce: 2 };
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

/**
 * The painted cards (canvas 2D, 1024 x 512): wheat on the left half, rough grass on the right.
 * Each is a dense mass low down with a soft wavy top, stalks or blades rising out of it and, for
 * wheat, ears with awns. Alpha-tested, so every stroke is drawn opaque.
 */
function paintCards() {
  const W = 512, H = 512;
  const canvas = Object.assign(document.createElement('canvas'), { width: W * 2, height: H });
  const g = canvas.getContext('2d');
  const rng = mulberry32(0xca7d5);
  const card = (ox, wheat) => {
    const base = wheat ? ['#9a8240', '#b09650', '#a48a46'] : ['#5a7a34', '#6a8a3a', '#4e6c2e'];
    const mid = wheat ? ['#d8bc68', '#e2c876', '#ccb05c'] : ['#7e9c46', '#8eac52', '#729040'];
    const tip = wheat ? ['#f2dc94', '#ecd286', '#f6e4a4'] : ['#a8c060', '#b4c86c', '#9cb658'];
    // the mass: overlapping soft lobes with a wavy top
    const top = wheat ? 0.52 : 0.62;
    for (let i = 0; i < 70; i++) {
      const x = ox + 20 + rng() * (W - 40);
      const y = H * (top + 0.08 + rng() * 0.3);
      const r = 26 + rng() * 34;
      const grd = g.createLinearGradient(0, y - r, 0, H);
      grd.addColorStop(0, mid[Math.floor(rng() * 3)]);
      grd.addColorStop(1, base[Math.floor(rng() * 3)]);
      g.fillStyle = grd;
      g.beginPath();
      g.ellipse(x, y, r * 0.8, r * 1.4, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = base[0];
    g.fillRect(ox + 10, H * (top + 0.32), W - 20, H);
    // stalks or blades rising out of it
    const n = wheat ? 70 : 90;
    for (let i = 0; i < n; i++) {
      const x0 = ox + 24 + rng() * (W - 48);
      const y0 = H * (top + 0.25 + rng() * 0.1);
      const lean = (rng() - 0.5) * (wheat ? 50 : 90);
      const y1 = H * (wheat ? 0.06 + rng() * 0.22 : 0.1 + rng() * 0.35);
      const x1 = x0 + lean;
      g.strokeStyle = mid[Math.floor(rng() * 3)];
      g.lineWidth = wheat ? 3 + rng() * 2 : 4 + rng() * 4;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x0, y0);
      g.quadraticCurveTo(x0 + lean * 0.2, (y0 + y1) / 2, x1, y1);
      g.stroke();
      if (wheat) {
        // the ear: plump grains along the last stretch, a darker edge, awns
        const ang = Math.atan2(y1 - y0, x1 - x0);
        const L = 34 + rng() * 14;
        g.save();
        g.translate(x1, y1);
        g.rotate(ang + Math.PI / 2);
        g.fillStyle = tip[Math.floor(rng() * 3)];
        g.strokeStyle = '#a8883a';
        g.lineWidth = 1.4;
        for (let k = 0; k < 7; k++) {
          const yy = -k * (L / 7);
          for (const s of [-1, 1]) {
            g.beginPath();
            g.ellipse(s * 3.2, yy, 3.6, 5.2, s * 0.35, 0, Math.PI * 2);
            g.fill();
            g.stroke();
            g.beginPath();
            g.moveTo(s * 4.5, yy - 3);
            g.lineTo(s * 9, yy - 14);
            g.stroke();
          }
        }
        g.restore();
      } else {
        g.strokeStyle = tip[Math.floor(rng() * 3)];
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x1 - lean * 0.1, y1 + 30);
        g.lineTo(x1, y1);
        g.stroke();
      }
    }
    // pencil: a few dark strokes in the mass for depth
    g.strokeStyle = wheat ? 'rgba(110,86,40,1)' : 'rgba(50,70,30,1)';
    g.lineWidth = 2;
    for (let i = 0; i < 40; i++) {
      const x = ox + 20 + rng() * (W - 40), y = H * (top + 0.15 + rng() * 0.3);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (rng() - 0.5) * 10, y + 18 + rng() * 20);
      g.stroke();
    }
  };
  card(0, true);
  card(W, false);
  return canvas;
}

/** Card material: the painted half (offset 0 wheat, 0.5 grass), alpha-tested, lit like the ground,
 * swaying in the wind (time.value in seconds) more toward the top. */
function cardMaterial(tex, offset, time) {
  const mat = new THREE.MeshToonMaterial({ map: tex, gradientMap: getToonGradient(), side: THREE.DoubleSide, alphaTest: 0.5 });
  mat.defines = { CANVAS_PLAIN: '' }; // no pencil hatching on the cards (canvasStyle.js)
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.uniforms.uOffset = { value: offset };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uOffset;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = vec2(uv.x * 0.5 + uOffset, uv.y);')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec2 at = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
          float gust = sin(uTime * 1.3 + at.x * 0.21 + at.y * 0.17) * 0.6 + sin(uTime * 2.1 + at.x * 0.53) * 0.4;
          transformed.xz += vec2(0.13, 0.05) * gust * uv.y * uv.y;
        }`);
    // both faces light like the ground (a double-sided material flips the back face's normal)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
      // alpha 0.5 marks a painted mass: the canvas post draws no ink on or around it
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a = 0.5;');
  };
  mat.customProgramCacheKey = () => 'skirmish-card';
  return mat;
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
   * @param packs  { town, military } from loadAssetPack (asset -> {0: geometry}), env: loadEnv() ({ kit, surfaces })
   */
  constructor(field, packs, { shadows = true, grass = 1 } = {}) {
    this.field = field;
    this.packs = packs;
    this.kit = packs.env?.kit || {};
    if (packs.env) {
      this.envMat = envMaterial(packs.env.surfaces);
      this.disposables = [this.envMat];
    }
    this.shadows = shadows;
    this.grassDensity = grass; // share of the tall grass tufts (quality tiers thin it out)
    this.group = new THREE.Group();
    this.group.name = 'battlefield';
    this.disposables ||= [];
    this.material = packMaterial({ glow: 1 });
    this.disposables.push(this.material);
    this.animated = [];
    this.time = { value: 0 };
    this.animated.push((dt) => (this.time.value += dt));
    this.buildTerrain();
    this.buildWater();
    this.buildTrenches();
    this.buildHouses();
    this.buildTrees();
    this.buildHedges();
    this.buildGrass();
    this.buildDressing();
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
    const ground = this.own(new THREE.Mesh(geo, this.groundMaterial(tex)));
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

  /**
   * The painted ground map, and close up the painted tiles of what lies there (grass, earth and
   * road, wheat, ploughland): each tile's pattern divided by its mean colour modulates the map, so
   * colour and layout stay the map's while brush strokes and stalks appear underfoot.
   */
  groundMaterial(tex) {
    const mat = new THREE.MeshToonMaterial({ map: tex, gradientMap: getToonGradient() });
    const surfaces = this.packs.env?.surfaces;
    if (!surfaces) return mat;
    const cls = new THREE.CanvasTexture(paintGroundClasses(this.field, 1024));
    cls.colorSpace = THREE.NoColorSpace;
    this.disposables.push(cls);
    const layers = ['grass', 'road', 'wheat', 'plough'].map((k) => SURFACE[k]);
    const scale = [1 / 3, 1 / 3, 1 / 2, 1 / 3];
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uSurf = { value: surfaces };
      sh.uniforms.uClass = { value: cls };
      sh.uniforms.uMean = { value: layers.map((l) => surfaces.userData.means[l]) };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vGroundXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundXZ = position.xz;');
      const tile = (i) => `(texture(uSurf, vec3(vGroundXZ * ${scale[i].toFixed(4)}, ${layers[i]}.0)).rgb / uMean[${i}])`;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform highp sampler2DArray uSurf;\nuniform sampler2D uClass;\nuniform vec3 uMean[4];\nvarying vec2 vGroundXZ;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          {
            vec3 c = texture2D(uClass, vMapUv).rgb;
            vec3 d = ${tile(0)};
            d = mix(d, ${tile(1)}, c.r);
            d = mix(d, ${tile(2)}, c.g);
            d = mix(d, ${tile(3)}, c.b);
            diffuseColor.rgb *= clamp(d, vec3(0.5), vec3(1.6));
          }`);
    };
    mat.customProgramCacheKey = () => 'skirmish-ground';
    return mat;
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

    // stone bridges from the kit (18 m long, 7 m wide; the width is scaled to the road), decks
    // at the height arena.js walks them at
    const mil = this.packs.military || {};
    const items = f.bridges.map((b) => {
      const ex = Math.sin(b.yaw) * (b.length / 2), ez = Math.cos(b.yaw) * (b.length / 2);
      const deck = Math.max(this.y(b.x + ex, b.z + ez), this.y(b.x - ex, b.z - ez), 0.1) + 0.05;
      return { x: b.x, z: b.z, y: deck, yaw: b.yaw, scale: new THREE.Vector3(b.width / 7, 1, 1) };
    });
    if (this.kit.p_bridge) this.instance(this.kit.p_bridge, items, { name: 'bridge', material: this.envMat });
    else this.instance(mil.p_bridge?.[0], items, { name: 'bridge' });
  }

  // ---------------------------------------------------------------- trenches: plank walls, spoil banks, duckboards
  /**
   * Each trench is three ribbons per side following its line: a plank wall from the floor to just
   * above the rim, and a bank of thrown-up earth from the wall top down to the ground 1.8 m out
   * (it covers the coarse terrain cut); and a duckboard floor down the middle.
   */
  buildTrenches() {
    const pos = [];
    const col = [];
    const plank = [new THREE.Color('#7a5a3a'), new THREE.Color('#6a4c30'), new THREE.Color('#84633f')];
    const earth = new THREE.Color('#7c6a4c'), earthDark = new THREE.Color('#665640'), board = new THREE.Color('#9a7a52');
    const quad = (a, b, c, d, ca, cb = ca) => {
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
      for (const k of [ca, ca, cb, ca, cb, cb]) col.push(k.r, k.g, k.b);
    };
    for (const t of this.field.trenches) {
      const pts = walk(t.pts, 0.5);
      const hw = t.width / 2;
      for (let i = 1; i < pts.length; i++) {
        const [p, q] = [pts[i - 1], pts[i]];
        const floorP = this.y(p.x, p.z) + 0.02, floorQ = this.y(q.x, q.z) + 0.02;
        for (const side of [-1, 1]) {
          const off = (s, d) => [s.x - s.tz * side * d, s.z + s.tx * side * d];
          const [pwx, pwz] = off(p, hw), [qwx, qwz] = off(q, hw);
          const [pox, poz] = off(p, hw + 1.8), [qox, qoz] = off(q, hw + 1.8);
          const [prx, prz] = off(p, hw + 2.6), [qrx, qrz] = off(q, hw + 2.6);
          const rimP = this.y(prx, prz) + 0.3, rimQ = this.y(qrx, qrz) + 0.3;
          const outP = this.y(pox, poz) - 0.02, outQ = this.y(qox, qoz) - 0.02;
          const c = plank[i % 3];
          // wall (faces the trench: winding depends on the side)
          const wall = [[pwx, floorP - 0.05, pwz], [qwx, floorQ - 0.05, qwz], [qwx, rimQ, qwz], [pwx, rimP, pwz]];
          if (side > 0) quad(...wall, c);
          else quad(wall[1], wall[0], wall[3], wall[2], c);
          // spoil bank
          const bank = [[pwx, rimP, pwz], [qwx, rimQ, qwz], [qox, Math.max(outQ, rimQ - 0.6), qoz], [pox, Math.max(outP, rimP - 0.6), poz]];
          if (side > 0) quad(...bank, earth, earthDark);
          else quad(bank[1], bank[0], bank[3], bank[2], earth, earthDark);
          // the bank's outer face down to the ground
          const face = [[pox, Math.max(outP, rimP - 0.6), poz], [qox, Math.max(outQ, rimQ - 0.6), qoz], [qox, outQ - 0.3, qoz], [pox, outP - 0.3, poz]];
          if (side > 0) quad(...face, earthDark);
          else quad(face[1], face[0], face[3], face[2], earthDark);
        }
        // duckboards: slats across the floor
        if (i % 2 === 0) {
          const w = hw * 0.7;
          const a = [p.x - p.tz * w, floorP + 0.06, p.z + p.tx * w], b = [p.x + p.tz * w, floorP + 0.06, p.z - p.tx * w];
          const m = (k) => [p.x + (q.x - p.x) * k, p.z + (q.z - p.z) * k];
          const [mx, mz] = m(0.6);
          const c2 = [mx + p.tz * w, floorP + 0.06, mz - p.tx * w], d2 = [mx - p.tz * w, floorP + 0.06, mz + p.tx * w];
          quad(a, d2, c2, b, board);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mesh = this.own(new THREE.Mesh(geo, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient(), side: THREE.DoubleSide })));
    mesh.name = 'trench';
    mesh.castShadow = mesh.receiveShadow = this.shadows;
  }

  // ---------------------------------------------------------------- instancing helper
  /**
   * One InstancedMesh per geometry. items: { x, z, yaw, s (uniform scale) | scale: Vector3, y?, color? }
   */
  instance(geo, items, { fit = null, castShadow = true, name = '', material = null } = {}) {
    if (!geo || !items.length) return null;
    if (!material) ensureAttrs(geo);
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const base = fit ? (fit.w ? fit.w / (bb.max.x - bb.min.x) : fit.h / (bb.max.y - bb.min.y)) : 1;
    const mesh = new THREE.InstancedMesh(geo, material || this.material, items.length);
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
      const kitKey = this.kit[name] ? name : this.kit[`${h.kind}_v0`] ? `${h.kind}_v0` : null;
      const key = kitKey ? `kit:${kitKey}` : town[name] ? name : town[`${h.kind}_v0`] ? `${h.kind}_v0` : null;
      if (!key) continue;
      // set into the slope: the lowest corner decides
      const y = Math.min(...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => this.y(h.x + (u * h.w) / 2, h.z + (v * h.d) / 2))) - 0.1;
      if (!groups.has(key)) groups.set(key, { w: h.w, items: [] });
      groups.get(key).items.push({ x: h.x, z: h.z, y, yaw: h.yaw });
    }
    for (const [key, g] of groups) {
      // the kit's houses are built to the generator's footprints: no fitting
      if (key.startsWith('kit:')) this.instance(this.kit[key.slice(4)], g.items, { name: key, material: this.envMat });
      else this.instance(town[key][0], g.items, { fit: { w: g.w }, name: key });
    }
    if (this.field.windmill) {
      const w = this.field.windmill;
      const mil = this.packs.military;
      const y = this.y(w.x, w.z) - 0.2;
      const kit = this.kit.p_windmill_body && this.kit.p_windmill_sails;
      const opt = (name) => (kit ? { name, material: this.envMat } : { name });
      this.instance(kit ? this.kit.p_windmill_body : mil.p_windmill_body?.[0], [{ x: w.x, z: w.z, y, yaw: w.yaw }], opt('windmill'));
      const sails = this.instance(kit ? this.kit.p_windmill_sails : mil.p_windmill_sails?.[0], [{ x: 0, z: 0, y: 0 }], opt('windmill_sails'));
      if (sails) {
        // the hub is 2.35 m in front of the tower, 9.2 m up (military_kit.py)
        const pivot = new THREE.Group();
        pivot.position.set(w.x + Math.sin(w.yaw) * 2.35, y + 9.2, w.z + Math.cos(w.yaw) * 2.35);
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
      const own = this.kit[`${t.kind}_v${v}`] ? `${t.kind}_v${v}` : this.kit[`${t.kind}_v0`] ? `${t.kind}_v0` : null;
      const key = own ? `kit:${own}` : town[`${t.kind}_v${v}`] ? `${t.kind}_v${v}` : `${t.kind}_v0`;
      if (!own && !town[key]) continue;
      if (!groups.has(key)) groups.set(key, { h: TREE_H[t.kind], items: [] });
      groups.get(key).items.push({ x: t.x, z: t.z, y: this.y(t.x, t.z) - 0.15, yaw: t.yaw, s: t.s });
    }
    for (const [key, g] of groups) {
      if (key.startsWith('kit:')) this.instance(this.kit[key.slice(4)], g.items, { name: key, material: this.envMat });
      else this.instance(town[key][0], g.items, { fit: { h: g.h }, name: key });
    }
  }

  /** Hedgerows: the kit's leafy hedge stretch laid end to end along each line, slightly varied. */
  buildHedges() {
    const mil = this.packs.military || {};
    const items = [];
    const rng = mulberry32(this.field.seed ^ 0x4ed9e);
    for (const h of this.field.hedges) {
      for (const s of walk(h.pts, 1.5)) {
        const k = 0.85 + rng() * 0.35;
        items.push({ x: s.x, z: s.z, y: this.y(s.x, s.z) - 0.1, yaw: Math.atan2(-s.tz, s.tx) + (rng() - 0.5) * 0.3, scale: new THREE.Vector3(1, k, 0.9 + rng() * 0.3) });
      }
    }
    if (this.kit.p_hedge) this.instance(this.kit.p_hedge, items, { name: 'hedge', material: this.envMat });
    else this.instance(mil.p_hedge?.[0], items, { name: 'hedge' });
  }

  // ---------------------------------------------------------------- wheat and rough grass: painted cards
  /**
   * Wheat fields and rough grass as soft painted masses: clumps of three crossed cards (canvas
   * painted: a dense mass low down, stalks above, ears on top for wheat) that sway in the wind,
   * kept a step inside each field's edge so the plots read neatly.
   */
  buildGrass() {
    const f = this.field;
    const tex = new THREE.CanvasTexture(paintCards());
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.disposables.push(tex);
    // three cards crossing at 60 degrees, 1.3 m wide and 1 m tall; uv.x picks the wheat or grass half
    const pos = [], uv = [], nrm = [], idx = [];
    for (let c = 0; c < 3; c++) {
      const a = (c / 3) * Math.PI;
      const dx = Math.cos(a) * 0.65, dz = Math.sin(a) * 0.65;
      const b = pos.length / 3;
      pos.push(-dx, 0, -dz, dx, 0, dz, dx, 1, dz, -dx, 1, -dz);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      for (let k = 0; k < 4; k++) nrm.push(0, 1, 0);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setIndex(idx);
    this.disposables.push(geo);
    const rng = mulberry32(f.seed ^ 0x9a55);
    const wheat = [new THREE.Color('#ffffff'), new THREE.Color('#f2e8d0'), new THREE.Color('#fff4dc')];
    const rough = [new THREE.Color('#ffffff'), new THREE.Color('#e8f0d8'), new THREE.Color('#f0f4e0')];
    const sets = { wheat: [], rough: [] };
    const edgeDist = (x, z, poly) => {
      let d = Infinity;
      for (let i = 0; i < poly.length; i++) d = Math.min(d, lineDist(x, z, [poly[i], poly[(i + 1) % poly.length]]));
      return d;
    };
    for (const g of f.grass) {
      const xs = g.poly.map((p) => p[0]), zs = g.poly.map((p) => p[1]);
      const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
      const step = (g.kind === 'wheat' ? 0.72 : 0.9) / Math.sqrt(this.grassDensity);
      for (let z = z0; z < z1; z += step) {
        for (let x = x0; x < x1; x += step) {
          const px = x + (rng() - 0.5) * step * 0.8, pz = z + (rng() - 0.5) * step * 0.8;
          if (!inPoly(px, pz, g.poly)) continue;
          const e = edgeDist(px, pz, g.poly);
          if (g.kind === 'wheat' && e < 0.45) continue;
          const pal = g.kind === 'wheat' ? wheat : rough;
          // rough grass thins out toward its patch's edge
          const h = g.kind === 'wheat' ? 1.05 + rng() * 0.15 : (0.55 + rng() * 0.35) * Math.min(1, 0.4 + e / 2.5);
          sets[g.kind].push({ x: px, z: pz, h, yaw: rng() * 6.28, c: pal[Math.floor(rng() * 3)] });
        }
      }
    }
    this.grassCount = 0;
    for (const [kind, items] of Object.entries(sets)) {
      if (!items.length) continue;
      const mat = cardMaterial(tex, kind === 'wheat' ? 0 : 0.5, this.time);
      this.disposables.push(mat);
      const mesh = new THREE.InstancedMesh(geo, mat, items.length);
      mesh.name = kind === 'wheat' ? 'wheat' : 'tall_grass';
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
      items.forEach((it, i) => {
        p.set(it.x, this.y(it.x, it.z) - 0.04, it.z);
        mesh.setMatrixAt(i, m.compose(p, q.setFromEuler(e.set(0, it.yaw, 0)), sc.set(1, it.h, 1)));
        mesh.setColorAt(i, it.c);
      });
      mesh.receiveShadow = this.shadows;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
      this.grassCount += items.length;
    }
  }

  // ---------------------------------------------------------------- field dressing: fences, hay, vegetable rows
  /** Decoration only (no collision, all low): post-and-rail fences on a side or two of some fields,
   * haystacks in meadows, stooks at the edge of some wheat, cabbage rows in some ploughland. */
  buildDressing() {
    const k = this.kit;
    if (!k.p_fence) return;
    const f = this.field;
    const rng = mulberry32(f.seed ^ 0xfe7ce);
    const clear = (x, z, r) =>
      f.roads.every((rd) => lineDist(x, z, rd.pts) > rd.width / 2 + r) &&
      f.houses.every((h) => Math.hypot(h.x - x, h.z - z) > Math.max(h.w, h.d) * 0.6 + r) &&
      f.cover.every((c) => Math.hypot(c.x - x, c.z - z) > 2 + r) &&
      (!f.river || lineDist(x, z, f.river.pts) > f.river.width / 2 + 2 + r);
    const sets = { p_fence: [], p_haystack: [], p_stooks: [], p_cabbages: [] };
    for (const fl of f.fields) {
      const c = Math.cos(fl.yaw), sn = Math.sin(fl.yaw);
      const at = (u, v) => ({ x: fl.x + u * c + v * sn, z: fl.z - u * sn + v * c });
      // fences: one or two sides, 3 m panels end to end, broken where something is in the way
      if (rng() < 0.55) {
        const sides = rng() < 0.5 ? [0] : [0, 2];
        const off = Math.floor(rng() * 4);
        for (const sd of sides.map((s) => (s + off) % 4)) {
          const along = sd % 2 === 0 ? fl.w : fl.d;
          const n = Math.floor(along / 3);
          for (let i = 0; i < n; i++) {
            const t = -along / 2 + 1.5 + i * 3 + (along - n * 3) / 2;
            const [u, v] = sd === 0 ? [t, -fl.d / 2] : sd === 1 ? [fl.w / 2, t] : sd === 2 ? [t, fl.d / 2] : [-fl.w / 2, t];
            const p = at(u, v);
            if (!clear(p.x, p.z, 1.6) || rng() < 0.08) continue;
            sets.p_fence.push({ ...p, yaw: fl.yaw + (sd % 2 ? Math.PI / 2 : 0) + (rng() - 0.5) * 0.04 });
          }
        }
      }
      if (fl.kind === 'meadow' && rng() < 0.7) {
        for (let i = 0, n = 1 + Math.floor(rng() * 3); i < n; i++) {
          const p = at((rng() - 0.5) * fl.w * 0.6, (rng() - 0.5) * fl.d * 0.6);
          if (clear(p.x, p.z, 2)) sets.p_haystack.push({ ...p, yaw: rng() * 6.28, s: 0.8 + rng() * 0.35 });
        }
      }
      if (fl.kind === 'wheat' && rng() < 0.5) {
        // stooks along the cut edge of the field
        for (let i = 0, n = 2 + Math.floor(rng() * 3); i < n; i++) {
          const p = at(-fl.w / 2 + 2 + i * 5, fl.d / 2 + 1.6);
          if (Math.abs(-fl.w / 2 + 2 + i * 5) < fl.w / 2 && clear(p.x, p.z, 2)) sets.p_stooks.push({ ...p, yaw: fl.yaw });
        }
      }
      if (fl.kind === 'plough' && rng() < 0.45) {
        for (let v = -fl.d / 2 + 1.2; v < fl.d / 2 - 0.8; v += 1.2) {
          for (let u = -fl.w / 2 + 2; u < fl.w / 2 - 1.5; u += 3.1) {
            const p = at(u, v);
            if (clear(p.x, p.z, 0.5)) sets.p_cabbages.push({ ...p, yaw: fl.yaw });
          }
        }
      }
    }
    for (const [asset, items] of Object.entries(sets)) {
      items.forEach((it) => (it.y = this.y(it.x, it.z) - 0.03));
      this.instance(k[asset], items, { name: asset, material: this.envMat, castShadow: asset !== 'p_cabbages' });
    }
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
      if (this.kit[asset]) this.instance(this.kit[asset], items, { name: asset, material: this.envMat });
      else this.instance(mil[asset]?.[0], items, { name: asset });
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
