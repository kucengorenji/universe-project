// Switches for the living-world experiments (LIVING_WORLD_BOOK §10). All are ON by default and
// can be turned off to isolate a regression:
//   ?exp=none            every experiment off
//   ?off=grass,greet     just these off        ?on=night   force these on
//   localStorage planet_globe_experiments = {"grass":false}   (kept until removed)
// The query wins over storage, storage over the defaults.

export const EXPERIMENTS = Object.freeze({
  grass: 'grass bends where the player walks (Proof 1)',
  greet: 'a named townsperson greets the player (Proof 2)',
  night: 'warm night palette and a readable home marker (Proof 3)',
  lazyInterior: 'furniture loads when a door is near, not on entering town',
  lazyBodies: "the women's body and its atlases load just after the town is on screen (Hemat bytes)",
  lowAtlas: 'the Low tier uses the 1024 character atlases'
});

const KEY = 'planet_globe_experiments';
const list = (value) => String(value || '').split(',').map((s) => s.trim()).filter(Boolean);

export function resolveExperiments({ search = '', storage = null } = {}) {
  const flags = Object.fromEntries(Object.keys(EXPERIMENTS).map((name) => [name, true]));
  try {
    const saved = JSON.parse(storage?.getItem(KEY) || '{}');
    if (saved && typeof saved === 'object') for (const name of Object.keys(flags)) if (typeof saved[name] === 'boolean') flags[name] = saved[name];
  } catch { /* unreadable storage: defaults */ }
  const query = new URLSearchParams(search);
  if (query.get('exp') === 'none') for (const name of Object.keys(flags)) flags[name] = false;
  for (const name of list(query.get('off'))) if (name in flags) flags[name] = false;
  for (const name of list(query.get('on'))) if (name in flags) flags[name] = true;
  return Object.freeze(flags);
}

let current = null;
const browserStorage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

/** The flags for this page load. */
export function experiments() {
  return (current ||= resolveExperiments({ search: globalThis.location?.search || '', storage: browserStorage() }));
}

export const isOn = (name) => experiments()[name] === true;

/** Tests and QA: recompute from a fresh query/storage. */
export function resetExperiments(options) {
  current = options ? resolveExperiments(options) : null;
  return experiments();
}
