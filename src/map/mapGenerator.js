import { createNoise3D } from '../math/simplex3d.js';

export const STORAGE_KEY = 'planet_globe_map_v5';

export const BIOMES = {
  OCEAN_DEEP: 'ocean_deep',
  OCEAN: 'ocean',
  COAST: 'coast', // Laut dangkal pesisir
  BEACH: 'beach', // Pantai berpasir
  PLAINS: 'plains', // Padang rumput datar
  FOREST: 'forest', // Hutan
  DESERT: 'desert', // Padang pasir
  MOUNTAIN: 'mountain', // Pegunungan
  TUNDRA: 'tundra', // Salju / kutub
  RIVER: 'river',
  CITY: 'city'
};

export const WATER_BIOMES = new Set([BIOMES.OCEAN_DEEP, BIOMES.OCEAN, BIOMES.COAST]);
export const isWater = (tile) => WATER_BIOMES.has(tile.biome);

const CITY_NAMES = [
  'Valoria', 'Eastmere', 'Solhaven', 'Kharun', 'Brightwater', 'Duneholm', 'Ironvale', 'Seabreak',
  'Thornwick', 'Amberfall', 'Mirewood', 'Stonegate', 'Coralis', 'Highcrest', 'Redcliff', 'Oakshire',
  'Saltmarsh', 'Goldreach', 'Windmoor', 'Pinehold', 'Sunspire', 'Riverend', 'Frostpeak', 'Tidewell'
];

