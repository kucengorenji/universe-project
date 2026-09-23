import { createNoise3D } from '../math/simplex3d.js';
import * as THREE from 'three';

export const STORAGE_KEY = 'planet_globe_map_v3';

export const BIOMES = {
  OCEAN_DEEP: 'ocean_deep',
  OCEAN: 'ocean',
  PLAINS: 'plains', // Padang rumput datar
  FOREST: 'forest', // Hutan rimbun
  MOUNTAIN: 'mountain', // Gunung plum / bersalju
  SAVANNAH: 'savannah', // Sabana emas / kering
  TUNDRA: 'tundra', // Daerah dingin / kutub
  RIVER: 'river', // Sungai
  CITY: 'city' // Kota / Ibukota
};

export const BIOME_COLORS = {
  [BIOMES.OCEAN_DEEP]: 0x0e3f75, // Biru tua palung yang cerah & kaya (bukan hitam)
  [BIOMES.OCEAN]: 0x186cb2, // Biru samudra cerah
  [BIOMES.PLAINS]: 0x4f8f37,
  [BIOMES.FOREST]: 0x225c2d,
  [BIOMES.MOUNTAIN]: 0x70374e, // Burgundy / plum rocks ala New Dawn
  [BIOMES.SAVANNAH]: 0xbda052, // Golden savannah
  [BIOMES.TUNDRA]: 0xd8e8ef, // Icy tundra
  [BIOMES.RIVER]: 0x38bdf8,
  [BIOMES.CITY]: 0x00f0ff
};

export class MapGenerator {
  constructor(hexasphere) {
    this.hexasphere = hexasphere;
    this.tiles = hexasphere.tiles;
    this.tileMap = hexasphere.tileMap;
  }

  generate(seed = null, options = {}) {
    const finalSeed =
      seed !== null && seed !== undefined && !isNaN(Number(seed))
        ? Number(seed)
        : Math.floor(Math.random() * 900000 + 100000);

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

    // 1. Assign elevations, moisture, and latitude-based biomes
    for (const tile of this.tiles) {
      const p = tile.center;
      // fBm 3D noise on unit sphere
      const elev = elevNoise.fbm(p.x * opts.noiseScale, p.y * opts.noiseScale, p.z * opts.noiseScale, 5, 2.0, 0.52);
      const moist = moistNoise.fbm((p.x + 3.5) * 1.7, (p.y + 7.1) * 1.7, (p.z + 1.2) * 1.7, 4, 2.0, 0.5);

      tile.elevation = parseFloat(elev.toFixed(4));
      tile.moisture = parseFloat(moist.toFixed(4));
      tile.owner = null;
      tile.isCapital = false;
      tile.capitalOf = null;
      tile.hasRiver = false;
      tile.riverNeighborId = null;

      // Latitude factor (-1 at South Pole, 0 at Equator, +1 at North Pole)
      const absLat = Math.abs(p.y);

      if (tile.elevation < opts.seaLevel - 0.2) {
        tile.biome = BIOMES.OCEAN_DEEP;
      } else if (tile.elevation < opts.seaLevel) {
        tile.biome = BIOMES.OCEAN;
      } else if (absLat > 0.82) {
        // Polar ice caps & tundra
        tile.biome = BIOMES.TUNDRA;
      } else if (tile.elevation > opts.mountainThreshold) {
        tile.biome = BIOMES.MOUNTAIN;
      } else if (tile.moisture > opts.forestMoisture && absLat < 0.75) {
        tile.biome = BIOMES.FOREST;
      } else if (tile.moisture < -0.12 && absLat < 0.45) {
        // Warm dry equatorial zone
        tile.biome = BIOMES.SAVANNAH;
      } else {
        tile.biome = BIOMES.PLAINS;
      }
    }

    // 2. Generate smooth flowing Rivers with full path tracking
    const riverPaths = this.generateRivers(opts.seaLevel);

    // 3. Find Player Capital and Territory (Civilization starter pack area)
    const playerInfo = this.claimTerritory('player', opts.territorySize, opts.seaLevel);

    // 4. Find System (NPC) Capital and Territory in a distant continent
    const systemInfo = this.claimTerritory('system', opts.territorySize, opts.seaLevel, playerInfo?.capitalId);

    const mapData = {
      seed: finalSeed,
      timestamp: Date.now(),
      subdivision: this.hexasphere.subdivision,
      options: opts,
      riverPaths,
      player: playerInfo,
      system: systemInfo,
      tilesData: this.tiles.map((t) => ({
        id: t.id,
        biome: t.biome,
        elevation: t.elevation,
        moisture: t.moisture,
        owner: t.owner,
        isCapital: t.isCapital,
        capitalOf: t.capitalOf,
        hasRiver: t.hasRiver,
        riverNeighborId: t.riverNeighborId
      }))
    };

    return mapData;
  }

  generateRivers(seaLevel) {
    const mountainTiles = this.tiles.filter(
      (t) => t.biome === BIOMES.MOUNTAIN && t.elevation > 0.38
    );

    const riverCount = Math.min(mountainTiles.length, 14);
    const sources = [...mountainTiles].sort(() => Math.random() - 0.5).slice(0, riverCount);
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
        t.elevation >= seaLevel &&
        t.biome !== BIOMES.MOUNTAIN &&
        t.biome !== BIOMES.TUNDRA &&
        t.owner === null
    );

    if (candidateTiles.length === 0) {
      candidateTiles = this.tiles.filter((t) => t.elevation >= seaLevel && t.owner === null);
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
          if (n && n.elevation >= seaLevel) landNeighbors++;
        }
        const score = landNeighbors * 2 + (cand.biome === BIOMES.PLAINS ? 4 : 2) - Math.abs(cand.elevation - 0.12) * 6;
        if (score > bestScore) {
          bestScore = score;
          capitalTile = cand;
        }
      }
    }

    if (!capitalTile) {
      capitalTile = candidateTiles[Math.floor(Math.random() * candidateTiles.length)];
    }

    capitalTile.isCapital = true;
    capitalTile.capitalOf = ownerKey;
    capitalTile.owner = ownerKey;

    const claimedTiles = [capitalTile.id];
    const queue = [capitalTile.id];
    const visited = new Set([capitalTile.id]);

    while (queue.length > 0 && claimedTiles.length < targetCount) {
      const currentId = queue.shift();
      const curr = this.tileMap.get(currentId);
      if (!curr) continue;

      const neighbors = [...curr.neighbors].sort(() => Math.random() - 0.5);

      for (const nId of neighbors) {
        if (visited.has(nId)) continue;
        visited.add(nId);

        const n = this.tileMap.get(nId);
        if (!n || n.owner !== null) continue;

        if (n.elevation < seaLevel - 0.15) continue;

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
    }
    return true;
  }

  saveToStorage(mapData) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(mapData));
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
      const data = JSON.parse(raw);
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
