// Player progress that belongs to one world (missions, tips) lives under
// `<base>:<worldId>` instead of one global key, so a new world starts clean and
// two worlds never share a checklist.
//
// Builds before this one wrote the progress to the bare `<base>` key. The first
// world that opens adopts that value once (`<base>:migrated` records which world
// got it) and the old key is left in place, so an older build still finds it.

const browserStorage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

export const scopedKey = (base, worldId) => `${base}:${worldId}`;

export class ScopedProgress {
  constructor(base, { storage } = {}) {
    this.base = base;
    this.fixedStorage = storage;
    this.error = null;
  }

  get storage() { return this.fixedStorage ?? browserStorage(); }

  /** The saved value for this world, or `fallback`. Performs the one-time migration. */
  load(worldId, fallback) {
    const storage = this.storage;
    if (!storage) return fallback;
    try {
      const scoped = storage.getItem(scopedKey(this.base, worldId));
      if (scoped !== null && scoped !== undefined) return JSON.parse(scoped);
      const marker = `${this.base}:migrated`;
      if (storage.getItem(marker) !== null && storage.getItem(marker) !== undefined) return fallback;
      const legacy = storage.getItem(this.base);
      if (legacy === null || legacy === undefined) return fallback;
      const value = JSON.parse(legacy);
      try {
        storage.setItem(scopedKey(this.base, worldId), legacy);
        storage.setItem(marker, worldId);
      } catch (error) { this.error = error; } // adopted in memory; the next load tries again
      return value;
    } catch {
      return fallback; // unreadable value: start clean rather than crash the boot
    }
  }

  /** True when the value was stored. A failure is kept in `error` so the UI can show it. */
  save(worldId, value) {
    const storage = this.storage;
    try {
      if (!storage) throw new Error('Browser storage is unavailable');
      storage.setItem(scopedKey(this.base, worldId), JSON.stringify(value));
      this.error = null;
      return true;
    } catch (error) {
      this.error = error;
      return false;
    }
  }
}
