import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BIOMES, isWater, mulberry32 } from '../map/mapGenerator.js';
import { loadAssetLibrary, createToonMaterial } from './assetLibrary.js';
import { buildMountainGeometry } from './mountainBuilder.js';

// Cartoon (Civ VI-like) terrain palette
export const BIOME_PALETTE = {
  [BIOMES.OCEAN_DEEP]: 0x1c4f9c,
  [BIOMES.OCEAN]: 0x2479c9,
  [BIOMES.COAST]: 0x3fc2d6,
  [BIOMES.BEACH]: 0xefd690,
  [BIOMES.PLAINS]: 0x93c24c,
  [BIOMES.FOREST]: 0x62993a,
  [BIOMES.DESERT]: 0xe8bf5f,
  [BIOMES.MOUNTAIN]: 0x8f8a5a,
  [BIOMES.TUNDRA]: 0xeaf2f7
};
const GROUND = { city: 0xcbb68c, wheat: 0xc9a650, crop: 0x7f9a45 };
// The1 identity colours: The Green = player, The Red = system
const FACTION = { player: 0x027b49, system: 0xfa4d43 };
const LABEL_STYLE = {
  player: { bg: '#027b49', fg: '#ffffff' },
  system: { bg: '#fa4d43', fg: '#1f1f1f' },
  neutral: { bg: '#1f1f1f', fg: '#d9d9d9' }
};
const UP = new THREE.Vector3(0, 1, 0);
const DETAIL_DISTANCE = 2.15; // detail props (grass, bushes, hay) only render closer than this x radius
const LOD_DISTANCE = 1.8; // trees swap to their low-poly stand-ins beyond this x radius
const FAR_LOD = {
  tree_pine: 'tree_pine_lod',
  tree_pine_snow: 'tree_pine_snow_lod',
  tree_round: 'tree_round_lod',
  tree_palm: 'tree_palm_lod'
};

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

// Reused temporaries (avoid per-frame / per-instance allocations)
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();

export class PlanetRenderer {
  constructor(containerElement, hexasphere) {
    this.container = containerElement;
    this.hexasphere = hexasphere;
    this.radius = hexasphere.radius;

    this.landR = this.radius;
    this.waterR = this.radius * 0.992;
    this.skirtR = this.radius * 0.972;

    this.mapGroup = null;
    this.showAirRoute = true;
    this.showGroundRoute = true;
    this.showSeaRoute = true;
    this.airCurve = null;
    this.airPulses = [];
    this.movers = [];
    this.labels = [];
    this.chunks = [];
    this.animatedMaterials = [];

    this.autoRotate = false;
    this.animTime = 0;
    this.onTileHover = null;
    this.onTileSelect = null;
    this.onAssetsStatus = null;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.pendingPointer = null;
    this.hoveredTile = null;
    this.selectedTile = null;

    // Everything shared across rebuilds lives here and is never disposed
    this.propMaterial = createToonMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.sharedGeometries = new Set();
    this.sharedMaterials = new Set([this.propMaterial]);
    this.assets = null;
    this.assetsState = 'loading';
    this.assetsPromise = loadAssetLibrary()
      .then((lib) => {
        this.assets = lib;
        Object.values(lib).forEach((g) => this.sharedGeometries.add(g));
        this.setAssetsState('ready');
        return lib;
      })
      .catch((err) => {
        console.error('Asset pack failed to load:', err);
        this.setAssetsState('error');
        return null;
      });
    this.buildId = 0;

    this.init();
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

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.container.appendChild(this.renderer.domElement);

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

    this.createAtmosphere();
    this.createCloudLayer();

    this.colliderMesh = new THREE.Mesh(
      new THREE.SphereGeometry(this.radius, 32, 32),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    this.scene.add(this.colliderMesh);

    this.createHoverIndicator();

    window.addEventListener('resize', this.onWindowResize.bind(this));
    this.renderer.domElement.addEventListener('pointermove', (e) => (this.pendingPointer = e));
    this.renderer.domElement.addEventListener('pointerleave', () => (this.pendingPointer = { leave: true }));
    // A tile is selected on click only, not at the start of a drag-to-rotate
    this.renderer.domElement.addEventListener('pointerdown', (e) => (this.pressAt = { x: e.clientX, y: e.clientY }));
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp.bind(this));

    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  /**
   * Default view: whole planet in frame, filling ~91% of the shorter screen
   * axis, seen slightly from above.
   */
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
    // Key light follows the camera so the visible hemisphere is always lit
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    sun.position.set(-12, 16, 10);
    this.camera.add(sun);
    this.camera.add(sun.target);
    sun.target.position.set(0, 0, -30);
  }

