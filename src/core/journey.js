import { JOURNEY_SCHEMA_VERSION } from '../world/versions.js';
import { loadVersionedRecord } from '../world/savedRecords.js';
import { homeCityIndex } from '../world/starterHome.js';

// The First Journey ("Perjalanan Pertama"): find your home in the hometown, leave a trace
// in it (light on, or an item put down), and come back to find it as you left it.
//
//   J1 fly to the home planet   J2 land in the hometown   J3 get within 6 m of the door
//   J4 go inside               J5 switch on a light / put an item down (and have it saved)
//   J6 leave, come back (or reload), go inside again and find the trace restored -> done
//
// Progress only moves forward, repeated events change nothing, and a stage is never
// claimed from a screen alone: J5 needs the room write to have succeeded, `done` needs
// the saved room (not the picture) to match what was left. State lives in the world's
// store under 'journey'; a record this build cannot read is quarantined and the journey
// starts over, never overwritten.

export const STAGES = ['j1', 'j2', 'j3', 'j4', 'j5', 'j6'];
export const NEAR_DOOR_M = 6;
export const JOURNEY_KEY = 'journey';
const ITEM_EPSILON = 0.02;

export const rank = stage => (stage === 'done' ? STAGES.length : STAGES.indexOf(stage));

const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const isJourneyRecord = record => isPlain(record) && rank(record.stage) >= 0 &&
  (record.home === null || isPlain(record.home)) && (record.trace === null || isPlain(record.trace));

export const newRecord = (now = Date.now()) => ({
  schemaVersion: JOURNEY_SCHEMA_VERSION, stage: 'j1', home: null, trace: null, away: false, celebrated: false, startedAt: now
});

// ---------------------------------------------------------------- the trace

/**
 * What the player changed between two interior snapshots: a light that went on, or an item
 * that was put down somewhere new. null when nothing counts (a light switched off, a pick-up).
 */
export function diffTrace(before, after) {
  if (!isPlain(before?.objects) || !isPlain(after?.objects)) return null; // nothing to compare against
  const was = before.objects, now = after.objects;
  for (const [id, state] of Object.entries(now)) {
    const prior = was[id];
    if (Array.isArray(state.position) && prior && !samePosition(prior.position, state.position) && after.holdingId !== id) {
      return { kind: 'item', id, expected: { position: [...state.position], x: state.x, z: state.z } };
    }
  }
  for (const [id, state] of Object.entries(now)) {
    if (id.startsWith('light:') && state.on && !was[id]?.on) return { kind: 'light', id, expected: { on: true } };
  }
  return null;
}

const samePosition = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= ITEM_EPSILON);

/** Does the saved room still hold what the player left? Compares ids and values, never pixels or the clock. */
export function verifyTrace(trace, snapshot) {
  if (!isPlain(trace) || !isPlain(snapshot?.objects)) return { ok: false, reason: 'missing' };
  const found = snapshot.objects[trace.id];
  if (!found) return { ok: false, reason: 'object-missing' };
  if (trace.kind === 'light') return found.on === true ? { ok: true } : { ok: false, reason: 'light-off' };
  if (trace.kind === 'item') {
    if (snapshot.holdingId === trace.id) return { ok: false, reason: 'item-held' };
    return samePosition(found.position, trace.expected?.position) ? { ok: true } : { ok: false, reason: 'item-moved' };
  }
  return { ok: false, reason: 'unknown-trace' };
}

// ---------------------------------------------------------------- what the HUD says

/**
 * The objective line for the current stage and place, as i18n keys. Pure so the wording
 * rules are checkable. `view` = { mode, view, inHomeTown, distance, holding, lights }.
 */
export function describeObjective(status, view = {}, names = {}) {
  const { stage, away, verifying, homeUnavailable } = status;
  const step = Math.min(rank(stage) + 1, STAGES.length);
  const base = { step, total: STAGES.length };
  const distance = view.inHomeTown && Number.isFinite(view.distance) ? Math.round(view.distance) : null;
  switch (stage) {
    case 'j1': return { ...base, line: ['journey.j1', { planet: names.planet ?? '' }], hint: ['journey.j1.hint'] };
    case 'j2': return { ...base, line: ['journey.j2', { city: names.city ?? '' }], hint: ['journey.j2.hint'] };
    case 'j3': return { ...base, line: ['journey.j3'], distance,
      hint: homeUnavailable ? ['journey.home.unavailable'] : view.view === 'diorama' ? ['journey.j3.diorama'] : ['journey.j3.hint'] };
    case 'j4': return { ...base, line: ['journey.j4'], distance, hint: view.view === 'drive' ? ['journey.j4.drive'] : ['journey.j4.hint'] };
    // the hint names what this room really offers: a lamp that is off, lamps that are all on already, or no lamp at all
    case 'j5': return { ...base, line: ['journey.j5'], hint: view.holding ? ['journey.j5.carry', { item: view.holding }]
      : view.lights === 'on' ? ['journey.j5.lightsOn'] : view.lights === 'none' ? ['journey.j5.noLights'] : ['journey.j5.hint'] };
    case 'j6': {
      const hint = verifying ? ['journey.j6.verify'] : !away ? ['journey.j6.leave'] :
        view.inHomeTown ? ['journey.j6.door'] : ['journey.j6.return', { city: names.city ?? '', planet: names.planet ?? '' }];
      return { ...base, line: ['journey.j6'], distance: away && view.inHomeTown && !verifying ? distance : null, hint };
    }
    default: return null;
  }
}

