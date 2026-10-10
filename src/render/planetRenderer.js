import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BIOMES, isWater } from '../map/mapGenerator.js';
import { mulberry32 } from '../math/random.js';
import { createNoise3D } from '../math/simplex3d.js';
import { loadAssetPack, createToonMaterial } from './assetLibrary.js';
import { ASSETS } from './assetManifest.js';
import { buildMountainGeometry } from './mountainBuilder.js';
import { PLANET_TYPES, TERRAN_PALETTE } from '../world/planetTypes.js';
import { createSpaceBackdrop } from './spaceBackdrop.js';
import { cozyRouteMaterial } from './cozyPaths.js';
import { JOURNEY_PALETTE } from '../art/palette.js';
import { FloatBuffer } from './floatBuffer.js';
import { t } from '../i18n/index.js';

// Cartoon (Civ VI-like) terrain palette (lives with the planet types, shared with the space baker)
export const BIOME_PALETTE = TERRAN_PALETTE;
const GROUND = { fantasy: 0xcbb68c, modern: 0xa9a8a0, wheat: 0xc9a650, crop: 0x7f9a45, riverbank: 0x6fae3f };
// The1 identity colours: The Green = player, The Red = system
const FACTION = { player: 0x027b49, system: 0xfa4d43 };
const LABEL_STYLE = {
  player: { bg: '#027b49', fg: '#ffffff' },
  system: { bg: '#fa4d43', fg: '#1f1f1f' },
  neutral: { bg: '#1f1f1f', fg: '#d9d9d9' }
};
const UP = new THREE.Vector3(0, 1, 0);
const DETAIL_DISTANCE = 2.15; // detail props (grass, bushes, reeds, hay) only render closer than this x radius
// Per-chunk LOD by the chunk's distance from the camera (x planet radius):
// LOD0 mid-poly up close, LOD1 in the middle distance, LOD2 far stand-ins
const LOD0_RANGE = 0.35;
const LOD1_RANGE = 1.1;

// Vehicles per civilisation and travel mode
export const VEHICLES = {
  land: { fantasy: { asset: 'caravan', get name() { return t('vehicle.caravan'); }, scale: 0.5, speed: 0.22 }, modern: { asset: 'truck', get name() { return t('vehicle.truck'); }, scale: 0.45, speed: 0.35 } },
  sea: { fantasy: { asset: 'ship', get name() { return t('vehicle.ship'); }, scale: 0.8, speed: 0.3 }, modern: { asset: 'container_ship', get name() { return t('vehicle.container_ship'); }, scale: 0.8, speed: 0.4 } },
  air: { fantasy: { asset: 'balloon', get name() { return t('vehicle.balloon'); }, scale: 0.75, speed: 0.25 }, modern: { asset: 'airplane', get name() { return t('vehicle.airplane'); }, scale: 0.7, speed: 0.9 } }
};
// Chase camera offsets in tile radii: behind, above, look-ahead
const POV_RIG = { land: [1.6, 0.55, 3.0], sea: [2.2, 0.75, 3.5], air: [2.6, 0.6, 4.0] };

function hash01(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function disposeTree(root, shared) {
  root.traverse((node) => {
    if (node.geometry && !shared.has(node.geometry)) node.geometry.dispose();
    const mats = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    mats.forEach((m) => {
      if (shared.has(m)) return;
      if (m.map) m.map.dispose();
      m.dispose();
    });
  });
}

/**
 * Flat band lying on the ground (hover, city/faction borders): one colour in
 * two opacities side by side across its width, outer edge strong, inner soft.
 */
function bandMaterial(color, { outer = 0.9, inner = 0.38, split = 0.5, fade = false } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOuter: { value: outer },
      uInner: { value: inner },
      uSplit: { value: split },
      uFade: { value: fade ? 1 : 0 }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOuter;
      uniform float uInner;
      uniform float uSplit;
      uniform float uFade;
      varying vec2 vUv;
      void main() {
        float stepped = mix(uOuter, uInner, smoothstep(uSplit - 0.03, uSplit + 0.03, vUv.y));
        float faded = mix(uOuter, uInner, vUv.y);
        float a = mix(stepped, faded, uFade);
        a *= 1.0 - smoothstep(0.9, 1.0, vUv.y); // soft inner edge
        gl_FragColor = vec4(uColor, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4
  });
}

/** Thin ribbon line with feathered edges: a smooth, anti-aliased looking hex grid. */
function gridMaterial(color, alpha) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: alpha } },
    vertexShader: `
      varying float vAcross;
      void main() {
        vAcross = uv.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uAlpha;
      varying float vAcross;
      void main() {
        float d = abs(vAcross - 0.5) * 2.0;
        gl_FragColor = vec4(uColor, uAlpha * (1.0 - smoothstep(0.35, 1.0, d)));
      }
    `,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });
}

// Reused temporaries (avoid per-frame / per-instance allocations)
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _c = new THREE.Color();

/** Spatial hash on the unit sphere: keeps props off rivers and roads. */
class Corridor {
  constructor(cell) {
    this.cell = cell;
    this.map = new Map();
  }
  key(x, y, z) {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`;
  }
  add(dir, radius, data = null) {
    const k = this.key(dir.x, dir.y, dir.z);
    if (!this.map.has(k)) this.map.set(k, []);
    this.map.get(k).push({ d: dir.clone(), r: radius, data });
  }
  /** Items whose disc (radius + pad, unit-sphere units) contains dir. */
  query(dir, pad = 0) {
    const out = [];
    const cx = Math.floor(dir.x / this.cell);
    const cy = Math.floor(dir.y / this.cell);
    const cz = Math.floor(dir.z / this.cell);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (let k = -1; k <= 1; k++) {
          const list = this.map.get(`${cx + i},${cy + j},${cz + k}`);
          if (!list) continue;
          for (const it of list) if (it.d.distanceTo(dir) < it.r + pad) out.push(it);
        }
    return out;
  }
  blocked(dir, pad = 0) {
    return this.query(dir, pad).length > 0;
  }
  /** Free distance from dir to the nearest corridor edge (capped at `reach`). */
  clearance(dir, reach) {
    let best = reach;
    for (const it of this.query(dir, reach)) best = Math.min(best, dir.distanceTo(it.d) - it.r);
    return best;
  }
}

/**
 * Signed distance (in tile radii, positive inside) to the ROUNDED outline of
 * a tile set. Used to draw coastlines and water depths as smooth curves
 * instead of hex steps, while tiles themselves stay hexagons.
 */
class ContourField {
  constructor(renderer, inside, density = 5) {
    this.inside = inside;
    this.unitTr = renderer.tileRadius / renderer.radius;
    this.cell = this.unitTr * 0.7;
    this.map = new Map();
    const set = new Set(renderer.hexasphere.tiles.filter(inside).map((t) => t.id));
    // Only tiles touching the outline can be crossed by it: everything else answers instantly
    this.near = new Set();
    for (const t of renderer.hexasphere.tiles) {
      const own = set.has(t.id);
      if (t.neighbors.some((id) => set.has(id) !== own)) this.near.add(t.id);
    }
    if (!set.size || set.size === renderer.hexasphere.tiles.length) return;
    for (const { pts, inward } of renderer.roundedLoops(set, density)) {
      const n = pts.length;
      for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % n];
        // Pseudo-normals at the ends keep the sign right around bends
        const na = inward[i].clone().add(inward[(i - 1 + n) % n]).normalize();
        const nb = inward[(i + 1) % n].clone().add(inward[i]).normalize();
        const seg = { a, b, n: inward[i].clone().add(inward[(i + 1) % n]).normalize(), na, nb };
        for (const p of [a, b, a.clone().add(b).multiplyScalar(0.5)]) {
          const k = this.key(p);
          if (!this.map.has(k)) this.map.set(k, []);
          const list = this.map.get(k);
          if (list[list.length - 1] !== seg) list.push(seg);
        }
      }
    }
  }
  // Numeric cell keys: this lookup runs about a million times per build
  cellKey(x, y, z) {
    return ((x + 1024) * 2048 + (y + 1024)) * 2048 + (z + 1024);
  }
  key(p) {
    return this.cellKey(Math.floor(p.x / this.cell), Math.floor(p.y / this.cell), Math.floor(p.z / this.cell));
  }
  signed(p, tile) {
    if (!this.near.has(tile.id)) return (this.inside(tile) ? 1 : -1) * (this.cell / this.unitTr);
    let best = Infinity;
    let sign = 1;
    const cx = Math.floor(p.x / this.cell);
    const cy = Math.floor(p.y / this.cell);
    const cz = Math.floor(p.z / this.cell);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (let k = -1; k <= 1; k++) {
          const list = this.map.get(this.cellKey(cx + i, cy + j, cz + k));
          if (!list) continue;
          for (const sg of list) {
            const abx = sg.b.x - sg.a.x;
            const aby = sg.b.y - sg.a.y;
            const abz = sg.b.z - sg.a.z;
            const len2 = abx * abx + aby * aby + abz * abz || 1e-12;
            let t = ((p.x - sg.a.x) * abx + (p.y - sg.a.y) * aby + (p.z - sg.a.z) * abz) / len2;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const qx = sg.a.x + abx * t;
            const qy = sg.a.y + aby * t;
            const qz = sg.a.z + abz * t;
            const dx = p.x - qx;
            const dy = p.y - qy;
            const dz = p.z - qz;
            const d = dx * dx + dy * dy + dz * dz;
            if (d < best) {
              best = d;
              const nrm = t <= 0 ? sg.na : t >= 1 ? sg.nb : sg.n;
              sign = dx * nrm.x + dy * nrm.y + dz * nrm.z >= 0 ? 1 : -1;
            }
          }
        }
    if (best === Infinity) return (this.inside(tile) ? 1 : -1) * (this.cell / this.unitTr);
    return (sign * Math.sqrt(best)) / this.unitTr;
  }
}

export class PlanetRenderer {
  /**
   * options.renderer: shared WebGLRenderer (the app's engine owns canvas + size)
   * options.externalLoop: the caller drives update()/render() instead of our own RAF
   */
  constructor(containerElement, hexasphere, options = {}) {
    this.options = options;
    this.suspended = false;
    this.container = containerElement;
    this.hexasphere = hexasphere;
    this.radius = hexasphere.radius;

    this.terrainMode = this.loadPref('terrainMode', 'relief');
    this.showGrid = this.loadPref('showGrid', true);
    this.applyTerrainRadii();

    this.mapGroup = null;
    this.showAirRoute = true;
    this.showGroundRoute = true;
    this.showSeaRoute = true;
    this.movers = [];
    this.labels = [];
    this.chunks = [];
    this.animatedMaterials = [];
    this.pov = null;
    // Ride-along camera offsets the player sets by dragging (yaw, pitch) and scrolling (zoom)
    this.povRig = { yaw: 0, pitch: 0, zoom: 1, lastInput: 0 };
    this.focus = null;
    this.camTween = null;
    this.onFocusChange = null;
    // Screen area covered by UI (focus card): left side on desktop, bottom sheet on phones
    this.inset = { left: 0, bottom: 0, right: 0, top: 0 };
    this.insetTarget = { left: 0, bottom: 0, right: 0, top: 0 };

    this.autoRotate = false;
    this.animTime = 0;
    this.lastFrame = 0;
    this.onTileHover = null;
    this.onTileSelect = null;
    this.onAssetsStatus = null;
    this.onPovChange = null;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.pendingPointer = null;
    this.hoveredTile = null;
    this.selectedTile = null;

    // Everything shared across rebuilds lives here and is never disposed
    this.propMaterial = createToonMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.sharedGeometries = new Set();
    this.sharedMaterials = new Set([this.propMaterial]);
    this.assets = null; // name -> LOD1 geometry (what most placement code needs)
    this.assetLods = {}; // name -> [LOD0 | undefined, LOD1, LOD2 | undefined]
    this.lod0Ready = false;
    this.assetsState = 'loading';
    const register = (pack) => {
      for (const [name, lods] of Object.entries(pack)) {
        const slot = (this.assetLods[name] ||= []);
        for (const [lvl, geo] of Object.entries(lods)) {
          slot[Number(lvl)] = geo;
          this.sharedGeometries.add(geo);
        }
      }
    };
    this.assetsPromise = loadAssetPack(ASSETS.planetPack)
      .then((pack) => {
        register(pack);
        this.assets = Object.fromEntries(Object.entries(this.assetLods).map(([n, l]) => [n, l[1]]));
        this.setAssetsState('ready');
        // Mid-poly models stream in after the world is already on screen
        loadAssetPack(ASSETS.planetPackLod0)
          .then((lod0) => {
            register(lod0);
            this.lod0Ready = true;
            this.addLod0Meshes();
          })
          .catch((err) => console.warn('Mid-poly pack unavailable, staying on LOD1:', err));
        return this.assets;
      })
      .catch((err) => {
        console.error('Asset pack failed to load:', err);
        this.setAssetsState('error');
        return null;
      });
    this.buildId = 0;

    this.init();
  }

  loadPref(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem('planet_globe_prefs') || '{}')[key] ?? fallback;
    } catch {
      return fallback;
    }
  }

  savePref(key, value) {
    try {
      const prefs = JSON.parse(localStorage.getItem('planet_globe_prefs') || '{}');
      prefs[key] = value;
      localStorage.setItem('planet_globe_prefs', JSON.stringify(prefs));
    } catch {
      /* preferences are optional */
    }
  }

  /** Relief: land sits on a cliff above the sea. Flat: land and sea share one level. */
  applyTerrainRadii() {
    const flat = this.terrainMode === 'flat';
    this.landR = this.radius;
    this.waterR = flat ? this.radius * 0.9995 : this.radius * 0.992;
    this.skirtR = this.radius * 0.972;
  }

  setTerrainMode(mode) {
    if (mode === this.terrainMode) return;
    this.terrainMode = mode;
    this.savePref('terrainMode', mode);
    this.applyTerrainRadii();
    const povMover = this.pov?.mover;
    if (this.mapData) this.buildPlanet(this.mapData, povMover ? { restorePov: povMover } : undefined);
  }

  /** Render the current view and download it as a PNG (concrete canvas behind the planet). */
  saveScreenshot(name = 'planet-globe') {
    this.renderer.render(this.scene, this.camera); // read back right after drawing: no preserveDrawingBuffer needed
    const src = this.renderer.domElement;
    const out = document.createElement('canvas');
    out.width = src.width;
    out.height = src.height;
    const ctx = out.getContext('2d');
    ctx.fillStyle = this.scene.background ? `#${this.scene.background.getHexString()}` : '#070c19';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0);
    return new Promise((resolve) =>
      out.toBlob((blob) => {
        if (!blob) return resolve(false);
        const d = new Date(); // local time, as the user reads it
        const pad = (n) => String(n).padStart(2, '0');
        const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${name}-${stamp}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        resolve(true);
      }, 'image/png')
    );
  }

  setGridVisible(visible) {
    this.showGrid = visible;
    this.savePref('showGrid', visible);
    (this.gridLines || []).forEach((l) => (l.visible = visible));
  }

  setAssetsState(state) {
    this.assetsState = state;
    if (this.onAssetsStatus) this.onAssetsStatus(state);
  }