  createAtmosphere() {
    // Thin blue rim so the planet edge reads against the concrete canvas
    const mat = new THREE.ShaderMaterial({
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
        varying vec3 vNormal;
        varying vec3 vPosition;
        void main() {
          float fresnel = clamp(1.0 - dot(normalize(-vPosition), vNormal), 0.0, 1.0);
          gl_FragColor = vec4(vec3(0.42, 0.66, 0.9), pow(fresnel, 3.0) * 0.55);
        }
      `,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false
    });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(this.radius * 1.05, 64, 48), mat));
  }

  createCloudLayer() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < 38; i++) {
      const cx = Math.random() * 1024;
      const cy = 70 + Math.random() * 372;
      const puffs = 4 + Math.floor(Math.random() * 5);
      for (let p = 0; p < puffs; p++) {
        const x = cx + (Math.random() - 0.5) * 90;
        const y = cy + (Math.random() - 0.5) * 30;
        const r = 16 + Math.random() * 26;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, 'rgba(255,255,255,0.75)');
        grad.addColorStop(0.7, 'rgba(255,255,255,0.55)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    this.cloudsMesh = new THREE.Mesh(
      new THREE.SphereGeometry(this.radius * 1.045, 64, 48),
      new THREE.MeshLambertMaterial({ map: tex, transparent: true, opacity: 0.4, depthWrite: false })
    );
    this.cloudsMesh.renderOrder = 5;
    this.planetGroup.add(this.cloudsMesh);
  }

  createHoverIndicator() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(7 * 3), 3));
    this.hoverIndicatorMesh = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x1f1f1f }));
    this.hoverIndicatorMesh.visible = false;
    this.hoverIndicatorMesh.renderOrder = 10;
    this.planetGroup.add(this.hoverIndicatorMesh);
  }

  // ------------------------------------------------------------------
  // BUILD
  // ------------------------------------------------------------------

  buildPlanet(mapData) {
    this.clearPlanet();
    const buildId = ++this.buildId;
    const tiles = this.hexasphere.tiles;
    const R = this.radius;
    this.mapData = mapData;

    this.tileSpacing = R * Math.sqrt((4 * Math.PI) / tiles.length);
    const sample = tiles.slice(0, 60);
    this.tileRadius = (R * sample.reduce((s, t) => s + t.center.distanceTo(t.corners[0]), 0)) / sample.length;

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

    this.buildTerrain(tiles);
    const mountains = this.buildMountains(mapData);
    this.buildTerritoryBorders();
    this.buildRivers(mapData.riverPaths || []);
    this.buildRoutes(mapData);
    if (mapData.player?.capitalId !== undefined && mapData.system?.capitalId !== undefined) {
      this.buildAirRoute(mapData.player.capitalId, mapData.system.capitalId);
    }
    this.applyRouteVisibility();

    Promise.all([this.assetsPromise, this.loadLabelFont()]).then(([lib]) => {
      if (buildId !== this.buildId) return;
      this.buildLabels(mapData);
      if (!lib) return;
      const props = new PropBatch();
      this.scatterNature(mapData, props, mountains?.foothills || []);
      this.buildSettlements(mapData, props);
      this.buildFarms(mapData, props);
      this.buildBridges(mapData, props);
      this.flushProps(props);
      this.buildMovers(mapData);
      this.applyRouteVisibility();
    });
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

  tileBaseColor(tile) {
    let hexColor = BIOME_PALETTE[tile.biome] ?? BIOME_PALETTE[BIOMES.PLAINS];
    if (tile.cityIndex !== null && tile.cityIndex !== undefined) hexColor = GROUND.city;
    else if (tile.farmIndex !== null && tile.farmIndex !== undefined) {
      hexColor = GROUND[this.mapData?.farms?.[tile.farmIndex]?.crop] ?? GROUND.wheat;
    }
    const c = new THREE.Color(hexColor);
    if (!isWater(tile)) {
      c.offsetHSL(0, 0, (hash01(tile.id) - 0.5) * 0.08);
      if (tile.owner && FACTION[tile.owner]) c.lerp(new THREE.Color(FACTION[tile.owner]), 0.08);
    }
    return c;
  }

  buildTerrain(tiles) {
    const land = { pos: [], col: [], nrm: [] };
    const water = { pos: [], col: [], nrm: [] };
    const foam = [];
    const landLines = [];
    const waterLines = [];

    const colorOf = new Map();
    tiles.forEach((t) => colorOf.set(t.id, this.tileBaseColor(t)));

    // Corner colours blend neighbouring biomes for soft transitions
    const landCorner = new Map();
    const waterCorner = new Map();
    const coastColor = new THREE.Color(BIOME_PALETTE[BIOMES.COAST]);
    for (const [c, owners] of this.cornerTiles) {
      const lc = new THREE.Color(0, 0, 0);
      const wc = new THREE.Color(0, 0, 0);
      let ln = 0;
      for (const t of owners) {
        if (isWater(t)) wc.add(colorOf.get(t.id));
        else {
          wc.add(coastColor);
          if (t.biome !== BIOMES.MOUNTAIN) {
            lc.add(colorOf.get(t.id));
            ln++;
          }
        }
      }
      waterCorner.set(c, wc.multiplyScalar(1 / owners.length));
      landCorner.set(c, ln ? lc.multiplyScalar(1 / ln) : null);
    }

    const push = (buf, p, n, c) => {
      buf.pos.push(p.x, p.y, p.z);
      buf.nrm.push(n.x, n.y, n.z);
      buf.col.push(c.r, c.g, c.b);
    };
    const skirtColor = new THREE.Color(0x9b7a52);
    const skirtDark = new THREE.Color(0x7a5c3c);

    for (const tile of tiles) {
      const wet = isWater(tile);
      const r = wet ? this.waterR : this.landR;
      const base = colorOf.get(tile.id);
      const center = tile.center.clone().multiplyScalar(r);
      const n = tile.cornerIndices.length;
      const isMtn = tile.biome === BIOMES.MOUNTAIN;
      // Farms keep crisper edges so the plots read as tiles
      const blend = tile.farmIndex !== null && tile.farmIndex !== undefined ? 0.2 : 0.55;

      for (let ci = 0; ci < n; ci++) {
        const ia = tile.cornerIndices[ci];
        const ib = tile.cornerIndices[(ci + 1) % n];
        const ua = this.hexasphere.globalCorners[ia];
        const ub = this.hexasphere.globalCorners[ib];
        const pa = ua.clone().multiplyScalar(r);
        const pb = ub.clone().multiplyScalar(r);

        if (wet) {
          push(water, center, tile.center, base);
          push(water, pa, ua, waterCorner.get(ia));
          push(water, pb, ub, waterCorner.get(ib));
        } else if (!isMtn) {
          const ca = landCorner.get(ia) ? base.clone().lerp(landCorner.get(ia), blend) : base;
          const cb = landCorner.get(ib) ? base.clone().lerp(landCorner.get(ib), blend) : base;
          push(land, center, tile.center, base);
          push(land, pa, ua, ca);
          push(land, pb, ub, cb);
        }

        const nb = this.edgeNeighbor(tile, ia, ib);
        if (!nb) continue;

        if (!wet && isWater(nb)) {
          // Coastal cliff skirt (two bands for a layered rock face) + foam on the water side
          const mid = ua.clone().multiplyScalar((this.landR + this.skirtR) / 2);
          const midB = ub.clone().multiplyScalar((this.landR + this.skirtR) / 2);
          const ba = ua.clone().multiplyScalar(this.skirtR);
          const bb = ub.clone().multiplyScalar(this.skirtR);
          const sn = new THREE.Vector3().subVectors(pa, center).add(_v2.subVectors(pb, center)).normalize();
          for (const [t1, t2, b1, b2, col] of [
            [pa, pb, mid, midB, skirtColor],
            [mid, midB, ba, bb, skirtDark]
          ]) {
            push(land, t1, sn, col);
            push(land, b1, sn, col);
            push(land, t2, sn, col);
            push(land, t2, sn, col);
            push(land, b1, sn, col);
            push(land, b2, sn, col);
          }
          const fr = this.waterR + 0.002;
          const fa = ua.clone().multiplyScalar(fr);
          const fb = ub.clone().multiplyScalar(fr);
          const ia2 = ua.clone().lerp(nb.center, 0.3).normalize().multiplyScalar(fr);
          const ib2 = ub.clone().lerp(nb.center, 0.3).normalize().multiplyScalar(fr);
          foam.push(fa, ia2, fb, fb, ia2, ib2);
        }

        if (tile.id < nb.id) {
          if (!wet && !isWater(nb) && !(isMtn && nb.biome === BIOMES.MOUNTAIN)) {
            const gr = this.landR * 1.0006;
            landLines.push(ua.x * gr, ua.y * gr, ua.z * gr, ub.x * gr, ub.y * gr, ub.z * gr);
          } else if (wet && isWater(nb)) {
            const gr = this.waterR * 1.0006;
            waterLines.push(ua.x * gr, ua.y * gr, ua.z * gr, ub.x * gr, ub.y * gr, ub.z * gr);
          }
        }
      }
    }

    const makeGeo = (buf) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(buf.nrm, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(buf.col, 3));
      return g;
    };

    this.mapGroup.add(
      new THREE.Mesh(new THREE.SphereGeometry(this.skirtR * 0.999, 48, 32), new THREE.MeshBasicMaterial({ color: 0x0d3b6e }))
    );
    const landMesh = new THREE.Mesh(makeGeo(land), createToonMaterial({ vertexColors: true }));
    landMesh.name = 'landMesh';
    this.mapGroup.add(landMesh);
    const waterMesh = new THREE.Mesh(
      makeGeo(water),
      new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 28, specular: 0x2a4a66 })
    );
    waterMesh.name = 'oceanMesh';
    this.mapGroup.add(waterMesh);

    if (foam.length) {
      const foamMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      const foamMesh = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints(foam), foamMat);
      foamMesh.renderOrder = 1;
      this.mapGroup.add(foamMesh);
      this.animatedMaterials.push((t) => (foamMat.opacity = 0.4 + Math.sin(t * 1.6) * 0.15));
    }

    const addLines = (arr, color, opacity) => {
      if (!arr.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      this.mapGroup.add(
        new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }))
      );
    };
    addLines(landLines, 0x1d2a12, 0.18);
    addLines(waterLines, 0x0b2f5c, 0.14); // faceted hex sea like the reference board
  }

  buildMountains(mapData) {
    const result = buildMountainGeometry(this.hexasphere, {
      landRadius: this.landR,
      tileSpacing: this.tileSpacing,
      seed: mapData.seed || 1
    });
    if (!result) return null;
    this.mapGroup.add(new THREE.Mesh(result.geometry, createToonMaterial({ vertexColors: true })));
    return result;
  }

  buildTerritoryBorders() {
    for (const owner of ['player', 'system']) {
      const tubes = this.borderTubes(owner);
      if (!tubes.length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(tubes, false), new THREE.MeshBasicMaterial({ color: FACTION[owner] }));
      tubes.forEach((g) => g.dispose());
      this.mapGroup.add(mesh);
    }
  }

  borderTubes(ownerKey) {
    const tiles = this.hexasphere.tiles;
    const edgeSet = new Set();
    const adj = new Map();
    const link = (u, v) => {
      if (!adj.has(u)) adj.set(u, []);
      adj.get(u).push(v);
    };
    for (const tile of tiles) {
      if (tile.owner !== ownerKey) continue;
      for (const nId of tile.neighbors) {
        const nb = this.hexasphere.tileMap.get(nId);
        if (!nb || nb.owner === ownerKey) continue;
        const shared = tile.cornerIndices.filter((c) => nb.cornerIndices.includes(c));
        if (shared.length !== 2) continue;
        const key = shared[0] < shared[1] ? `${shared[0]}_${shared[1]}` : `${shared[1]}_${shared[0]}`;
        if (edgeSet.has(key)) continue;
        edgeSet.add(key);
        link(shared[0], shared[1]);
        link(shared[1], shared[0]);
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
        const next = (adj.get(curr) || []).find((n) => n !== prev && (!visited.has(n) || (n === start && loop.length > 2)));
        if (next === undefined || next === start || visited.has(next)) break;
        visited.add(next);
        loop.push(next);
        prev = curr;
        curr = next;
      }
      if (loop.length >= 3) loops.push(loop);
    }

    const corners = this.hexasphere.globalCorners;
    const tubeRadius = this.tileSpacing * 0.05;
    const out = [];
    for (const loop of loops) {
      const N = loop.length;
      const pts = [];
      for (let i = 0; i < N; i++) {
        const P = corners[loop[i]];
        const A = new THREE.Vector3().lerpVectors(P, corners[loop[(i - 1 + N) % N]], 0.36);
        const B = new THREE.Vector3().lerpVectors(P, corners[loop[(i + 1) % N]], 0.36);
        for (let s = 0; s <= 3; s++) {
          const t = s / 3;
          pts.push(
            new THREE.Vector3()
              .copy(A)
              .multiplyScalar((1 - t) * (1 - t))
              .addScaledVector(P, 2 * (1 - t) * t)
              .addScaledVector(B, t * t)
              .normalize()
              .multiplyScalar(this.landR * 1.004)
          );
        }
      }
      if (pts.length >= 6) {
        out.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), pts.length * 2, tubeRadius, 5, true));
      }
    }
    return out;
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

  pathCurve(path, extraStart = null) {
    const tileMap = this.hexasphere.tileMap;
    const pts = extraStart ? [extraStart] : [];
    for (const id of path) {
      const t = tileMap.get(id);
      pts.push(t.center.clone().multiplyScalar(isWater(t) ? this.waterR : this.landR));
    }
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

  buildRivers(riverPaths) {
    const tileMap = this.hexasphere.tileMap;
    this.riverTiles = new Set();
    const parts = [];
    const s = this.tileSpacing;
    for (const path of riverPaths) {
      // Rivers spring from the mountain foot: skip tiles buried under the massif
      let i = 0;
      while (i < path.length && tileMap.get(path[i]).biome === BIOMES.MOUNTAIN) i++;
      if (i >= path.length - 1) continue;
      let start = null;
      if (i > 0) {
        start = tileMap.get(path[i - 1]).center.clone().lerp(tileMap.get(path[i]).center, 0.55);
        start.normalize().multiplyScalar(this.landR);
      }
      path.slice(i).forEach((id) => this.riverTiles.add(id));
      const curve = this.pathCurve(path.slice(i), start);
      if (!curve) continue;
      const pts = curve.getSpacedPoints(Math.max(8, (path.length - i) * 6));
      parts.push(this.buildRibbon(pts, (t) => s * (0.06 + 0.1 * t), 0.004));
    }
    this.addMerged(parts, createToonMaterial({ color: 0x4cb6ee, polygonOffset: true, polygonOffsetFactor: -2 }), this.mapGroup);
  }

  buildRoutes(mapData) {
    this.landCurves = [];
    this.seaCurves = [];
    const s = this.tileSpacing;

    const roads = [];
    for (const route of mapData.landRoutes || []) {
      const curve = this.pathCurve(route.path);
      if (!curve) continue;
      this.landCurves.push({ curve, path: route.path });
      roads.push(this.buildRibbon(curve.getSpacedPoints(route.path.length * 6), () => s * 0.1, 0.005));
    }
    this.addMerged(
      roads,
      createToonMaterial({ color: 0xc49a5c, polygonOffset: true, polygonOffsetFactor: -3 }),
      this.groundRouteGroup
    );

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
    for (const route of mapData.seaRoutes || []) {
      const curve = this.pathCurve(route.path);
      if (!curve) continue;
      this.seaCurves.push({ curve });
      lanes.push(this.buildRibbon(curve.getSpacedPoints(route.path.length * 5), () => s * 0.12, 0.006));
    }
    this.addMerged(lanes, laneMat, this.seaRouteGroup, 2);
  }

  buildAirRoute(playerCapId, systemCapId) {
    const R = this.radius;
    const tA = this.hexasphere.tileMap.get(playerCapId);
    const tB = this.hexasphere.tileMap.get(systemCapId);
    if (!tA || !tB) return;
    // Great-circle slerp (capitals can sit almost antipodal, where lerp+normalize collapses)
    const a = tA.center.clone().normalize();
    const b = tB.center.clone().normalize();
    const omega = Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
    const axis = new THREE.Vector3().crossVectors(a, b);
    if (axis.lengthSq() < 1e-8) axis.crossVectors(a, Math.abs(a.y) < 0.9 ? UP : new THREE.Vector3(1, 0, 0));
    axis.normalize();
    const pts = [];
    for (let i = 0; i <= 96; i++) {
      const t = i / 96;
      const lift = R * 1.02 + Math.sin(t * Math.PI) * R * 0.12;
      pts.push(a.clone().applyAxisAngle(axis, omega * t).multiplyScalar(lift));
    }
    this.airCurve = new THREE.CatmullRomCurve3(pts);
    const iron = new THREE.MeshBasicMaterial({ color: 0x1f1f1f, transparent: true, opacity: 0.55, depthWrite: false });
    this.airRouteGroup.add(new THREE.Mesh(new THREE.TubeGeometry(this.airCurve, 160, 0.008, 5, false), iron));
    const pulseGeo = new THREE.SphereGeometry(0.04, 10, 8);
    for (let i = 0; i < 3; i++) {
      const pulse = new THREE.Mesh(pulseGeo, iron);
      pulse.userData.offset = i / 3;
      this.airRouteGroup.add(pulse);
      this.airPulses.push(pulse);
    }
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

  /** Unit direction at a tangent offset (world units) from the tile centre. */
  offsetDir(frame, du, dv) {
    const k = 1 / this.radius;
    return frame.n.clone().addScaledVector(frame.u, du * k).addScaledVector(frame.v, dv * k).normalize();
  }

  /** Offset along an arbitrary tangent vector (world units). */
  offsetAlong(frame, tangent, d) {
    return frame.n.clone().addScaledVector(tangent, d / this.radius).normalize();
  }

  scatterDir(tile, rng, maxFrac = 0.62, minFrac = 0) {
    const f = this.tileFrame(tile);
    const a = rng() * Math.PI * 2;
    const d = (minFrac + Math.sqrt(rng()) * (maxFrac - minFrac)) * this.tileRadius;
    return this.offsetDir(f, Math.cos(a) * d, Math.sin(a) * d);
  }

  /** Upright on the sphere with a yaw around the local up axis. */
  onSphere(dir, radius, scale, yaw, target = new THREE.Matrix4()) {
    _q.setFromUnitVectors(UP, dir).multiply(_q2.setFromAxisAngle(UP, yaw));
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

  /** Boundary edges of a tile set with unit corner vectors. */
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

  scatterNature(mapData, props, foothills) {
    const rng = mulberry32((mapData.seed || 1) + 5);
    const tr = this.tileRadius;
    const put = (name, tile, scale, opts = {}) => {
      const dir = this.scatterDir(tile, rng, opts.maxFrac ?? 0.62, opts.minFrac ?? 0);
      const r = opts.radius ?? this.landR;
      props.add(name, this.onSphere(dir, r, scale * (0.8 + rng() * 0.45), rng() * Math.PI * 2), {
        tint: 0.88 + rng() * 0.24,
        detail: opts.detail
      });
    };

    for (const tile of this.hexasphere.tiles) {
      if (tile.cityIndex !== null && tile.cityIndex !== undefined) continue;
      if (tile.farmIndex !== null && tile.farmIndex !== undefined) continue;
      const absLat = Math.abs(tile.center.y);
      const road = tile.road ? 1 : 0;

      switch (tile.biome) {
        case BIOMES.FOREST: {
          const jungle = absLat < 0.28 && tile.moisture > 0.2;
          const count = 5 + Math.floor(rng() * 3) - road * 2;
          const pineShare = THREE.MathUtils.clamp((absLat - 0.25) * 2.2, 0.15, 0.95);
          for (let i = 0; i < count; i++) {
            if (jungle) put(rng() < 0.4 ? 'tree_palm' : 'tree_round', tile, tr * 0.62);
            else put(rng() < pineShare ? 'tree_pine' : 'tree_round', tile, tr * 0.58);
          }
          put('bush', tile, tr * 0.5, { detail: true });
          break;
        }
        case BIOMES.PLAINS: {
          const savanna = tile.moisture < -0.02 && absLat < 0.45;
          if (savanna && rng() < 0.35) put('tree_acacia', tile, tr * 0.6);
          else if (!savanna && rng() < 0.2) put('tree_round', tile, tr * 0.55);
          if (rng() < 0.25) put('bush', tile, tr * 0.5, { detail: true });
          if (rng() < 0.08) put('rock', tile, tr * 0.45);
          for (let i = 0; i < 2; i++) if (rng() < 0.6) put('grass_tuft', tile, tr * 0.45, { detail: true });
          break;
        }
        case BIOMES.BEACH:
          if (rng() < 0.45) for (let i = 0, n = 1 + Math.floor(rng() * 2); i < n; i++) put('tree_palm', tile, tr * 0.62);
          if (rng() < 0.12) put('rock', tile, tr * 0.4);
          break;
        case BIOMES.DESERT:
          if (rng() < 0.6) for (let i = 0, n = 1 + Math.floor(rng() * 2); i < n; i++) put('dune', tile, tr * 0.32, { maxFrac: 0.5 });
          if (rng() < 0.35) put('cactus', tile, tr * 0.62);
          if (rng() < 0.14) put('rock_mesa', tile, tr * 0.55, { maxFrac: 0.35 });
          break;
        case BIOMES.TUNDRA:
          if (rng() < 0.35) for (let i = 0, n = 1 + Math.floor(rng() * 3); i < n; i++) put('tree_pine_snow', tile, tr * 0.52);
          if (absLat > 0.9 && rng() < 0.35) put('ice_block', tile, tr * 0.6);
          if (rng() < 0.08) put('rock', tile, tr * 0.4);
          break;
        case BIOMES.COAST:
          if (rng() < 0.04) put('rock', tile, tr * 0.55, { radius: this.waterR - 0.01 });
          break;
        case BIOMES.OCEAN:
        case BIOMES.OCEAN_DEEP:
          if (absLat > 0.84 && rng() < 0.3) put('ice_block', tile, tr * 0.7, { radius: this.waterR - 0.02 });
          break;
        default:
          break;
      }
    }

    // Pines climbing the lower flanks of mountain ranges
    for (const spot of foothills) {
      if (rng() > 0.3) continue;
      const dir = spot.p.clone().normalize();
      const snowy = Math.abs(dir.y) > 0.6 || spot.hn > 0.35;
      props.add(
        snowy ? 'tree_pine_snow' : 'tree_pine',
        this.onSphere(dir, spot.p.length() - 0.004, tr * (0.45 + rng() * 0.2), rng() * Math.PI * 2),
        { tint: 0.9 + rng() * 0.2 }
      );
    }
  }

  buildSettlements(mapData, props) {
    const tileMap = this.hexasphere.tileMap;
    const tr = this.tileRadius;
    const rng = mulberry32((mapData.seed || 1) + 17);
    const HOUSES = ['house_a', 'house_b', 'house_c'];
    // Lot layout inside a tile (fractions of tile radius)
    const LOTS = [
      [0, 0], [0.42, 0], [-0.42, 0], [0.21, 0.37], [-0.21, 0.37], [0.21, -0.37], [-0.21, -0.37],
      [0.5, 0.36], [-0.5, -0.36]
    ];

    for (const city of mapData.cities || []) {
      const footprint = city.tiles || [city.tileId];
      const inCity = (t) => t.cityIndex === city.index;
      const center = tileMap.get(city.tileId);
      const centerDir = center.center.clone().normalize();
      const big = city.type === 'capital' || footprint.length >= 5;

      for (const id of footprint) {
        const tile = tileMap.get(id);
        const f = this.tileFrame(tile);
        const isCenter = id === city.tileId;
        const lots = LOTS.slice().sort(() => rng() - 0.5);

        if (isCenter) {
          const landmark = city.type === 'capital' ? 'castle' : footprint.length >= 3 ? 'temple' : 'tower';
          const scale = city.type === 'capital' ? tr * 0.95 : tr * 0.8;
          props.add(landmark, this.onSphere(centerDir, this.landR, scale, hash01(id) * Math.PI * 2));
          if (landmark === 'temple') {
            props.add('tower', this.onSphere(this.offsetDir(f, tr * 0.5, tr * 0.25), this.landR, tr * 0.55, 0));
          }
        }
        // Houses: denser in bigger cities, the centre tile keeps its middle for the landmark
        const count = isCenter ? (city.type === 'capital' ? 0 : 4) : big ? 7 : 5;
        let placed = 0;
        for (const [a, b] of lots) {
          if (placed >= count) break;
          if (isCenter && Math.hypot(a, b) < 0.4) continue;
          const dir = this.offsetDir(f, (a + (rng() - 0.5) * 0.08) * tr, (b + (rng() - 0.5) * 0.08) * tr);
          // Face roughly toward the city centre, snapped to a street grid
          const toCenter = new THREE.Vector3().subVectors(centerDir, dir);
          const yaw =
            Math.round((Math.atan2(toCenter.dot(f.v), toCenter.dot(f.u)) + rng() * 0.4) / (Math.PI / 2)) * (Math.PI / 2);
          props.add(HOUSES[Math.floor(rng() * HOUSES.length)], this.onSphere(dir, this.landR, tr * 0.72, yaw), {
            tint: 0.92 + rng() * 0.16
          });
          placed++;
        }
        if (!isCenter && rng() < 0.7) {
          props.add('tree_round', this.onSphere(this.scatterDir(tile, rng, 0.7, 0.55), this.landR, tr * 0.45, rng() * 6));
        }
      }

      // City edge: stone walls + towers for big cities, palisade for towns
      const edges = this.boundaryEdges(footprint, inCity);
      const cornersDone = new Set();
      for (const e of edges) {
        const mid = e.a.clone().add(e.b).normalize();
        const fwd = new THREE.Vector3().subVectors(e.b, e.a);
        const len = fwd.length() * this.landR;
        if (e.nb && isWater(e.nb) && !big) continue; // towns stay open to the shore
        if (big) {
          props.add('wall_segment', this.along(mid, this.landR, fwd, len, tr * 0.42, tr * 0.42));
          for (const [ci, c] of [[e.ia, e.a], [e.ib, e.b]]) {
            if (cornersDone.has(ci)) continue;
            cornersDone.add(ci);
            props.add('wall_tower', this.onSphere(c.clone(), this.landR, tr * 0.42, 0));
          }
        } else if (footprint.length >= 2) {
          props.add('fence_segment', this.along(mid, this.landR, fwd, len * 0.95, tr * 0.6, tr * 0.6));
        }
      }

      // Harbour: dock + moored boat on one shoreline edge, lighthouse for big ports
      if (city.isPort) {
        const shore = edges.filter((e) => e.nb && isWater(e.nb));
        if (shore.length) {
          const e = shore[Math.floor(rng() * shore.length)];
          const mid = e.a.clone().add(e.b).normalize();
          const out = new THREE.Vector3().subVectors(e.nb.center, e.tile.center);
          props.add('dock', this.along(mid, this.landR - 0.004, out, tr * 0.8, tr * 0.8, tr * 0.8));
          const outT = out.clone().addScaledVector(mid, -out.dot(mid)).normalize();
          const side = new THREE.Vector3().crossVectors(outT, mid);
          const boatDir = mid
            .clone()
            .multiplyScalar(this.radius)
            .addScaledVector(outT, tr * 0.42)
            .addScaledVector(side, tr * 0.2)
            .normalize();
          props.add('boat', this.along(boatDir, this.waterR, side, tr * 0.7, tr * 0.7, tr * 0.7));
          const e2 = shore.find((x) => x !== e);
          if (big && e2) {
            props.add('lighthouse', this.onSphere(e2.a.clone().lerp(e2.tile.center, 0.15).normalize(), this.landR, tr * 0.55, 0));
          }
        }
      }
    }
  }

  buildFarms(mapData, props) {
    const tileMap = this.hexasphere.tileMap;
    const tr = this.tileRadius;
    const rng = mulberry32((mapData.seed || 1) + 29);

    for (const farm of mapData.farms || []) {
      const f0 = this.tileFrame(tileMap.get(farm.tiles[0]));
      const angle = rng() * Math.PI;
      // One row direction for the whole farm so plots line up across tiles
      const rowDir0 = f0.u.clone().multiplyScalar(Math.cos(angle)).addScaledVector(f0.v, Math.sin(angle));
      const row = farm.crop === 'wheat' ? 'wheat_row' : 'crop_row';

      farm.tiles.forEach((id, idx) => {
        const f = this.tileFrame(tileMap.get(id));
        const rowDir = rowDir0.clone().addScaledVector(f.n, -rowDir0.dot(f.n)).normalize();
        const perp = new THREE.Vector3().crossVectors(f.n, rowDir);
        const yard = idx === 0 || (idx === 1 && farm.tiles.length >= 4);
        const reach = tr * 0.78;
        for (let k = -3; k <= 3; k++) {
          const off = k * tr * 0.2;
          if (yard && off > -tr * 0.05) continue; // keep the yard half free for buildings
          const half = Math.sqrt(Math.max(0, reach * reach - off * off));
          if (half < tr * 0.2) continue;
          props.add(row, this.along(this.offsetAlong(f, perp, off), this.landR, rowDir, half * 2, tr * 1.1, tr * 1.1));
        }
        if (idx === 0) {
          props.add('barn', this.along(this.offsetAlong(f, perp, tr * 0.4), this.landR, rowDir, tr * 0.7, tr * 0.7, tr * 0.7));
          for (let h = 0; h < 3; h++) {
            const d = f.n
              .clone()
              .addScaledVector(perp, (tr * 0.22) / this.radius)
              .addScaledVector(rowDir, (tr * (0.3 + h * 0.13)) / this.radius)
              .normalize();
            props.add('hay_bale', this.onSphere(d, this.landR, tr * 0.6, rng() * Math.PI), { detail: true });
          }
        } else if (yard) {
          props.add('windmill', this.onSphere(this.offsetAlong(f, perp, tr * 0.4), this.landR, tr * 0.7, rng() * Math.PI * 2));
        }
      });

      const inFarm = (t) => t.farmIndex === farm.index;
      for (const e of this.boundaryEdges(farm.tiles, inFarm)) {
        if (e.nb && e.nb.cityIndex !== null && e.nb.cityIndex !== undefined) continue;
        const mid = e.a.clone().add(e.b).normalize();
        const fwd = new THREE.Vector3().subVectors(e.b, e.a);
        props.add('fence_segment', this.along(mid, this.landR, fwd, fwd.length() * this.landR * 0.95, tr * 0.6, tr * 0.6));
      }
    }
  }

  buildBridges(mapData, props) {
    if (!this.riverTiles?.size) return;
    const tileMap = this.hexasphere.tileMap;
    const done = new Set();
    for (const route of mapData.landRoutes || []) {
      route.path.forEach((id, i) => {
        if (!this.riverTiles.has(id) || done.has(id)) return;
        const tile = tileMap.get(id);
        if (isWater(tile) || (tile.cityIndex !== null && tile.cityIndex !== undefined)) return;
        done.add(id);
        const prev = tileMap.get(route.path[Math.max(0, i - 1)]).center;
        const next = tileMap.get(route.path[Math.min(route.path.length - 1, i + 1)]).center;
        const fwd = new THREE.Vector3().subVectors(next, prev);
        const tr = this.tileRadius;
        props.add('bridge', this.along(tile.center.clone(), this.landR, fwd, tr * 0.9, tr * 0.7, tr * 0.7));
      });
    }
  }

  makeDuneGeometry() {
    const g = new THREE.SphereGeometry(1, 9, 4, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed();
    g.scale(1, 0.4, 0.38);
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    const color = new THREE.Color(0xd9a94c);
    const cols = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < g.attributes.position.count; i++) color.toArray(cols, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    g.computeVertexNormals();
    return g;
  }

  /**
   * Turn collected transforms into InstancedMeshes, split into 12 spatial
   * chunks (icosahedron directions). Chunks behind the planet's horizon, and
   * small "detail" props when zoomed out, are skipped every frame.
   */
  flushProps(props) {
    const phi = (1 + Math.sqrt(5)) / 2;
    const dirs = [
      [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0], [0, -1, phi], [0, 1, phi],
      [0, -1, -phi], [0, 1, -phi], [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1]
    ].map((d) => new THREE.Vector3(...d).normalize());

    this.chunks = dirs.map((normal) => {
      const group = new THREE.Group();
      const detail = new THREE.Group();
      const near = new THREE.Group();
      const far = new THREE.Group();
      group.add(detail, near, far);
      this.mapGroup.add(group);
      return { normal, spread: 0, group, detail, near, far, buckets: new Map() };
    });

    const dune = this.makeDuneGeometry();
    const geoFor = (name) => (name === 'dune' ? dune : this.assets[name]);
    const pos = new THREE.Vector3();

    for (const [name, items] of props.items) {
      if (!geoFor(name)) continue;
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

    const tint = new THREE.Color();
    for (const chunk of this.chunks) {
      for (const [key, items] of chunk.buckets) {
        const [name, detail] = key.split('|');
        const make = (geo) => {
          const inst = new THREE.InstancedMesh(geo, this.propMaterial, items.length);
          items.forEach((it, i) => {
            inst.setMatrixAt(i, it.m);
            inst.setColorAt(i, tint.setScalar(it.tint));
          });
          inst.instanceMatrix.needsUpdate = true;
          inst.computeBoundingSphere();
          return inst;
        };
        const lodGeo = this.assets[FAR_LOD[name]];
        if (detail === '1') chunk.detail.add(make(geoFor(name)));
        else if (lodGeo) {
          chunk.near.add(make(geoFor(name)));
          chunk.far.add(make(lodGeo));
        } else chunk.group.add(make(geoFor(name)));
      }
      chunk.buckets = null;
    }
  }

  makeLabelSprite(city) {
    const style = LABEL_STYLE[city.owner] || LABEL_STYLE.neutral;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const font = '500 34px "Barlow Condensed", "Archivo Narrow", sans-serif';
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(city.name).width) + 28;
    canvas.width = w;
    canvas.height = 48;
    ctx.fillStyle = style.bg;
    ctx.fillRect(0, 0, w, 48);
    ctx.font = font;
    ctx.fillStyle = style.fg;
    ctx.textBaseline = 'middle';
    ctx.fillText(city.name, 14, 25);

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

  buildLabels(mapData) {
    const tileMap = this.hexasphere.tileMap;
    for (const city of mapData.cities || []) {
      const tile = tileMap.get(city.tileId);
      if (!tile) continue;
      const dir = tile.center.clone().normalize();
      const label = this.makeLabelSprite(city);
      label.position.copy(dir).multiplyScalar(this.landR + this.tileRadius * (city.type === 'capital' ? 2.4 : 1.7));
      this.mapGroup.add(label);
      this.labels.push({ sprite: label, normal: dir });
    }
  }

  buildMovers(mapData) {
    this.movers = [];
    const tr = this.tileRadius;
    const rng = mulberry32((mapData.seed || 1) + 99);
    const spawn = (geo, curve, group, scale, speed, count) => {
      if (!geo) return;
      const length = curve.getLength();
      for (let i = 0; i < count; i++) {
        const mesh = new THREE.Mesh(geo, this.propMaterial);
        mesh.scale.setScalar(scale);
        group.add(mesh);
        this.movers.push({ mesh, curve, length, speed, offset: rng() * 2 });
      }
    };
    this.landCurves.forEach(({ curve }) => spawn(this.assets.caravan, curve, this.groundRouteGroup, tr * 0.5, 0.25, 1));
    this.seaCurves.forEach(({ curve }) => spawn(this.assets.ship, curve, this.seaRouteGroup, tr * 0.8, 0.35, 2));
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
    this.airPulses = [];
    this.movers = [];
    this.labels = [];
    this.chunks = [];
    this.animatedMaterials = [];
    this.airCurve = null;
    this.landCurves = [];
    this.seaCurves = [];
    this.hoveredTile = null;
    if (this.hoverIndicatorMesh) this.hoverIndicatorMesh.visible = false;
  }

  // ------------------------------------------------------------------
  // INTERACTION
  // ------------------------------------------------------------------

  onPointerUp(e) {
    const press = this.pressAt;
    this.pressAt = null;
    if (!press || Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) return;
    if (this.hoveredTile && this.onTileSelect) {
      this.selectedTile = this.hoveredTile;
      this.onTileSelect(this.selectedTile);
    }
  }

  /** Pointer work is coalesced to once per frame. */
  processPointer() {
    const event = this.pendingPointer;
    this.pendingPointer = null;
    if (!event) return;
    if (event.leave) {
      this.setHovered(null);
      return;
    }
    const rect = this.renderer.domElement.getBoundingClientRect();
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
    const corners = tile.corners;
    const r = (isWater(tile) ? this.waterR : this.landR) + 0.01;
    const attr = this.hoverIndicatorMesh.geometry.attributes.position;
    for (let i = 0; i <= corners.length; i++) {
      const c = corners[i % corners.length];
      attr.setXYZ(i, c.x * r, c.y * r, c.z * r);
    }
    attr.needsUpdate = true;
    this.hoverIndicatorMesh.geometry.setDrawRange(0, corners.length + 1);
    this.hoverIndicatorMesh.geometry.computeBoundingSphere();
    this.hoverIndicatorMesh.visible = true;
  }

  onWindowResize() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.frameGlobe(width, height);
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
    const close = dist < this.radius * LOD_DISTANCE;
    for (const chunk of this.chunks) {
      const angle = Math.acos(THREE.MathUtils.clamp(chunk.normal.dot(camLocal), -1, 1));
      chunk.group.visible = angle - chunk.spread < horizon;
      chunk.detail.visible = showDetail;
      chunk.near.visible = close;
      chunk.far.visible = !close;
    }

    if (this.cloudsMesh) {
      // Clouds clear away as the camera dives in
      const o = 0.4 * THREE.MathUtils.smoothstep(dist, this.radius * 1.35, this.radius * 1.9);
      this.cloudsMesh.material.opacity = o;
      this.cloudsMesh.visible = o > 0.01;
    }

    for (const { sprite, normal } of this.labels) {
      const facing = _v2.copy(normal).applyQuaternion(this.planetGroup.quaternion).dot(camWorld);
      const o = THREE.MathUtils.smoothstep(facing, 0.32, 0.5);
      sprite.material.opacity = o;
      sprite.visible = o > 0.01;
    }
  }

  animate(timestamp) {
    requestAnimationFrame(this.animate);
    const t = (this.animTime = timestamp * 0.001);

    this.controls.update();
    if (this.autoRotate) this.planetGroup.rotation.y += 0.002;
    if (this.cloudsMesh) this.cloudsMesh.rotation.y += 0.0004;

    this.processPointer();
    this.updateVisibility();
    this.animatedMaterials.forEach((fn) => fn(t));

    if (this.showAirRoute && this.airPulses.length && this.airCurve) {
      const prog = (t * 0.28) % 1.0;
      for (const pulse of this.airPulses) {
        const p = (prog + pulse.userData.offset) % 1.0;
        this.airCurve.getPointAt(p, pulse.position);
        pulse.scale.setScalar(0.8 + Math.sin(p * Math.PI) * 0.5);
      }
    }

    for (const m of this.movers) {
      if (m.mesh.parent?.visible) this.updateMover(m, t);
    }

    this.renderer.render(this.scene, this.camera);
  }

  resetCamera() {
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
