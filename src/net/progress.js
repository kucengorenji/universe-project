import { KEYS, readJson, storageOr, writeJson } from './config.js';

// Per-world progress the dashboard shows: planets landed on, towns visited and
// play time. Kept in localStorage and carried in the cloud snapshot.

const MAX_LIST = 500;

export class Progress {
  constructor(storage) {
    this.storage = storageOr(storage);
  }

  all() {
    return readJson(this.storage, KEYS.progress, {});
  }

  get(worldId) {
    const p = this.all()[worldId] || {};
    return { planets: Array.isArray(p.planets) ? p.planets : [], towns: Array.isArray(p.towns) ? p.towns : [], playtime: Number(p.playtime) || 0 };
  }

  update(worldId, fn) {
    const all = this.all();
    const next = fn(this.get(worldId));
    all[worldId] = { planets: next.planets.slice(-MAX_LIST), towns: next.towns.slice(-MAX_LIST), playtime: Math.round(next.playtime) };
    writeJson(this.storage, KEYS.progress, all);
  }

  /** A route the director reached: planet and town visits count once each. */
  visit(worldId, route) {
    if (route.planet == null || (route.mode !== 'planet' && route.mode !== 'town' && route.mode !== 'home')) return;
    const planet = String(route.planet), town = route.city == null ? null : `${route.planet}:${route.city}`;
    const p = this.get(worldId);
    if (p.planets.includes(planet) && (!town || route.mode === 'planet' || p.towns.includes(town))) return;
    this.update(worldId, (q) => ({
      ...q,
      planets: q.planets.includes(planet) ? q.planets : [...q.planets, planet],
      towns: !town || route.mode === 'planet' || q.towns.includes(town) ? q.towns : [...q.towns, town]
    }));
  }

  addPlaytime(worldId, seconds) {
    if (seconds > 0) this.update(worldId, (q) => ({ ...q, playtime: q.playtime + seconds }));
  }
}