  init() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 400);
    this.scene.add(this.camera);

    if (this.options.renderer) {
      this.renderer = this.options.renderer;
    } else {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
      this.renderer.setSize(width, height);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.05;
      this.container.appendChild(this.renderer.domElement);
    }

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.rotateSpeed = 0.6;
    this.controls.zoomSpeed = 1.1;
    this.controls.minDistance = this.radius * 1.12;
    this.controls.maxDistance = this.radius * 3.5;
    this.controls.enablePan = false;
    this.frameGlobe(width, height, true);

    this.setupLighting();

    this.planetGroup = new THREE.Group();
    this.scene.add(this.planetGroup);

    this.createSpace();
    this.createAtmosphere();
    this.createCloudLayer();

    this.colliderMesh = new THREE.Mesh(
      new THREE.SphereGeometry(this.radius, 32, 32),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    this.scene.add(this.colliderMesh);

    this.createHoverIndicator();

    // The canvas may be shared with other modes: ignore input while suspended
    window.addEventListener('resize', () => !this.suspended && this.onWindowResize());
    const el = this.renderer.domElement;
    el.addEventListener('pointermove', (e) => !this.suspended && (this.pendingPointer = e));
    el.addEventListener('pointerleave', () => !this.suspended && (this.pendingPointer = { leave: true }));
    // Select on click only, not at the start of a drag-to-rotate
    el.addEventListener('pointerdown', (e) => {
      if (this.suspended) return;
      this.pressAt = { x: e.clientX, y: e.clientY };
      this.povDrag = { x: e.clientX, y: e.clientY };
    });
    el.addEventListener('pointerup', (e) => {
      this.povDrag = null;
      if (!this.suspended) this.onPointerUp(e);
    });
    // Riding along: drag looks around the vehicle, the wheel moves the camera in and out
    el.addEventListener('pointermove', (e) => {
      if (this.suspended || !this.pov || !this.povDrag || !e.buttons) return;
      const rig = this.povRig;
      rig.yaw -= (e.clientX - this.povDrag.x) * 0.006;
      rig.pitch = THREE.MathUtils.clamp(rig.pitch + (e.clientY - this.povDrag.y) * 0.004, -0.5, 1.1);
      rig.lastInput = performance.now();
      this.povDrag = { x: e.clientX, y: e.clientY };
    });
    el.addEventListener(
      'wheel',
      (e) => {
        if (this.suspended || !this.pov) return;
        this.povRig.zoom = THREE.MathUtils.clamp(this.povRig.zoom * Math.exp(e.deltaY * 0.0012), 0.55, 3);
      },
      { passive: true }
    );

    this.animate = this.animate.bind(this);
    if (!this.options.externalLoop) requestAnimationFrame(this.animate);
  }

  /** Leave the planet: free every per-planet mesh, stop reacting to input. */
  suspend() {
    if (this.pov) this.exitPov(true, false);
    if (this.focus) this.clearFocus({ animate: false });
    this.camTween = null;
    this.buildId++; // cancels a prop build still waiting for assets
    this.clearPlanet();
    this.mapData = null;
    this.pendingPointer = null;
    this.pressAt = null;
    this.suspended = true;
    this.controls.enabled = false;
  }

  resume() {
    this.suspended = false;
    this.controls.enabled = true;
    this.planetGroup.rotation.set(0, 0, 0);
  }

  /** Whole-globe framing seen from a direction in planet space (arrival from orbit). */
  viewFrom(dir) {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.camTween = null;
    this.setControlsUp(UP);
    this.controls.target.set(0, 0, 0);
    this.controls.minDistance = this.radius * 1.12;
    this.controls.maxPolarAngle = Math.PI;
    this.camera.position.copy(dir).normalize();
    this.frameGlobe(w || window.innerWidth, h || window.innerHeight);
    this.controls.enabled = true;
  }

  /** Per-type colours: palette, shore colours, mountains, water, sky, air and clouds. */
  applyLook(typeKey) {
    const look = PLANET_TYPES[typeKey]?.look || {};
    this.look = look;
    this.palette = { ...BIOME_PALETTE, ...(look.palette || {}) };
    const atmo = look.atmosphere === undefined ? [0x8cccff, 0x408cf2] : look.atmosphere;
    this.atmosphere.visible = !!atmo;
    this.haze.visible = !!atmo;
    if (atmo) {
      this.atmosphere.material.uniforms.uInner.value.set(atmo[0]);
      this.atmosphere.material.uniforms.uOuter.value.set(atmo[1]);
      this.haze.material.uniforms.uColor.value.set(look.haze ?? 0x9ed1ff);
    }
    this.hasAir = !!atmo;
    const clouds = look.clouds === undefined ? { count: 70 } : look.clouds;
    this.cloudsMesh.visible = !!clouds;
    if (clouds) {
      const n = Math.min(this.cloudOffsets.length - 1, clouds.count ?? 70);
      this.cloudsMesh.geometry.setDrawRange(0, this.cloudOffsets[n]);
      this.cloudsMesh.material.uniforms.uTint.value.set(clouds.color ?? 0xffffff);
    }
  }

  /** Default view: whole planet in frame, ~91% of the shorter screen axis, seen slightly from above. */
  frameGlobe(width, height, resetDirection = false) {
    const halfV = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const halfH = Math.atan(Math.tan(halfV) * (width / height));
    const distance = this.radius / Math.sin(0.91 * Math.min(halfV, halfH));

    this.controls.maxDistance = Math.max(this.radius * 3.5, distance * 1.15);
    const dir =
      resetDirection || this.camera.position.lengthSq() < 0.01
        ? new THREE.Vector3(0, 0.35, 0.93).normalize()
        : this.camera.position.clone().normalize();
    this.camera.position.copy(dir.multiplyScalar(distance));
    this.camera.lookAt(0, 0, 0);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  setupLighting() {
    this.scene.add(new THREE.HemisphereLight(0xe6f2ff, 0x5b6f4a, 1.1));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.25));
    // Key light follows the camera so whatever you look at is lit
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    sun.position.set(-12, 16, 10);
    this.camera.add(sun);
    this.camera.add(sun.target);
    sun.target.position.set(0, 0, -30);
  }

  /** Deep-space backdrop (shared with the space mode, see spaceBackdrop.js). */
  createSpace() {
    const { nebula, stars } = createSpaceBackdrop({ radius: 300, pixelRatio: this.renderer.getPixelRatio() });
    this.nebula = nebula;
    this.stars = stars;
    this.scene.add(nebula, stars);
  }

  createAtmosphere() {
    const shell = (radius, side, fragment, uniforms) =>
      new THREE.Mesh(
        new THREE.SphereGeometry(radius, 96, 64),
        new THREE.ShaderMaterial({
          uniforms,
          vertexShader: `
            varying vec3 vNormal;
            varying vec3 vPosition;
            void main() {
              vNormal = normalize(normalMatrix * normal);
              vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
              gl_Position = projectionMatrix * vec4(vPosition, 1.0);
            }
          `,
          fragmentShader: `
            uniform vec3 uInner;
            uniform vec3 uOuter;
            uniform vec3 uColor;
            varying vec3 vNormal;
            varying vec3 vPosition;
            void main() {
              float fresnel = clamp(1.0 - abs(dot(normalize(-vPosition), vNormal)), 0.0, 1.0);
              ${fragment}
            }
          `,
          side,
          transparent: true,
          depthWrite: false
        })
      );
    // Outer glow ring beyond the limb, fading into the concrete canvas
    this.atmosphere = shell(
      this.radius * 1.09,
      THREE.BackSide,
      `float glow = pow(1.0 - fresnel, 1.6);
       gl_FragColor = vec4(mix(uInner, uOuter, glow), glow * 0.85);`,
      { uInner: { value: new THREE.Color(0x8cccff) }, uOuter: { value: new THREE.Color(0x408cf2) }, uColor: { value: new THREE.Color() } }
    );
    // Haze over the terrain near the limb: the planet's edge looks wrapped in air
    this.haze = shell(
      this.radius * 1.075,
      THREE.FrontSide,
      `gl_FragColor = vec4(uColor, pow(fresnel, 2.4) * 0.6);`,
      { uInner: { value: new THREE.Color() }, uOuter: { value: new THREE.Color() }, uColor: { value: new THREE.Color(0x9ed1ff) } }
    );
    this.haze.renderOrder = 7;
    this.scene.add(this.atmosphere, this.haze);
  }

  /**
   * Low-poly cumulus clusters drifting above the planet. They fade out when
   * the camera gets close, so they frame the globe from orbit and float
   * overhead in POV without ever blocking the view.
   */
  createCloudLayer() {
    const rng = mulberry32(20260924);
    const R = this.radius;
    const clusters = [];
    const m = new THREE.Matrix4();
    // Enough clusters for the cloudiest planet type; each type draws a prefix (setDrawRange)
    for (let c = 0; c < 110; c++) {
      const z = rng() * 1.7 - 0.85; // keep clear of the poles
      const phi = rng() * Math.PI * 2;
      const dir = new THREE.Vector3(Math.sqrt(1 - z * z) * Math.cos(phi), z, Math.sqrt(1 - z * z) * Math.sin(phi));
      const puffs = [];
      // A flat-bottomed cumulus: a big central puff, smaller ones spread around it
      const n = 6 + Math.floor(rng() * 6);
      const spread = R * (0.03 + rng() * 0.035);
      for (let i = 0; i < n; i++) {
        const big = i === 0;
        const r = R * (big ? 0.022 + rng() * 0.01 : 0.01 + rng() * 0.014);
        const g = new THREE.IcosahedronGeometry(r, 1);
        g.scale(1.25, big ? 0.7 : 0.55, 1);
        const a = rng() * Math.PI * 2;
        const d = big ? 0 : spread * (0.35 + rng() * 0.65);
        g.translate(Math.cos(a) * d * 1.4, r * 0.3, Math.sin(a) * d * 0.8);
        puffs.push(g);
      }
      const cluster = mergeGeometries(puffs, false);
      puffs.forEach((g) => g.dispose());
      const alt = R * (1.055 + rng() * 0.035);
      const q = new THREE.Quaternion().setFromUnitVectors(UP, dir).multiply(new THREE.Quaternion().setFromAxisAngle(UP, rng() * Math.PI * 2));
      cluster.applyMatrix4(m.compose(dir.clone().multiplyScalar(alt), q, new THREE.Vector3(1, 1, 1)));
      clusters.push(cluster);
    }
    const geo = mergeGeometries(clusters, false);
    this.cloudOffsets = [0];
    for (const g of clusters) this.cloudOffsets.push(this.cloudOffsets[this.cloudOffsets.length - 1] + (g.index ? g.index.count : g.attributes.position.count));
    clusters.forEach((g) => g.dispose());
    geo.computeVertexNormals();
    const mat = new THREE.ShaderMaterial({
      uniforms: { uNear: { value: R * 0.1 }, uFar: { value: R * 0.26 }, uTint: { value: new THREE.Color(0xffffff) } },
      vertexShader: `
        varying vec3 vNormal;
        varying float vDepth;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform float uNear;
        uniform float uFar;
        uniform vec3 uTint;
        varying vec3 vNormal;
        varying float vDepth;
        void main() {
          // Two-step toon shading lit from the upper left, like the terrain
          float ndl = dot(normalize(vNormal), normalize(vec3(-0.45, 0.65, 0.6)));
          vec3 col = ndl > 0.25 ? vec3(1.0) : ndl > -0.25 ? vec3(0.9, 0.93, 0.97) : vec3(0.78, 0.84, 0.92);
          gl_FragColor = vec4(col * uTint, 0.86 * smoothstep(uNear, uFar, vDepth));
        }
      `,
      transparent: true,
      depthWrite: false
    });
    this.cloudsMesh = new THREE.Mesh(geo, mat);
    this.cloudsMesh.renderOrder = 6;
    this.planetGroup.add(this.cloudsMesh);
  }

  /** Hover marker: a flat grey band just inside the hex rim, strong outside and soft inside. */
  createHoverIndicator() {
    this.hoverIndicatorMesh = new THREE.Mesh(new THREE.BufferGeometry(), bandMaterial(0x4a4a4a, { outer: 0.72, inner: 0.28 }));
    this.hoverIndicatorMesh.visible = false;
    this.hoverIndicatorMesh.renderOrder = 10;
    this.planetGroup.add(this.hoverIndicatorMesh);
  }

  /** Closed loops of corner indices around the outside of a tile set. */
  boundaryLoops(set) {
    const adj = new Map();
    const link = (u, v) => {
      if (!adj.has(u)) adj.set(u, []);
      adj.get(u).push(v);
    };
    const tileMap = this.hexasphere.tileMap;
    for (const id of set) {
      for (const e of this.tileEdges(tileMap.get(id))) {
        if (e.nb && set.has(e.nb.id)) continue;
        link(e.ia, e.ib);
        link(e.ib, e.ia);
      }
    }
    const visited = new Set();
    const loops = [];
    for (const [start] of adj) {
      if (visited.has(start)) continue;
      const loop = [start];
      visited.add(start);
      let curr = start;
      let prev = null;
      for (;;) {
        const next = (adj.get(curr) || []).find((n) => n !== prev && !visited.has(n));
        if (next === undefined) break;
        visited.add(next);
        loop.push(next);
        prev = curr;
        curr = next;
      }
      if (loop.length >= 3) loops.push(loop);
    }
    return loops;
  }

  /**
   * Smooth flat ribbon around a tile set: every hex corner is rounded off with
   * a fillet, the outline is resampled along a spline, and the ribbon is laid
   * on the ground toward the inside. uv.y is 0 on the outline, 1 on the inner edge.
   */
  /**
   * Rounded outlines of a tile set: every hex corner is filleted and the loop
   * resampled along a spline. Returns [{ pts, inward }] on the unit sphere,
   * where inward[i] points into the set.
   */
  roundedLoops(set, density = 10) {
    const tileMap = this.hexasphere.tileMap;
    const corners = this.hexasphere.globalCorners;
    const unitTr = this.tileRadius / this.radius;
    let hint = tileMap.get(set.values().next().value);
    const out = [];
    for (const loop of this.boundaryLoops(set)) {
      const N = loop.length;
      const rounded = [];
      for (let i = 0; i < N; i++) {
        const P = corners[loop[i]];
        const A = P.clone().lerp(corners[loop[(i - 1 + N) % N]], 0.42);
        const B = P.clone().lerp(corners[loop[(i + 1) % N]], 0.42);
        for (let k = 0; k <= 5; k++) {
          const t = k / 5;
          rounded.push(
            A.clone()
              .multiplyScalar((1 - t) * (1 - t))
              .addScaledVector(P, 2 * (1 - t) * t)
              .addScaledVector(B, t * t)
              .normalize()
          );
        }
      }
      const curve = new THREE.CatmullRomCurve3(rounded, true, 'centripetal');
      const pts = curve.getSpacedPoints(Math.max(36, N * density)).slice(0, -1).map((p) => p.normalize());
      const n = pts.length;
      const sides = pts.map((p, i) => new THREE.Vector3().crossVectors(p, pts[(i + 1) % n].clone().sub(pts[(i - 1 + n) % n])).normalize());
      // Which side is inside? Probe a few points and take the majority
      let votes = 0;
      for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 8))) {
        const q = pts[i].clone().addScaledVector(sides[i], unitTr * 0.3).normalize();
        hint = this.locate(q, hint);
        votes += set.has(hint.id) ? 1 : -1;
      }
      if (votes < 0) sides.forEach((v) => v.negate());
      out.push({ pts, inward: sides });
    }
    return out;
  }

  /**
   * Smooth flat ribbon around a tile set, laid on the ground toward the
   * inside. uv.y is 0 on the outline, 1 on the inner edge.
   */
  roundedBand(tileIds, width, lift = 0.002) {
    const set = tileIds instanceof Set ? tileIds : new Set(tileIds);
    const tileMap = this.hexasphere.tileMap;
    const unitTr = this.tileRadius / this.radius;
    const pos = [];
    const uv = [];
    const idx = [];
    let hint = tileMap.get(set.values().next().value);
    for (const { pts, inward } of this.roundedLoops(set)) {
      const n = pts.length;
      const base = pos.length / 3;
      for (let i = 0; i < n; i++) {
        const outer = pts[i];
        const inner = outer.clone().addScaledVector(inward[i], width * unitTr).normalize();
        hint = this.locate(outer, hint);
        const po = outer.clone().multiplyScalar(this.surfaceRadius(outer, hint) + lift);
        const pi = inner.clone().multiplyScalar(this.surfaceRadius(inner, this.locate(inner, hint)) + lift);
        pos.push(po.x, po.y, po.z, pi.x, pi.y, pi.z);
        uv.push(i / n, 0, i / n, 1);
        const a = base + i * 2;
        const b = base + ((i + 1) % n) * 2;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }

  /** Ground height at a direction: the rounded coastline decides land vs sea. */
  surfaceRadius(dir, tile) {
    if (!this.landField) return isWater(tile) ? this.waterR : this.landR;
    return this.landField.signed(dir, tile) > 0 ? this.landR : this.waterR;
  }

  /** Dry land at least `margin` tile radii in from the rounded coastline. */
  isDry(dir, tile, margin = 0.08) {
    return !this.landField || this.landField.signed(dir, tile) > margin;
  }




  // ------------------------------------------------------------------
  // BUILD
  // ------------------------------------------------------------------

  buildPlanet(mapData, { restorePov } = {}) {
    const povWas = restorePov ? { mode: restorePov.mode, index: this.moversOf(restorePov.mode).indexOf(restorePov) } : null;
    if (this.pov) this.exitPov(false, false);
    // A new world invalidates the focused city/faction
    if (this.focus && this.mapData && mapData.seed !== this.mapData.seed) this.clearFocus();
    this.clearPlanet();
    this.applyLook(mapData.planetType);
    const buildId = ++this.buildId;
    const tiles = this.hexasphere.tiles;
    const R = this.radius;
    this.mapData = mapData;
    this.cityByIndex = new Map((mapData.cities || []).map((c) => [c.index, c]));

    this.tileSpacing = R * Math.sqrt((4 * Math.PI) / tiles.length);
    const sample = tiles.slice(0, 60);
    this.tileRadius = (R * sample.reduce((s, t) => s + t.center.distanceTo(t.corners[0]), 0)) / sample.length;
    this.noise = createNoise3D((mapData.seed || 1) + 313);
    this.midCache = new Map();
    this.edgeCache = new Map();
    // Corridors keep scattered props off rivers and roads (unit-sphere coordinates)
    this.corridor = new Corridor((this.tileRadius / R) * 0.6);

    this.cornerTiles = new Map();
    for (const t of tiles) {
      for (const c of t.cornerIndices) {
        if (!this.cornerTiles.has(c)) this.cornerTiles.set(c, []);
        this.cornerTiles.get(c).push(t);
      }
    }

    this.mapGroup = new THREE.Group();
    this.planetGroup.add(this.mapGroup);
    this.groundRouteGroup = new THREE.Group();
    this.seaRouteGroup = new THREE.Group();
    this.airRouteGroup = new THREE.Group();
    this.mapGroup.add(this.groundRouteGroup, this.seaRouteGroup, this.airRouteGroup);

    this.computeRiverTiles(mapData.riverPaths || []);
    this.computeFarmPlots(mapData);
    this.buildTerrain(tiles);
    const mountains = this.buildMountains(mapData);
    this.mountainPeaks = mountains?.peaks || new Map();
    this.buildTerritoryBorders();
    this.buildRivers(mapData.riverPaths || []);
    this.buildRoutes(mapData);
    this.buildAirRoutes(mapData);
    this.applyRouteVisibility();

    Promise.all([this.assetsPromise, this.loadLabelFont()]).then(([lib]) => {
      if (buildId !== this.buildId) return;
      this.buildLabels(mapData);
      if (!lib) return;
      const props = new PropBatch();
      this.buildBridges(props);
      this.buildRiverbanks(props);
      this.scatterNature(mapData, props, mountains?.foothills || []);
      this.buildSettlements(mapData, props);
      this.buildFarms(mapData, props);
      this.flushProps(props);
      if (this.options.decorativeMovers !== false) this.buildMovers(mapData);
      this.applyRouteVisibility();
      if (this.focus) this.setHighlight(this.focus.spec, this.highlightTiles(this.focus.spec));
      if (povWas) this.enterPov(this.moversOf(povWas.mode)[Math.max(0, povWas.index)] || null);
      else if (this.onPovChange) this.onPovChange(this.povInfo());
    });
  }

  highlightTiles(spec) {
    if (spec.type === 'city') {
      const c = this.cityByIndex.get(spec.index);
      return c ? c.tiles || [c.tileId] : [];
    }
    if (spec.type === 'faction') return this.mapData[spec.owner]?.claimedTiles || [];
    return [spec.tileId];
  }

  loadLabelFont() {
    if (!document.fonts?.load) return Promise.resolve();
    return document.fonts.load('500 30px "Barlow Condensed"').catch(() => null);
  }

  edgeNeighbor(tile, ia, ib) {
    const a = this.cornerTiles.get(ia);
    const b = this.cornerTiles.get(ib);
    return a.find((t) => t !== tile && b.includes(t)) || null;
  }

  /** Midpoint of the hex edge between two corners (hex edges stay straight). */
  edgeMid(ia, ib) {
    const key = Math.min(ia, ib) * 1000003 + Math.max(ia, ib);
    let m = this.midCache.get(key);
    if (!m) {
      m = this.hexasphere.globalCorners[ia].clone().add(this.hexasphere.globalCorners[ib]).normalize();
      this.midCache.set(key, m);
    }
    return m;
  }

  /** Edges of a tile with their neighbour: [{ A, B, ia, ib, nb }]. */
  tileEdges(tile) {
    let edges = this.edgeCache.get(tile.id);
    if (edges) return edges;
    const n = tile.cornerIndices.length;
    edges = [];
    for (let i = 0; i < n; i++) {
      const ia = tile.cornerIndices[i];
      const ib = tile.cornerIndices[(i + 1) % n];
      edges.push({ ia, ib, A: this.hexasphere.globalCorners[ia], B: this.hexasphere.globalCorners[ib], nb: this.edgeNeighbor(tile, ia, ib) });
    }
    this.edgeCache.set(tile.id, edges);
    return edges;
  }

  /** Distance from a unit direction to a tile edge, in tile radii. */
  edgeDistance(p, e) {
    const ab = _v4.subVectors(e.B, e.A);
    const t = THREE.MathUtils.clamp(_v.subVectors(p, e.A).dot(ab) / ab.lengthSq(), 0, 1);
    return _v.copy(e.A).addScaledVector(ab, t).distanceTo(p) / (this.tileRadius / this.radius);
  }

  /** Uniform random direction inside a hex (optionally shrunk toward its centre). */
  hexSample(tile, rng, reach = 1) {
    const edges = this.tileEdges(tile);
    const e = edges[Math.floor(rng() * edges.length)];
    const r1 = Math.sqrt(rng()) * reach;
    const r2 = rng();
    return tile.center
      .clone()
      .multiplyScalar(1 - r1)
      .addScaledVector(e.A, r1 * (1 - r2))
      .addScaledVector(e.B, r1 * r2)
      .normalize();
  }

  /** Tile containing a direction, found by walking from a nearby hint tile. */
  locate(dir, hint) {
    const tileMap = this.hexasphere.tileMap;
    let cur = hint;
    let best = cur.center.dot(dir);
    for (;;) {
      let next = null;
      for (const id of cur.neighbors) {
        const t = tileMap.get(id);
        const d = t.center.dot(dir);
        if (d > best) {
          best = d;
          next = t;
        }
      }
      if (!next) return cur;
      cur = next;
    }
  }

  noiseAt(p, freq, seed = 0) {
    const f = (this.radius / this.tileSpacing) * freq;
    return this.noise.noise(p.x * f + seed, p.y * f - seed * 0.7, p.z * f + seed * 1.3);
  }

  isCity(tile) {
    return tile.cityIndex !== null && tile.cityIndex !== undefined;
  }

  isFarm(tile) {
    return tile.farmIndex !== null && tile.farmIndex !== undefined;
  }

  tileBaseColor(tile) {
    let hexColor = this.palette[tile.biome] ?? this.palette[BIOMES.PLAINS];
    if (this.isCity(tile)) hexColor = GROUND[this.cityByIndex.get(tile.cityIndex)?.style === 'modern' ? 'modern' : 'fantasy'];
    else if (this.isFarm(tile)) hexColor = GROUND[this.mapData?.farms?.[tile.farmIndex]?.crop] ?? GROUND.wheat;
    const c = new THREE.Color(hexColor);
    if (!isWater(tile)) {
      // River valleys are lusher than the land around them
      if (this.riverTiles.has(tile.id) && (tile.biome === BIOMES.PLAINS || tile.biome === BIOMES.FOREST) && !this.isCity(tile)) {
        c.lerp(_c.set(GROUND.riverbank), 0.3);
      }
      c.offsetHSL(0, 0, (hash01(tile.id) - 0.5) * 0.06);
      if (tile.owner && FACTION[tile.owner]) c.lerp(_c.set(FACTION[tile.owner]), 0.08);
    }
    return c;
  }

  /** Low-frequency brightness/hue drift so large areas of one biome don't look stamped. */
  paint(color, dir, amount = 1) {
    const f = (this.radius / this.tileSpacing) * 0.35;
    const n = this.noise.noise(dir.x * f + 11, dir.y * f, dir.z * f);
    const n2 = this.noise.noise(dir.x * f * 2.7, dir.y * f * 2.7 + 5, dir.z * f * 2.7);
    return color.clone().offsetHSL(n2 * 0.012 * amount, 0, (n * 0.055 + n2 * 0.025) * amount);
  }

  /**
   * How a tile's ground changes toward one neighbour, drawn INSIDE the hex so
   * the grid stays regular while the world reads as continuous: a sand strip
   * along the sea, shallows along the shore, forests fading into grassland,
   * foothills greening toward mountains.
   */
  edgeTransition(tile, nb, colorOf) {
    if (!nb) return null;
    const wet = isWater(tile);
    const nbWet = isWater(nb);
    const base = colorOf.get(tile.id);
    if (wet) {
      if (!nbWet) return { color: this.col.shallows, width: 0.55, strength: 0.85 };
      if (nb.biome !== tile.biome) return { color: base.clone().lerp(colorOf.get(nb.id), 0.5), width: 0.7, strength: 1 };
      return null;
    }
    if (nbWet) {
      if (tile.biome === BIOMES.TUNDRA) return { color: this.col.iceShore, width: 0.26, strength: 1, crisp: true, shore: true };
      if (tile.biome === BIOMES.BEACH || tile.biome === BIOMES.DESERT) return { color: this.col.wetSand, width: 0.14, strength: 1, crisp: true, shore: true };
      if (this.isCity(tile)) return { color: this.col.quay, width: 0.12, strength: 1, crisp: true, shore: true };
      return { color: this.col.sand, width: 0.32, strength: 1, crisp: true, shore: true };
    }
    if (nb.biome === BIOMES.MOUNTAIN) return { color: this.col.foothill, width: 0.4, strength: 0.55 };
    const special = (t) => this.isCity(t) || this.isFarm(t);
    if (special(tile)) {
      // Plots and streets end in a thin grass verge
      return special(nb) && nb.cityIndex === tile.cityIndex && nb.farmIndex === tile.farmIndex
        ? null
        : { color: colorOf.get(nb.id).clone().lerp(this.col.verge, special(nb) ? 0 : 0.6), width: 0.1, strength: 0.9, crisp: true };
    }
    if (nb.biome === tile.biome && !special(nb)) return null;
    // Wild land blends halfway at the shared edge, so both sides meet on the same colour
    return { color: base.clone().lerp(colorOf.get(nb.id), 0.5), width: 0.55, strength: special(nb) ? 0.35 : 1 };
  }

  /** Ground colour at a direction inside a land tile. */
  groundColor(tile, p, base, transitions, sLand) {
    const own = this.isFarm(tile) ? this.plotAt(tile, p).soil : base;
    const c = this.paint(own, p, 1);
    let shoreDone = false;
    for (const { e, tr } of transitions) {
      // The sand strip follows the rounded coastline (once), other blends follow the hex edge
      if (tr.shore && shoreDone) continue;
      const d = tr.shore ? Math.max(0, sLand ?? this.landField.signed(p, tile)) : this.edgeDistance(p, e);
      if (tr.shore) shoreDone = true;
      const w = tr.width * (1 + 0.45 * this.noiseAt(p, 2.2, 7));
      const t = tr.crisp ? 1 - THREE.MathUtils.smoothstep(d, w * 0.72, w) : 1 - THREE.MathUtils.smoothstep(d, 0, w);
      if (t > 0) c.lerp(tr.color, t * tr.strength);
    }
    return c;
  }

  /**
   * Water colour from rounded depth contours: deep trenches, open sea and the
   * shallow coastal ring blend along smooth curves, and turquoise shallows
   * hug the (rounded) shoreline.
   */
  waterColor(p, tile, sLand) {
    const soft = (sd) => THREE.MathUtils.smoothstep(sd, -0.35, 0.35);
    const c = this.col.ocean.clone();
    c.lerp(this.col.deep, soft(this.deepField.signed(p, tile)));
    c.lerp(this.col.coastal, soft(this.coastField.signed(p, tile)));
    const off = -(sLand ?? this.landField.signed(p, tile)); // distance out to sea from the coastline
    const w = 0.55 * (1 + 0.4 * this.noiseAt(p, 2.2, 5));
    c.lerp(this.col.shallows, (1 - THREE.MathUtils.smoothstep(off, 0, w)) * 0.85);
    return this.paint(c, p, 0.4);
  }

  buildTerrain(tiles) {
    const relief = this.terrainMode !== 'flat';
    const land = { pos: new FloatBuffer(), col: new FloatBuffer(), nrm: new FloatBuffer() };
    const water = { pos: new FloatBuffer(), col: new FloatBuffer(), nrm: new FloatBuffer() };
    const landLines = [];
    const waterLines = [];
    this.col = {
      sand: new THREE.Color(0xecd79c),
      wetSand: new THREE.Color(0xd5bb7c),
      iceShore: new THREE.Color(0xd3e3ea),
      quay: new THREE.Color(0xb5ab98),
      shallows: new THREE.Color(0x74dbe2),
      foothill: new THREE.Color(0x8e9a5a),
      verge: new THREE.Color(0x7fae47),
      deep: new THREE.Color(this.palette[BIOMES.OCEAN_DEEP]),
      ocean: new THREE.Color(this.palette[BIOMES.OCEAN]),
      coastal: new THREE.Color(this.palette[BIOMES.COAST])
    };
    for (const [k, v] of Object.entries(this.look.col || {})) this.col[k] = new THREE.Color(v);
    // Rounded contours for the coastline and the depth bands
    this.landField = new ContourField(this, (t) => !isWater(t));
    // Depth bands only colour the water, so a coarser outline is plenty
    this.deepField = new ContourField(this, (t) => t.biome === BIOMES.OCEAN_DEEP, 3);
    this.coastField = new ContourField(this, (t) => t.biome === BIOMES.COAST, 3);

    const colorOf = new Map();
    tiles.forEach((t) => colorOf.set(t.id, this.tileBaseColor(t)));
    const transitionsOf = new Map();
    for (const t of tiles) {
      const list = [];
      if (t.biome !== BIOMES.MOUNTAIN && !isWater(t)) {
        for (const e of this.tileEdges(t)) {
          const tr = this.edgeTransition(t, e.nb, colorOf);
          if (tr) list.push({ e, tr });
        }
      }
      transitionsOf.set(t.id, list);
    }
    // Colour of land/sea at p even when p lies in a tile of the other kind
    // (rounded corners move the shore across hex edges)
    const nearestOf = (tile, wantWater) => {
      if (isWater(tile) === wantWater) return tile;
      const nbs = tile.neighbors.map((id) => this.hexasphere.tileMap.get(id)).filter((n) => isWater(n) === wantWater);
      // Prefer lowland over mountains for the colour of filled-in shore corners
      return nbs.find((n) => n.biome !== BIOMES.MOUNTAIN) || nbs[0] || tile;
    };
    // sLand: the coastline distance already known at this point (saves a field lookup)
    const landColorAt = (p, tile, sLand) => {
      const t = nearestOf(tile, false);
      return this.groundColor(t, p, colorOf.get(t.id), transitionsOf.get(t.id), sLand);
    };
    const waterColorAt = (p, tile, sLand) => this.waterColor(p, tile, sLand);

    const push = (buf, p, n, c) => {
      buf.pos.add3(p.x, p.y, p.z);
      buf.nrm.add3(n.x, n.y, n.z);
      buf.col.add3(c.r, c.g, c.b);
    };
    const skirtColor = new THREE.Color(this.look.skirt?.[0] ?? 0x9b7a52);
    const skirtDark = new THREE.Color(this.look.skirt?.[1] ?? 0x7a5c3c);
    const skirtMidR = (this.landR + this.skirtR) / 2;

    // Vertical quad facing `out` (outward normal), from top edge t1-t2 down to b1-b2
    const wall = (t1, t2, b1, b2, out, colr) => {
      const n = new THREE.Vector3().subVectors(b1, t1).cross(new THREE.Vector3().subVectors(t2, t1));
      if (n.dot(out) < 0) {
        [t1, t2] = [t2, t1];
        [b1, b2] = [b2, b1];
      }
      push(land, t1, out, colr);
      push(land, b1, out, colr);
      push(land, t2, out, colr);
      push(land, t2, out, colr);
      push(land, b1, out, colr);
      push(land, b2, out, colr);
    };

    const gridFor = (tile, e, k, fn) => {
      const grid = [];
      for (let i = 0; i <= k; i++) {
        grid[i] = [];
        for (let j = 0; j <= k - i; j++) {
          const wA = i / k;
          const wB = j / k;
          // Planar barycentric point: edge vertices sit on the straight chord A-B,
          // so neighbouring tiles of any resolution meet without cracks.
          const b = new THREE.Vector3().addScaledVector(tile.center, 1 - wA - wB).addScaledVector(e.A, wA).addScaledVector(e.B, wB);
          grid[i][j] = fn(b, b.clone().normalize());
        }
      }
      return grid;
    };
    const eachTri = (grid, k, fn) => {
      for (let i = 0; i < k; i++) {
        for (let j = 0; j < k - i; j++) {
          fn(grid[i][j], grid[i + 1][j], grid[i][j + 1]);
          if (j < k - i - 1) fn(grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]);
        }
      }
    };

    for (const tile of tiles) {
      const wet = isWater(tile);
      const isMtn = tile.biome === BIOMES.MOUNTAIN;
      const edges = this.tileEdges(tile);
      const coastal = !isMtn && edges.some((e) => e.nb && isWater(e.nb) !== wet);

      if (coastal) {
        // Marching triangles: split the tile along the rounded coastline, so land
        // and sea (and the cliff between them) follow a smooth curve.
        const k = 4;
        for (const e of edges) {
          const grid = gridFor(tile, e, k, (b, dir) => ({ b, dir, s: this.landField.signed(dir, tile) - 1e-4 }));
          const lc = (v) => v.lc || (v.lc = landColorAt(v.dir, tile, v.s));
          const wc = (v) => v.wc || (v.wc = waterColorAt(v.dir, tile, v.s));
          eachTri(grid, k, (v0, v1, v2) => {
            const vs = [v0, v1, v2];
            const landPoly = [];
            const waterPoly = [];
            const cross = [];
            for (let i = 0; i < 3; i++) {
              const a = vs[i];
              const b = vs[(i + 1) % 3];
              (a.s > 0 ? landPoly : waterPoly).push(a);
              if (a.s > 0 !== b.s > 0) {
                const t = a.s / (a.s - b.s);
                const bb = a.b.clone().lerp(b.b, t);
                const c = { b: bb, dir: bb.clone().normalize(), s: 0 };
                landPoly.push(c);
                waterPoly.push(c);
                cross.push({ c, water: a.s > 0 ? b : a });
              }
            }
            const emit = (poly, buf, r, colorFn) => {
              for (let i = 1; i + 1 < poly.length; i++) {
                for (const v of [poly[0], poly[i], poly[i + 1]]) push(buf, v.b.clone().multiplyScalar(r), v.dir, colorFn(v));
              }
            };
            if (landPoly.length >= 3) emit(landPoly, land, this.landR, lc);
            if (waterPoly.length >= 3) emit(waterPoly, water, this.waterR, wc);
            if (cross.length === 2) {
              const [c1, c2] = cross.map((x) => x.c);
              const mid = c1.dir.clone().add(c2.dir).normalize();
              const seaward = cross[0].water.dir.clone().sub(mid);
              const out = seaward.addScaledVector(mid, -seaward.dot(mid)).normalize();
              if (relief) {
                wall(c1.b.clone().multiplyScalar(this.landR), c2.b.clone().multiplyScalar(this.landR), c1.b.clone().multiplyScalar(skirtMidR), c2.b.clone().multiplyScalar(skirtMidR), out, skirtColor);
                wall(c1.b.clone().multiplyScalar(skirtMidR), c2.b.clone().multiplyScalar(skirtMidR), c1.b.clone().multiplyScalar(this.skirtR), c2.b.clone().multiplyScalar(this.skirtR), out, skirtDark);
              }
            }
          });
        }
      } else if (wet) {
        // Open water: extra vertices only where a depth contour passes
        const k = edges.some((e) => e.nb && e.nb.biome !== tile.biome) ? 3 : 1;
        for (const e of edges) {
          const grid = gridFor(tile, e, k, (b, dir) => ({ p: b.clone().multiplyScalar(this.waterR), dir, c: waterColorAt(dir, tile) }));
          eachTri(grid, k, (a, b, c) => [a, b, c].forEach((v) => push(water, v.p, v.dir, v.c)));
        }
      } else if (!isMtn) {
        const transitions = transitionsOf.get(tile.id);
        const k = this.isFarm(tile) ? 5 : transitions.length ? 3 : 1;
        const base = colorOf.get(tile.id);
        for (const e of edges) {
          const grid = gridFor(tile, e, k, (b, dir) => ({ p: b.clone().multiplyScalar(this.landR), dir, c: this.groundColor(tile, dir, base, transitions) }));
          eachTri(grid, k, (a, b, c) => [a, b, c].forEach((v) => push(land, v.p, v.dir, v.c)));
        }
      }

      for (const { A, B, nb } of edges) {
        if (!nb) continue;
        // Mountains keep their hex outline: straight cliff + surf where they meet the sea
        if (isMtn && isWater(nb)) {
          const out = A.clone().add(B).sub(tile.center).sub(tile.center).normalize();
          if (relief) {
            wall(A.clone().multiplyScalar(this.landR), B.clone().multiplyScalar(this.landR), A.clone().multiplyScalar(skirtMidR), B.clone().multiplyScalar(skirtMidR), out, skirtColor);
            wall(A.clone().multiplyScalar(skirtMidR), B.clone().multiplyScalar(skirtMidR), A.clone().multiplyScalar(this.skirtR), B.clone().multiplyScalar(this.skirtR), out, skirtDark);
          }
        }
        if (tile.id < nb.id) {
          const line = (arr, gr) => arr.push([A, B, gr]);
          if (!wet && !isWater(nb) && !(isMtn && nb.biome === BIOMES.MOUNTAIN)) line(landLines, this.landR + 0.0015);
          else if (wet && isWater(nb)) line(waterLines, this.waterR + 0.0015);
        }
      }
    }

    const makeGeo = (buf) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(buf.pos.finish(), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(buf.nrm.finish(), 3));
      g.setAttribute('color', new THREE.BufferAttribute(buf.col.finish(), 3));
      // Let go of the growth buffers: closures made below (animated materials) share this scope, and anything
      // the scope still names stays alive as long as they do (that kept ~180 MiB of vertex data on the heap).
      buf.pos = buf.nrm = buf.col = null;
      return g;
    };

    this.mapGroup.add(
      new THREE.Mesh(new THREE.SphereGeometry(this.skirtR * 0.999, 48, 32), new THREE.MeshBasicMaterial({ color: this.look.core ?? 0x0d3b6e }))
    );
    const landMesh = new THREE.Mesh(makeGeo(land), createToonMaterial({ vertexColors: true }));
    landMesh.name = 'landMesh';
    this.mapGroup.add(landMesh);
    // In flat mode the sea shares the land's level: push it back in depth at the shore
    const offset = { polygonOffset: !relief, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
    const waterMesh = new THREE.Mesh(
      makeGeo(water),
      this.look.water?.unlit
        ? new THREE.MeshBasicMaterial({ vertexColors: true, ...offset }) // lava glows on its own
        : new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 28, specular: 0x2a4a66, ...offset })
    );
    waterMesh.name = 'oceanMesh';
    this.mapGroup.add(waterMesh);

    // Surf: one smooth ribbon hugging the rounded coastline, fading out to sea
    const landSet = new Set(tiles.filter((t) => !isWater(t)).map((t) => t.id));
    if (landSet.size) {
      const fr = this.waterR + 0.002;
      const fw = (this.tileRadius / this.radius) * 0.24;
      const fpos = [];
      const fuv = [];
      const fidx = [];
      for (const { pts, inward } of this.roundedLoops(landSet, 8)) {
        const n = pts.length;
        const base = fpos.length / 3;
        pts.forEach((p, i) => {
          const o = p.clone().addScaledVector(inward[i], -fw).normalize();
          fpos.push(p.x * fr, p.y * fr, p.z * fr, o.x * fr, o.y * fr, o.z * fr);
          fuv.push(i / n, 0, i / n, 1);
          const a0 = base + i * 2;
          const b0 = base + ((i + 1) % n) * 2;
          fidx.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1);
        });
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(fuv, 2));
      g.setIndex(fidx);
      const foamMat = bandMaterial(this.look.foam ?? 0xffffff, { outer: 0.75, inner: 0, fade: true });
      foamMat.side = THREE.DoubleSide;
      const foamMesh = new THREE.Mesh(g, foamMat);
      foamMesh.renderOrder = 1;
      this.mapGroup.add(foamMesh);
      this.animatedMaterials.push((t) => (foamMat.uniforms.uOuter.value = 0.6 + Math.sin(t * 1.6) * 0.18));
    }

    this.gridLines = [];
    const addLines = (edgesList, color, alpha) => {
      if (!edgesList.length) return;
      const w = this.tileSpacing * 0.022;
      const pos = [];
      const uv = [];
      for (const [A, B, r] of edgesList) {
        const side = new THREE.Vector3().crossVectors(A.clone().add(B), new THREE.Vector3().subVectors(B, A)).normalize().multiplyScalar(w / 2);
        const pa = A.clone().multiplyScalar(r);
        const pb = B.clone().multiplyScalar(r);
        const q = [pa.clone().add(side), pa.clone().sub(side), pb.clone().add(side), pb.clone().sub(side)];
        for (const [i, v] of [[0, 0], [1, 1], [2, 0], [2, 0], [1, 1], [3, 1]]) {
          pos.push(q[i].x, q[i].y, q[i].z);
          uv.push(0, v);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      const mesh = new THREE.Mesh(g, gridMaterial(color, alpha));
      mesh.renderOrder = 1;
      mesh.visible = this.showGrid;
      this.gridLines.push(mesh);
      this.mapGroup.add(mesh);
    };
    // Soft warm grey on land, a lighter blue-grey on water
    addLines(landLines, this.look.grid?.[0] ?? 0x5b5d52, 0.32);
    addLines(waterLines, this.look.grid?.[1] ?? 0x9fb9cc, 0.22);
  }

  /**
   * Farms are planned as one estate across all their tiles: 1-2 plot seeds
   * per tile, each plot its own crop and furrow direction. The ground colour
   * and the crop rows both follow the plots, so fields run across hex edges
   * like a real patchwork.
   */
  computeFarmPlots(mapData) {
    this.farmPlots = new Map();
    const tileMap = this.hexasphere.tileMap;
    const SOIL = { wheat: 0xd6b34a, crop: 0x6f9b3d, plowed: 0x9a7447, pasture: 0xa6c95f };
    for (const farm of mapData.farms || []) {
      const rng = mulberry32((mapData.seed || 1) * 31 + farm.index * 977);
      const mainAngle = rng() * Math.PI;
      const plots = [];
      for (const id of farm.tiles) {
        const tile = tileMap.get(id);
        const seeds = rng() < 0.6 ? 2 : 1;
        for (let i = 0; i < seeds; i++) {
          const dir = this.hexSample(tile, rng, 0.8);
          const roll = rng();
          const bias = farm.crop === 'wheat' ? 0.15 : -0.15;
          const crop = roll < 0.4 + bias ? 'wheat' : roll < 0.65 ? 'crop' : roll < 0.82 ? 'plowed' : 'pasture';
          const f = this.frameAt(dir);
          const a = mainAngle + (rng() < 0.3 ? Math.PI / 2 : 0) + (rng() - 0.5) * 0.35;
          const rowDir = f.u.clone().multiplyScalar(Math.cos(a)).addScaledVector(f.v, Math.sin(a)).normalize();
          plots.push({ dir, crop, rowDir, soil: new THREE.Color(SOIL[crop]).offsetHSL(0, 0, (rng() - 0.5) * 0.05), tile: id });
        }
      }
      this.farmPlots.set(farm.index, plots);
    }
  }

  plotAt(tile, p) {
    const plots = this.farmPlots.get(tile.farmIndex);
    let best = plots[0];
    let bestD = -2;
    for (const pl of plots) {
      const d = pl.dir.dot(p);
      if (d > bestD) {
        bestD = d;
        best = pl;
      }
    }
    return best;
  }

  frameAt(dir) {
    const n = dir.clone().normalize();
    const ref = Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(n, ref).normalize();
    const v = new THREE.Vector3().crossVectors(n, u).normalize();
    return { n, u, v };
  }

  buildMountains(mapData) {
    const result = buildMountainGeometry(this.hexasphere, {
      landRadius: this.landR,
      tileSpacing: this.tileSpacing,
      seed: mapData.seed || 1,
      edgeMid: (a, b) => this.edgeMid(a, b),
      palette: this.look.mountain
    });
    if (!result) return null;
    this.mapGroup.add(new THREE.Mesh(result.geometry, createToonMaterial({ vertexColors: true })));
    return result;
  }

  /**
   * Territory border, Civ style: a crisp line in the faction colour, a thin
   * concrete keyline just outside it, and a soft band of the same colour that
   * fades into the territory so the owned area reads at a glance.
   */
  buildTerritoryBorders() {
    for (const owner of ['player', 'system']) {
      const owned = this.mapData[owner]?.claimedTiles;
      if (!owned?.length) continue;
      // Flat on the ground: a solid outer stripe and a softer inner stripe of the same colour
      const band = new THREE.Mesh(this.roundedBand(owned, 0.2), bandMaterial(FACTION[owner], { outer: 1, inner: 0.5, split: 0.45 }));
      band.renderOrder = 4;
      // ...and a wide glow that fades into the territory
      const glow = new THREE.Mesh(this.roundedBand(owned, 0.55, 0.0015), bandMaterial(FACTION[owner], { outer: 0.3, inner: 0, fade: true }));
      glow.renderOrder = 3;
      this.mapGroup.add(glow, band);
    }
  }

  /** Flat ribbon on the sphere. uv.x = distance travelled, uv.y = 0..1 across. */
  buildRibbon(points, widthFn, lift = 0) {
    const pos = [];
    const nrm = [];
    const uvs = [];
    const idx = [];
    let dist = 0;
    const side = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const up = p.clone().normalize();
      tangent.subVectors(points[Math.min(points.length - 1, i + 1)], points[Math.max(0, i - 1)]).normalize();
      side.crossVectors(up, tangent).normalize();
      if (i > 0) dist += p.distanceTo(points[i - 1]);
      const w = widthFn(i / (points.length - 1)) / 2;
      const base = up.clone().multiplyScalar(p.length() + lift);
      const l = base.clone().addScaledVector(side, w);
      const r = base.clone().addScaledVector(side, -w);
      pos.push(l.x, l.y, l.z, r.x, r.y, r.z);
      nrm.push(up.x, up.y, up.z, up.x, up.y, up.z);
      uvs.push(dist, 0, dist, 1);
      if (i > 0) {
        const a = (i - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    return g;
  }

  /** Curve through tile centres; `wander` bends it between centres for a hand-drawn line. */
  pathCurve(path, { extraStart = null, extraEnd = null, wander = 0 } = {}) {
    const tileMap = this.hexasphere.tileMap;
    const pts = extraStart ? [extraStart] : [];
    const radiusOf = (t) => (isWater(t) ? this.waterR : this.landR);
    for (let i = 0; i < path.length; i++) {
      const t = tileMap.get(path[i]);
      pts.push(t.center.clone().multiplyScalar(radiusOf(t)));
      if (wander && i < path.length - 1) {
        const nt = tileMap.get(path[i + 1]);
        const mid = t.center.clone().add(nt.center).normalize();
        const along = new THREE.Vector3().subVectors(nt.center, t.center);
        const across = new THREE.Vector3().crossVectors(mid, along).normalize();
        const f = (this.radius / this.tileSpacing) * 0.7;
        const n = this.noise.noise(mid.x * f + 3, mid.y * f, mid.z * f - 7);
        mid.addScaledVector(across, (n * wander * this.tileRadius) / this.radius).normalize();
        pts.push(mid.multiplyScalar(Math.min(radiusOf(t), radiusOf(nt))));
      }
    }
    if (extraEnd) pts.push(extraEnd);
    return pts.length < 2 ? null : new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
  }

  /** Merge ribbons into one mesh (one draw call per route family). */
  addMerged(parts, material, parent, renderOrder = 0) {
    if (!parts.length) return;
    const mesh = new THREE.Mesh(mergeGeometries(parts, false), material);
    parts.forEach((g) => g.dispose());
    mesh.renderOrder = renderOrder;
    parent.add(mesh);
  }

  computeRiverTiles(riverPaths) {
    const tileMap = this.hexasphere.tileMap;
    this.riverTiles = new Set();
    this.riverStarts = [];
    for (const path of riverPaths) {
      let i = 0;
      while (i < path.length && tileMap.get(path[i]).biome === BIOMES.MOUNTAIN) i++;
      this.riverStarts.push(i);
      path.slice(i).forEach((id) => this.riverTiles.add(id));
    }
  }

  buildRivers(riverPaths) {
    const tileMap = this.hexasphere.tileMap;
    const s = this.tileSpacing;
    const water = [];
    const banks = [];
    this.rivers = [];
    riverPaths.forEach((path, idx) => {
      // Rivers spring from the mountain foot: skip tiles buried under the massif
      const i = this.riverStarts[idx];
      if (i >= path.length - 1) return;
      let start = null;
      if (i > 0) {
        start = tileMap.get(path[i - 1]).center.clone().lerp(tileMap.get(path[i]).center, 0.55);
        start.normalize().multiplyScalar(this.landR);
      }
      // End at the shoreline: the mouth sits on the edge between the last land tile and the sea
      let course = path.slice(i);
      const firstWet = course.findIndex((id) => isWater(tileMap.get(id)));
      let mouth = null;
      if (firstWet > 0) {
        const lastLand = tileMap.get(course[firstWet - 1]);
        mouth = lastLand.center.clone().lerp(tileMap.get(course[firstWet]).center, 0.5).normalize().multiplyScalar(this.landR);
        course = course.slice(0, firstWet);
      }
      if (course.length + (start ? 1 : 0) + (mouth ? 1 : 0) < 2) return;
      const curve = this.pathCurve(course, { extraStart: start, extraEnd: mouth, wander: 0.35 });
      if (!curve) return;
      const pts = curve.getSpacedPoints(Math.max(10, course.length * 8));
      const width = (t) => s * (0.05 + 0.11 * t);
      water.push(this.buildRibbon(pts, width, 0.0045));
      banks.push(this.buildRibbon(pts, (t) => width(t) * 1.9 + s * 0.02, 0.003));
      const samples = pts.map((p, k) => {
        const t = k / (pts.length - 1);
        const dir = p.clone().normalize();
        const tan = pts[Math.min(pts.length - 1, k + 1)].clone().sub(pts[Math.max(0, k - 1)]).normalize();
        this.corridor.add(dir, (width(t) * 1.1) / this.radius, { kind: 'river', width: width(t), tan, t });
        return { dir, tan, t, width: width(t) };
      });
      this.rivers.push({ samples });
    });
    this.addMerged(banks, createToonMaterial({ color: 0x5f8f3e, polygonOffset: true, polygonOffsetFactor: -1 }), this.mapGroup);
    this.addMerged(water, createToonMaterial({ color: 0x4cb6ee, polygonOffset: true, polygonOffsetFactor: -2 }), this.mapGroup);
  }

  buildRoutes(mapData) {
    this.landCurves = [];
    this.seaCurves = [];
    const s = this.tileSpacing;

    const roads = { fantasy: [], modern: [] };
    for (const route of mapData.landRoutes || []) {
      const curve = this.pathCurve(route.path, { wander: 0.18 });
      if (!curve) continue;
      const style = route.style || 'fantasy';
      this.landCurves.push({ curve, route, style });
      const pts = curve.getSpacedPoints(route.path.length * 6);
      roads[style].push(this.buildRibbon(pts, () => s * (style === 'modern' ? 0.11 : 0.1), 0.005));
      pts.forEach((p, k) => {
        const tan = pts[Math.min(pts.length - 1, k + 1)].clone().sub(pts[Math.max(0, k - 1)]).normalize();
        this.corridor.add(p.clone().normalize(), (s * 0.08) / this.radius, { kind: 'road', tan, style });
      });
    }
    this.addMerged(roads.fantasy, cozyRouteMaterial(createToonMaterial, false, s), this.groundRouteGroup);
    this.addMerged(roads.modern, cozyRouteMaterial(createToonMaterial, true, s), this.groundRouteGroup);

    const laneMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uDash: { value: 1 / (s * 0.45) }, uColor: { value: new THREE.Color(0xffffff) } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uDash;
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          if (fract(vUv.x * uDash - uTime * 0.8) > 0.55) discard;
          float edge = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
          gl_FragColor = vec4(uColor, 0.85 * edge);
        }
      `,
      transparent: true,
      depthWrite: false
    });
    this.animatedMaterials.push((t) => (laneMat.uniforms.uTime.value = t));

    const lanes = [];
    const tileMap = this.hexasphere.tileMap;
    const shorePoint = (landId, waterId) =>
      tileMap.get(landId).center.clone().lerp(tileMap.get(waterId).center, 0.55).normalize().multiplyScalar(this.waterR);
    for (const route of mapData.seaRoutes || []) {
      // Ships sail between the harbours, not over the town squares at either end
      const wet = route.path.filter((id) => isWater(tileMap.get(id)));
      if (wet.length < 2) continue;
      const first = route.path.findIndex((id) => isWater(tileMap.get(id)));
      const last = route.path.length - 1 - [...route.path].reverse().findIndex((id) => isWater(tileMap.get(id)));
      const extraStart = first > 0 ? shorePoint(route.path[first - 1], route.path[first]) : null;
      const extraEnd = last < route.path.length - 1 ? shorePoint(route.path[last + 1], route.path[last]) : null;
      const curve = this.pathCurve(route.path.slice(first, last + 1), { wander: 0.3, extraStart, extraEnd });
      if (!curve) continue;
      this.seaCurves.push({ curve, route, style: route.style || 'fantasy' });
      lanes.push(this.buildRibbon(curve.getSpacedPoints(route.path.length * 5), () => s * 0.12, 0.006));
    }
    this.addMerged(lanes, laneMat, this.seaRouteGroup, 2);
  }

  /** Great-circle arcs between cities; balloons fly low, airliners high. */
  buildAirRoutes(mapData) {
    this.airCurves = [];
    const tileMap = this.hexasphere.tileMap;
    let routes = mapData.airRoutes;
    if (!routes && mapData.player?.capitalId !== undefined && mapData.system?.capitalId !== undefined) {
      routes = [{ from: 0, to: 1, style: 'fantasy' }];
    }
    const tubes = [];
    for (const route of routes || []) {
      const ca = this.cityByIndex.get(route.from);
      const cb = this.cityByIndex.get(route.to);
      if (!ca || !cb) continue;
      const a = tileMap.get(ca.tileId).center.clone().normalize();
      const b = tileMap.get(cb.tileId).center.clone().normalize();
      const omega = Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
      const axis = new THREE.Vector3().crossVectors(a, b);
      if (axis.lengthSq() < 1e-8) axis.crossVectors(a, Math.abs(a.y) < 0.9 ? UP : new THREE.Vector3(1, 0, 0));
      axis.normalize();
      const peak = this.radius * (route.style === 'modern' ? 0.09 : 0.045);
      const pts = [];
      const steps = Math.max(24, Math.round(omega * 60));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const lift = this.landR + this.tileRadius * 0.6 + Math.sin(t * Math.PI) * peak;
        pts.push(a.clone().applyAxisAngle(axis, omega * t).multiplyScalar(lift));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      this.airCurves.push({ curve, route, style: route.style });
      tubes.push(new THREE.TubeGeometry(curve, steps * 2, 0.006, 4, false));
    }
    this.addMerged(
      tubes,
      new THREE.MeshBasicMaterial({ color: 0x1f1f1f, transparent: true, opacity: 0.35, depthWrite: false }),
      this.airRouteGroup
    );
    // Route lines are a map overlay: hidden while riding at ground level
    this.airLines = this.airRouteGroup.children[this.airRouteGroup.children.length - 1] || null;
  }

  // ------------------------------------------------------------------
  // PROPS
  // ------------------------------------------------------------------

  tileFrame(tile) {
    const n = tile.center.clone().normalize();
    const ref = Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(n, ref).normalize();
    const v = new THREE.Vector3().crossVectors(n, u).normalize();
    return { n, u, v };
  }

  offsetDir(frame, du, dv) {
    const k = 1 / this.radius;
    return frame.n.clone().addScaledVector(frame.u, du * k).addScaledVector(frame.v, dv * k).normalize();
  }

  offsetAlong(frame, tangent, d) {
    return frame.n.clone().addScaledVector(tangent, d / this.radius).normalize();
  }

  scatterDir(tile, rng, maxFrac = 0.62, minFrac = 0) {
    const f = this.tileFrame(tile);
    const a = rng() * Math.PI * 2;
    const d = (minFrac + Math.sqrt(rng()) * (maxFrac - minFrac)) * this.tileRadius;
    return this.offsetDir(f, Math.cos(a) * d, Math.sin(a) * d);
  }

  /** Upright on the sphere with a yaw (and an optional small lean) around the local up axis. */
  onSphere(dir, radius, scale, yaw, target = new THREE.Matrix4(), lean = 0) {
    _q.setFromUnitVectors(UP, dir).multiply(_q2.setFromAxisAngle(UP, yaw));
    if (lean) _q.multiply(_q2.setFromEuler(_e.set(lean, 0, lean * 0.6)));
    if (typeof scale === 'number') _s.setScalar(scale);
    else _s.copy(scale);
    return target.compose(_v3.copy(dir).multiplyScalar(radius), _q, _s);
  }

  /** Upright on the sphere with local +X pointing along `forward` (tangent). */
  along(dir, radius, forward, sx, sy, sz, target = new THREE.Matrix4()) {
    const up = _v.copy(dir).normalize();
    const fwd = _v2.copy(forward).addScaledVector(up, -forward.dot(up)).normalize();
    const side = _v3.crossVectors(fwd, up);
    target.makeBasis(fwd.multiplyScalar(sx), up.clone().multiplyScalar(sy), side.multiplyScalar(sz));
    target.setPosition(up.x * radius, up.y * radius, up.z * radius);
    return target;
  }

  boundaryEdges(tileIds, inside) {
    const edges = [];
    for (const id of tileIds) {
      const tile = this.hexasphere.tileMap.get(id);
      const n = tile.cornerIndices.length;
      for (let i = 0; i < n; i++) {
        const ia = tile.cornerIndices[i];
        const ib = tile.cornerIndices[(i + 1) % n];
        const nb = this.edgeNeighbor(tile, ia, ib);
        if (nb && inside(nb)) continue;
        edges.push({ tile, nb, ia, ib, a: this.hexasphere.globalCorners[ia], b: this.hexasphere.globalCorners[ib] });
      }
    }
    return edges;
  }

  /**
   * Bridges sit where a road actually crosses a river (not at tile centres),
   * aligned with the road. Narrow upstream crossings get a timber footbridge,
   * wide lower reaches a stone arch bridge, modern roads a cable bridge.
   */
  buildBridges(props) {
    this.bridgeSpots = [];
    const tr = this.tileRadius;
    const minGap = (tr * 1.4) / this.radius;
    for (const { curve, style } of this.landCurves) {
      const pts = curve.getSpacedPoints(Math.max(20, Math.round(curve.getLength() / (tr * 0.12))));
      for (let k = 1; k < pts.length - 1; k++) {
        const dir = pts[k].clone().normalize();
        const hits = this.corridor.query(dir, 0).filter((h) => h.data?.kind === 'river');
        if (!hits.length) continue;
        const river = hits.reduce((a, b) => (a.d.distanceTo(dir) < b.d.distanceTo(dir) ? a : b)).data;
        const roadTan = pts[k + 1].clone().sub(pts[k - 1]).normalize();
        if (Math.abs(roadTan.dot(river.tan)) > 0.8) continue; // running alongside, not crossing
        if (this.bridgeSpots.some((b) => b.distanceTo(dir) < minGap)) continue;
        this.bridgeSpots.push(dir);
        const wide = river.width > this.tileSpacing * 0.1;
        const kind = style === 'modern' ? 'bridge_modern' : wide ? 'bridge_stone' : 'bridge_wood';
        const span = Math.max(tr * (wide ? 0.95 : 0.6), river.width * 3);
        const h = tr * (wide ? 0.6 : 0.5);
        props.add(kind, this.along(dir, this.landR - 0.002, roadTan, span, h, h));
      }
    }
  }

  /** Reeds and bank shrubs along the water, the small life a river valley carries. */
  buildRiverbanks(props) {
    const rng = mulberry32((this.mapData.seed || 1) + 41);
    const tr = this.tileRadius;
    for (const { samples } of this.rivers || []) {
      samples.forEach((sm, k) => {
        if (k % 3 !== 0 || rng() < 0.35) return;
        const side = new THREE.Vector3().crossVectors(sm.dir, sm.tan).normalize();
        const sign = rng() < 0.5 ? -1 : 1;
        const off = (sm.width * (1.05 + rng() * 0.4)) / this.radius;
        const dir = sm.dir.clone().addScaledVector(side, off * sign).normalize();
        if (this.bridgeSpots.some((b) => b.distanceTo(dir) < (tr * 0.5) / this.radius)) return;
        const tile = this.nearestTile(dir);
        if (!tile || isWater(tile) || !this.isDry(dir, tile, 0.05) || this.isCity(tile) || tile.biome === BIOMES.DESERT || tile.biome === BIOMES.TUNDRA) return;
        props.add('reeds', this.onSphere(dir, this.landR, tr * (0.4 + rng() * 0.25), rng() * 6.28), { detail: true, tint: [0.9 + rng() * 0.2, 1, 0.9] });
        if (rng() < 0.25) props.add('bush', this.onSphere(sm.dir.clone().addScaledVector(side, -off * sign * 1.4).normalize(), this.landR, tr * 0.4, rng() * 6.28));
      });
    }
  }

  nearestTile(dir) {
    // Tiles are small and dir is always near a known tile; brute force on a subset is fine here
    let best = null;
    let bestDot = -2;
    for (const t of this.hexasphere.tiles) {
      const d = t.center.dot(dir);
      if (d > bestDot) {
        bestDot = d;
        best = t;
      }
    }
    return best;
  }

  scatterNature(mapData, props, foothills) {
    const rng = mulberry32((mapData.seed || 1) + 5);
    const tr = this.tileRadius;
    const clearance = (tr * 0.12) / this.radius;
    const densityF = (this.radius / this.tileSpacing) * 0.5;
    const density = (dir) => this.noise.noise(dir.x * densityF - 4, dir.y * densityF, dir.z * densityF + 9); // -1..1
    const tintFor = (kind) => {
      // Slight hue drift per instance: some trees lean yellow-green, some blue-green
      const w = rng();
      if (kind === 'foliage') return [0.86 + w * 0.2, 0.9 + rng() * 0.18, 0.82 + (1 - w) * 0.2];
      return [0.9 + rng() * 0.2, 0.9 + rng() * 0.2, 0.9 + rng() * 0.2];
    };
    const put = (name, tile, scale, opts = {}) => {
      const dir = opts.dir ?? this.scatterDir(tile, rng, opts.maxFrac ?? 0.66, opts.minFrac ?? 0);
      if (!opts.wet && this.corridor.blocked(dir, clearance)) return false;
      if (!opts.wet && !this.isDry(dir, tile, 0.06)) return false; // rounded shore corners are sea now
      const r = opts.radius ?? this.landR;
      const lean = opts.lean ? (rng() - 0.5) * opts.lean : 0;
      props.add(name, this.onSphere(dir, r, scale * (0.72 + rng() * 0.6), rng() * Math.PI * 2, undefined, lean), {
        tint: tintFor(opts.kind),
        detail: opts.detail
      });
      return true;
    };
    const pick = (a, b, pB) => (rng() < pB ? b : a);
    // green (terran/ocean), dry (desert world), snow (ice world), none (lava, barren)
    const flora = this.look.flora || 'green';
    const floes = this.look.floes || 0;

    for (const tile of this.hexasphere.tiles) {
      if (this.isCity(tile) || this.isFarm(tile)) continue;
      const absLat = Math.abs(tile.center.y);
      const dens = density(tile.center);

      if (flora !== 'green') {
        this.scatterAlien(flora, tile, { put, pick, rng, dens, tr, floes });
        continue;
      }

      switch (tile.biome) {
        case BIOMES.FOREST: {
          // Trees are sampled over the WHOLE hex; only edges facing non-forest land
          // thin them out (with a noisy falloff), so neighbouring forest tiles read
          // as one continuous wood with an organic outline.
          const jungle = absLat < 0.28 && tile.moisture > 0.2;
          const edges = this.tileEdges(tile).filter((e) => e.nb && e.nb.biome !== BIOMES.FOREST);
          const candidates = Math.round(9 + dens * 3);
          for (let i = 0; i < candidates; i++) {
            const dir = this.hexSample(tile, rng);
            let keep = 1;
            for (const e of edges) {
              const reach = (isWater(e.nb) ? 0.45 : 0.55) * (1 + 0.5 * this.noiseAt(dir, 1.6, 3));
              keep = Math.min(keep, THREE.MathUtils.smoothstep(this.edgeDistance(dir, e), reach * 0.25, reach));
            }
            if (rng() > keep) continue;
            // Species follow a smooth noise field, so pine stands and broadleaf groves span tiles
            const mix = this.noiseAt(dir, 0.8, 11);
            const pineShare = THREE.MathUtils.clamp((absLat - 0.25) * 2.2 + mix * 0.6, 0.05, 0.95);
            if (jungle) put(mix > 0 ? 'tree_palm' : 'tree_round', tile, tr * 0.6, { dir, kind: 'foliage', lean: 0.12 });
            else if (rng() < pineShare) put(mix > 0.35 ? 'tree_pine_b' : 'tree_pine', tile, tr * 0.56, { dir, kind: 'foliage', lean: 0.06 });
            else put(mix < -0.4 ? 'tree_round_b' : 'tree_round', tile, tr * 0.56, { dir, kind: 'foliage', lean: 0.08 });
          }
          if (rng() < 0.7) put(pick('bush', 'bush_b', 0.2), tile, tr * 0.5, { detail: true, kind: 'foliage' });
          if (rng() < 0.12) put('rock_b', tile, tr * 0.45);
          break;
        }
        case BIOMES.PLAINS: {
          const savanna = tile.moisture < -0.02 && absLat < 0.45;
          // Forest fringe: a few trees continue past the forest's edge, fading with distance
          for (const e of this.tileEdges(tile)) {
            if (!e.nb || e.nb.biome !== BIOMES.FOREST) continue;
            for (let i = 0; i < 4; i++) {
              const dir = this.hexSample(tile, rng);
              const fade = 1 - THREE.MathUtils.smoothstep(this.edgeDistance(dir, e), 0.05, 0.55 * (1 + 0.5 * this.noiseAt(dir, 1.6, 3)));
              if (rng() < fade * 0.8) put(pick('tree_round', 'tree_pine', absLat > 0.4 ? 0.6 : 0.2), tile, tr * 0.5, { dir, kind: 'foliage' });
            }
          }
          if (savanna && rng() < 0.3 + dens * 0.2) put('tree_acacia', tile, tr * 0.62, { kind: 'foliage', maxFrac: 0.9 });
          else if (!savanna && rng() < 0.16 + dens * 0.12) put(pick('tree_round', 'tree_round_b', 0.4), tile, tr * 0.52, { kind: 'foliage', maxFrac: 0.9 });
          if (rng() < 0.3) put(pick('bush', 'bush_b', savanna ? 0.1 : 0.45), tile, tr * 0.46, { detail: true, kind: 'foliage', maxFrac: 0.9 });
          if (rng() < 0.08) put(pick('rock', 'rock_b', 0.5), tile, tr * 0.42);
          const tufts = Math.round(1 + (dens + 1) * 1.2);
          for (let i = 0; i < tufts; i++) put('grass_tuft', tile, tr * 0.42, { detail: true, kind: 'foliage', maxFrac: 0.95 });
          break;
        }
        case BIOMES.BEACH:
          if (rng() < 0.4 + dens * 0.15) for (let i = 0, n = 1 + Math.floor(rng() * 2); i < n; i++) put('tree_palm', tile, tr * 0.62, { kind: 'foliage', lean: 0.25, maxFrac: 0.85 });
          if (rng() < 0.12) put('rock', tile, tr * 0.4);
          break;
        case BIOMES.DESERT:
          if (rng() < 0.55 + dens * 0.2) for (let i = 0, n = 1 + Math.floor(rng() * 3); i < n; i++) put('dune', tile, tr * (0.24 + rng() * 0.14), { maxFrac: 0.55 });
          if (rng() < 0.3) put('cactus', tile, tr * 0.6, { lean: 0.1 });
          if (rng() < 0.12) put('rock_mesa', tile, tr * 0.55, { maxFrac: 0.35 });
          break;
        case BIOMES.TUNDRA:
          if (rng() < 0.3 + dens * 0.15) for (let i = 0, n = 1 + Math.floor(rng() * 3); i < n; i++) put('tree_pine_snow', tile, tr * 0.52, { kind: 'foliage', lean: 0.05 });
          if (absLat > 0.9 && rng() < 0.35) put('ice_block', tile, tr * 0.6);
          if (rng() < 0.08) put(pick('rock', 'rock_b', 0.5), tile, tr * 0.4);
          break;
        case BIOMES.COAST:
          if (rng() < 0.04) put(pick('rock', 'rock_b', 0.3), tile, tr * 0.55, { radius: this.waterR - 0.01, wet: true });
          break;
        case BIOMES.OCEAN:
        case BIOMES.OCEAN_DEEP:
          if (absLat > 0.84 && rng() < 0.3) put('ice_block', tile, tr * 0.7, { radius: this.waterR - 0.02, wet: true });
          break;
        default:
          break;
      }
    }

    // Sand strips along the sea get palms in the warm belt, driftwood-grey rocks elsewhere
    for (const tile of flora === 'green' ? this.hexasphere.tiles : []) {
      if (isWater(tile) || this.isCity(tile) || this.isFarm(tile)) continue;
      if (tile.biome === BIOMES.BEACH || tile.biome === BIOMES.MOUNTAIN || tile.biome === BIOMES.TUNDRA) continue;
      const shore = this.tileEdges(tile).filter((e) => e.nb && isWater(e.nb));
      if (!shore.length) continue;
      const warm = Math.abs(tile.center.y) < 0.5 && tile.biome !== BIOMES.DESERT;
      for (let i = 0; i < 3; i++) {
        const dir = this.hexSample(tile, rng);
        const inland = this.landField.signed(dir, tile);
        if (inland < 0.05 || inland > 0.3) continue; // on the sand strip only
        if (warm && rng() < 0.45) put('tree_palm', tile, tr * 0.55, { dir, kind: 'foliage', lean: 0.3 });
        else if (rng() < 0.25) put(pick('rock', 'rock_b', 0.4), tile, tr * 0.36, { dir });
      }
    }

    // Pines climbing the lower flanks of mountain ranges
    for (const spot of flora === 'green' || flora === 'snow' ? foothills : []) {
      if (rng() > 0.3) continue;
      const dir = spot.p.clone().normalize();
      const snowy = flora === 'snow' || Math.abs(dir.y) > 0.6 || spot.hn > 0.35;
      props.add(
        snowy ? 'tree_pine_snow' : pick('tree_pine', 'tree_pine_b', 0.4),
        this.onSphere(dir, spot.p.length() - 0.004, tr * (0.42 + rng() * 0.24), rng() * Math.PI * 2),
        { tint: tintFor('foliage') }
      );
    }
  }

  /** Props for non-terran worlds: the same asset kit, picked for the climate. */
  scatterAlien(flora, tile, { put, pick, rng, dens, tr, floes }) {
    const wet = isWater(tile);
    if (wet) {
      if (floes && rng() < floes * (tile.biome === BIOMES.COAST ? 1.6 : 1)) put('ice_block', tile, tr * (0.5 + rng() * 0.3), { radius: this.waterR - 0.02, wet: true });
      return;
    }
    if (flora === 'snow') {
      if (tile.biome === BIOMES.FOREST) {
        for (let i = 0, n = Math.round(6 + dens * 3); i < n; i++) put(pick('tree_pine_snow', 'tree_pine_b', 0.15), tile, tr * 0.54, { kind: 'foliage', lean: 0.05, maxFrac: 0.9 });
      } else if (tile.biome === BIOMES.TUNDRA || tile.biome === BIOMES.PLAINS) {
        if (rng() < 0.18 + dens * 0.1) put('tree_pine_snow', tile, tr * 0.5, { kind: 'foliage' });
        if (rng() < 0.12) put('ice_block', tile, tr * 0.45);
      }
      if (rng() < 0.08) put(pick('rock', 'rock_b', 0.5), tile, tr * 0.4);
      return;
    }
    if (flora === 'dry') {
      switch (tile.biome) {
        case BIOMES.FOREST: // oasis scrub
          for (let i = 0, n = Math.round(3 + dens * 2); i < n; i++) put(pick('tree_palm', 'tree_acacia', 0.5), tile, tr * 0.58, { kind: 'foliage', lean: 0.15, maxFrac: 0.85 });
          if (rng() < 0.6) put('bush_b', tile, tr * 0.45, { detail: true, kind: 'foliage' });
          break;
        case BIOMES.PLAINS:
          if (rng() < 0.2 + dens * 0.1) put('tree_acacia', tile, tr * 0.55, { kind: 'foliage', maxFrac: 0.9 });
          if (rng() < 0.2) put('cactus', tile, tr * 0.5, { lean: 0.1 });
          if (rng() < 0.3) put('bush_b', tile, tr * 0.4, { detail: true, kind: 'foliage', maxFrac: 0.9 });
          break;
        case BIOMES.DESERT:
          if (rng() < 0.6 + dens * 0.2) for (let i = 0, n = 1 + Math.floor(rng() * 3); i < n; i++) put('dune', tile, tr * (0.26 + rng() * 0.16), { maxFrac: 0.55 });
          if (rng() < 0.18) put('cactus', tile, tr * 0.6, { lean: 0.1 });
          if (rng() < 0.16) put('rock_mesa', tile, tr * 0.6, { maxFrac: 0.35 });
          break;
        case BIOMES.BEACH:
          if (rng() < 0.3) put('tree_palm', tile, tr * 0.6, { kind: 'foliage', lean: 0.25, maxFrac: 0.85 });
          break;
        default:
          if (rng() < 0.1) put('rock', tile, tr * 0.4);
      }
      return;
    }
    // Lifeless rock (lava, barren): boulders, mesas and ash dunes only
    if (tile.biome === BIOMES.DESERT && rng() < 0.4) put('dune', tile, tr * (0.24 + rng() * 0.14), { maxFrac: 0.55 });
    if (rng() < 0.16 + dens * 0.08) put(pick('rock', 'rock_b', 0.5), tile, tr * (0.4 + rng() * 0.2));
    if (rng() < 0.06) put('rock_mesa', tile, tr * 0.5, { maxFrac: 0.4 });
  }

  buildSettlements(mapData, props) {
    const tileMap = this.hexasphere.tileMap;
    const tr = this.tileRadius;
    const rng = mulberry32((mapData.seed || 1) + 17);
    const LOTS = [
      [0, 0], [0.42, 0], [-0.42, 0], [0.21, 0.37], [-0.21, 0.37], [0.21, -0.37], [-0.21, -0.37],
      [0.5, 0.36], [-0.5, -0.36]
    ];

    for (const city of mapData.cities || []) {
      const modern = city.style === 'modern';
      const footprint = city.tiles || [city.tileId];
      const inCity = (t) => t.cityIndex === city.index;
      const centerDir = tileMap.get(city.tileId).center.clone().normalize();
      const big = city.type === 'capital' || footprint.length >= 5;
      let landmarkSpot = null;

      // Landmark on the centre tile (steps aside if a river or road runs through the middle)
      {
        const f = this.tileFrame(tileMap.get(city.tileId));
        let landmark;
        if (modern) landmark = city.type === 'capital' ? 'landmark_spire' : footprint.length >= 3 ? 'tower_glass_b' : 'apartment';
        else landmark = city.type === 'capital' ? 'castle' : footprint.length >= 3 ? 'temple' : 'tower';
        const scale = city.type === 'capital' ? tr * 0.95 : tr * 0.8;
        const reach = (tr * 0.4) / this.radius;
        const clear = (d) => this.corridor.clearance(d, reach) >= reach;
        let spot = centerDir;
        if (!clear(spot)) {
          spot = [centerDir, ...LOTS.slice(1).map(([a, b]) => this.offsetDir(f, a * tr * 0.9, b * tr * 0.9))].reduce((best, d) =>
            this.corridor.clearance(d, reach) > this.corridor.clearance(best, reach) ? d : best
          );
        }
        landmarkSpot = spot;
        props.add(landmark, this.onSphere(spot, this.landR, scale, hash01(city.tileId) * Math.PI * 2));
        const towerAt = this.offsetDir(f, tr * 0.5, tr * 0.25);
        if (landmark === 'temple' && clear(towerAt)) props.add('tower', this.onSphere(towerAt, this.landR, tr * 0.55, 0));
      }

      // One street grid for the whole city, laid across all of its tiles, so the
      // blocks run continuously over hex edges while each lot still varies.
      const cf = this.tileFrame(tileMap.get(city.tileId));
      const axis = hash01(city.index * 13 + 5) * Math.PI;
      const gu = cf.u.clone().multiplyScalar(Math.cos(axis)).addScaledVector(cf.v, Math.sin(axis));
      const gv = new THREE.Vector3().crossVectors(cf.n, gu);
      const lot = tr * (modern ? 0.46 : 0.4);
      const span = Math.ceil((this.tileSpacing * 1.7) / lot);
      const centerTile = tileMap.get(city.tileId);
      const street = (a) => a % 3 === 0; // every third row stays open as a street
      for (let a = -span; a <= span; a++) {
        for (let b = -span; b <= span; b++) {
          if (street(a) && street(b)) continue; // crossroads
          const jitter = modern ? 0.04 : 0.12;
          const d = centerDir
            .clone()
            .addScaledVector(gu, ((a + (rng() - 0.5) * jitter) * lot) / this.radius)
            .addScaledVector(gv, ((b + (rng() - 0.5) * jitter) * lot) / this.radius)
            .normalize();
          const t = this.locate(d, centerTile);
          if (!inCity(t) || !this.isDry(d, t, 0.15)) continue;
          // Leave a margin inside the city edge for walls / fences
          if (this.tileEdges(t).some((e) => (!e.nb || !inCity(e.nb)) && this.edgeDistance(d, e) < 0.22)) continue;
          if (this.corridor.blocked(d, (tr * 0.18) / this.radius)) continue;
          if (landmarkSpot && d.distanceTo(landmarkSpot) < (tr * 0.5) / this.radius) continue;
          const ring = d.distanceTo(centerDir) / (this.tileSpacing / this.radius);
          const yaw = axis + (street(a) ? Math.PI / 2 : 0) + (rng() < 0.2 ? Math.PI : 0);
          if (street(a) || street(b)) {
            // Street lots get the odd tree instead of a building
            if (rng() < 0.18) props.add(modern ? 'tree_round_b' : 'tree_round', this.onSphere(d, this.landR, tr * 0.4, rng() * 6));
            continue;
          }
          if (rng() < (modern ? 0.1 : 0.16)) {
            // Gardens and small squares break up the blocks
            if (rng() < 0.6) props.add(modern ? 'tree_round_b' : 'tree_round', this.onSphere(d, this.landR, tr * 0.45, rng() * 6));
            continue;
          }
          let name;
          let scale = tr * 0.7;
          if (modern) {
            // Skyline: towers near the core, apartments around them, villas at the edge
            if (ring < 0.7 && big) name = rng() < 0.5 ? 'tower_glass_a' : 'tower_glass_b';
            else if (ring < 1.3) name = rng() < 0.65 ? 'apartment' : 'tower_glass_a';
            else name = rng() < 0.7 ? 'modern_house' : 'apartment';
            scale = tr * (name.startsWith('tower') ? 0.55 + (1 - Math.min(1, ring)) * 0.25 : 0.6);
          } else {
            name = ring < 0.6 && rng() < 0.5 ? 'house_c' : ['house_a', 'house_b', 'house_c'][Math.floor(rng() * 3)];
          }
          props.add(name, this.onSphere(d, this.landR, scale, yaw), { tint: 0.92 + rng() * 0.16 });
        }
      }

      // Fantasy edge: stone walls + towers for big cities, palisade for towns
      const edges = this.boundaryEdges(footprint, inCity);
      if (!modern) {
        const cornersDone = new Set();
        for (const e of edges) {
          if (e.nb && isWater(e.nb) && !big) continue;
          for (const [P1, P2] of [[e.a, this.edgeMid(e.ia, e.ib)], [this.edgeMid(e.ia, e.ib), e.b]]) {
            const mid = P1.clone().add(P2).normalize();
            const fwd = new THREE.Vector3().subVectors(P2, P1);
            const len = fwd.length() * this.landR;
            if (big) props.add('wall_segment', this.along(mid, this.landR, fwd, len * 1.04, tr * 0.42, tr * 0.42));
            else if (footprint.length >= 2) props.add('fence_segment', this.along(mid, this.landR, fwd, len * 0.95, tr * 0.6, tr * 0.6));
          }
          if (big) {
            for (const [ci, c] of [[e.ia, e.a], [e.ib, e.b]]) {
              if (cornersDone.has(ci)) continue;
              cornersDone.add(ci);
              props.add('wall_tower', this.onSphere(c.clone(), this.landR, tr * 0.42, 0));
            }
          }
        }
      }

      // Harbour on one shoreline edge
      if (city.isPort) {
        // Keep the harbour clear of river mouths
        const shore = edges.filter((e) => e.nb && isWater(e.nb) && !this.corridor.blocked(this.edgeMid(e.ia, e.ib), (tr * 0.3) / this.radius));
        if (shore.length) {
          const e = shore[Math.floor(rng() * shore.length)];
          const mid = this.edgeMid(e.ia, e.ib).clone();
          const out = new THREE.Vector3().subVectors(e.nb.center, e.tile.center);
          const outT = out.clone().addScaledVector(mid, -out.dot(mid)).normalize();
          const side = new THREE.Vector3().crossVectors(outT, mid);
          props.add('dock', this.along(mid, this.landR - 0.004, out, tr * 0.8, tr * 0.8, tr * 0.8));
          if (modern) {
            const inland = mid.clone().multiplyScalar(this.radius).addScaledVector(outT, -tr * 0.28);
            props.add('port_crane', this.along(inland.clone().addScaledVector(side, tr * 0.18).normalize(), this.landR, side, tr * 0.7, tr * 0.7, tr * 0.7));
            props.add('container_stack', this.along(inland.clone().addScaledVector(side, -tr * 0.22).normalize(), this.landR, side, tr * 0.6, tr * 0.6, tr * 0.6));
          } else {
            const boatDir = mid.clone().multiplyScalar(this.radius).addScaledVector(outT, tr * 0.42).addScaledVector(side, tr * 0.2).normalize();
            props.add('boat', this.along(boatDir, this.waterR, side, tr * 0.7, tr * 0.7, tr * 0.7));
            const e2 = shore.find((x) => x !== e);
            if (big && e2) props.add('lighthouse', this.onSphere(e2.a.clone().lerp(e2.tile.center, 0.15).normalize(), this.landR, tr * 0.55, 0));
          }
        }
      }
    }
  }

  buildFarms(mapData, props) {
    const tileMap = this.hexasphere.tileMap;
    const tr = this.tileRadius;
    const R = this.radius;
    const rng = mulberry32((mapData.seed || 1) + 29);

    for (const farm of mapData.farms || []) {
      const plots = this.farmPlots.get(farm.index) || [];
      const inFarm = (t) => t.farmIndex === farm.index;
      const home = tileMap.get(farm.tiles[0]);
      const reserved = [];

      // Farmstead on the first tile, a windmill on big estates
      const yard = this.hexSample(home, rng, 0.35);
      const yardPlot = this.plotAt(home, yard);
      props.add('barn', this.along(yard, this.landR, yardPlot.rowDir, tr * 0.7, tr * 0.7, tr * 0.7));
      reserved.push(yard);
      if (farm.tiles.length >= 4) {
        const millTile = tileMap.get(farm.tiles[Math.floor(farm.tiles.length / 2)]);
        const mill = this.hexSample(millTile, rng, 0.5);
        if (!this.corridor.blocked(mill, (tr * 0.25) / R)) {
          props.add('windmill', this.onSphere(mill, this.landR, tr * 0.7, rng() * Math.PI * 2));
          reserved.push(mill);
        }
      }
      const isReserved = (d) => reserved.some((q) => q.distanceTo(d) < (tr * 0.38) / R);

      for (const plot of plots) {
        if (plot.crop === 'plowed') continue; // bare furrows: the soil colour carries it
        const f = this.frameAt(plot.dir);
        const across = new THREE.Vector3().crossVectors(f.n, plot.rowDir);
        if (plot.crop === 'pasture') {
          // Pasture: a few hay bales and bushes, no rows
          for (let i = 0; i < 3; i++) {
            const d = plot.dir.clone().addScaledVector(plot.rowDir, ((rng() - 0.5) * tr) / R).addScaledVector(across, ((rng() - 0.5) * tr) / R).normalize();
            const t = this.locate(d, home);
            if (!inFarm(t) || this.plotAt(t, d) !== plot || isReserved(d)) continue;
            props.add(rng() < 0.6 ? 'hay_bale' : 'bush', this.onSphere(d, this.landR, tr * 0.55, rng() * Math.PI), { detail: true });
          }
          continue;
        }
        // Rows on a lattice in the plot's own furrow direction, clipped to the plot's cell
        const row = plot.crop === 'wheat' ? 'wheat_row' : 'crop_row';
        const step = tr * 0.2;
        const seg = tr * 0.46;
        for (let a = -7; a <= 7; a++) {
          for (let b = -3; b <= 3; b++) {
            const d = plot.dir
              .clone()
              .addScaledVector(across, (a * step) / R)
              .addScaledVector(plot.rowDir, (b * seg) / R)
              .normalize();
            const t = this.locate(d, tileMap.get(plot.tile));
            if (!inFarm(t) || this.plotAt(t, d) !== plot || !this.isDry(d, t, 0.12)) continue;
            // Keep a hand-width headland at the estate border
            if (this.tileEdges(t).some((e) => e.nb && !inFarm(e.nb) && this.edgeDistance(d, e) < 0.18)) continue;
            if (isReserved(d) || this.corridor.blocked(d, (tr * 0.08) / R)) continue;
            props.add(row, this.along(d, this.landR, plot.rowDir, seg * 0.96, tr * 1.1, tr * 1.1), {
              detail: true,
              tint: [0.95 + rng() * 0.1, 0.95 + rng() * 0.1, 0.95]
            });
          }
        }
      }

      for (const e of this.boundaryEdges(farm.tiles, inFarm)) {
        if (e.nb && this.isCity(e.nb)) continue;
        const mid = e.a.clone().add(e.b).normalize();
        if (this.corridor.blocked(mid, 0)) continue; // leave a gap where a road or river passes
        const fwd = new THREE.Vector3().subVectors(e.b, e.a);
        props.add('fence_segment', this.along(mid, this.landR, fwd, fwd.length() * this.landR * 0.95, tr * 0.6, tr * 0.6));
      }
    }
  }

  makeDuneGeometry() {
    const g = new THREE.SphereGeometry(1, 9, 4, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed();
    g.scale(1, 0.4, 0.38);
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    const color = new THREE.Color(this.look?.dune ?? 0xd9a94c);
    const cols = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < g.attributes.position.count; i++) color.toArray(cols, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    g.computeVertexNormals();
    return g;
  }

  /**
   * Collected transforms become InstancedMeshes split into 32 spatial chunks
   * (icosahedron vertices + face centres). Per chunk and asset there is one
   * InstancedMesh per LOD; every frame each chunk shows exactly one LOD based
   * on its distance from the camera, chunks behind the horizon are skipped,
   * and small "detail" props only render up close.
   */
  flushProps(props) {
    const ico = new THREE.IcosahedronGeometry(1, 0);
    const p = ico.attributes.position;
    const verts = [];
    const dirs = [];
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i).normalize();
      if (!verts.some((u) => u.distanceTo(v) < 1e-4)) verts.push(v);
    }
    for (let f = 0; f < p.count; f += 3) {
      dirs.push(new THREE.Vector3().fromBufferAttribute(p, f).add(new THREE.Vector3().fromBufferAttribute(p, f + 1)).add(new THREE.Vector3().fromBufferAttribute(p, f + 2)).normalize());
    }
    dirs.push(...verts);
    ico.dispose();

    this.chunks = dirs.map((normal) => {
      const group = new THREE.Group();
      const levels = [0, 1, 2].map(() => {
        const main = new THREE.Group();
        const detail = new THREE.Group();
        main.add(detail);
        group.add(main);
        return { main, detail };
      });
      this.mapGroup.add(group);
      return { normal, spread: 0, group, levels, buckets: new Map(), level: -1 };
    });

    this.duneGeo = this.makeDuneGeometry();
    const pos = new THREE.Vector3();
    for (const [name, items] of props.items) {
      if (!this.lodsOf(name)[1]) continue;
      for (const it of items) {
        pos.setFromMatrixPosition(it.m).normalize();
        let best = 0;
        let bestDot = -2;
        for (let c = 0; c < dirs.length; c++) {
          const d = dirs[c].dot(pos);
          if (d > bestDot) {
            bestDot = d;
            best = c;
          }
        }
        const chunk = this.chunks[best];
        chunk.spread = Math.max(chunk.spread, Math.acos(Math.min(1, bestDot)));
        const key = `${name}|${it.detail ? 1 : 0}`;
        if (!chunk.buckets.has(key)) chunk.buckets.set(key, []);
        chunk.buckets.get(key).push(it);
      }
    }

    for (const chunk of this.chunks) {
      for (const [key, items] of chunk.buckets) {
        const [name, detail] = key.split('|');
        const lods = this.lodsOf(name);
        for (const lvl of [0, 1, 2]) {
          // Missing LOD2 reuses LOD1; LOD0 is added when the mid-poly pack arrives
          const geo = lvl === 2 ? lods[2] || lods[1] : lods[lvl];
          if (geo) this.addInstanced(chunk, lvl, detail === '1', geo, items);
        }
      }
    }
  }

  lodsOf(name) {
    return name === 'dune' ? [undefined, this.duneGeo, undefined] : this.assetLods[name] || [];
  }

  addInstanced(chunk, lvl, detail, geo, items) {
    const inst = new THREE.InstancedMesh(geo, this.propMaterial, items.length);
    items.forEach((it, i) => {
      inst.setMatrixAt(i, it.m);
      if (Array.isArray(it.tint)) _c.setRGB(it.tint[0], it.tint[1], it.tint[2]);
      else _c.setScalar(it.tint);
      inst.setColorAt(i, _c);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    (detail ? chunk.levels[lvl].detail : chunk.levels[lvl].main).add(inst);
  }

  /** Mid-poly pack arrived: add LOD0 meshes to every chunk and upgrade the vehicles. */
  addLod0Meshes() {
    for (const chunk of this.chunks || []) {
      for (const [key, items] of chunk.buckets) {
        const [name, detail] = key.split('|');
        const geo = this.lodsOf(name)[0];
        if (geo) this.addInstanced(chunk, 0, detail === '1', geo, items);
      }
      chunk.level = -1; // re-evaluate visibility next frame
    }
    for (const m of this.movers || []) {
      const geo = this.assetLods[m.asset]?.[0];
      if (geo) m.mesh.geometry = geo;
    }
  }

  /** `home`: the hometown of the First Journey gets a gold house badge and outline on its banner. */
  makeLabelSprite(city, home = false) {
    const style = LABEL_STYLE[city.owner] || LABEL_STYLE.neutral;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const font = '500 34px "Barlow Condensed", "Archivo Narrow", sans-serif';
    ctx.font = font;
    const badge = home ? 40 : 0;
    const w = Math.ceil(ctx.measureText(city.name).width) + 28 + badge;
    canvas.width = w;
    canvas.height = 48;
    ctx.fillStyle = style.bg;
    ctx.fillRect(0, 0, w, 48);
    ctx.font = font;
    ctx.fillStyle = style.fg;
    ctx.textBaseline = 'middle';
    ctx.fillText(city.name, 14 + badge, 25);
    if (home) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = 4;
      ctx.strokeStyle = JOURNEY_PALETTE.outline;
      ctx.fillStyle = JOURNEY_PALETTE.target;
      ctx.beginPath();
      ctx.moveTo(8, 25); ctx.lineTo(20, 10); ctx.lineTo(32, 25); ctx.lineTo(32, 39); ctx.lineTo(8, 39);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.strokeStyle = JOURNEY_PALETTE.target;
      ctx.strokeRect(2, 2, w - 4, 44);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        sizeAttenuation: false,
        depthWrite: false,
        depthTest: false, // back-side banners are faded out by facing angle instead
        transparent: true,
        toneMapped: false
      })
    );
    const h = city.type === 'capital' ? 0.032 : (city.size || 1) >= 3 ? 0.027 : 0.023;
    sprite.scale.set((h * canvas.width) / canvas.height, h, 1);
    sprite.center.set(0.5, -0.9); // float the banner above the landmark on screen
    sprite.renderOrder = 20;
    return sprite;
  }

  /** Mark one city's banner as the First Journey's hometown (or clear it with null). */
  setJourneyCity(index) {
    this.journeyCity = index;
    for (const entry of this.labels) {
      const wanted = entry.city.index === index;
      if (!!entry.home === wanted) continue;
      const fresh = this.makeLabelSprite(entry.city, wanted);
      fresh.position.copy(entry.sprite.position);
      fresh.visible = entry.sprite.visible;
      this.mapGroup.remove(entry.sprite);
      entry.sprite.material.map?.dispose();
      entry.sprite.material.dispose();
      this.mapGroup.add(fresh);
      entry.sprite = fresh;
      entry.home = wanted;
    }
  }

  buildLabels(mapData) {
    const tileMap = this.hexasphere.tileMap;
    for (const city of mapData.cities || []) {
      const tile = tileMap.get(city.tileId);
      if (!tile) continue;
      const dir = tile.center.clone().normalize();
      const home = city.index === this.journeyCity;
      const label = this.makeLabelSprite(city, home);
      label.position.copy(dir).multiplyScalar(this.landR + this.tileRadius * (city.type === 'capital' ? 2.4 : 1.7));
      this.mapGroup.add(label);
      this.labels.push({ sprite: label, normal: dir, city, home });
    }
  }

  buildMovers(mapData) {
    this.movers = [];
    const tr = this.tileRadius;
    const rng = mulberry32((mapData.seed || 1) + 99);
    const cityName = (i) => this.cityByIndex.get(i)?.name ?? 'Tanpa nama';
    const spawn = (mode, list, group, perRoute) => {
      for (const { curve, route, style } of list) {
        const spec = VEHICLES[mode][style] || VEHICLES[mode].fantasy;
        const geo = this.assetLods[spec.asset]?.[0] || this.assets[spec.asset];
        if (!geo) continue;
        const length = curve.getLength();
        for (let i = 0; i < perRoute; i++) {
          const mesh = new THREE.Mesh(geo, this.propMaterial);
          mesh.scale.setScalar(tr * spec.scale);
          group.add(mesh);
          this.movers.push({
            mesh,
            curve,
            length,
            speed: spec.speed * (0.85 + rng() * 0.3),
            offset: rng() * 2,
            mode,
            style,
            name: spec.name,
            asset: spec.asset,
            from: cityName(route.from),
            to: cityName(route.to),
            cities: [route.from, route.to],
            upright: spec.asset === 'balloon'
          });
        }
      }
    };
    spawn('land', this.landCurves, this.groundRouteGroup, 1);
    spawn('sea', this.seaCurves, this.seaRouteGroup, 2);
    spawn('air', this.airCurves, this.airRouteGroup, 1);
  }

  // ------------------------------------------------------------------
  // POV MODE
  // ------------------------------------------------------------------

  moversOf(mode) {
    return this.movers.filter((m) => m.mode === mode);
  }

  povInfo() {
    const counts = { air: this.moversOf('air').length, land: this.moversOf('land').length, sea: this.moversOf('sea').length };
    if (!this.pov) return { active: false, counts };
    const list = this.moversOf(this.pov.mover.mode);
    const m = this.pov.mover;
    return {
      active: true,
      counts,
      mode: m.mode,
      style: m.style,
      index: list.indexOf(m),
      total: list.length,
      name: m.name,
      route: `${m.from} ke ${m.to}`
    };
  }

  /** Ride along with a vehicle: a chase camera that keeps the local horizon level. */
  enterPov(mover) {
    if (!mover) return;
    if (this.camTween) this.camTween = null;
    if (this.focus) {
      const flying = this.focus.flying;
      this.focus = null;
      this.setHighlight(null, []);
      if (flying) {
        this.setControlsUp(UP);
        this.controls.target.set(0, 0, 0);
        this.controls.minDistance = this.radius * 1.12;
        this.controls.maxPolarAngle = Math.PI;
      }
      if (this.onFocusChange) this.onFocusChange(null);
    }
    const wasActive = !!this.pov;
    // Every change of vehicle flies over the surface (never through the planet)
    const lookFrom = this.pov?.look?.clone() ?? this.controls.target.clone();
    this.pov = { mover, pos: null, look: null, heading: null, blend: { pos: this.camera.position.clone(), look: lookFrom, up: this.camera.up.clone(), t0: performance.now() } };
    // A new vehicle starts from behind it (the zoom is kept)
    this.povRig.yaw = 0;
    this.povRig.pitch = 0;
    if (!wasActive) {
      this.povReturn = this.camera.position.clone();
      this.controls.enabled = false;
      this.camera.far = 120;
      this.camera.updateProjectionMatrix();
      // At ground level the thin atmosphere shell would show its edge: use a plain sky instead
      this.scene.background = new THREE.Color(this.look?.sky ?? 0x9dc0e3);
      this.atmosphere.visible = false;
      this.stars.visible = false;
      this.nebula.visible = false;
      if (this.hoverIndicatorMesh) this.hoverIndicatorMesh.visible = false;
      this.hoveredTile = null;
      if (this.onTileHover) this.onTileHover(null);
    }
    if (this.onPovChange) this.onPovChange(this.povInfo());
  }

  exitPov(notify = true, animate = true) {
    if (!this.pov) return;
    this.pov = null;
    this.camera.far = 400;
    this.camera.updateProjectionMatrix();
    this.scene.background = null;
    this.atmosphere.visible = this.hasAir !== false;
    this.stars.visible = true;
    this.nebula.visible = true;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    const halfV = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const halfH = Math.atan(Math.tan(halfV) * (width / height));
    const d = this.radius / Math.sin(0.91 * Math.min(halfV, halfH));
    // Rise back to orbit above the spot we were riding over
    const pose = { pos: this.camera.position.clone().normalize().multiplyScalar(d), target: new THREE.Vector3(), up: UP.clone() };
    if (animate) this.flyTo(pose, true, () => this.releaseFocusControls());
    else {
      this.camera.up.set(0, 1, 0);
      this.controls.enabled = true;
      this.frameGlobe(width, height);
    }
    if (notify && this.onPovChange) this.onPovChange(this.povInfo());
  }

  cyclePov(step) {
    if (!this.pov) return;
    const list = this.moversOf(this.pov.mover.mode);
    if (!list.length) return;
    const i = list.indexOf(this.pov.mover);
    this.enterPov(list[(i + step + list.length) % list.length]);
  }

  setPovMode(mode) {
    const list = this.moversOf(mode);
    if (!list.length) return false;
    // Start with the vehicle closest to where the camera is looking from
    const cam = this.camera.position.clone().normalize();
    const best = list.reduce((a, b) =>
      a.mesh.getWorldPosition(_v).normalize().dot(cam) >= b.mesh.getWorldPosition(_v2).normalize().dot(cam) ? a : b
    );
    this.enterPov(best);
    return true;
  }

  updatePovCamera(dt) {
    const m = this.pov.mover;
    const tr = this.tileRadius;
    // Balloons are tall: look over the envelope instead of into it
    const [back, above, ahead] = m.upright ? [3.2, 1.9, 4.5] : POV_RIG[m.mode];
    m.mesh.updateWorldMatrix(true, false);
    const p = m.mesh.getWorldPosition(_v);
    const up = _v2.copy(p).normalize();
    const fwd = _v3.setFromMatrixColumn(m.mesh.matrixWorld, 0).normalize();
    fwd.addScaledVector(up, -fwd.dot(up)).normalize();

    // Heading eases toward the direction of travel: a vehicle turning round at the end of
    // its route swings the camera around it instead of pulling it through the vehicle
    const pov = this.pov;
    if (!pov.heading || pov.blend) pov.heading = fwd.clone();
    else {
      const h = pov.heading.addScaledVector(up, -pov.heading.dot(up)).normalize();
      const ang = Math.atan2(_v4.crossVectors(h, fwd).dot(up), h.dot(fwd));
      h.applyAxisAngle(up, ang * (1 - Math.exp(-dt * 3)));
    }
    const heading = pov.heading;
    const side = _v4.crossVectors(heading, up).normalize();
    // Drag offsets: yaw around the vehicle, pitch up or down; both settle back when left alone
    const rig = this.povRig;
    if (performance.now() - rig.lastInput > 3000) {
      rig.yaw *= Math.exp(-dt * 1.2);
      rig.pitch *= Math.exp(-dt * 1.2);
    }
    const dist = Math.hypot(back, above) * rig.zoom;
    const elev = THREE.MathUtils.clamp(Math.atan2(above, back) + rig.pitch, 0.04, 1.35);
    const around = heading.clone().multiplyScalar(-Math.cos(rig.yaw)).addScaledVector(side, Math.sin(rig.yaw));
    const desired = p.clone().addScaledVector(around, Math.cos(elev) * dist * tr).addScaledVector(up, Math.sin(elev) * dist * tr);
    // Never dip below the ground (or sea) under the camera
    const floor = this.landR + tr * 0.25;
    if (desired.length() < floor) desired.setLength(floor);
    // Look ahead of the vehicle when behind it, at the vehicle when looking from the side
    const lead = Math.max(0, Math.cos(rig.yaw)) * ahead;
    const look = p.clone().addScaledVector(heading, lead * tr).addScaledVector(up, tr * 0.15);

    const blend = this.pov.blend;
    if (blend) {
      // Arc over the surface from where we were to the new chase position
      const travel = blend.pos.clone().normalize().angleTo(desired.clone().normalize());
      const dur = 900 + Math.min(1.6, travel) * 1100;
      const raw = Math.min(1, (performance.now() - blend.t0) / dur);
      const e = raw < 0.5 ? 4 * raw * raw * raw : 1 - Math.pow(-2 * raw + 2, 3) / 2;
      const a = blend.pos.clone().normalize();
      const b = desired.clone().normalize();
      const axis = new THREE.Vector3().crossVectors(a, b);
      const dir = axis.lengthSq() > 1e-10 ? a.applyAxisAngle(axis.normalize(), a.angleTo(b) * e) : a;
      const len = THREE.MathUtils.lerp(blend.pos.length(), desired.length(), e) + Math.sin(Math.PI * e) * this.radius * Math.min(0.5, travel * 0.45);
      this.pov.pos = dir.multiplyScalar(len);
      this.pov.look = blend.look.clone().lerp(look, e);
      this.camera.up.copy(blend.up).lerp(up, e).normalize();
      if (raw >= 1) this.pov.blend = null;
    } else {
      this.pov.pos.lerp(desired, 1 - Math.exp(-dt * 4.5));
      this.pov.look.lerp(look, 1 - Math.exp(-dt * 7));
      this.camera.up.copy(up);
    }
    this.camera.position.copy(this.pov.pos);
    this.camera.lookAt(this.pov.look);
  }

  /** Vehicle under the cursor, by screen distance (they are too small for mesh picking). */
  pickMover(clientX, clientY, maxPx = 22) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const camDir = _v4.copy(this.camera.position).normalize();
    let best = null;
    let bestD = maxPx;
    for (const m of this.movers) {
      if (!m.mesh.parent?.visible) continue;
      const wp = m.mesh.getWorldPosition(_v);
      if (_v2.copy(wp).normalize().dot(camDir) < 0.15) continue; // behind the planet
      wp.project(this.camera);
      const x = rect.left + ((wp.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - wp.y) / 2) * rect.height;
      const d = Math.hypot(x - clientX, y - clientY);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------
  // VISIBILITY / CLEANUP
  // ------------------------------------------------------------------

  applyRouteVisibility() {
    if (this.airRouteGroup) this.airRouteGroup.visible = this.showAirRoute;
    if (this.groundRouteGroup) this.groundRouteGroup.visible = this.showGroundRoute;
    if (this.seaRouteGroup) this.seaRouteGroup.visible = this.showSeaRoute;
  }

  setAirRouteVisible(visible) {
    this.showAirRoute = visible;
    this.applyRouteVisibility();
  }

  setGroundRouteVisible(visible) {
    this.showGroundRoute = visible;
    this.applyRouteVisibility();
  }

  setSeaRouteVisible(visible) {
    this.showSeaRoute = visible;
    this.applyRouteVisibility();
  }

  clearPlanet() {
    if (this.mapGroup) {
      disposeTree(this.mapGroup, new Set([...this.sharedGeometries, ...this.sharedMaterials]));
      this.planetGroup.remove(this.mapGroup);
      this.mapGroup = null;
    }
    this.movers = [];
    this.labels = [];
    this.chunks = [];
    this.animatedMaterials = [];
    this.landCurves = [];
    this.seaCurves = [];
    this.airCurves = [];
    this.rivers = [];
    this.bridgeSpots = [];
    this.hoveredTile = null;
    this.highlight = null;
    if (this.hoverIndicatorMesh) this.hoverIndicatorMesh.visible = false;
  }

  // ------------------------------------------------------------------
  // INTERACTION
  // ------------------------------------------------------------------

  onPointerUp(e) {
    const press = this.pressAt;
    this.pressAt = null;
    if (this.driving) return;
    if (!press || Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) return;
    if (this.options.onSelect) {
      this.pendingPointer = e;
      this.processPointer();
      this.options.onSelect({ tile: this.hoveredTile, city: this.pickLabel(e.clientX, e.clientY), event: e });
      return;
    }
    // Clicking a vehicle rides along with it; otherwise the click inspects a tile
    const mover = this.pickMover(e.clientX, e.clientY);
    if (mover) {
      this.enterPov(mover);
      return;
    }
    if (this.pov) return;
    const labelCity = this.pickLabel(e.clientX, e.clientY);
    if (labelCity) {
      this.focusOn({ type: 'city', index: labelCity.index });
      return;
    }
    const tile = this.hoveredTile;
    if (!tile) return;
    if (this.isCity(tile)) {
      this.focusOn({ type: 'city', index: tile.cityIndex });
      return;
    }
    this.selectedTile = tile;
    this.focusOn({ type: 'tile', tileId: tile.id });
    if (this.onTileSelect) this.onTileSelect(tile);
  }

  /** City banner under the cursor (banners float above their anchor on screen). */
  pickLabel(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pxPerUnit = rect.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    for (const { sprite, city } of this.labels) {
      if (!sprite.visible || sprite.material.opacity < 0.5) continue;
      const a = sprite.getWorldPosition(_v).project(this.camera);
      const ax = rect.left + ((a.x + 1) / 2) * rect.width;
      const ay = rect.top + ((1 - a.y) / 2) * rect.height;
      const h = sprite.scale.y * pxPerUnit;
      const w = sprite.scale.x * pxPerUnit;
      if (clientX > ax - w / 2 && clientX < ax + w / 2 && clientY > ay - h * 1.9 && clientY < ay - h * 0.9) return city;
    }
    return null;
  }

  // ------------------------------------------------------------------
  // FOCUS (cinematic fly-to + highlight)
  // ------------------------------------------------------------------

  /**
   * spec: { type: 'city', index } | { type: 'faction', owner } | { type: 'tile', tileId }
   * Cities and factions fly the camera to a tilted close-up; tiles only highlight.
   */
  focusOn(spec, { animate = true } = {}) {
    if (!this.mapData) return;
    const tileMap = this.hexasphere.tileMap;
    let tiles = [];
    let dist = 0;
    let tilt = 0;
    if (spec.type === 'city') {
      const city = this.cityByIndex.get(spec.index);
      if (!city) return;
      tiles = city.tiles || [city.tileId];
      dist = this.tileSpacing * (3.2 + Math.sqrt(tiles.length) * 1.1);
      tilt = 0.68;
    } else if (spec.type === 'faction') {
      const info = this.mapData[spec.owner];
      if (!info) return;
      tiles = info.claimedTiles;
      dist = this.tileSpacing * (4 + Math.sqrt(tiles.length) * 1.5);
      tilt = 0.55;
    } else if (spec.type === 'tile') {
      tiles = [spec.tileId];
    }
    if (this.pov) this.exitPov(false, false);
    // Portrait screens see less sideways: pull back so the whole city still fits
    const aspect = this.camera.aspect;
    if (aspect < 1) dist *= Math.min(2, 0.8 / aspect);

    const dir = new THREE.Vector3();
    tiles.forEach((id) => dir.add(tileMap.get(id).center));
    dir.normalize();

    this.setHighlight(spec, tiles);
    const prev = this.focus;
    this.focus = { spec, dir, dist, tilt, flying: dist > 0 };
    if (dist > 0) {
      this.flyTo(this.focusPose(), animate, () => this.lockFocusControls());
    } else if (prev?.flying) {
      // A plain tile click keeps the current close-up camera
      this.focus.flying = true;
      this.focus.dir = prev.dir;
      this.focus.dist = prev.dist;
      this.focus.tilt = prev.tilt;
    }
    if (this.onFocusChange) this.onFocusChange(spec);
  }

  clearFocus({ animate = true, notify = true } = {}) {
    if (!this.focus) return;
    const wasFlying = this.focus.flying;
    const dir = this.focus.dir.clone().applyQuaternion(this.planetGroup.quaternion);
    this.focus = null;
    this.setHighlight(null, []);
    if (wasFlying) {
      const width = this.container.clientWidth || window.innerWidth;
      const height = this.container.clientHeight || window.innerHeight;
      const halfV = THREE.MathUtils.degToRad(this.camera.fov / 2);
      const halfH = Math.atan(Math.tan(halfV) * (width / height));
      const d = this.radius / Math.sin(0.91 * Math.min(halfV, halfH));
      const pose = { pos: dir.add(new THREE.Vector3(0, 0.25, 0)).normalize().multiplyScalar(d), target: new THREE.Vector3(), up: UP.clone() };
      this.flyTo(pose, animate, () => this.releaseFocusControls());
    }
    if (notify && this.onFocusChange) this.onFocusChange(null);
  }

  /** Tilted close-up: the camera sits off to the side it is already on, looking at the spot. */
  focusPose() {
    const T = this.focus.dir.clone().applyQuaternion(this.planetGroup.quaternion).multiplyScalar(this.landR);
    const up = T.clone().normalize();
    const away = this.camera.position.clone().sub(T);
    const back = away.addScaledVector(up, -away.dot(up));
    if (back.lengthSq() < 1e-6) back.set(0, 1, 0).addScaledVector(up, -up.y);
    back.normalize();
    const { dist, tilt } = this.focus;
    const pos = T.clone().addScaledVector(up, dist * Math.cos(tilt)).addScaledVector(back, dist * Math.sin(tilt));
    return { pos, target: T, up };
  }

  flyTo(pose, animate, done) {
    this.controls.enabled = false;
    // The ground slides under the cursor during the flight: drop the stale hover
    this.setHovered(null);
    const from = { pos: this.camera.position.clone(), target: this.controls.target.clone(), up: this.camera.up.clone() };
    const travel = from.pos.clone().normalize().angleTo(pose.pos.clone().normalize());
    this.camTween = {
      from,
      to: pose,
      t0: performance.now(),
      dur: animate ? 1300 + Math.min(1.2, travel) * 900 : 0,
      bump: this.radius * Math.min(0.45, travel * 0.35),
      done
    };
  }

  updateCamTween(now) {
    const tw = this.camTween;
    const raw = tw.dur ? Math.min(1, (now - tw.t0) / tw.dur) : 1;
    // easeInOutCubic: slow launch, glide, gentle landing
    const e = raw < 0.5 ? 4 * raw * raw * raw : 1 - Math.pow(-2 * raw + 2, 3) / 2;
    const a = tw.from.pos.clone().normalize();
    const b = tw.to.pos.clone().normalize();
    const len = THREE.MathUtils.lerp(tw.from.pos.length(), tw.to.pos.length(), e) + Math.sin(Math.PI * e) * tw.bump;
    // Travel along the sphere so the globe appears to turn under the camera
    const axis = new THREE.Vector3().crossVectors(a, b);
    const ang = a.angleTo(b);
    const dir = axis.lengthSq() > 1e-10 ? a.applyAxisAngle(axis.normalize(), ang * e) : a.lerp(b, e).normalize();
    this.camera.position.copy(dir.multiplyScalar(len));
    const target = tw.from.target.clone().lerp(tw.to.target, e);
    this.camera.up.copy(tw.from.up).lerp(tw.to.up, e).normalize();
    this.camera.lookAt(target);
    this.controls.target.copy(target);
    if (raw >= 1) {
      this.camTween = null;
      tw.done?.();
    }
  }

  /**
   * Near plane follows the camera's height above the ground: close to the
   * surface a fixed near plane would slice into the terrain and show the
   * hollow inside of the globe.
   */
  updateNearPlane() {
    const alt = Math.max(0.001, this.camera.position.length() - this.landR);
    const near = THREE.MathUtils.clamp(alt * 0.12, 0.004, 0.1);
    if (Math.abs(near - this.camera.near) / this.camera.near > 0.15) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Keep the focused spot centred in the part of the screen the UI leaves free. */
  setInset({ left = 0, bottom = 0, right = 0, top = 0 } = {}) {
    this.insetTarget = { left, bottom, right, top };
  }

  applyInset(dt) {
    const k = 1 - Math.exp(-dt * 6);
    let changed = false;
    for (const side of ['left', 'bottom', 'right', 'top']) {
      const diff = this.insetTarget[side] - this.inset[side];
      if (diff === 0) continue;
      this.inset[side] = Math.abs(diff) < 0.5 ? this.insetTarget[side] : this.inset[side] + diff * k;
      changed = true;
    }
    if (!changed) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    if (Object.values(this.inset).every(value => value < 0.5)) this.camera.clearViewOffset();
    else this.camera.setViewOffset(w, h, (this.inset.right - this.inset.left) / 2, (this.inset.bottom - this.inset.top) / 2, w, h);
  }

  setControlsUp(up) {
    this.camera.up.copy(up);
    this.controls._quat.setFromUnitVectors(up, UP);
    this.controls._quatInverse.copy(this.controls._quat).invert();
  }

  /** Orbit around the focused spot with the local ground as "down". */
  lockFocusControls() {
    const pose = this.focusPose();
    this.setControlsUp(pose.up);
    this.controls.target.copy(pose.target);
    this.controls.minDistance = this.tileRadius * 2.2;
    this.controls.maxDistance = this.focus.dist * 2.4;
    this.controls.maxPolarAngle = 1.3; // never below the horizon
    this.controls.enabled = true;
    this.controls.update();
  }

  releaseFocusControls() {
    this.setControlsUp(UP);
    this.controls.target.set(0, 0, 0);
    this.controls.minDistance = this.radius * 1.12;
    this.controls.maxPolarAngle = Math.PI;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.frameGlobe(width, height);
    this.controls.enabled = true;
  }

  /** Faction: tinted territory. City: outline around its footprint. Tile: outline. */
  setHighlight(spec, tileIds) {
    if (this.highlight) {
      disposeTree(this.highlight, new Set());
      this.highlight.parent?.remove(this.highlight);
      this.highlight = null;
    }
    if (!spec || !this.mapGroup) return;
    const group = new THREE.Group();
    const set = new Set(tileIds);
    const tileMap = this.hexasphere.tileMap;
    const color = spec.type === 'faction' ? FACTION[spec.owner] : spec.type === 'city' ? FACTION[this.cityByIndex.get(spec.index)?.owner] ?? 0x3a3a3a : 0x3a3a3a;

    if (spec.type === 'faction') {
      const pos = [];
      for (const id of set) {
        const t = tileMap.get(id);
        const r = (isWater(t) ? this.waterR : this.landR) + 0.004;
        for (const e of this.tileEdges(t)) {
          for (const v of [t.center, e.A, e.B]) pos.push(v.x * r, v.y * r, v.z * r);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const fill = new THREE.Mesh(
        g,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 })
      );
      fill.renderOrder = 3;
      group.add(fill);
    }
    if (spec.type !== 'faction') {
      const band = new THREE.Mesh(this.roundedBand(set, spec.type === 'city' ? 0.18 : 0.16, 0.004), bandMaterial(color, { outer: 0.95, inner: 0.4 }));
      band.renderOrder = 9;
      group.add(band);
    }
    this.highlight = group;
    this.mapGroup.add(group);
  }

  /** Ride a vehicle that serves this city (land first, then sea, then air). */
  povFromCity(index) {
    for (const mode of ['land', 'sea', 'air']) {
      const m = this.movers.find((v) => v.mode === mode && v.cities.includes(index));
      if (m) {
        this.enterPov(m); // enterPov tears down the focus state and notifies the UI
        return true;
      }
    }
    return false;
  }

  /** Pointer work is coalesced to once per frame. */
  processPointer() {
    const event = this.pendingPointer;
    this.pendingPointer = null;
    if (!event) return;
    const canvas = this.renderer.domElement;
    if (event.leave) {
      this.setHovered(null);
      return;
    }
    if (this.driving) return;
    canvas.style.cursor = this.pickMover(event.clientX, event.clientY) ? 'pointer' : '';
    if (this.pov) return;
    const rect = canvas.getBoundingClientRect();
    this.mouse.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObject(this.colliderMesh, false);
    if (!hits.length) {
      this.setHovered(null);
      return;
    }
    const local = this.planetGroup.worldToLocal(hits[0].point.clone()).normalize();
    let best = null;
    let maxDot = -Infinity;
    const tiles = this.hexasphere.tiles;
    for (let i = 0; i < tiles.length; i++) {
      const c = tiles[i].center;
      const dot = c.x * local.x + c.y * local.y + c.z * local.z;
      if (dot > maxDot) {
        maxDot = dot;
        best = tiles[i];
      }
    }
    this.setHovered(best, event.clientX, event.clientY);
  }

  setHovered(tile, x, y) {
    if (tile !== this.hoveredTile) {
      this.hoveredTile = tile;
      if (tile) this.updateHoverIndicator(tile);
      else if (this.hoverIndicatorMesh) this.hoverIndicatorMesh.visible = false;
    }
    if (this.onTileHover) this.onTileHover(tile, x, y);
  }

  updateHoverIndicator(tile) {
    const old = this.hoverIndicatorMesh.geometry;
    this.hoverIndicatorMesh.geometry = this.roundedBand([tile.id], 0.17, 0.003);
    old.dispose();
    this.hoverIndicatorMesh.visible = true;
  }

  onWindowResize() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (!this.options.renderer) this.renderer.setSize(width, height);
    if (!this.pov && !this.focus?.flying && !this.camTween) this.frameGlobe(width, height);
  }

  updateMover(m, time) {
    let u = ((time * m.speed) / m.length + m.offset) % 2;
    const forward = u <= 1;
    if (!forward) u = 2 - u;
    u = THREE.MathUtils.clamp(u, 0.001, 0.999);

    m.curve.getPointAt(u, m.mesh.position);
    const tan = m.curve.getTangentAt(u, _v);
    if (!forward) tan.negate();
    const up = _v2.copy(m.mesh.position).normalize();
    tan.addScaledVector(up, -tan.dot(up)).normalize();
    _v3.crossVectors(tan, up);
    _m.makeBasis(tan, up, _v3);
    m.mesh.quaternion.setFromRotationMatrix(_m);
  }

  /** Hide prop chunks beyond the horizon, detail props when zoomed out, fade clouds and labels. */
  updateVisibility() {
    const dist = this.camera.position.length();
    const camWorld = _v3.copy(this.camera.position).normalize();
    const camLocal = _v.copy(camWorld).applyQuaternion(_q.copy(this.planetGroup.quaternion).invert());
    const horizon = Math.acos(Math.min(1, this.radius / dist)) + 0.12;
    const showDetail = dist < this.radius * DETAIL_DISTANCE;
    const camPosLocal = _v4.copy(camLocal).multiplyScalar(dist);
    for (const chunk of this.chunks) {
      const angle = Math.acos(THREE.MathUtils.clamp(chunk.normal.dot(camLocal), -1, 1));
      chunk.group.visible = angle - chunk.spread < horizon;
      if (!chunk.group.visible) continue;
      // Distance from the camera to the nearest part of the chunk
      const d = Math.max(0, _v2.copy(chunk.normal).multiplyScalar(this.radius).distanceTo(camPosLocal) - chunk.spread * this.radius);
      let level = d < this.radius * LOD0_RANGE ? 0 : d < this.radius * LOD1_RANGE ? 1 : 2;
      if (level === 0 && !this.lod0Ready) level = 1;
      if (level !== chunk.level) {
        chunk.level = level;
        chunk.levels.forEach((l, i) => (l.main.visible = i === level));
      }
      chunk.levels[level].detail.visible = showDetail;
    }

    const inPov = !!this.pov || !!this.driving;
    if (this.haze) this.haze.visible = !inPov && this.hasAir !== false;

    const focusedCity = this.focus?.spec.type === 'city' ? this.focus.spec.index : -1;
    for (const { sprite, normal, city } of this.labels) {
      if (city.index === focusedCity) {
        // The focus card already names this city
        sprite.visible = false;
        continue;
      }
      const facing = _v2.copy(normal).applyQuaternion(this.planetGroup.quaternion).dot(camWorld);
      // In POV the camera hugs the ground, so only nearby banners stay up
      const o = this.pov || this.driving
        ? THREE.MathUtils.smoothstep(facing, 0.985, 0.995)
        : THREE.MathUtils.smoothstep(facing, 0.32, 0.5);
      sprite.material.opacity = o;
      sprite.visible = o > 0.01;
    }
  }

  animate(timestamp) {
    requestAnimationFrame(this.animate);
    this.update(timestamp);
    this.render();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  update(timestamp) {
    const t = (this.animTime = timestamp * 0.001);
    const dt = Math.min(0.1, t - (this.lastFrame || t));
    this.lastFrame = t;

    this.applyInset(dt);
    if (this.camTween) this.updateCamTween(performance.now());
    else if (!this.pov && !this.driving) {
      this.controls.update();
      // Auto-rotate pauses while a spot is in focus, so the camera stays on it
      if (this.autoRotate && !this.focus?.flying) this.planetGroup.rotation.y += 0.002;
    }
    if (this.cloudsMesh) this.cloudsMesh.rotation.y += 0.00025; // clouds drift slower than the eye notices
    this.updateNearPlane();

    this.processPointer();
    this.animatedMaterials.forEach((fn) => fn(t));

    for (const m of this.movers) {
      if (m.mesh.parent?.visible || this.pov?.mover === m) this.updateMover(m, t);
    }
    if (this.pov) this.updatePovCamera(dt);
    // Air route lines are a map overlay: shown from orbit, hidden up close and while riding
    if (this.airLines) this.airLines.visible = !this.pov && this.camera.position.length() > this.radius * 1.45;
    this.updateVisibility();
  }

  resetCamera() {
    if (this.pov) {
      this.exitPov();
      return;
    }
    if (this.focus) {
      this.clearFocus();
      return;
    }
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.frameGlobe(width, height, true);
  }
}

/** Collects prop transforms per asset before they become instanced chunks. */
class PropBatch {
  constructor() {
    this.items = new Map();
  }
  add(name, matrix, { tint = 1, detail = false } = {}) {
    if (!this.items.has(name)) this.items.set(name, []);
    this.items.get(name).push({ m: matrix.clone(), tint, detail });
  }
}
