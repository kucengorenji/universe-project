import {
  HOME_SCHEMA_VERSION, INTERIOR_LEGACY_SCHEMA_VERSION, INTERIOR_SCHEMA_VERSION
} from './versions.js';

// Saved records written by a build this one does not understand (a newer game,
// a hand-edited store, a broken write) are held aside under `quarantine:<key>`
// instead of being read as something they are not, or overwritten by an empty
// record. The original stays at its own key until the player's next save replaces
// it, and the copy stays in quarantine from then on (restoreQuarantined undoes it).

const PREFIX = 'quarantine:';
const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export const isSupportedHomeRecord = record => isPlain(record) && record.schemaVersion === HOME_SCHEMA_VERSION;

const slotsOf = (state, key) => [...state.records.keys()].filter(id => id === PREFIX + key || id.startsWith(`${PREFIX}${key}#`));

/** Hold `record` aside. The same record is held once; a different one at the same key gets its own slot. */
export function quarantineRecord(state, key, record, reason) {
  for (const id of slotsOf(state, key)) {
    const held = state.get(id);
    if (held && same(held.record, record)) return { id, key, reason: held.reason, created: false };
  }
  let n = 1, id = PREFIX + key;
  while (state.get(id)) id = `${PREFIX}${key}#${++n}`;
  state.set(id, { schemaVersion: 1, key, reason, found: isPlain(record) ? (record.schemaVersion ?? null) : typeof record, at: Date.now(), record });
  return { id, key, reason, created: true };
}

export function listQuarantine(state) {
  return [...state.records.keys()].filter(id => id.startsWith(PREFIX)).map(id => ({ id, ...state.get(id) }))
    .filter(entry => entry.key !== undefined).sort((a, b) => (a.id < b.id ? -1 : 1));
}

export const quarantineCount = state => listQuarantine(state).length;

/** Put a held record back at its key. Whatever is there now is held aside first, so nothing is lost. */
export function restoreQuarantined(state, id) {
  const entry = state.get(id);
  if (!entry || entry.key === undefined) throw new Error(`No quarantine entry ${id}`);
  const current = state.get(entry.key);
  if (current !== null && !same(current, entry.record)) quarantineRecord(state, entry.key, current, 'replaced-by-restore');
  state.set(entry.key, entry.record);
  state.set(id, null);
}

/**
 * Read a record this build owns (journey progress): the record when it is supported and passes
 * `validate`, else null. Anything else is quarantined and `quarantined` says so; nothing is overwritten.
 */
export function loadVersionedRecord(state, key, { schemaVersion, validate = () => true }) {
  const saved = state.get(key);
  if (saved === null || saved === undefined) return { record: null, quarantined: null };
  if (isPlain(saved) && saved.schemaVersion === schemaVersion && validate(saved)) return { record: saved, quarantined: null };
  const reason = isPlain(saved) && saved.schemaVersion === schemaVersion ? 'malformed' : 'unknown-schema';
  return { record: null, quarantined: quarantineRecord(state, key, saved, reason) };
}

export const newInteriorContainer = () => ({ schemaVersion: INTERIOR_SCHEMA_VERSION, layoutVersion: 2, floors: {} });

/**
 * Open the saved room at `key`.
 *   record      the container to play on (always a valid v2 container)
 *   legacy      the v1 snapshot when the room was saved before floors (it keeps its own generator)
 *   quarantined the quarantine entry when the saved record could not be read, else null
 */
export function loadInteriorRecord(state, key) {
  const saved = state.get(key);
  if (saved === null || saved === undefined) return { record: newInteriorContainer(), legacy: null, quarantined: null };
  if (isPlain(saved) && saved.schemaVersion === INTERIOR_LEGACY_SCHEMA_VERSION) return { record: newInteriorContainer(), legacy: saved, quarantined: null };
  if (isPlain(saved) && saved.schemaVersion === INTERIOR_SCHEMA_VERSION && isPlain(saved.floors)) return { record: saved, legacy: null, quarantined: null };
  const reason = isPlain(saved) && saved.schemaVersion === INTERIOR_SCHEMA_VERSION ? 'malformed' : 'unknown-schema';
  return { record: newInteriorContainer(), legacy: null, quarantined: quarantineRecord(state, key, saved, reason) };
}
