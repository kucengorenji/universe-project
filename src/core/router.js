// Hash routes, one per mode:
//   #/space            ship parked in the system (optionally #/space/<planet>)
//   #/planet/<i>       globe of planet i (optionally /city/<c> to focus a city)
//   #/town/<i>/<c>     inside city c of planet i
//   #/home/<i>/<c>/<id> edit one immutable building/lot identity

export const isSafeHomeId = id => typeof id === 'string' && /^[a-zA-Z0-9:_-]{1,240}$/.test(id);

export function parseRoute(hash) {
  const parts = String(hash || '')
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean);
  const num = (v) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : null);
  switch (parts[0]) {
    case 'space':
      return { mode: 'space', planet: num(parts[1]) };
    case 'planet':
      if (num(parts[1]) === null) return null;
      return { mode: 'planet', planet: num(parts[1]), city: parts[2] === 'city' ? num(parts[3]) : null };
    case 'town':
      if (num(parts[1]) === null || num(parts[2]) === null) return null;
      return { mode: 'town', planet: num(parts[1]), city: num(parts[2]) };
    case 'home': {
      if (parts.length !== 4 || num(parts[1]) === null || num(parts[2]) === null) return null;
      let home;
      try { home = decodeURIComponent(parts[3]); } catch { return null; }
      return isSafeHomeId(home) ? { mode: 'home', planet: num(parts[1]), city: num(parts[2]), home } : null;
    }
    default:
      return null;
  }
}

export function formatRoute(r) {
  if (r.mode === 'space') return r.planet !== null && r.planet !== undefined ? `#/space/${r.planet}` : '#/space';
  if (r.mode === 'planet') return r.city !== null && r.city !== undefined ? `#/planet/${r.planet}/city/${r.city}` : `#/planet/${r.planet}`;
  if (r.mode === 'home') {
    if (!isSafeHomeId(r.home)) throw new TypeError('Identitas rumah tidak valid');
    return `#/home/${r.planet}/${r.city}/${encodeURIComponent(r.home)}`;
  }
  return `#/town/${r.planet}/${r.city}`;
}
