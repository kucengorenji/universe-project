import { WorldStateStore } from '../world/stateStore.js';
import { createCampaign } from './scenario.js';
import { graphFor } from './routing.js';
import { fingerprint } from './resources.js';
import { command, tick, validateState } from './simulation.js';

export class TradeSession {
  constructor(world, { time = () => performance.now() / 1000, storeFactory = key => new WorldStateStore(key), coordination = true } = {}) {
    this.world = world; this.time = time; this.storeFactory = storeFactory; this.coordination = coordination;
    this.indexStore = storeFactory('trade:index'); this.ready = this.indexStore.ready;
    this.state = null; this.base = null; this.graph = null; this.listeners = new Set();
    this.last = time(); this.accumulator = 0; this.appPaused = false; this.holds = 0; this.readOnly = false;
    this.owner = globalThis.crypto?.randomUUID?.() || `tab-${Math.random().toString(36).slice(2)}`;
    this.lastSave = 0; this.lastHeartbeat = 0;
    if (typeof document !== 'undefined') {
      this.interval = setInterval(() => this.pump(), 250);
      this.onVisibility = () => { this.pump(); this.save(); };
      this.onPageHide = () => this.save();
      document.addEventListener('visibilitychange', this.onVisibility);
      window.addEventListener('pagehide', this.onPageHide);
    }
  }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  notify() { for (const fn of this.listeners) fn(this); }
  get items() {
    const items = this.indexStore.get('campaigns')?.items;
    return Array.isArray(items) ? items.filter(c => c && typeof c.id === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(c.id) &&
      typeof c.worldId === 'string' && typeof c.name === 'string' && Number.isInteger(c.planet) && typeof c.fingerprint === 'string') : [];
  }
  matching(planet, map) { const fp = fingerprint(map); return this.items.filter(c => c.worldId === this.world.worldId && c.planet === planet && c.fingerprint === fp); }
  async create(planet, map, tutorial = true) {
    await this.ready;
    const id = `campaign-${globalThis.crypto?.randomUUID?.() || Date.now().toString(36)}`;
    const campaign = createCampaign(map, this.world.hexasphere, { id, planet, worldId: this.world.worldId, name: this.world.planet(planet).name, tutorial });
    await this.stop();
    this.store = this.storeFactory(`trade:${id}`); await this.store.ready;
    this.base = campaign.base; this.graph = campaign.graph; this.state = campaign.state; this.mapIdentity = map;
    this.last = this.time(); this.accumulator = 0;
    this.readOnly = !(await this.acquire(id));
    if (this.readOnly) throw new Error('trade.error.lease');
    await this.store.set('base', this.base); await this.save();
    const items = [...this.items, { id, planet, worldId: this.world.worldId, seed: map.seed, subdivision: map.subdivision, name: this.state.name, fingerprint: this.state.fingerprint }];
    await this.indexStore.set('campaigns', { items }); this.notify(); return id;
  }
  async resume(id) {
    await this.ready;
    if (this.state?.id === id) return this.state;
    const item = this.items.find(c => c.id === id && c.worldId === this.world.worldId);
    if (!item) throw new Error('trade.error.save');
    const store = this.storeFactory(`trade:${id}`); await store.ready;
    const base = store.get('base'), state = store.get('checkpoint');
    if (!base || !validateState(state, base) || state.fingerprint !== fingerprint(base)) throw new Error('trade.error.save');
    if (base.subdivision !== this.world.subdivision || state.fingerprint !== fingerprint(this.world.mapFor(item.planet))) throw new Error('trade.error.world');
    const graph = graphFor(base, this.world.hexasphere);
    if (!validateState(state, base, graph)) throw new Error('trade.error.save');
    await this.stop();
    this.store = store; this.base = base; this.state = state; this.graph = graph;
    this.mapIdentity = this.world.mapFor(item.planet);
    this.state.paused = true; this.accumulator = 0; this.last = this.time();
    this.readOnly = !(await this.acquire(id)); this.notify(); return this.state;
  }
  async acquire(id) {
    this.releaseLock?.(); this.releaseLock = null;
    if (!this.coordination) return true;
    this.leaseKey = `globe:trade:lease:${id}`;
    if (globalThis.navigator?.locks) return new Promise(resolve => {
      navigator.locks.request(this.leaseKey, { ifAvailable: true }, async lock => {
        resolve(!!lock);
        if (lock) await new Promise(release => { this.releaseLock = release; });
      }).catch(() => resolve(false));
    });
    try {
      const previous = JSON.parse(localStorage.getItem(this.leaseKey) || 'null');
      if (previous && previous.owner !== this.owner && previous.until > Date.now()) return false;
      localStorage.setItem(this.leaseKey, JSON.stringify({ owner: this.owner, until: Date.now() + 15000 }));
      this.fallbackLease = true; return JSON.parse(localStorage.getItem(this.leaseKey)).owner === this.owner;
    } catch { return false; }
  }
  async takeover() {
    if (!this.state || !this.readOnly) return;
    const id = this.state.id;
    if (!(await this.acquire(id))) throw new Error('trade.error.lease');
    const latestStore = this.storeFactory(`trade:${id}`); await latestStore.ready;
    const latest = latestStore.get('checkpoint');
    if (!validateState(latest, this.base)) { this.releaseLock?.(); throw new Error('trade.error.save'); }
    this.store = latestStore; this.state = latest; this.state.paused = true; this.readOnly = false;
    this.last = this.time(); this.accumulator = 0; this.notify();
  }
  heartbeat() {
    if (!this.fallbackLease || this.readOnly || !this.state) return;
    try {
      const current = JSON.parse(localStorage.getItem(this.leaseKey) || 'null');
      if (current?.owner !== this.owner) { this.readOnly = true; this.notify(); return; }
      localStorage.setItem(this.leaseKey, JSON.stringify({ owner: this.owner, until: Date.now() + 15000 }));
    } catch { this.readOnly = true; this.notify(); }
  }
  pump() {
    const now = this.time(), elapsed = Math.max(0, now - this.last); this.last = now;
    if (!this.state || this.readOnly) return;
    const homeChanged = this.world.planet(this.state.planet)?.home && this.mapIdentity !== this.world.homeMap;
    if (homeChanged && fingerprint(this.world.homeMap) === this.state.fingerprint) this.mapIdentity = this.world.homeMap;
    if (this.state.worldId !== this.world.worldId || homeChanged && this.mapIdentity !== this.world.homeMap) { if (!this.state.paused) { this.state.paused = true; this.save(); this.notify(); } return; }
    if (now - this.lastHeartbeat > 2) { this.heartbeat(); this.lastHeartbeat = now; }
    if (this.readOnly) return;
    if (!this.state.paused && !this.appPaused && !this.holds) this.accumulator += elapsed * this.state.speed;
    const steps = Math.min(120, Math.floor(this.accumulator));
    for (let i = 0; i < steps; i++) tick(this.state, this.graph, this.base.resourcePlan);
    this.accumulator -= steps;
    if (steps) { if (now - this.lastSave >= 5) this.save(); this.notify(); }
  }
  run(action) {
    this.pump(); if (!this.state || this.readOnly) throw new Error('trade.error.lease');
    if (this.accumulator >= 1) throw new Error('trade.error.catchup');
    command(this.state, this.graph, this.base.resourcePlan, action); this.save(); this.notify();
  }
  setPaused(paused) { this.pump(); if (this.readOnly || !this.state) return; this.state.paused = paused; this.save(); this.notify(); }
  setSpeed(speed) { if (![1, 2, 4].includes(speed)) return; this.pump(); if (this.readOnly || !this.state) return; this.state.speed = speed; this.save(); this.notify(); }
  setAppPaused(paused) { this.pump(); this.appPaused = paused; this.last = this.time(); }
  hold() { this.pump(); this.holds++; let released = false; return () => { if (!released) { this.last = this.time(); this.holds--; released = true; } }; }
  save() {
    if (this.fallbackLease) this.heartbeat();
    if (!this.state || this.readOnly || !this.store) return Promise.resolve();
    this.state.sessionSavedAt = Date.now(); this.lastSave = this.time();
    return this.store.set('checkpoint', this.state);
  }
  get saveError() { return this.store?.error || this.indexStore.error; }
  export() { return JSON.stringify({ format: 'globe-trade', version: 1, base: this.base, state: this.state }); }
  async exportSaved(id) {
    if (this.state?.id === id) return this.export();
    const store = this.storeFactory(`trade:${id}`); await store.ready;
    const base = store.get('base'), state = store.get('checkpoint');
    if (!base || !state) throw new Error('trade.error.save');
    return JSON.stringify({ format: 'globe-trade', version: 1, base, state });
  }
  async import(text) {
    if (text.length > 12_000_000) throw new Error('trade.error.save');
    let data; try { data = JSON.parse(text); } catch { throw new Error('trade.error.save'); }
    if (!data || data.format !== 'globe-trade' || data.version !== 1 || !data.base || !validateState(data.state, data.base) ||
      data.state.fingerprint !== fingerprint(data.base)) throw new Error('trade.error.save');
    const map = this.world.mapFor(data.state.planet);
    if (!map || fingerprint(map) !== data.state.fingerprint || data.state.worldId !== this.world.worldId) throw new Error('trade.error.world');
    if (data.base.subdivision !== this.world.subdivision || !validateState(data.state, data.base, graphFor(data.base, this.world.hexasphere))) throw new Error('trade.error.save');
    data.state.id = `campaign-${globalThis.crypto?.randomUUID?.() || Date.now().toString(36)}`;
    await this.stop(); this.base = data.base; this.state = data.state; this.graph = graphFor(data.base, this.world.hexasphere); this.mapIdentity = map;
    this.state.paused = true; this.store = this.storeFactory(`trade:${this.state.id}`); await this.store.ready;
    this.readOnly = !(await this.acquire(this.state.id));
    if (this.readOnly) throw new Error('trade.error.lease');
    this.accumulator = 0; this.last = this.time();
    await this.store.set('base', this.base); await this.save();
    await this.indexStore.set('campaigns', { items: [...this.items, { id: this.state.id, planet: this.state.planet,
      worldId: this.state.worldId, seed: this.base.seed, subdivision: this.base.subdivision, name: this.state.name, fingerprint: this.state.fingerprint }] }); this.notify(); return this.state.id;
  }
  async stop() {
    await this.save(); this.releaseLock?.(); this.releaseLock = null;
    if (this.fallbackLease) { try { const v = JSON.parse(localStorage.getItem(this.leaseKey) || 'null'); if (v?.owner === this.owner) localStorage.removeItem(this.leaseKey); } catch { /* lease expires */ } }
    this.fallbackLease = false; this.state = null; this.base = null; this.graph = null;
  }
  destroy() { clearInterval(this.interval); globalThis.document?.removeEventListener('visibilitychange', this.onVisibility); globalThis.window?.removeEventListener('pagehide', this.onPageHide); return this.stop(); }
}
