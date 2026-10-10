// What a route really fetched, for QA (window.__globe.qa.proofs().bytes). Reads the browser's
// resource timing; nothing here changes behaviour. `transfer` is what crossed the network (0 for a cache
// hit; dev servers do not compress), `encoded` the body as sent, `decoded` the body after decompression.

const KIND = [[/\.(glb|gltf)(\?|$)/i, 'model'], [/\.(png|jpe?g|webp|ktx2)(\?|$)/i, 'texture'], [/\.(m?js)(\?|$)/i, 'script'], [/\.css(\?|$)/i, 'style'], [/\.json(\?|$)/i, 'data'], [/\.(woff2?|ttf)(\?|$)/i, 'font']];
const kindOf = (name) => (KIND.find(([re]) => re.test(name)) ?? [null, 'other'])[1];
const file = (name) => { try { return new URL(name, 'http://x').pathname.split('/').pop() || name; } catch { return String(name).split('/').pop(); } };
const MiB = 1048576;

export const marks = [];

/** The director calls this when a route starts loading, so bytes can be split per route. */
export function markRoute(mode, at = typeof performance !== 'undefined' ? performance.now() : 0) {
  marks.push({ mode, at });
  if (marks.length > 200) marks.shift();
}

export function summarize(entries, { top = 12 } = {}) {
  const out = { count: 0, transfer: 0, encoded: 0, decoded: 0, byKind: {}, largest: [] };
  for (const e of entries) {
    const kind = kindOf(e.name), transfer = e.transferSize || 0, encoded = e.encodedBodySize || 0, decoded = e.decodedBodySize || 0;
    out.count++; out.transfer += transfer; out.encoded += encoded; out.decoded += decoded;
    const k = (out.byKind[kind] ||= { count: 0, transfer: 0, encoded: 0, decoded: 0 });
    k.count++; k.transfer += transfer; k.encoded += encoded; k.decoded += decoded;
  }
  out.largest = [...entries].sort((a, b) => (b.decodedBodySize || 0) - (a.decodedBodySize || 0)).slice(0, top)
    .map((e) => ({ file: file(e.name), kind: kindOf(e.name), transfer: e.transferSize || 0, encoded: e.encodedBodySize || 0, decoded: e.decodedBodySize || 0 }));
  out.transferMiB = +(out.transfer / MiB).toFixed(2);
  out.decodedMiB = +(out.decoded / MiB).toFixed(2);
  return out;
}

/** Resources split by the route that was loading when they started: [{ mode, at, ...summary }]. */
export function byRoute(entries, routeMarks = marks) {
  return routeMarks.map((mark, i) => {
    const end = routeMarks[i + 1]?.at ?? Infinity;
    return { mode: mark.mode, at: Math.round(mark.at), ...summarize(entries.filter((e) => e.startTime >= mark.at && e.startTime < end), { top: 6 }) };
  });
}

export function resourceBytes({ entries = performance.getEntriesByType('resource') } = {}) {
  return { page: summarize(entries), routes: byRoute(entries) };
}
