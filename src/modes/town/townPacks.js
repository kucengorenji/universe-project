import { loadAssetPack } from '../../render/assetLibrary.js';
import { loadTexturedPack } from '../../render/texturedAssetLibrary.js';
import { ASSETS } from '../../render/assetManifest.js';
import { loadTownSurfaces } from '../../render/townSurfaces.js';
import { loadTownPaintedSurfaces } from './render/paintedStyle.js';
import { loadTownPeople } from './people/skirmishPeople.js';
import { FURNITURE_PACK } from './interior/interior.js';
import { optionalPack } from './render/packLoading.js';
import { PAINTED_SURFACE_MEANS } from './render/paintedMeans.js';
import { isOn } from '../../core/experiments.js';

// What entering a town fetches. Anything that is only needed inside a building (the furniture)
// is not in this list: it loads when a door is near, or when the player goes in.

const COMMON = ['planetPack', 'planetPackLod0', 'townPack', 'sceneryPack', 'environmentPack', 'townSurfaces', 'envSurfacesTown', 'soldierPack', 'townWalk'];
const FEMALE = ['soldierPackF', 'townWalkF'];
const ATLAS = { normal: ['soldierAtlas', 'soldierHead'], low: ['soldierAtlasLow', 'soldierHeadLow'] };
const ATLAS_F = { normal: ['soldierAtlasF', 'soldierHeadF'], low: ['soldierAtlasFLow', 'soldierHeadFLow'] };

/**
 * Manifest keys that entering a town fetches, and the ones it fetches right after it is on screen (the women's
 * body). Low uses the 1024 atlases. tests/asset-usage.test.js checks these lists against the source, so a pack
 * added to the entry path cannot slip in unnoticed, and prices them in bytes per tier.
 */
export function townAssetKeys({ low = false, deferFemale = true } = {}) {
  const tier = low ? 'low' : 'normal';
  const female = [...FEMALE, ...ATLAS_F[tier]];
  return { entry: [...COMMON, ...ATLAS[tier], ...(deferFemale ? [] : female)], deferred: deferFemale ? female : [] };
}

/** The Low tier ships the 1024 character atlases (everything else looks the same on every tier). */
export const usesLowAtlases = (quality) => quality?.preset === 'low' && isOn('lowAtlas');

export const loadTownPacks = ({ low = false, deferFemale = false } = {}) =>
  Promise.all([
    optionalPack(loadAssetPack(ASSETS.planetPack), 'planet pack'), // only a last-resort fallback for town models
    loadAssetPack(ASSETS.planetPackLod0).catch(() => null),
    loadAssetPack(ASSETS.townPack).catch(() => null),
    loadTownPeople({ low, deferFemale }),
    loadTexturedPack(ASSETS.sceneryPack).catch(() => null),
    loadTownSurfaces(ASSETS.townSurfaces).catch(() => null),
    loadTexturedPack(ASSETS.environmentPack, { mergeShades: true }).catch(() => null),
    loadTownPaintedSurfaces(ASSETS.envSurfacesTown, { means: PAINTED_SURFACE_MEANS }).catch(() => null)
  ]).then(([base, lod0, townPack, townPeople, sceneryPack, surfaceAtlas, environmentPack, paintedSurfaces]) =>
    ({ base, lod0, townPack, townPeople, sceneryPack, surfaceAtlas, environmentPack, paintedSurfaces }));

/**
 * A pack that loads on first use, once. A failed load resolves to null and may be tried again,
 * but not more often than every `retryMs`.
 */
export class LazyPack {
  constructor(load, { now = () => performance.now(), retryMs = 10000 } = {}) {
    Object.assign(this, { load, now, retryMs });
    this.state = 'idle'; // idle | loading | ready | failed
    this.value = null;
    this.promise = null;
    this.startedAt = null;
    this.reason = null;
    this.failedAt = null;
  }

  get ready() { return this.state === 'ready'; }

  start(reason = 'enter') {
    if (this.promise) return this.promise;
    if (this.failedAt !== null && this.now() - this.failedAt < this.retryMs) return Promise.resolve(null);
    this.state = 'loading';
    this.startedAt = this.now();
    this.reason = reason;
    this.promise = Promise.resolve().then(() => this.load()).then((value) => {
      if (!value) throw new Error('empty pack');
      this.value = value;
      this.state = 'ready';
      this.loadedMs = this.now() - this.startedAt;
      return value;
    }).catch((error) => {
      this.state = 'failed';
      this.error = String(error?.message ?? error);
      this.failedAt = this.now();
      this.promise = null; // allows a later retry
      return null;
    });
    return this.promise;
  }

  metrics() {
    return { state: this.state, reason: this.reason, loadedMs: this.loadedMs ?? null, error: this.error ?? null };
  }
}

export const createFurniturePack = () => new LazyPack(() => loadAssetPack(ASSETS.furniturePack, FURNITURE_PACK));

/** Is anything in `doors` within `radius` metres of `pos`? (the cue to start loading the furniture) */
export function anyWithin(doors, pos, radius) {
  if (!pos) return false;
  const r2 = radius * radius;
  for (const d of doors) if ((d.x - pos.x) ** 2 + (d.z - pos.z) ** 2 <= r2) return true;
  return false;
}