// ---------------------------------------------------------------- the journey

/** The journey of this world's home planet and hometown; it follows the world when a new home world replaces it. */
export function createJourney(world, options = {}) {
  const where = () => ({ homePlanet: world.homeIndex, homeCity: homeCityIndex(world.homeMap) });
  const names = () => ({ planet: world.planet(world.homeIndex)?.name ?? '', city: world.homeMap?.cities?.[where().homeCity]?.name ?? '' });
  const journey = new Journey({ state: world.state, ...where(), ...options });
  journey.names = names();
  world.subscribe?.(async (event) => {
    if (event !== 'world') return;
    await world.ready; // the new world's store has to finish loading before its record can be read
    journey.rebind({ state: world.state, ...where() });
    journey.names = names();
  });
  return journey;
}

/**
 * `state` is the world's WorldStateStore (get/set/serial/error). Listeners get
 * ({ type: 'change' | 'toast' | 'complete', ... }).
 */
export class Journey {
  constructor({ state, homePlanet, homeCity, session = `s${Math.random().toString(36).slice(2)}`, now = () => Date.now() }) {
    this.state = state;
    this.homePlanet = homePlanet;
    this.homeCity = homeCity;
    this.session = session;
    this.now = now;
    this.listeners = new Set();
    this.view = {}; // where the player is: set by the modes
    this.names = {};
    this.status = { save: 'idle', progressFailed: false, restoreFailed: false, quarantine: null, verifying: false, homeUnavailable: false };
    this.record = this.load();
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(event) { for (const fn of this.listeners) fn(event, this); }

  load() {
    const { record, quarantined } = loadVersionedRecord(this.state, JOURNEY_KEY, { schemaVersion: JOURNEY_SCHEMA_VERSION, validate: isJourneyRecord });
    if (quarantined) {
      this.status.quarantine = 'pending';
      Promise.resolve(this.state.serial).then(() => {
        this.status.quarantine = this.state.error ? 'failed' : 'saved';
        this.emit({ type: 'change' });
      });
    }
    return record ? structuredClone(record) : newRecord(this.now());
  }

  get stage() { return this.record.stage; }
  get done() { return this.record.stage === 'done'; }
  get home() { return this.record.home?.buildingId ? this.record.home : null; }
  get away() { return this.record.stage === 'j6' && !!(this.record.away || (this.record.trace && this.record.trace.session !== this.session)); }

  /** Everything a screen needs. */
  snapshot() {
    return { stage: this.stage, away: !!this.away, home: this.home, done: this.done, celebrated: this.record.celebrated, ...this.status };
  }

  objective() {
    return this.done ? null : describeObjective(this.snapshot(), this.view, this.names);
  }

  /** Read-only view for QA (window.__globe.journey). */
  debug() {
    return { stage: this.stage, rank: rank(this.stage), done: this.done, away: !!this.away, session: this.session, home: this.home && { ...this.home },
      trace: this.record.trace && structuredClone(this.record.trace), status: { ...this.status }, view: { ...this.view }, homePlanet: this.homePlanet, homeCity: this.homeCity };
  }

  setView(patch) {
    Object.assign(this.view, patch);
    this.emit({ type: 'change' });
  }

  advance(stage) {
    if (rank(stage) <= rank(this.record.stage) || this.done) return false;
    this.record.stage = stage;
    return true;
  }

  /** Write the record. true only when the store reports no error afterwards. */
  async persist() {
    this.state.set(JOURNEY_KEY, this.record);
    await this.state.serial;
    const ok = !this.state.error;
    this.status.progressFailed = !ok;
    this.emit({ type: 'change' });
    return ok;
  }

  toast(key) { this.emit({ type: 'toast', key }); }

  /** The world was replaced (a new home world): start from that world's own record. */
  rebind({ state, homePlanet, homeCity }) {
    this.state = state;
    this.homePlanet = homePlanet;
    this.homeCity = homeCity;
    this.view = {};
    this.status = { save: 'idle', progressFailed: false, restoreFailed: false, quarantine: null, verifying: false, homeUnavailable: false };
    this.record = this.load();
    this.emit({ type: 'change' });
  }

  // -------------------------------------------------------------- events from the modes

  /** The director has a new mode on screen. Town and interior details come from the town itself. */
  modeEntered(route) {
    this.view = { ...this.view, mode: route.mode, view: undefined, distance: undefined, inHomeTown: false, holding: undefined };
    if (route.mode === 'space') this.space();
    else if (route.mode === 'planet') this.planet(route.planet);
    else if (route.mode === 'town') this.town(route.planet, route.city);
    else this.emit({ type: 'change' });
  }

  /** A planet's globe is on screen. */
  planet(index) {
    if (index !== this.homePlanet || !this.advance('j2')) return false;
    this.toast('journey.toast.j1');
    this.persist();
    return true;
  }

  /** The star system is on screen; a journey that is waiting for the player to come back notes that they left. */
  space() {
    if (this.stage !== 'j6' || this.record.away) { this.emit({ type: 'change' }); return false; }
    this.record.away = true;
    this.persist();
    return true;
  }

  /** A town is on screen. Only the hometown moves the journey; landing there also means the planet was reached. */
  town(planet, city) {
    const inHome = planet === this.homePlanet && city === this.homeCity;
    this.view.inHomeTown = inHome;
    if (inHome && this.advance('j3')) {
      this.toast('journey.toast.j2');
      this.persist();
      return true;
    }
    this.emit({ type: 'change' });
    return false;
  }

  /** The town resolved (or could not resolve) the starter house. Saved once; never replaced afterwards. */
  setHome(home) {
    if (!home) {
      this.status.homeUnavailable = !this.home;
      this.emit({ type: 'change' });
      return this.home;
    }
    this.status.homeUnavailable = false;
    if (!this.home) {
      this.record.home = { planet: this.homePlanet, city: this.homeCity, buildingId: home.buildingId, portalId: home.portalId, asset: home.asset, tier: home.tier };
      this.persist();
    }
    this.emit({ type: 'change' });
    return this.home;
  }

  /** The saved starter house is not in this town any more (or its door is unsafe): say so, and do not pick another. */
  markHomeLost() {
    this.status.homeUnavailable = true;
    this.emit({ type: 'change' });
  }

  /** Distance in metres from the player (or driver) to the starter door. Reaching 6 m completes J3. */
  near(distance) {
    const changed = Math.round(distance) !== Math.round(this.view.distance ?? NaN);
    this.view.distance = distance;
    if (changed) this.emit({ type: 'change' });
    if (this.stage === 'j3' && this.home && distance < NEAR_DOOR_M && this.advance('j4')) {
      this.toast('journey.toast.j3');
      this.persist();
      return true;
    }
    return false;
  }

  /**
   * A room opened. `floors` is the room's saved record (floor -> snapshot) as just read from the store.
   * Entering the starter house completes J3/J4; entering it again after leaving checks the trace.
   */
  enterHome({ buildingId, floors = {} }) {
    if (!this.home || buildingId !== this.home.buildingId || this.done) return false;
    if (rank(this.stage) < rank('j5')) {
      this.advance('j5');
      this.toast('journey.toast.j4');
      this.persist();
      return true;
    }
    if (this.stage === 'j6' && this.away) {
      this.status.verifying = true;
      const result = verifyTrace(this.record.trace, floors[this.record.trace?.floor]);
      this.status.verifying = false;
      if (!result.ok) {
        this.status.restoreFailed = true;
        this.emit({ type: 'change' });
        return false;
      }
      this.status.restoreFailed = false;
      this.record.stage = 'done';
      this.record.celebrated = true;
      this.persist().then(() => this.emit({ type: 'complete' }));
      return true;
    }
    this.emit({ type: 'change' });
    return false;
  }

  /**
   * The player changed the room just after `before` was captured. Counts for J5 only in the
   * starter house, only for a light switched on or an item put down, and only once the room write
   * is confirmed. Resolves true when the trace was recorded.
   */
  async changed({ buildingId, floor, before, after }) {
    if (this.stage !== 'j5' || !this.home || buildingId !== this.home.buildingId) return false;
    const trace = diffTrace(before, after);
    if (!trace) return false;
    this.status.save = 'pending';
    this.emit({ type: 'change' });
    await this.state.serial; // the room's own write, queued by the caller before this call
    if (this.state.error) {
      this.status.save = 'failed';
      this.emit({ type: 'change' });
      return false;
    }
    this.status.save = 'idle';
    this.record.trace = { ...trace, floor, session: this.session };
    this.record.stage = 'j6';
    this.record.away = false;
    this.toast('journey.toast.j5');
    await this.persist();
    return true;
  }
}
