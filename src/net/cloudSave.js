import { STORAGE_KEY as MAP_KEY } from '../map/mapGenerator.js';
import { MISSIONS } from '../core/missionList.js';
import { STATE_DB, journalKey } from '../world/stateStore.js';
import { KEYS, readJson, writeJson } from './config.js';
import { apiFetch } from './api.js';

// Cloud save: one snapshot per world (localStorage values the world depends on
// plus every WorldStateStore record). Signed-in players sync automatically;
// each upload names the cloud revision it builds on, and a mismatch (another
// device moved on) asks the player which copy wins.

export const SYNC_KEYS = [MAP_KEY, 'planet_globe_missions', 'planet_globe_clock_offset', 'planet_globe_ship'];
const SYNC_INTERVAL = 60_000;

/** FNV-1a; enough to notice that a snapshot changed. */
export function hashText(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(16).padStart(8, '0')}-${text.length.toString(16)}`;
}

const sortedEntries = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** What counts as a change worth uploading: not play time, not the save time. */
export function contentHash(snapshot) {
  const { [KEYS.progress]: progress, ...storage } = snapshot.storage;
  const p = readJson({ getItem: () => progress }, 'x', {})[snapshot.worldId] || {};
  return hashText(JSON.stringify([sortedEntries(storage), p.planets || [], p.towns || [], sortedEntries(snapshot.entities)]));
}

export function missionSummary(json) {
  let state = {};
  try { state = JSON.parse(json || '{}') || {}; } catch { /* no missions yet */ }
  let done = 0, total = 0;
  const missionsDone = [];
  for (const m of MISSIONS) {
    let all = true;
    for (const it of m.items) {
      total++;
      if (state[`${m.id}.${it.id}`]?.done) done++;
      else all = false;
    }
    if (all) missionsDone.push(m.id);
  }
  return { missionsDone, missionItems: { done, total } };
}

export function buildSnapshot({ storage, worldId, seed, subdivision, records, progress, now = Date.now() }) {
  const values = {};
  for (const key of SYNC_KEYS) {
    const v = storage.getItem(key);
    if (v != null) values[key] = v;
  }
  const scopedMissionsKey = `planet_globe_missions:${worldId}`;
  const scopedMissionsVal = storage.getItem(scopedMissionsKey);
  if (scopedMissionsVal != null) values[scopedMissionsKey] = scopedMissionsVal;

  const scopedTipsKey = `planet_globe_tips:${worldId}`;
  const scopedTipsVal = storage.getItem(scopedTipsKey);
  if (scopedTipsVal != null) values[scopedTipsKey] = scopedTipsVal;

  const prog = progress.get(worldId);
  values[KEYS.progress] = JSON.stringify({ [worldId]: prog });
  const entities = sortedEntries(Object.fromEntries(records));
  const snapshot = { schemaVersion: 1, worldId, savedAt: now, storage: values, entities };
  const meta = {
    seed, subdivision,
    planetsLanded: prog.planets.length,
    townsVisited: prog.towns.length,
    playtimeSec: prog.playtime,
    homes: Object.keys(entities).filter((k) => k.startsWith('home:')).length,
    ...missionSummary(scopedMissionsVal || values.planet_globe_missions)
  };
  return { snapshot, meta, hash: contentHash(snapshot) };
}

function putEntities(indexedDB, worldId, entities) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(STATE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('entities');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('entities', 'readwrite');
      tx.objectStore('entities').put(entities, worldId);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}

/** Writes a cloud snapshot over this browser's copy. The page must reload afterwards. */
export async function applySnapshot(snapshot, { storage, indexedDB, rev = 0, now = Date.now() }) {
  if (snapshot?.schemaVersion !== 1 || typeof snapshot.storage?.[MAP_KEY] !== 'string' || typeof snapshot.entities !== 'object') {
    throw new Error('Invalid snapshot');
  }
  const { worldId } = snapshot;
  if (indexedDB) await putEntities(indexedDB, worldId, snapshot.entities);
  for (const key of Object.keys(snapshot.storage || {})) {
    if (typeof snapshot.storage[key] === 'string') storage.setItem(key, snapshot.storage[key]);
  }
  const incoming = readJson({ getItem: () => snapshot.storage[KEYS.progress] }, 'x', {})[worldId];
  if (incoming) writeJson(storage, KEYS.progress, { ...readJson(storage, KEYS.progress, {}), [worldId]: incoming });
  // Without IndexedDB the journal is the store; with it, a stale journal would replay over the restore.
  if (indexedDB) storage.removeItem(journalKey(worldId));
  else storage.setItem(journalKey(worldId), JSON.stringify(snapshot.entities));
  const sync = readJson(storage, KEYS.sync, {});
  sync[worldId] = { rev, hash: contentHash(snapshot), at: now };
  writeJson(storage, KEYS.sync, sync);
}

export class CloudSync {
  /**
   * @param {{ world: any, storage: Storage, indexedDB?: IDBFactory | null, auth: import('./auth.js').Auth,
   *           progress: import('./progress.js').Progress, deviceId: string, dialog: (opts: any) => Promise<string>,
   *           t: (key: string, params?: any) => string, api?: typeof apiFetch, reload?: (url: string) => void }} deps
   */
  constructor({ world, storage, indexedDB = null, auth, progress, deviceId, dialog, t, api = apiFetch, reload = (url) => location.replace(url) }) {
    Object.assign(this, { world, storage, indexedDB, auth, progress, deviceId, dialog, t, api, reload });
    this.status = { state: 'off', at: null };
    this.listeners = new Set();
    this.busy = false;
    this.paused = false; // a conflict the player postponed: no automatic uploads this session
  }

  get worldId() { return this.world.worldId; }
  get path() { return `/me/worlds/${encodeURIComponent(this.worldId)}`; }

  setStatus(state, extra = {}) {
    this.status = { ...this.status, state, ...extra };
    this.listeners.forEach((fn) => fn(this.status));
  }

  local() {
    return readJson(this.storage, KEYS.sync, {})[this.worldId] || { rev: 0, hash: null, at: null };
  }

  saveLocal(entry) {
    const all = readJson(this.storage, KEYS.sync, {});
    all[this.worldId] = entry;
    writeJson(this.storage, KEYS.sync, all);
  }

  build() {
    return buildSnapshot({
      storage: this.storage, worldId: this.worldId, seed: this.world.homeMap.seed, subdivision: this.world.subdivision,
      records: this.world.state.records, progress: this.progress
    });
  }

  async guard(fn) {
    if (this.busy || !this.auth.user) return;
    this.busy = true;
    try { await fn(await this.auth.token()); }
    catch (error) { this.setStatus('error', { error: String(error?.message || error) }); }
    finally { this.busy = false; }
  }

  /** Compare with the cloud (sign-in, boot, "Sync now"). force: also re-upload a world deleted in the cloud. */
  check({ force = false } = {}) {
    return this.guard(async (token) => {
      this.setStatus('syncing');
      const list = await this.api('/me/worlds', { token });
      if (!list.ok) return this.failed(list.status);
      const remote = list.data.items.find((w) => w.worldId === this.worldId);
      const local = this.local();
      const { hash } = this.build();
      if (!remote) {
        if ((local.rev > 0 || local.deleted) && !force) {
          // Deleted from the dashboard: do not quietly upload it again.
          this.saveLocal({ ...local, rev: 0, deleted: true });
          return this.setStatus('deleted');
        }
        return this.push(token, 0);
      }
      if (remote.rev === local.rev && !local.deleted) {
        if (hash === local.hash) return this.setStatus('synced', { at: local.at });
        return this.push(token, remote.rev);
      }
      return this.conflict(token, remote, hash !== local.hash || !local.rev);
    });
  }

  /** Periodic upload of local changes. */
  tick() {
    if (this.paused || this.status.state === 'conflict' || this.local().deleted) return Promise.resolve();
    return this.guard(async (token) => {
      const local = this.local();
      if (this.build().hash === local.hash) return;
      return this.push(token, local.rev);
    });
  }

  async push(token, baseRev) {
    this.setStatus('syncing');
    const { snapshot, meta, hash } = this.build();
    const res = await this.api(this.path, { method: 'PUT', token, body: { baseRev, deviceId: this.deviceId, meta, snapshot } });
    if (res.ok) {
      this.saveLocal({ rev: res.data.rev, hash, at: res.data.updatedAt });
      return this.setStatus('synced', { at: res.data.updatedAt, error: null });
    }
    if (res.status === 409) {
      if (res.data.rev === 0) {
        this.saveLocal({ ...this.local(), rev: 0, deleted: true });
        return this.setStatus('deleted');
      }
      return this.conflict(token, { rev: res.data.rev, updatedAt: res.data.updatedAt, meta: res.data.meta }, true);
    }
    return this.failed(res.status);
  }

  failed(status) {
    const error = status === 401 ? 'auth' : status === 413 ? 'too_large' : `http_${status}`;
    this.setStatus('error', { error });
  }

  /** The cloud moved on since this device last synced. */
  async conflict(token, remote, localChanged) {
    const { t } = this;
    this.setStatus('conflict');
    const when = remote.updatedAt ? new Date(remote.updatedAt).toLocaleString() : '';
    const choice = await this.dialog({
      eyebrow: t('net.sync.eyebrow'),
      title: localChanged ? t('net.conflict.title') : t('net.newer.title'),
      text: localChanged ? t('net.conflict.text', { when }) : t('net.newer.text', { when }),
      choices: localChanged
        ? [{ id: 'cloud', label: t('net.conflict.cloud') }, { id: 'local', label: t('net.conflict.local') }, { id: 'later', label: t('net.later'), ghost: true }]
        : [{ id: 'cloud', label: t('net.newer.load') }, { id: 'later', label: t('net.later'), ghost: true }]
    });
    if (choice === 'cloud') return this.loadCloud(token, this.worldId);
    if (choice === 'local') {
      this.paused = false;
      return this.push(token, remote.rev);
    }
    this.paused = true;
  }

  async loadCloud(token, worldId) {
    this.setStatus('syncing');
    const res = await this.api(`/me/worlds/${encodeURIComponent(worldId)}`, { token });
    if (!res.ok) return this.failed(res.status);
    this.paused = true; // nothing may upload between the restore and the reload
    await this.world.state.serial?.catch(() => {});
    await applySnapshot(res.data.snapshot, { storage: this.storage, indexedDB: this.indexedDB, rev: res.data.rev });
    this.reload('/play/#/space');
  }

  /** ?restore=<worldId> from the dashboard: bring a cloud world onto this device. */
  async restore(worldId) {
    const { t } = this;
    if (!this.auth.user) {
      const go = await this.dialog({ eyebrow: t('net.restore.eyebrow'), title: t('net.restore.signin.title'), text: t('net.restore.signin.text'), choices: [{ id: 'signin', label: t('net.signin') }, { id: 'cancel', label: t('net.cancel'), ghost: true }] });
      if (go !== 'signin') return;
      await this.auth.signIn();
    }
    if (worldId === this.worldId) return this.check();
    await this.tick(); // save the world on this device first
    const token = await this.auth.token();
    const list = await this.api('/me/worlds', { token });
    const remote = list.ok ? list.data.items.find((w) => w.worldId === worldId) : null;
    if (!remote) {
      await this.dialog({ eyebrow: t('net.restore.eyebrow'), title: t('net.restore.missing.title'), text: t('net.restore.missing.text'), choices: [{ id: 'ok', label: t('net.ok') }] });
      return;
    }
    const current = this.local();
    const savedHere = current.rev > 0 && current.hash === this.build().hash;
    const choice = await this.dialog({
      eyebrow: t('net.restore.eyebrow'),
      title: t('net.restore.title', { seed: String(remote.meta.seed) }),
      text: `${t('net.restore.text', { when: new Date(remote.updatedAt).toLocaleString(), planets: remote.meta.planetsLanded, towns: remote.meta.townsVisited })} ${savedHere ? t('net.restore.currentSaved', { seed: String(this.world.homeMap.seed) }) : t('net.restore.currentLost', { seed: String(this.world.homeMap.seed) })}`,
      choices: [{ id: 'load', label: t('net.restore.load') }, { id: 'cancel', label: t('net.cancel'), ghost: true }]
    });
    if (choice === 'load') await this.loadCloud(token, worldId);
  }

  start() {
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), SYNC_INTERVAL);
    return this.check();
  }

  stop() {
    clearInterval(this.timer);
    this.paused = false;
    this.setStatus('off', { at: null, error: null });
  }
}
