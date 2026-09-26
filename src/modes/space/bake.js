import * as THREE from 'three';

// Space-view textures per star system, baked once in a worker and kept (as
// pixels) for as long as the system exists, so coming back to orbit is instant.
// GPU textures are created per visit and disposed when the mode exits.
let cache = null; // { seed, subdivision, promise, images: Map(index -> {data,width,height}), clouds }

export function bakeSystem(world, onProgress) {
  const sys = world.system;
  const home = world.homeMap;
  if (cache && cache.seed === sys.seed && cache.homeTime === home.timestamp && cache.subdivision === world.subdivision) {
    if (cache.done) onProgress?.(1);
    return cache.promise;
  }
  const images = new Map();
  const entry = { seed: sys.seed, homeTime: home.timestamp, subdivision: world.subdivision, images, clouds: null, done: false };
  const jobs = sys.planets.map((p) => {
    if (p.type === 'gas') return { index: p.index, type: 'gas', seed: p.seed, bands: p.bands };
    if (p.home) {
      const t = home.tilesData;
      return {
        index: p.index,
        type: p.type,
        seed: p.seed,
        biomes: t.map((d) => d.biome),
        elevation: t.map((d) => d.elevation),
        city: t.map((d) => (d.cityIndex === null || d.cityIndex === undefined ? -1 : d.cityIndex)),
        farm: t.map((d) => (d.farmIndex === null || d.farmIndex === undefined ? 0 : 1)),
        modern: (home.cities || []).map((c) => c.style === 'modern')
      };
    }
    return { index: p.index, type: p.type, seed: p.seed, capitalNames: p.capitalNames };
  });
  const total = jobs.length + 1;
  entry.promise = new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../world/planetBake.worker.js', import.meta.url), { type: 'module' });
    let got = 0;
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.done) {
        entry.done = true;
        worker.terminate();
        resolve(entry);
        return;
      }
      const img = { data: new Uint8Array(m.data), width: m.width, height: m.height };
      if (m.clouds) entry.clouds = img;
      else images.set(m.index, img);
      onProgress?.(++got / total);
    };
    worker.onerror = (err) => {
      worker.terminate();
      if (cache === entry) cache = null;
      reject(err);
    };
    worker.postMessage({ subdivision: world.subdivision, radius: world.radius, jobs, width: 1024 });
  });
  cache = entry;
  return entry.promise;
}

export function toTexture(img, { srgb = true } = {}) {
  const tex = new THREE.DataTexture(img.data, img.width, img.height, THREE.RGBAFormat);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
