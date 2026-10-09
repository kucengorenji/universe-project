import { apiUrl } from './config.js';
import { journalKey } from '../world/stateStore.js';

// /play/?inspect=<token>: an admin opens a player's cloud save from the
// dashboard. The game boots from the snapshot with storage swapped for an
// in-memory copy, so nothing touches the admin's own saves, and nothing is
// sent back (no telemetry, no sync).

export class MemoryStorage {
  constructor(entries = []) { this.map = new Map(entries); }
  get length() { return this.map.size; }
  key(i) { return [...this.map.keys()][i] ?? null; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(String(k), String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

// Device preferences carried over from the admin's browser.
const PREFS = ['planet_globe_locale', 'planet_globe_quality', 'planet_globe_post', 'planet_globe_audio', 'planet_globe_prefs', 'planet_globe_town_style'];

/** Storage contents for an inspect session: the admin's preferences, the player's world. */
export function inspectEntries(snapshot, real) {
  const entries = [];
  for (const k of PREFS) {
    const v = real?.getItem(k);
    if (v != null) entries.push([k, v]);
  }
  const tips = (() => { try { return JSON.parse(real?.getItem('planet_globe_tips') || '[]'); } catch { return []; } })();
  entries.push(['planet_globe_tips', JSON.stringify([...new Set([...tips, 'intro'])])]);
  for (const [k, v] of Object.entries(snapshot.storage)) entries.push([k, v]);
  // Without IndexedDB the state store reads its records from the journal.
  entries.push([journalKey(snapshot.worldId), JSON.stringify(snapshot.entities)]);
  return entries;
}

/** Runs before the world boots. Returns the inspected save, or null on a normal visit. */
export async function prepareInspect() {
  const token = new URLSearchParams(location.search).get('inspect');
  if (!token) return null;
  let save = null;
  try {
    const res = await fetch(apiUrl(`/inspect/${encodeURIComponent(token)}`));
    if (res.ok) save = await res.json();
  } catch { /* handled below */ }
  if (!save?.snapshot) {
    history.replaceState(null, '', `/play/${location.hash}`);
    return { failed: true };
  }
  let real = null;
  try { real = window.localStorage; } catch { /* blocked */ }
  const memory = new MemoryStorage(inspectEntries(save.snapshot, real));
  Object.defineProperty(window, 'localStorage', { configurable: true, get: () => memory });
  Object.defineProperty(window, 'indexedDB', { configurable: true, get: () => null });
  return { save };
}
