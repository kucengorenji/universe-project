// Where the game talks to its backend (functions/api on the same origin by
// default) and the localStorage keys the net modules own. No heavy imports:
// the landing page uses this too.

const env = import.meta.env || {};

export const API_BASE = `${(env.VITE_API_BASE || '').replace(/\/$/, '')}/api`;
const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(globalThis.location?.hostname || '');
// A game opened from localhost (npm run dev / api:dev) links to the local dashboard dev server.
export const DASHBOARD_URL = env.VITE_DASHBOARD_URL || (LOCAL ? 'http://localhost:5174/' : 'https://dashboard.aethergate.cloud/');
export const BUILD = env.VITE_BUILD || (env.DEV ? 'dev' : 'web');

export const KEYS = Object.freeze({
  device: 'planet_globe_device',
  telemetry: 'planet_globe_telemetry', // 'off' when the player opted out
  signedIn: 'planet_globe_signed_in', // '1' while a Google session should be restored at boot
  sync: 'planet_globe_sync', // { [worldId]: { rev, hash, at } } last cloud state seen by this device
  progress: 'planet_globe_progress', // { [worldId]: { planets, towns, playtime } }
  announcements: 'planet_globe_announcements' // ids already shown
});

export const storageOr = (storage) => {
  if (storage) return storage;
  try { return globalThis.localStorage ?? null; } catch { return null; }
};

export function readJson(storage, key, fallback) {
  try {
    const v = JSON.parse(storage?.getItem(key) ?? 'null');
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(storage, key, value) {
  try { storage?.setItem(key, JSON.stringify(value)); } catch { /* storage is optional */ }
}

export const apiUrl = (path) => `${API_BASE}${path}`;
