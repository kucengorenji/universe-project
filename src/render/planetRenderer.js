import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BIOMES } from '../map/mapGenerator.js';

export class PlanetRenderer {
  constructor(containerElement, hexasphere) {
    this.container = containerElement;
    this.hexasphere = hexasphere;
    this.radius = hexasphere.radius;

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.planetGroup = null;
    this.bordersGroup = null;
    this.riversGroup = null;
    this.airRouteGroup = null;
    this.groundRouteGroup = null;
    this.decorationsGroup = null;
    this.cloudsMesh = null;
    this.colliderMesh = null;
    this.hoverIndicatorMesh = null;

    this.showAirRoute = true;
    this.showGroundRoute = true;
    this.airCurve = null;
    this.groundCurve = null;
    this.airPulses = [];
    this.groundPulses = [];

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2(-999, -999);
    this.hoveredTile = null;
    this.selectedTile = null;

    this.autoRotate = false;
    this.animTime = 0;

    // Callbacks for UI
    this.onTileHover = null;
    this.onTileSelect = null;

    this.init();
  }

  init() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    // 1. Scene
    this.scene = new THREE.Scene();

    // 2. Camera: Compute distance so planet fills ~75% horizontally on 16:9 screen
    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 1000);
    this.adjustCameraFor75PercentWidth(width, height);

    // 3. Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.container.appendChild(this.renderer.domElement);

    // 4. OrbitControls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.rotateSpeed = 0.8;
    this.controls.zoomSpeed = 1.1;
    this.controls.minDistance = this.radius * 1.15;
    this.controls.maxDistance = this.radius * 3.5;
    this.controls.enablePan = false;

    // 5. Lighting
    this.setupLighting();

    // 6. Hierarchy Groups
    this.planetGroup = new THREE.Group();
    this.scene.add(this.planetGroup);

    this.riversGroup = new THREE.Group();
    this.planetGroup.add(this.riversGroup);

    this.bordersGroup = new THREE.Group();
    this.planetGroup.add(this.bordersGroup);

    this.airRouteGroup = new THREE.Group();
    this.planetGroup.add(this.airRouteGroup);

    this.groundRouteGroup = new THREE.Group();
    this.planetGroup.add(this.groundRouteGroup);

    this.decorationsGroup = new THREE.Group();
    this.planetGroup.add(this.decorationsGroup);

    // 7. Background Cosmic Ambiance, Atmosphere & Clouds
    this.createBackgroundAndAtmosphere();
    this.createCloudLayer();

    // 8. Invisible Sphere Collider for Ultra-Fast Spatial Raycasting (10k tiles in <1ms)
    const colliderGeo = new THREE.SphereGeometry(this.radius * 1.03, 32, 32);
    const colliderMat = new THREE.MeshBasicMaterial({ visible: false });
    this.colliderMesh = new THREE.Mesh(colliderGeo, colliderMat);
    this.scene.add(this.colliderMesh);

    // 9. Dynamic Hover Indicator Mesh
    this.createHoverIndicator();

    // 10. Event Listeners
    window.addEventListener('resize', this.onWindowResize.bind(this));
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove.bind(this));
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown.bind(this));

    // 11. Animation Loop
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  adjustCameraFor75PercentWidth(width, height) {
    const aspect = width / height;
    const vFovRad = (this.camera.fov * Math.PI) / 180;
    const tanHalfFov = Math.tan(vFovRad / 2);

    const targetDistance = (4 * this.radius) / (3 * aspect * tanHalfFov);
    const distance = Math.max(this.radius * 1.35, Math.min(targetDistance, this.radius * 2.8));

    const currentDir = this.camera.position.clone().normalize();
    if (currentDir.lengthSq() < 0.1) {
      this.camera.position.set(0, distance * 0.35, distance * 0.93);
    } else {
      this.camera.position.copy(currentDir.multiplyScalar(distance));
    }

    this.camera.lookAt(0, 0, 0);
    if (this.controls) {
      this.controls.target.set(0, 0, 0);
      this.controls.update();
    }
  }

  setupLighting() {
    const ambientLight = new THREE.AmbientLight(0xdbe7f8, 0.95);
    this.scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xfff8ee, 2.3);
    sunLight.position.set(40, 25, 35);
    this.scene.add(sunLight);

    const rimLight = new THREE.DirectionalLight(0x2885f6, 1.4);
    rimLight.position.set(-35, -20, -30);
    this.scene.add(rimLight);

    const topLight = new THREE.DirectionalLight(0x7ec8ff, 0.65);
    topLight.position.set(0, 50, 0);
    this.scene.add(topLight);
  }

  createBackgroundAndAtmosphere() {
    const atmoGeo = new THREE.SphereGeometry(this.radius * 1.055, 64, 64);
    const atmoMat = new THREE.ShaderMaterial({
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
          vec3 viewDir = normalize(-vPosition);
          float fresnel = dot(viewDir, vNormal);
          fresnel = clamp(1.0 - fresnel, 0.0, 1.0);
          float intensity = pow(fresnel, 2.8) * 0.95;
          vec3 atmoColor = mix(vec3(0.06, 0.35, 0.85), vec3(0.35, 0.78, 1.0), fresnel);
          gl_FragColor = vec4(atmoColor, intensity * 0.8);
        }
      `,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false
    });
    this.atmosphereMesh = new THREE.Mesh(atmoGeo, atmoMat);
    this.scene.add(this.atmosphereMesh);

    const starCount = 800;
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(starCount * 3);
    const starColors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      const r = 90 + Math.random() * 45;

      const sinPhi = Math.sin(phi);
      starPos[i * 3] = r * sinPhi * Math.cos(theta);
      starPos[i * 3 + 1] = r * sinPhi * Math.sin(theta);
      starPos[i * 3 + 2] = r * Math.cos(phi);

      const shade = 0.6 + Math.random() * 0.4;
      starColors[i * 3] = shade * 0.82;
      starColors[i * 3 + 1] = shade * 0.9;
      starColors[i * 3 + 2] = shade;
    }

    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));

    const starMat = new THREE.PointsMaterial({
      size: 1.1,
      vertexColors: true,
      transparent: true,
      opacity: 0.75
    });
    this.scene.add(new THREE.Points(starGeo, starMat));
  }

  createCloudLayer() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'rgba(0, 0, 0, 0)';
    ctx.fillRect(0, 0, 512, 256);

    for (let i = 0; i < 52; i++) {
      const x = Math.random() * 512;
      const y = 30 + Math.random() * 196;
      const radius = 25 + Math.random() * 45;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.42)');
      grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.22)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    const cloudTex = new THREE.CanvasTexture(canvas);
    cloudTex.wrapS = THREE.RepeatWrapping;
    cloudTex.wrapT = THREE.ClampToEdgeWrapping;

    const cloudGeo = new THREE.SphereGeometry(this.radius * 1.036, 48, 48);
    const cloudMat = new THREE.MeshStandardMaterial({
      map: cloudTex,
      transparent: true,
      opacity: 0.55,
      roughness: 1.0,
      depthWrite: false
    });

    this.cloudsMesh = new THREE.Mesh(cloudGeo, cloudMat);
    this.planetGroup.add(this.cloudsMesh);
  }

  createHoverIndicator() {
    const hexLineGeo = new THREE.BufferGeometry();
    const dummyPos = new Float32Array(7 * 3);
    hexLineGeo.setAttribute('position', new THREE.BufferAttribute(dummyPos, 3));

    const hexLineMat = new THREE.LineBasicMaterial({
      color: 0xfff380,
      linewidth: 3,
      transparent: true,
      opacity: 0.95
    });

    this.hoverIndicatorMesh = new THREE.Line(hexLineGeo, hexLineMat);
    this.hoverIndicatorMesh.visible = false;
    this.planetGroup.add(this.hoverIndicatorMesh);
  }

  buildPlanet(mapData) {
    this.clearPlanet();

    const tiles = this.hexasphere.tiles;
    const R = this.radius;

    // Palette with vibrant, rich blues for the ocean (zero blackness)
    const colors = {
      oceanShallow: new THREE.Color(0x22bce2), // Biru muda cerah / cyan toska di pesisir
      oceanMedium: new THREE.Color(0x166cb8),  // Biru samudra royal yang hidup
      oceanDeep: new THREE.Color(0x0e3f78),    // Biru tua palung yang pekat & kaya (bukan hitam)
      plains: new THREE.Color(0x4b8e35),
      forest: new THREE.Color(0x1f592c),
      mountain: new THREE.Color(0x6f334c), // Burgundy / plum craggy stone
      mountainPeak: new THREE.Color(0x8c4664),
      snow: new THREE.Color(0xf1f5f9),
      savannah: new THREE.Color(0xbfa152),
      tundra: new THREE.Color(0xdcebf2),
      river: new THREE.Color(0x38bdf8),
      playerTint: new THREE.Color(0x00f0ff),
      systemTint: new THREE.Color(0xff007f)
    };

    // 1. Merged Terrain Meshes with depth gradient & seamless ocean
    this.buildMergedTerrainMeshes(tiles, R, colors);

    // 2. Rounded Borders with corner filleting
    this.buildSmoothTerritoryBorders(tiles, R);

    // 3. Smooth Organic Rivers
    this.buildSmoothRivers(mapData.riverPaths, R);

    // 4. Stylized 3D Props (scaled for 10k grid)
    this.buildInstancedDecorations(tiles, R, colors);

    // 5. Build BOTH Sky Route & Surface Route between Capitals
    if (mapData.player?.capitalId !== undefined && mapData.system?.capitalId !== undefined) {
      this.buildCapitalConnection(mapData.player.capitalId, mapData.system.capitalId, R);
    }
  }

  buildMergedTerrainMeshes(tiles, R, colors) {
    const landPositions = [];
    const landColors = [];
    const landNormals = [];

    const oceanPositions = [];
    const oceanColors = [];
    const oceanNormals = [];

    // Underlying Bedrock Sphere (rich navy marine tone, prevents any void)
    const bedrockGeo = new THREE.SphereGeometry(R * 0.978, 48, 48);
    const bedrockMat = new THREE.MeshStandardMaterial({
      color: 0x0a2e56, // Deep marine blue
      roughness: 0.7,
      metalness: 0.2
    });
    const bedrockMesh = new THREE.Mesh(bedrockGeo, bedrockMat);
    bedrockMesh.name = 'bedrockSphere';
    this.planetGroup.add(bedrockMesh);

    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      const isOcean = tile.biome === BIOMES.OCEAN || tile.biome === BIOMES.OCEAN_DEEP;

      // Ocean tiles touch completely (1.0 = seamless), land has snug fit (0.996)
      const insetFactor = isOcean ? 1.0 : 0.996;

      let rTop = R;
      let rBottom = R * 0.978;

      if (tile.biome === BIOMES.OCEAN_DEEP) {
        rTop = R * 0.985;
      } else if (tile.biome === BIOMES.OCEAN) {
        rTop = R * 0.988;
      } else if (tile.biome === BIOMES.PLAINS) {
        rTop = R * (1.0 + Math.max(0, tile.elevation) * 0.035);
      } else if (tile.biome === BIOMES.FOREST) {
        rTop = R * (1.008 + Math.max(0, tile.elevation) * 0.035);
      } else if (tile.biome === BIOMES.MOUNTAIN) {
        rTop = R * (1.02 + Math.max(0, tile.elevation) * 0.05);
      } else if (tile.biome === BIOMES.SAVANNAH) {
        rTop = R * (1.002 + Math.max(0, tile.elevation) * 0.03);
      } else if (tile.biome === BIOMES.TUNDRA) {
        rTop = R * (1.005 + Math.max(0, tile.elevation) * 0.03);
      }

      tile.worldElevation = rTop;

      const center = tile.center;
      const cornerCount = tile.corners.length;

      const topCorners = tile.corners.map((c) => {
        return new THREE.Vector3().lerpVectors(center, c, insetFactor).normalize().multiplyScalar(rTop);
      });
      const bottomCorners = tile.corners.map((c) => {
        return new THREE.Vector3().lerpVectors(center, c, insetFactor).normalize().multiplyScalar(rBottom);
      });
      const topCenter = center.clone().multiplyScalar(rTop);

      // Color selection with vibrant ocean depth gradient (biru muda -> biru tua, NO black!)
      let baseColor;
      if (isOcean) {
        const depth = THREE.MathUtils.clamp((-tile.elevation) / 0.35, 0.0, 1.0);
        if (depth < 0.4) {
          baseColor = colors.oceanShallow.clone().lerp(colors.oceanMedium, depth / 0.4);
        } else {
          baseColor = colors.oceanMedium.clone().lerp(colors.oceanDeep, (depth - 0.4) / 0.6);
        }
      } else if (tile.biome === BIOMES.FOREST) {
        baseColor = colors.forest;
      } else if (tile.biome === BIOMES.MOUNTAIN) {
        baseColor = colors.mountain;
      } else if (tile.biome === BIOMES.SAVANNAH) {
        baseColor = colors.savannah;
      } else if (tile.biome === BIOMES.TUNDRA) {
        baseColor = colors.tundra;
      } else {
        baseColor = colors.plains;
      }

      let finalColor = baseColor.clone();
      if (tile.owner === 'player') {
        finalColor.lerp(colors.playerTint, 0.25);
      } else if (tile.owner === 'system') {
        finalColor.lerp(colors.systemTint, 0.25);
      }

      const targetPos = isOcean ? oceanPositions : landPositions;
      const targetCol = isOcean ? oceanColors : landColors;
      const targetNorm = isOcean ? oceanNormals : landNormals;

      // Top cap triangles
      for (let c = 0; c < cornerCount; c++) {
        const next = (c + 1) % cornerCount;
        const c1 = topCorners[c];
        const c2 = topCorners[next];

        const e1 = new THREE.Vector3().subVectors(c1, topCenter);
        const e2 = new THREE.Vector3().subVectors(c2, topCenter);
        const normal = new THREE.Vector3().crossVectors(e1, e2).normalize();

        targetPos.push(topCenter.x, topCenter.y, topCenter.z);
        targetPos.push(c1.x, c1.y, c1.z);
        targetPos.push(c2.x, c2.y, c2.z);

        for (let k = 0; k < 3; k++) {
          targetNorm.push(normal.x, normal.y, normal.z);
          targetCol.push(finalColor.r, finalColor.g, finalColor.b);
        }
      }

      // Physical 3D side skirts for land tiles
      if (!isOcean) {
        const sideColor = finalColor.clone().multiplyScalar(0.72);
        for (let c = 0; c < cornerCount; c++) {
          const next = (c + 1) % cornerCount;
          const t1 = topCorners[c];
          const t2 = topCorners[next];
          const b1 = bottomCorners[c];
          const b2 = bottomCorners[next];

          targetPos.push(t1.x, t1.y, t1.z);
          targetPos.push(b1.x, b1.y, b1.z);
          targetPos.push(t2.x, t2.y, t2.z);

          targetPos.push(t2.x, t2.y, t2.z);
          targetPos.push(b1.x, b1.y, b1.z);
          targetPos.push(b2.x, b2.y, b2.z);

          const edgeA = new THREE.Vector3().subVectors(b1, t1);
          const edgeB = new THREE.Vector3().subVectors(t2, t1);
          const sideNormal = new THREE.Vector3().crossVectors(edgeB, edgeA).normalize();

          for (let k = 0; k < 6; k++) {
            targetNorm.push(sideNormal.x, sideNormal.y, sideNormal.z);
            targetCol.push(sideColor.r, sideColor.g, sideColor.b);
          }
        }
      }
    }

    // Land Mesh
    if (landPositions.length > 0) {
      const landGeo = new THREE.BufferGeometry();
      landGeo.setAttribute('position', new THREE.Float32BufferAttribute(landPositions, 3));
      landGeo.setAttribute('color', new THREE.Float32BufferAttribute(landColors, 3));
      landGeo.setAttribute('normal', new THREE.Float32BufferAttribute(landNormals, 3));

      const landMat = new THREE.MeshStandardMaterial({
        roughness: 0.8,
        metalness: 0.1,
        vertexColors: true,
        flatShading: true
      });
      const landMesh = new THREE.Mesh(landGeo, landMat);
      landMesh.name = 'landMesh';
      this.planetGroup.add(landMesh);
    }

    // Ocean Mesh (seamless, vibrant blue surface)
    if (oceanPositions.length > 0) {
      const oceanGeo = new THREE.BufferGeometry();
      oceanGeo.setAttribute('position', new THREE.Float32BufferAttribute(oceanPositions, 3));
      oceanGeo.setAttribute('color', new THREE.Float32BufferAttribute(oceanColors, 3));
      oceanGeo.setAttribute('normal', new THREE.Float32BufferAttribute(oceanNormals, 3));

      const oceanMat = new THREE.MeshStandardMaterial({
        roughness: 0.22,
        metalness: 0.38,
        vertexColors: true,
        transparent: true,
        opacity: 0.96,
        flatShading: true
      });
      const oceanMesh = new THREE.Mesh(oceanGeo, oceanMat);
      oceanMesh.name = 'oceanMesh';
      this.planetGroup.add(oceanMesh);
    }

    // Draw subtle dark brown/earthy border lines ONLY on land
    const landLinePositions = [];
    const landLineColors = [];
    const processedEdgeKeys = new Set();

    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      const isOceanA = tile.biome === BIOMES.OCEAN || tile.biome === BIOMES.OCEAN_DEEP;

      for (const nId of tile.neighbors) {
        const neighbor = this.hexasphere.tileMap.get(nId);
        if (!neighbor) continue;
        const isOceanB = neighbor.biome === BIOMES.OCEAN || neighbor.biome === BIOMES.OCEAN_DEEP;

        // Skip completely if both are ocean
        if (isOceanA && isOceanB) continue;

        const edgeKey = tile.id < nId ? `${tile.id}_${nId}` : `${nId}_${tile.id}`;
        if (processedEdgeKeys.has(edgeKey)) continue;
        processedEdgeKeys.add(edgeKey);

        const sharedCorners = tile.cornerIndices.filter((c) => neighbor.cornerIndices.includes(c));
        if (sharedCorners.length === 2) {
          const rLine = Math.max(tile.worldElevation || R, neighbor.worldElevation || R) * 1.0012;
          const p1 = this.hexasphere.globalCorners[sharedCorners[0]].clone().normalize().multiplyScalar(rLine);
          const p2 = this.hexasphere.globalCorners[sharedCorners[1]].clone().normalize().multiplyScalar(rLine);

          landLinePositions.push(p1.x, p1.y, p1.z);
          landLinePositions.push(p2.x, p2.y, p2.z);

          let lineColor;
          if (tile.biome === BIOMES.SAVANNAH || neighbor.biome === BIOMES.SAVANNAH) {
            lineColor = new THREE.Color(0x3e2815);
          } else if (tile.biome === BIOMES.MOUNTAIN || neighbor.biome === BIOMES.MOUNTAIN) {
            lineColor = new THREE.Color(0x3a1e2b);
          } else if (tile.biome === BIOMES.TUNDRA || neighbor.biome === BIOMES.TUNDRA) {
            lineColor = new THREE.Color(0x283842);
          } else {
            lineColor = new THREE.Color(0x261d15);
          }

          for (let k = 0; k < 2; k++) {
            landLineColors.push(lineColor.r, lineColor.g, lineColor.b);
          }
        }
      }
    }

    if (landLinePositions.length > 0) {
      const linesGeo = new THREE.BufferGeometry();
      linesGeo.setAttribute('position', new THREE.Float32BufferAttribute(landLinePositions, 3));
      linesGeo.setAttribute('color', new THREE.Float32BufferAttribute(landLineColors, 3));

      const linesMat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.6
      });
      const gridMesh = new THREE.LineSegments(linesGeo, linesMat);
      gridMesh.name = 'hexGridLines';
      this.planetGroup.add(gridMesh);
    }
  }

  buildSmoothTerritoryBorders(tiles, R) {
    while (this.bordersGroup.children.length > 0) {
      const obj = this.bordersGroup.children.pop();
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }

    this.createRoundedBorderForOwner('player', 0x00f0ff, R);
    this.createRoundedBorderForOwner('system', 0xff007f, R);
  }

  createRoundedBorderForOwner(ownerKey, hexColor, R) {
    const tiles = this.hexasphere.tiles;
    const borderEdges = [];
    const edgeSet = new Set();

    tiles.forEach((tile) => {
      if (tile.owner !== ownerKey) return;

      for (const nId of tile.neighbors) {
        const neighbor = this.hexasphere.tileMap.get(nId);
        if (!neighbor || neighbor.owner === ownerKey) continue;

        const shared = tile.cornerIndices.filter((c) => neighbor.cornerIndices.includes(c));
        if (shared.length === 2) {
          const key = shared[0] < shared[1] ? `${shared[0]}_${shared[1]}` : `${shared[1]}_${shared[0]}`;
          if (!edgeSet.has(key)) {
            edgeSet.add(key);
            borderEdges.push([shared[0], shared[1]]);
          }
        }
      }
    });

    if (borderEdges.length === 0) return;

    const adj = new Map();
    for (const [u, v] of borderEdges) {
      if (!adj.has(u)) adj.set(u, []);
      if (!adj.has(v)) adj.set(v, []);
      adj.get(u).push(v);
      adj.get(v).push(u);
    }

    const visited = new Set();
    const loops = [];

    for (const [startVertex] of adj) {
      if (visited.has(startVertex)) continue;

      const loop = [startVertex];
      visited.add(startVertex);
      let curr = startVertex;
      let prev = null;

      while (curr !== undefined) {
        const neighbors = adj.get(curr) || [];
        const next = neighbors.find((n) => n !== prev && (!visited.has(n) || (n === startVertex && loop.length > 2)));

        if (next === startVertex) break;

        if (next !== undefined && !visited.has(next)) {
          visited.add(next);
          loop.push(next);
          prev = curr;
          curr = next;
        } else {
          break;
        }
      }

      if (loop.length >= 3) {
        loops.push(loop);
      }
    }

    const filletRatio = 0.36;
    const arcSteps = 3;

    const borderMaterial = new THREE.MeshStandardMaterial({
      color: hexColor,
      emissive: hexColor,
      emissiveIntensity: 1.3,
      roughness: 0.25,
      metalness: 0.3
    });

    loops.forEach((loop) => {
      const N = loop.length;
      const smoothedPoints = [];

      for (let i = 0; i < N; i++) {
        const prevIdx = (i - 1 + N) % N;
        const nextIdx = (i + 1) % N;

        const P_prev = this.hexasphere.globalCorners[loop[prevIdx]];
        const P_curr = this.hexasphere.globalCorners[loop[i]];
        const P_next = this.hexasphere.globalCorners[loop[nextIdx]];

        const A = new THREE.Vector3().lerpVectors(P_curr, P_prev, filletRatio);
        const B = new THREE.Vector3().lerpVectors(P_curr, P_next, filletRatio);

        for (let s = 0; s <= arcSteps; s++) {
          const t = s / arcSteps;
          const pt = new THREE.Vector3()
            .copy(A)
            .multiplyScalar((1 - t) * (1 - t))
            .addScaledVector(P_curr, 2 * (1 - t) * t)
            .addScaledVector(B, t * t)
            .normalize()
            .multiplyScalar(R * 1.018);

          smoothedPoints.push(pt);
        }
      }

      if (smoothedPoints.length >= 6) {
        const borderTubeRadius = {
          2: 0.055,
          3: 0.038,
          4: 0.026,
          5: 0.020
        }[this.hexasphere?.subdivision] || 0.020;
        const closedCurve = new THREE.CatmullRomCurve3(smoothedPoints, true);
        const tubeGeo = new THREE.TubeGeometry(closedCurve, smoothedPoints.length * 2, borderTubeRadius, 5, true);
        const tubeMesh = new THREE.Mesh(tubeGeo, borderMaterial);
        this.bordersGroup.add(tubeMesh);
      }
    });
  }

  buildSmoothRivers(riverPaths, R) {
    while (this.riversGroup.children.length > 0) {
      const obj = this.riversGroup.children.pop();
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }

    if (!riverPaths || riverPaths.length === 0) return;

    const riverMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x1d75b3,
      emissiveIntensity: 0.5,
      roughness: 0.2,
      metalness: 0.35
    });

    riverPaths.forEach((path, pathIdx) => {
      const rawPoints = [];

      for (let i = 0; i < path.length; i++) {
        const tile = this.hexasphere.tileMap.get(path[i]);
        if (!tile) continue;

        const p1 = tile.center.clone().normalize().multiplyScalar(R * 1.006);
        rawPoints.push(p1);

        if (i < path.length - 1) {
          const nextTile = this.hexasphere.tileMap.get(path[i + 1]);
          if (nextTile) {
            const p2 = nextTile.center.clone().normalize().multiplyScalar(R * 1.006);
            const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);

            const flowDir = new THREE.Vector3().subVectors(p2, p1).normalize();
            const normal = mid.clone().normalize();
            const lateral = new THREE.Vector3().crossVectors(normal, flowDir).normalize();
            const meanderAmount = ((pathIdx + i) % 2 === 0 ? 0.05 : -0.05) * (0.8 + ((i * 13) % 5) * 0.1);

            mid.addScaledVector(lateral, meanderAmount).normalize().multiplyScalar(R * 1.006);
            rawPoints.push(mid);
          }
        }
      }

      if (rawPoints.length >= 4) {
        const riverTubeRadius = {
          2: 0.045,
          3: 0.030,
          4: 0.020,
          5: 0.014
        }[this.hexasphere?.subdivision] || 0.014;
        const curve = new THREE.CatmullRomCurve3(rawPoints, false, 'centripetal', 0.5);
        const tubeGeo = new THREE.TubeGeometry(curve, rawPoints.length * 3, riverTubeRadius, 4, false);
        const tubeMesh = new THREE.Mesh(tubeGeo, riverMat);
        this.riversGroup.add(tubeMesh);
      }
    });
  }

  buildInstancedDecorations(tiles, R, colors) {
    while (this.decorationsGroup.children.length > 0) {
      const child = this.decorationsGroup.children.pop();
      child.traverse((n) => {
        if (n.geometry) n.geometry.dispose();
        if (n.material) {
          if (Array.isArray(n.material)) n.material.forEach((m) => m.dispose());
          else n.material.dispose();
        }
      });
    }

    const scaleFactor = {
      2: 3.2,
      3: 2.0,
      4: 1.4,
      5: 1.0
    }[this.hexasphere?.subdivision] || 1.0;

    const mtnGroup = new THREE.Group();
    const treeGroup = new THREE.Group();
    const cityGroup = new THREE.Group();

    const plumMat = new THREE.MeshStandardMaterial({
      color: 0x6e3149,
      roughness: 0.85,
      metalness: 0.1,
      flatShading: true
    });
    const snowMat = new THREE.MeshStandardMaterial({
      color: 0xf5f8fa,
      roughness: 0.55,
      flatShading: true
    });
    const treeMat = new THREE.MeshStandardMaterial({
      color: 0x225e2d,
      roughness: 0.8,
      flatShading: true
    });
    const treeMatLight = new THREE.MeshStandardMaterial({
      color: 0x2e753b,
      roughness: 0.8,
      flatShading: true
    });

    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      const normal = tile.center.clone().normalize();
      const absLat = Math.abs(tile.center.y);

      // 1. Mountain: Burgundy / Plum craggy peaks (scaled by subdivision)
      if (tile.biome === BIOMES.MOUNTAIN) {
        const peakPos = tile.center.clone().normalize().multiplyScalar(R * 1.018);
        const height = (0.24 + tile.elevation * 0.28) * scaleFactor;
        const radiusBase = 0.11 * scaleFactor;

        const coneGeo = new THREE.ConeGeometry(radiusBase, height, 5);
        const mtnMesh = new THREE.Mesh(coneGeo, plumMat);
        mtnMesh.position.copy(peakPos);
        mtnMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
        mtnMesh.translateY(height * 0.42);
        mtnGroup.add(mtnMesh);

        if (tile.elevation > 0.42 || absLat > 0.6) {
          const snowGeo = new THREE.ConeGeometry(radiusBase * 0.42, height * 0.35, 5);
          const snowMesh = new THREE.Mesh(snowGeo, snowMat);
          snowMesh.position.copy(peakPos);
          snowMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
          snowMesh.translateY(height * 0.78);
          mtnGroup.add(snowMesh);
        }
      }

      // 2. Forest: Puffy Canopy Tree Clusters
      else if (tile.biome === BIOMES.FOREST && tile.id % 2 === 0) {
        const pos = this.getPointOnTile(tile, 0, 0.08 * scaleFactor, R * 1.01);
        const canopyGeo = new THREE.DodecahedronGeometry(0.065 * scaleFactor, 0);
        const cMesh = new THREE.Mesh(canopyGeo, tile.id % 4 === 0 ? treeMat : treeMatLight);
        cMesh.position.copy(pos);
        cMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
        cMesh.translateY(0.065 * scaleFactor);
        treeGroup.add(cMesh);
      }

      // 3. Capital City: Sci-Fi Colony Hub
      if (tile.isCapital) {
        const isPlayer = tile.capitalOf === 'player';
        const cityColor = isPlayer ? 0x00f0ff : 0xff007f;
        const cityPos = tile.center.clone().normalize().multiplyScalar(R * 1.015);

        // Central Biodome
        const domeGeo = new THREE.SphereGeometry(0.18 * scaleFactor, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.5);
        const domeMat = new THREE.MeshStandardMaterial({
          color: 0xd8e4ec,
          roughness: 0.25,
          metalness: 0.5,
          flatShading: true
        });
        const domeMesh = new THREE.Mesh(domeGeo, domeMat);
        domeMesh.position.copy(cityPos);
        domeMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
        cityGroup.add(domeMesh);

        // Concentric Tech Ring
        const ringGeo = new THREE.RingGeometry(0.22 * scaleFactor, 0.32 * scaleFactor, 16);
        const ringMat = new THREE.MeshBasicMaterial({
          color: cityColor,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.85
        });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.position.copy(cityPos);
        ringMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
        ringMesh.translateZ(0.02);
        cityGroup.add(ringMesh);

        // Holographic Beam
        const beamGeo = new THREE.CylinderGeometry(0.014 * scaleFactor, 0.035 * scaleFactor, 1.2 * scaleFactor, 8, 1, true);
        const beamMat = new THREE.MeshBasicMaterial({
          color: cityColor,
          transparent: true,
          opacity: 0.85,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide
        });
        const beamMesh = new THREE.Mesh(beamGeo, beamMat);
        beamMesh.position.copy(cityPos);
        beamMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
        beamMesh.translateY(0.6 * scaleFactor);
        cityGroup.add(beamMesh);
      }
    }

    this.decorationsGroup.add(mtnGroup);
    this.decorationsGroup.add(treeGroup);
    this.decorationsGroup.add(cityGroup);
  }

  getPointOnTile(tile, angle, distanceFactor, radius) {
    const normal = tile.center.clone().normalize();
    let tangent = new THREE.Vector3(0, 1, 0);
    if (Math.abs(normal.y) > 0.9) tangent = new THREE.Vector3(1, 0, 0);

    const u = new THREE.Vector3().crossVectors(normal, tangent).normalize();
    const v = new THREE.Vector3().crossVectors(normal, u).normalize();

    const offsetDir = new THREE.Vector3()
      .addScaledVector(u, Math.cos(angle))
      .addScaledVector(v, Math.sin(angle))
      .multiplyScalar(distanceFactor);

    return new THREE.Vector3().addVectors(tile.center, offsetDir).normalize().multiplyScalar(radius);
  }

  /**
   * USER REQUEST:
   * "fix line udara dan darat antar ibukota player dan npc. lalu bikin toggle untuk show hide line jalur darat/udara itu."
   */
  buildCapitalConnection(playerCapId, systemCapId, R) {
    // 1. Clear previous routes
    while (this.airRouteGroup.children.length > 0) {
      const obj = this.airRouteGroup.children.pop();
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }
    while (this.groundRouteGroup.children.length > 0) {
      const obj = this.groundRouteGroup.children.pop();
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }
    this.airPulses = [];
    this.groundPulses = [];

    const tPlayer = this.hexasphere.tileMap.get(playerCapId);
    const tSystem = this.hexasphere.tileMap.get(systemCapId);
    if (!tPlayer || !tSystem) return;

    const startCenter = tPlayer.center.clone().normalize();
    const endCenter = tSystem.center.clone().normalize();

    // -------------------------------------------------------------
    // ROUTE 1: JALUR UDARA (Air / Sky Route) - Stratospheric High Arc
    // -------------------------------------------------------------
    const airPoints = [];
    const airSegments = 64;
    const maxArcHeight = R * 0.25;

    for (let i = 0; i <= airSegments; i++) {
      const t = i / airSegments;
      const ptOnSphere = new THREE.Vector3().lerpVectors(startCenter, endCenter, t).normalize();
      const heightBoost = Math.sin(t * Math.PI) * maxArcHeight;
      const pos = ptOnSphere.multiplyScalar(R * 1.018 + heightBoost);
      airPoints.push(pos);
    }

    this.airCurve = new THREE.CatmullRomCurve3(airPoints);

    const airTubeGeo = new THREE.TubeGeometry(this.airCurve, 64, 0.024, 6, false);
    const airTubeMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending
    });
    const airMesh = new THREE.Mesh(airTubeGeo, airTubeMat);
    this.airRouteGroup.add(airMesh);

    // Cyan air transport energy pulses
    for (let i = 0; i < 3; i++) {
      const pulseGeo = new THREE.SphereGeometry(0.08, 10, 10);
      const pulseMat = new THREE.MeshBasicMaterial({
        color: 0x70f5ff,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending
      });
      const pulseMesh = new THREE.Mesh(pulseGeo, pulseMat);
      pulseMesh.userData = { offset: i / 3 };
      this.airRouteGroup.add(pulseMesh);
      this.airPulses.push(pulseMesh);
    }

    // -------------------------------------------------------------
    // ROUTE 2: JALUR DARAT / PERMUKAAN (Surface / Ground Route) - Hugs Surface
    // -------------------------------------------------------------
    const groundPoints = [];
    const groundSegments = 80;

    for (let i = 0; i <= groundSegments; i++) {
      const t = i / groundSegments;
      // Great circle path directly hugging planet surface
      const pt = new THREE.Vector3().lerpVectors(startCenter, endCenter, t).normalize().multiplyScalar(R * 1.013);
      groundPoints.push(pt);
    }

    this.groundCurve = new THREE.CatmullRomCurve3(groundPoints);

    const groundTubeGeo = new THREE.TubeGeometry(this.groundCurve, 80, 0.016, 5, false);
    const groundTubeMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b, // Luminous golden amber
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending
    });
    const groundMesh = new THREE.Mesh(groundTubeGeo, groundTubeMat);
    this.groundRouteGroup.add(groundMesh);

    // Amber ground transport convoy pulses
    for (let i = 0; i < 3; i++) {
      const pulseGeo = new THREE.SphereGeometry(0.065, 8, 8);
      const pulseMat = new THREE.MeshBasicMaterial({
        color: 0xffe277,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending
      });
      const pulseMesh = new THREE.Mesh(pulseGeo, pulseMat);
      pulseMesh.userData = { offset: i / 3 };
      this.groundRouteGroup.add(pulseMesh);
      this.groundPulses.push(pulseMesh);
    }

    // Apply visibility state
    this.airRouteGroup.visible = this.showAirRoute;
    this.groundRouteGroup.visible = this.showGroundRoute;
  }

  setAirRouteVisible(visible) {
    this.showAirRoute = visible;
    if (this.airRouteGroup) {
      this.airRouteGroup.visible = visible;
    }
  }

  setGroundRouteVisible(visible) {
    this.showGroundRoute = visible;
    if (this.groundRouteGroup) {
      this.groundRouteGroup.visible = visible;
    }
  }

  clearPlanet() {
    const toRemove = [];
    this.planetGroup.children.forEach((c) => {
      if (
        c.name === 'landMesh' ||
        c.name === 'oceanMesh' ||
        c.name === 'hexGridLines' ||
        c.name === 'bedrockSphere'
      ) {
        toRemove.push(c);
      }
    });

    toRemove.forEach((c) => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
      this.planetGroup.remove(c);
    });

    while (this.decorationsGroup.children.length > 0) {
      const child = this.decorationsGroup.children.pop();
      child.traverse((node) => {
        if (node.geometry) node.geometry.dispose();
        if (node.material) {
          if (Array.isArray(node.material)) node.material.forEach((m) => m.dispose());
          else node.material.dispose();
        }
      });
    }

    while (this.bordersGroup.children.length > 0) {
      const child = this.bordersGroup.children.pop();
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }

    while (this.riversGroup.children.length > 0) {
      const child = this.riversGroup.children.pop();
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }

    while (this.airRouteGroup.children.length > 0) {
      const child = this.airRouteGroup.children.pop();
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }

    while (this.groundRouteGroup.children.length > 0) {
      const child = this.groundRouteGroup.children.pop();
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }

    this.airPulses = [];
    this.groundPulses = [];
    this.airCurve = null;
    this.groundCurve = null;
    if (this.hoverIndicatorMesh) this.hoverIndicatorMesh.visible = false;
  }

  onPointerMove(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.checkSpatialRaycast(event);
  }

  onPointerDown(event) {
    if (this.hoveredTile && this.onTileSelect) {
      this.selectedTile = this.hoveredTile;
      this.onTileSelect(this.selectedTile);
    }
  }

  checkSpatialRaycast(event) {
    if (!this.colliderMesh) return;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObject(this.colliderMesh, false);

    if (hits.length > 0) {
      const hitPoint = hits[0].point;
      const hitNormal = hitPoint.clone().normalize();

      let bestTile = null;
      let maxDot = -Infinity;

      const tiles = this.hexasphere.tiles;
      for (let i = 0; i < tiles.length; i++) {
        const dot = tiles[i].center.dot(hitNormal);
        if (dot > maxDot) {
          maxDot = dot;
          bestTile = tiles[i];
        }
      }

      if (this.hoveredTile !== bestTile) {
        this.hoveredTile = bestTile;
        this.updateHoverIndicator(bestTile);
        if (this.onTileHover) {
          this.onTileHover(bestTile, event.clientX, event.clientY);
        }
      } else if (this.onTileHover) {
        this.onTileHover(bestTile, event.clientX, event.clientY);
      }
    } else {
      if (this.hoveredTile !== null) {
        this.hoveredTile = null;
        if (this.hoverIndicatorMesh) this.hoverIndicatorMesh.visible = false;
        if (this.onTileHover) {
          this.onTileHover(null);
        }
      }
    }
  }

  updateHoverIndicator(tile) {
    if (!this.hoverIndicatorMesh || !tile) return;

    const corners = tile.corners;
    const cornerCount = corners.length;
    const R = this.radius * 1.022;

    const posAttr = this.hoverIndicatorMesh.geometry.attributes.position;
    const array = posAttr.array;

    for (let i = 0; i < cornerCount; i++) {
      const p = corners[i].clone().normalize().multiplyScalar(R);
      array[i * 3] = p.x;
      array[i * 3 + 1] = p.y;
      array[i * 3 + 2] = p.z;
    }
    const p0 = corners[0].clone().normalize().multiplyScalar(R);
    array[cornerCount * 3] = p0.x;
    array[cornerCount * 3 + 1] = p0.y;
    array[cornerCount * 3 + 2] = p0.z;

    posAttr.needsUpdate = true;
    this.hoverIndicatorMesh.geometry.setDrawRange(0, cornerCount + 1);
    this.hoverIndicatorMesh.visible = true;
  }

  onWindowResize() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.adjustCameraFor75PercentWidth(width, height);
    this.renderer.setSize(width, height);
  }

  animate(timestamp) {
    requestAnimationFrame(this.animate);

    this.animTime = timestamp * 0.001;

    if (this.controls) {
      this.controls.update();
    }

    if (this.autoRotate && this.planetGroup) {
      this.planetGroup.rotation.y += 0.002;
    }

    if (this.cloudsMesh) {
      this.cloudsMesh.rotation.y += 0.0005;
    }

    // Animate Air Route Pulses
    if (this.showAirRoute && this.airPulses && this.airPulses.length > 0 && this.airCurve) {
      const airProg = (this.animTime * 0.28) % 1.0;
      this.airPulses.forEach((pulse) => {
        const p = (airProg + pulse.userData.offset) % 1.0;
        const pt = this.airCurve.getPointAt(p);
        if (pt) {
          pulse.position.copy(pt);
          const scale = 0.8 + Math.sin(p * Math.PI) * 0.5;
          pulse.scale.set(scale, scale, scale);
        }
      });
    }

    // Animate Ground Route Pulses
    if (this.showGroundRoute && this.groundPulses && this.groundPulses.length > 0 && this.groundCurve) {
      const groundProg = (this.animTime * 0.18) % 1.0;
      this.groundPulses.forEach((pulse) => {
        const p = (groundProg + pulse.userData.offset) % 1.0;
        const pt = this.groundCurve.getPointAt(p);
        if (pt) {
          pulse.position.copy(pt);
          const scale = 0.75 + Math.sin(p * Math.PI) * 0.35;
          pulse.scale.set(scale, scale, scale);
        }
      });
    }

    this.renderer.render(this.scene, this.camera);
  }

  resetCamera() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.adjustCameraFor75PercentWidth(width, height);
  }
}
