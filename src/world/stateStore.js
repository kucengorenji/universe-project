import { t } from '../i18n/index.js';

// IndexedDB is the durable store. A small synchronous write-ahead journal
// protects the latest interactions when a tab closes before a transaction ends.
const browserStore = name => { try { return globalThis[name]; } catch { return null; } };
export class WorldStateStore {
  constructor(worldId, { storage = browserStore('localStorage'), indexedDB = browserStore('indexedDB') } = {}) {
    this.worldId = worldId;
    this.storage = storage;
    this.indexedDB = indexedDB;
    this.key = `globe:journal:${worldId}`;
    this.records = new Map();
    this.pending = {};
    this.error = null;
    this.serial = Promise.resolve();
    try {
      this.pending = JSON.parse(storage?.getItem(this.key) || '{}');
      if (!this.pending || Array.isArray(this.pending) || typeof this.pending !== 'object') throw new Error(t('store.invalid'));
      for (const [id, value] of Object.entries(this.pending)) this.records.set(id, value);
    } catch (error) { this.error = error; this.pending = {}; }
    this.ready = this.open();
  }

  async open() {
    if (!this.indexedDB) return;
    try {
      this.db = await new Promise((resolve, reject) => {
        const request = this.indexedDB.open('globe-world-state', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('entities');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error(t('store.blocked')));
      });
      const loaded = await new Promise((resolve, reject) => {
        const tx = this.db.transaction('entities');
        const request = tx.objectStore('entities').get(this.worldId);
        request.onsuccess = () => resolve(request.result || {});
        request.onerror = () => reject(request.error);
      });
      for (const [id, value] of Object.entries(loaded)) if (!this.records.has(id)) this.records.set(id, value);
      if (Object.keys(this.pending).length) await this.commit();
    } catch (error) { this.error = error; }
  }

  get(id) { return this.records.has(id) ? structuredClone(this.records.get(id)) : null; }

  set(id, value) {
    const data = structuredClone(value);
    this.records.set(id, data);
    this.pending[id] = data;
    try {
      if (!this.storage && !this.indexedDB) throw new Error(t('store.unavailable'));
      this.storage?.setItem(this.key, JSON.stringify(this.pending));
    }
    catch (error) { this.error = error; }
    this.serial = this.serial.then(() => this.ready).then(() => this.commit()).catch(error => { this.error = error; });
    return this.serial;
  }

  async commit() {
    if (!this.db) return; // journal remains durable when IndexedDB is unavailable
    const pending = { ...this.pending };
    if (!Object.keys(pending).length) return;
    await new Promise((resolve, reject) => {
      const tx = this.db.transaction('entities', 'readwrite');
      const store = tx.objectStore('entities');
      const read = store.get(this.worldId);
      // Merge within one transaction: separate tabs updating different rooms
      // must not replace each other's whole world snapshot.
      read.onsuccess = () => store.put({ ...(read.result || {}), ...pending }, this.worldId);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error(t('store.aborted')));
    });
    for (const [id, value] of Object.entries(pending)) if (this.pending[id] === value) delete this.pending[id];
    try { this.storage?.setItem(this.key, JSON.stringify(this.pending)); this.error = null; }
    catch (error) { this.error = error; }
  }
}