// Land travel cost per biome (Infinity = impassable)
const LAND_COST = {
  [BIOMES.PLAINS]: 1,
  [BIOMES.BEACH]: 1.1,
  [BIOMES.DESERT]: 1.6,
  [BIOMES.FOREST]: 2,
  [BIOMES.TUNDRA]: 2.2
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class MinHeap {
  constructor() {
    this.items = [];
  }
  get size() {
    return this.items.length;
  }
  push(id, priority) {
    const a = this.items;
    a.push([priority, id]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top[1];
  }
}

// ---------------------------------------------------------------- storage format
// Per-tile data is stored column-wise (one char or one integer per tile) instead
// of one object per tile: ~10x smaller in localStorage and faster to parse.
const BIOME_CODES = Object.values(BIOMES);
const OWNER_CODES = { player: 'p', system: 's' };

function packMapData(mapData) {
  const { tilesData, ...rest } = mapData;
  const sparse = (key) => {
    const out = {};
    tilesData.forEach((t) => {
      if (t[key] !== null && t[key] !== undefined) out[t.id] = t[key];
    });
    return out;
  };
  return {
    ...rest,
    mountainRanges: undefined, // recomputed by the renderer
    packed: {
      count: tilesData.length,
      biome: tilesData.map((t) => BIOME_CODES.indexOf(t.biome).toString(36)).join(''),
      elevation: tilesData.map((t) => Math.round(t.elevation * 10000)),
      moisture: tilesData.map((t) => Math.round(t.moisture * 10000)),
      owner: tilesData.map((t) => OWNER_CODES[t.owner] || '0').join(''),
      flags: tilesData.map((t) => ((t.hasRiver ? 1 : 0) | (t.road ? 2 : 0) | (t.isCapital ? 4 : 0)).toString()).join(''),
      riverNeighborId: sparse('riverNeighborId'),
      cityIndex: sparse('cityIndex'),
      farmIndex: sparse('farmIndex')
    }
  };
}

function unpackMapData(data) {
  if (!data?.packed) return data; // already in the plain format
  const { packed, ...rest } = data;
  const owners = { p: 'player', s: 'system' };
  const tilesData = [];
  for (let id = 0; id < packed.count; id++) {
    const flags = Number(packed.flags[id]);
    const owner = owners[packed.owner[id]] || null;
    tilesData.push({
      id,
      biome: BIOME_CODES[parseInt(packed.biome[id], 36)],
      elevation: packed.elevation[id] / 10000,
      moisture: packed.moisture[id] / 10000,
      owner,
      isCapital: (flags & 4) !== 0,
      capitalOf: flags & 4 ? owner : null,
      hasRiver: (flags & 1) !== 0,
      road: (flags & 2) !== 0,
      riverNeighborId: packed.riverNeighborId[id] ?? null,
      cityIndex: packed.cityIndex[id] ?? null,
      farmIndex: packed.farmIndex[id] ?? null
    });
  }
  return { ...rest, tilesData };
}

export class MapGenerator {
  constructor(hexasphere) {
    this.hexasphere = hexasphere;
    this.tiles = hexasphere.tiles;
    this.tileMap = hexasphere.tileMap;
    this.rng = Math.random;
  }

  generate(seed = null, options = {}) {
    const finalSeed =
      seed !== null && seed !== undefined && !isNaN(Number(seed))
        ? Number(seed)
        : Math.floor(Math.random() * 900000 + 100000);
    this.rng = mulberry32(finalSeed);

    const defaultTerritorySize = {
      2: 8,
      3: 14,
      4: 28,
      5: 55
    }[this.hexasphere.subdivision] || 28;

    const opts = {
      seaLevel: options.seaLevel ?? -0.05,
      mountainThreshold: options.mountainThreshold ?? 0.36,
      forestMoisture: options.forestMoisture ?? 0.08,
      noiseScale: options.noiseScale ?? 1.6,
      territorySize: options.territorySize ?? defaultTerritorySize,
      ...options
    };

    const elevNoise = createNoise3D(finalSeed);
    const moistNoise = createNoise3D(finalSeed + 4242);
    const ridgeNoise = createNoise3D(finalSeed + 777);

    // 1. Elevation, moisture & base biomes
    for (const tile of this.tiles) {
      const p = tile.center;
      const elev = elevNoise.fbm(p.x * opts.noiseScale, p.y * opts.noiseScale, p.z * opts.noiseScale, 5, 2.0, 0.52);
      const moist = moistNoise.fbm((p.x + 3.5) * 1.7, (p.y + 7.1) * 1.7, (p.z + 1.2) * 1.7, 4, 2.0, 0.5);
      // Ridged noise produces long chains -> mountain ranges instead of blobs
      const ridge = 1 - Math.abs(ridgeNoise.fbm(p.x * 2.2, p.y * 2.2, p.z * 2.2, 3, 2.0, 0.5));

      tile.elevation = parseFloat(elev.toFixed(4));
      tile.moisture = parseFloat(moist.toFixed(4));
      tile.owner = null;
      tile.isCapital = false;
      tile.capitalOf = null;
      tile.hasRiver = false;
      tile.riverNeighborId = null;
      tile.cityIndex = null;
      tile.farmIndex = null;
      tile.road = false;

      const absLat = Math.abs(p.y);

      if (tile.elevation < opts.seaLevel - 0.2) {
        tile.biome = BIOMES.OCEAN_DEEP;
      } else if (tile.elevation < opts.seaLevel) {
        tile.biome = BIOMES.OCEAN;
      } else if (absLat > 0.82) {
        tile.biome = BIOMES.TUNDRA;
      } else if (
        tile.elevation > opts.mountainThreshold ||
        (tile.elevation > opts.seaLevel + 0.12 && ridge > 0.94)
      ) {
        tile.biome = BIOMES.MOUNTAIN;
      } else if (tile.moisture < -0.1 && absLat < 0.5) {
        tile.biome = BIOMES.DESERT;
      } else if (tile.moisture > opts.forestMoisture && absLat < 0.78) {
        tile.biome = BIOMES.FOREST;
      } else {
        tile.biome = BIOMES.PLAINS;
      }
    }

    // 2. Coastlines: shallow water next to land, sandy beaches next to water
    const landIds = new Set(this.tiles.filter((t) => !isWater(t)).map((t) => t.id));
    for (const tile of this.tiles) {
      const touchesLand = tile.neighbors.some((n) => landIds.has(n));
      const touchesWater = tile.neighbors.some((n) => !landIds.has(n));
      if (!landIds.has(tile.id) && touchesLand) {
        tile.biome = BIOMES.COAST;
      } else if (
        landIds.has(tile.id) &&
        touchesWater &&
        (tile.biome === BIOMES.PLAINS || tile.biome === BIOMES.DESERT) &&
        tile.elevation < opts.seaLevel + 0.09
      ) {
        tile.biome = BIOMES.BEACH;
      }
    }

    // 3. Rivers
    const riverPaths = this.generateRivers(opts.seaLevel);

    // 4. Faction capitals & territory
    const playerInfo = this.claimTerritory('player', opts.territorySize, opts.seaLevel);
    const systemInfo = this.claimTerritory('system', opts.territorySize, opts.seaLevel, playerInfo?.capitalId);

    // 5. Cities, road network & sea lanes
    const cities = this.placeCities(playerInfo, systemInfo);
    this.assignCityStyles(cities);
    this.growCityFootprints(cities);
    const farms = this.placeFarms(cities);
    const landRoutes = this.buildLandRoutes(cities);
    const seaRoutes = this.buildSeaRoutes(cities);
    const airRoutes = this.buildAirRoutes(cities);

    return {
      seed: finalSeed,
      timestamp: Date.now(),
      subdivision: this.hexasphere.subdivision,
      options: opts,
      riverPaths,
      player: playerInfo,
      system: systemInfo,
      cities,
      farms,
      landRoutes,
      seaRoutes,
      airRoutes,
      mountainRanges: this.findMountainRanges(),
      tilesData: this.tiles.map((t) => ({
        id: t.id,
        biome: t.biome,
        elevation: t.elevation,
        moisture: t.moisture,
        owner: t.owner,
        isCapital: t.isCapital,
        capitalOf: t.capitalOf,
        hasRiver: t.hasRiver,
        riverNeighborId: t.riverNeighborId,
        cityIndex: t.cityIndex,
        farmIndex: t.farmIndex,
        road: t.road
      }))
    };
  }

  /** Connected components of mountain tiles = one merged mountain range each. */
  findMountainRanges() {
    const seen = new Set();
    const ranges = [];
    for (const tile of this.tiles) {
      if (tile.biome !== BIOMES.MOUNTAIN || seen.has(tile.id)) continue;
      const range = [];
      const stack = [tile.id];
      seen.add(tile.id);
      while (stack.length) {
        const id = stack.pop();
        range.push(id);
        for (const nId of this.tileMap.get(id).neighbors) {
          const n = this.tileMap.get(nId);
          if (n.biome === BIOMES.MOUNTAIN && !seen.has(nId)) {
            seen.add(nId);
            stack.push(nId);
          }
        }
      }
      ranges.push(range);
    }
    return ranges;
  }

  generateRivers(seaLevel) {
    const mountainTiles = this.tiles.filter((t) => t.biome === BIOMES.MOUNTAIN && t.elevation > 0.38);

    const riverCount = Math.min(mountainTiles.length, 14);
    const sources = [...mountainTiles].sort(() => this.rng() - 0.5).slice(0, riverCount);
    const allPaths = [];

    const maxSteps = {
      2: 8,
      3: 16,
      4: 24,
      5: 36
    }[this.hexasphere.subdivision] || 24;

    for (const source of sources) {
      let current = source;
      const visited = new Set();
      const currentPath = [current.id];

      while (current && currentPath.length < maxSteps) {
        visited.add(current.id);

        if (current.elevation < seaLevel) break;

        current.hasRiver = true;

        let lowestNeighbor = null;
        let minElev = current.elevation;

        for (const nId of current.neighbors) {
          if (visited.has(nId)) continue;
          const neighbor = this.tileMap.get(nId);
          if (neighbor && neighbor.elevation < minElev) {
            minElev = neighbor.elevation;
            lowestNeighbor = neighbor;
          }
        }

        if (lowestNeighbor) {
          current.riverNeighborId = lowestNeighbor.id;
          current = lowestNeighbor;
          currentPath.push(lowestNeighbor.id);
        } else {
          break;
        }
      }

      if (currentPath.length >= 4) {
        allPaths.push(currentPath);
      }
    }

    return allPaths;
  }

  claimTerritory(ownerKey, targetCount = 55, seaLevel, avoidCapitalId = null) {
    let candidateTiles = this.tiles.filter(
      (t) =>
        !isWater(t) &&
        t.biome !== BIOMES.MOUNTAIN &&
        t.biome !== BIOMES.TUNDRA &&
        t.owner === null
    );

    if (candidateTiles.length === 0) {
      candidateTiles = this.tiles.filter((t) => !isWater(t) && t.owner === null);
    }

    if (candidateTiles.length === 0) return null;

    let capitalTile = null;

    if (avoidCapitalId !== null) {
      const avoidTile = this.tileMap.get(avoidCapitalId);
      if (avoidTile) {
        let maxDist = -1;
        for (const cand of candidateTiles) {
          const dist = cand.center.distanceTo(avoidTile.center);
          if (dist > maxDist) {
            maxDist = dist;
            capitalTile = cand;
          }
        }
      }
    }

    if (!capitalTile) {
      let bestScore = -999;
      for (const cand of candidateTiles) {
        let landNeighbors = 0;
        for (const nId of cand.neighbors) {
          const n = this.tileMap.get(nId);
          if (n && !isWater(n)) landNeighbors++;
        }
        const score = landNeighbors * 2 + (cand.biome === BIOMES.PLAINS ? 4 : 2) - Math.abs(cand.elevation - 0.12) * 6;
        if (score > bestScore) {
          bestScore = score;
          capitalTile = cand;
        }
      }
    }

    capitalTile.isCapital = true;
    capitalTile.capitalOf = ownerKey;
    capitalTile.owner = ownerKey;

    const claimedTiles = [capitalTile.id];
    const queue = [capitalTile.id];
    const visited = new Set([capitalTile.id]);

    while (queue.length > 0 && claimedTiles.length < targetCount) {
      const curr = this.tileMap.get(queue.shift());
      if (!curr) continue;

      const neighbors = [...curr.neighbors].sort(() => this.rng() - 0.5);

      for (const nId of neighbors) {
        if (visited.has(nId)) continue;
        visited.add(nId);

        const n = this.tileMap.get(nId);
        if (!n || n.owner !== null) continue;
        if (n.biome === BIOMES.OCEAN_DEEP) continue;

        n.owner = ownerKey;
        claimedTiles.push(nId);

        if (claimedTiles.length >= targetCount) break;
        queue.push(nId);
      }
    }

    return {
      owner: ownerKey,
      capitalId: capitalTile.id,
      capitalPosition: [capitalTile.worldCenter.x, capitalTile.worldCenter.y, capitalTile.worldCenter.z],
      claimedTileCount: claimedTiles.length,
      claimedTiles,
      capitalName: ownerKey === 'player' ? 'New Babylon (Player)' : 'Aegis Citadel (System NPC)'
    };
  }

  /** Tiles a settlement or farm may spread onto. */
  isBuildable(t) {
    return !isWater(t) && t.biome !== BIOMES.MOUNTAIN && t.cityIndex === null && t.farmIndex === null;
  }

  /**
   * Cities occupy 1-7 tiles: the centre plus part of its hex ring.
   * Capitals take the full ring (7), towns roll small / medium / large.
   */
  growCityFootprints(cities) {
    for (const city of cities) {
      const center = this.tileMap.get(city.tileId);
      let size;
      if (city.type === 'capital') size = 7;
      else {
        const r = this.rng();
        size = r < 0.35 ? 1 : r < 0.6 ? 2 : r < 0.8 ? 3 : r < 0.93 ? 5 : 6;
      }
      const ring = center.neighbors
        .map((id) => this.tileMap.get(id))
        .filter((t) => this.isBuildable(t))
        .sort((a, b) => (b.biome === BIOMES.PLAINS) - (a.biome === BIOMES.PLAINS) || this.rng() - 0.5);
      city.tiles = [center.id, ...ring.slice(0, size - 1).map((t) => t.id)];
      city.tiles.forEach((id) => (this.tileMap.get(id).cityIndex = city.index));
      city.size = city.tiles.length;
      city.isPort = city.tiles.some((id) => this.tileMap.get(id).neighbors.some((n) => isWater(this.tileMap.get(n))));
    }
  }

  /** Farm clusters (1-7 tiles) grown over grassland next to each city. */
  placeFarms(cities) {
    const farms = [];
    for (const city of cities) {
      const clusters = city.type === 'capital' ? 2 : city.size >= 3 ? 2 : 1;
      for (let c = 0; c < clusters; c++) {
        const border = city.tiles
          .flatMap((id) => this.tileMap.get(id).neighbors)
          .map((id) => this.tileMap.get(id))
          .filter((t) => this.isBuildable(t) && (t.biome === BIOMES.PLAINS || (t.hasRiver && t.biome !== BIOMES.FOREST)));
        if (!border.length) break;
        const seed = border[Math.floor(this.rng() * border.length)];
        const target = 1 + Math.floor(this.rng() * Math.min(7, 2 + city.size));
        const farm = { index: farms.length, city: city.index, crop: this.rng() < 0.65 ? 'wheat' : 'crop', tiles: [] };
        const queue = [seed];
        while (queue.length && farm.tiles.length < target) {
          const t = queue.shift();
          if (!this.isBuildable(t) || t.biome !== BIOMES.PLAINS && t !== seed) continue;
          t.farmIndex = farm.index;
          farm.tiles.push(t.id);
          t.neighbors.forEach((id) => queue.push(this.tileMap.get(id)));
        }
        if (farm.tiles.length) farms.push(farm);
      }
    }
    return farms;
  }

  /** Capitals + spaced-out towns that favour coasts, rivers and grassland. */
  placeCities(playerInfo, systemInfo) {
    const cities = [];
    const addCity = (tile, props) => {
      tile.cityIndex = cities.length;
      cities.push({
        index: cities.length,
        tileId: tile.id,
        isPort: tile.neighbors.some((n) => isWater(this.tileMap.get(n))),
        ...props
      });
    };

    if (playerInfo) addCity(this.tileMap.get(playerInfo.capitalId), { name: 'New Babylon', type: 'capital', owner: 'player' });
    if (systemInfo) addCity(this.tileMap.get(systemInfo.capitalId), { name: 'Aegis Citadel', type: 'capital', owner: 'system' });

    const townCount = { 2: 4, 3: 7, 4: 10, 5: 14 }[this.hexasphere.subdivision] || 10;
    // Minimum angular spacing between cities, scaled from the tile spacing
    const tileAngle = Math.sqrt((4 * Math.PI) / this.tiles.length);
    const minAngle = Math.max(tileAngle * 5, 0.22);

    const candidates = this.tiles
      .filter((t) => !isWater(t) && t.biome !== BIOMES.MOUNTAIN && t.biome !== BIOMES.TUNDRA && t.cityIndex === null)
      .map((t) => {
        const coastal = t.neighbors.some((n) => isWater(this.tileMap.get(n)));
        let score = this.rng() * 2;
        if (coastal) score += 3;
        if (t.hasRiver) score += 2.5;
        if (t.biome === BIOMES.PLAINS) score += 2;
        if (t.biome === BIOMES.FOREST) score += 0.8;
        if (t.biome === BIOMES.DESERT) score -= 0.5;
        return { t, score };
      })
      .sort((a, b) => b.score - a.score);

    const names = [...CITY_NAMES].sort(() => this.rng() - 0.5);
    for (const { t } of candidates) {
      if (cities.length >= townCount + 2) break;
      const tooClose = cities.some((c) => {
        const other = this.tileMap.get(c.tileId);
        return Math.acos(Math.min(1, t.center.dot(other.center))) < minAngle;
      });
      if (tooClose) continue;
      addCity(t, { name: names[cities.length % names.length], type: 'town', owner: t.owner });
    }
    return cities;
  }

  angleBetween(aId, bId) {
    const a = this.tileMap.get(aId).center;
    const b = this.tileMap.get(bId).center;
    return Math.acos(Math.max(-1, Math.min(1, a.dot(b))));
  }

  /** Generic A* over the tile graph. `costFn(tile)` returns step cost or Infinity. */
  findPath(startId, goalId, costFn, maxAngle = Infinity) {
    const tileAngle = Math.sqrt((4 * Math.PI) / this.tiles.length);
    const h = (id) => (this.angleBetween(id, goalId) / tileAngle) * 0.9;
    const open = new MinHeap();
    const g = new Map([[startId, 0]]);
    const came = new Map();
    const closed = new Set();
    open.push(startId, h(startId));

    while (open.size) {
      const id = open.pop();
      if (id === goalId) {
        const path = [id];
        let cur = id;
        while (came.has(cur)) {
          cur = came.get(cur);
          path.push(cur);
        }
        return path.reverse();
      }
      if (closed.has(id)) continue;
      closed.add(id);

      for (const nId of this.tileMap.get(id).neighbors) {
        if (closed.has(nId)) continue;
        const n = this.tileMap.get(nId);
        const step = nId === goalId ? 1 : costFn(n);
        if (!isFinite(step)) continue;
        if (this.angleBetween(nId, startId) > maxAngle) continue;
        const ng = g.get(id) + step;
        if (ng < (g.get(nId) ?? Infinity)) {
          g.set(nId, ng);
          came.set(nId, id);
          open.push(nId, ng + h(nId));
        }
      }
    }
    return null;
  }

  /** Nearest-neighbour pairs (k per city), deduplicated. */
  nearestPairs(cityList, k) {
    const pairs = new Set();
    const out = [];
    for (const c of cityList) {
      const nearest = cityList
        .filter((o) => o !== c)
        .map((o) => ({ o, d: this.angleBetween(c.tileId, o.tileId) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, k);
      for (const { o, d } of nearest) {
        const key = c.index < o.index ? `${c.index}_${o.index}` : `${o.index}_${c.index}`;
        if (pairs.has(key)) continue;
        pairs.add(key);
        out.push({ a: c, b: o, d });
      }
    }
    return out.sort((x, y) => x.d - y.d);
  }

  buildLandRoutes(cities) {
    const routes = [];
    this.landLinked = new Set();
    const cost = (t) => {
      if (isWater(t) || t.biome === BIOMES.MOUNTAIN) return Infinity;
      const base = LAND_COST[t.biome] ?? 1;
      return t.road ? base * 0.45 : base; // reuse existing roads -> branching network
    };

    for (const { a, b, d } of this.nearestPairs(cities, 2)) {
      if (d > 1.1) continue;
      const path = this.findPath(a.tileId, b.tileId, cost, d * 1.6 + 0.1);
      if (!path || path.length < 2) continue;
      path.forEach((id) => (this.tileMap.get(id).road = true));
      routes.push({ from: a.index, to: b.index, style: a.style, path });
      this.landLinked.add(`${Math.min(a.index, b.index)}_${Math.max(a.index, b.index)}`);
    }
    return routes;
  }

  /**
   * Two civilisations share the planet: the player's capital founds a fantasy
   * realm, the system's capital a modern nation. Every town adopts the style
   * of the capital it sits closest to.
   */
  assignCityStyles(cities) {
    const capitals = cities.filter((c) => c.type === 'capital');
    for (const city of cities) {
      if (city.type === 'capital') {
        city.style = city.owner === 'system' ? 'modern' : 'fantasy';
        continue;
      }
      let best = null;
      let bestAngle = Infinity;
      for (const cap of capitals) {
        const angle = this.angleBetween(city.tileId, cap.tileId);
        if (angle < bestAngle) {
          bestAngle = angle;
          best = cap;
        }
      }
      city.style = best?.owner === 'system' ? 'modern' : 'fantasy';
    }
  }

  /** Air links inside each civilisation: balloons (fantasy) and airliners (modern). */
  buildAirRoutes(cities) {
    const routes = [];
    for (const style of ['fantasy', 'modern']) {
      const group = cities.filter((c) => c.style === style);
      const pairs = this.nearestPairs(group, 2).filter(({ d }) => d > 0.18);
      pairs.slice(0, style === 'modern' ? 7 : 5).forEach(({ a, b }) => routes.push({ from: a.index, to: b.index, style }));
    }
    return routes;
  }

  buildSeaRoutes(cities) {
    const ports = cities.filter((c) => c.isPort);
    const routes = [];
    const cost = (t) => (t.biome === BIOMES.OCEAN_DEEP ? 1.15 : isWater(t) ? 1 : Infinity);

    for (const { a, b, d } of this.nearestPairs(ports, 2)) {
      const key = `${Math.min(a.index, b.index)}_${Math.max(a.index, b.index)}`;
      // Sea lanes connect places the road network can't (other continents / far coasts)
      if (this.landLinked?.has(key) && d < 0.5) continue;
      const path = this.findPath(a.tileId, b.tileId, cost, Math.PI);
      if (!path || path.length < 4) continue;
      routes.push({ from: a.index, to: b.index, style: a.style, path });
    }
    return routes;
  }

  applyMapData(mapData) {
    if (!mapData || !mapData.tilesData) return false;

    for (const tData of mapData.tilesData) {
      const tile = this.tileMap.get(tData.id);
      if (!tile) continue;
      tile.biome = tData.biome;
      tile.elevation = tData.elevation;
      tile.moisture = tData.moisture;
      tile.owner = tData.owner;
      tile.isCapital = tData.isCapital;
      tile.capitalOf = tData.capitalOf;
      tile.hasRiver = tData.hasRiver;
      tile.riverNeighborId = tData.riverNeighborId;
      tile.cityIndex = tData.cityIndex ?? null;
      tile.farmIndex = tData.farmIndex ?? null;
      tile.road = tData.road ?? false;
    }
    return true;
  }

  saveToStorage(mapData) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(packMapData(mapData)));
      return true;
    } catch (err) {
      console.warn('Could not save map to localStorage:', err);
      return false;
    }
  }

  loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const data = unpackMapData(JSON.parse(raw));
      if (
        data &&
        data.tilesData &&
        Array.isArray(data.tilesData) &&
        data.tilesData.length > 0 &&
        data.subdivision
      ) {
        return data;
      }
      return null;
    } catch (err) {
      console.warn('Could not parse map from localStorage:', err);
      return null;
    }
  }

  clearStorage() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      console.warn('Could not clear localStorage:', err);
    }
  }
}
