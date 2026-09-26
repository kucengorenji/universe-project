import { generateHexasphere } from '../math/hexasphere.js';
import { MapGenerator } from '../map/mapGenerator.js';
import { generateSystem } from './solarSystem.js';
import { typeOf } from './planetTypes.js';

const CLOCK_KEY = 'planet_globe_clock_offset';
const CLOCK_EPOCH = 1790000000; // keeps the clock's numbers small

/**
 * The persistent world: one star system per seed. Only the home planet's map
 * is saved (localStorage, as before); every other planet is regenerated from
 * its own seed in ~50 ms and kept in a small in-memory cache.
 *
 * All planets share one hexasphere topology. Tile fields (biome, owner, ...)
 * live on the tiles themselves, so `activate(map)` must run before a renderer
 * builds from them.
 */
export class World {
  constructor({ subdivision = 5, radius = 10 } = {}) {
    this.radius = radius;
    this.clockOffset = 0;
    try {
      this.clockOffset = Number(localStorage.getItem(CLOCK_KEY)) || 0;
    } catch {
      /* optional */
    }
    this.subdivision = subdivision;
    this.hexasphere = generateHexasphere(subdivision, radius);
    this.mapGenerator = new MapGenerator(this.hexasphere);
    this.cache = new Map();
    this.applied = null;

    const saved = this.mapGenerator.loadFromStorage();
    if (saved) {
      if (saved.subdivision && saved.subdivision !== subdivision) this.setSubdivision(saved.subdivision);
      this.homeMap = saved;
    } else {
      this.homeMap = this.mapGenerator.generate(null, { planetType: 'terran' });
      this.mapGenerator.saveToStorage(this.homeMap);
      this.applied = this.homeMap;
    }
    this.system = generateSystem(this.homeMap.seed);
  }

  /**
   * World clock in seconds. Real time drives it, so the system keeps turning
   * while the tab is closed; sleeping in a bed skips ahead (offset, saved).
   */
  now() {
    return Date.now() / 1000 - CLOCK_EPOCH + this.clockOffset;
  }

  skipTime(seconds) {
    this.clockOffset += seconds;
    try {
      localStorage.setItem(CLOCK_KEY, String(this.clockOffset));
    } catch {
      /* optional */
    }
  }

  get homeIndex() {
    return this.system.homeIndex;
  }

  planet(index) {
    return this.system.planets[index] ?? null;
  }

  setSubdivision(level) {
    if (level === this.subdivision) return;
    this.subdivision = level;
    this.hexasphere = generateHexasphere(level, this.radius);
    this.mapGenerator.hexasphere = this.hexasphere;
    this.mapGenerator.tiles = this.hexasphere.tiles;
    this.mapGenerator.tileMap = this.hexasphere.tileMap;
    this.cache.clear();
    this.applied = null;
  }

  /** Map data for a landable planet (generated on demand). */
  mapFor(index) {
    const p = this.planet(index);
    if (!p || !p.landable) return null;
    if (p.home) return this.homeMap;
    const cached = this.cache.get(index);
    if (cached) {
      // refresh LRU order
      this.cache.delete(index);
      this.cache.set(index, cached);
      return cached;
    }
    const type = typeOf(p.type);
    const map = this.mapGenerator.generate(p.seed, {
      ...type.gen,
      planetType: p.type,
      inhabited: type.inhabited,
      capitalNames: p.capitalNames
    });
    this.applied = map;
    this.cache.set(index, map);
    while (this.cache.size > 3) this.cache.delete(this.cache.keys().next().value);
    return map;
  }

  /**
   * Sun as seen from a city: direction in the town's frame (x = east-ish U,
   * y = up, z = V), from the planet's spin and its position around the star.
   */
  sunAt(planetIndex, frame, t = this.now()) {
    const p = this.planet(planetIndex);
    const a = p.phase + p.orbitSpeed * t;
    // Star direction from the planet (world), then into the planet's own frame
    const sx = -Math.cos(a);
    const sz = -Math.sin(a);
    const spin = p.phase * 2 + p.spin * t;
    const c = Math.cos(-spin);
    const s = Math.sin(-spin);
    // rotateY(-spin): x' = x cos + z sin, z' = -x sin + z cos
    const lx = sx * c + sz * s;
    const lz = -sx * s + sz * c;
    const ly = 0;
    const dot = (v) => lx * v[0] + ly * v[1] + lz * v[2];
    return { x: dot(frame.U), y: dot(frame.N), z: dot(frame.V) };
  }

  /** Put a planet's tile data onto the shared hexasphere. */
  activate(map) {
    if (this.applied !== map) {
      this.mapGenerator.applyMapData(map);
      this.applied = map;
    }
    return this.hexasphere;
  }

  /** New home world (and with it a new star system). */
  regenerateHome(seed, options = {}) {
    const level = options.subdivision !== undefined ? parseInt(options.subdivision, 10) : this.subdivision;
    this.setSubdivision(level);
    this.homeMap = this.mapGenerator.generate(seed, { ...options, planetType: 'terran' });
    this.applied = this.homeMap;
    this.mapGenerator.saveToStorage(this.homeMap);
    this.system = generateSystem(this.homeMap.seed);
    this.cache.clear();
    return this.homeMap;
  }
}
