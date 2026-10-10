// Read-only numbers from the living-world proofs, for QA (window.__globe.qa.proofs()).
// A proof registers a function while it is alive; nothing here changes behaviour.
const sources = new Map();

export function registerProof(name, read) {
  sources.set(name, read);
  return () => { if (sources.get(name) === read) sources.delete(name); };
}

export function proofMetrics() {
  const out = {};
  for (const [name, read] of sources) {
    try { out[name] = read(); } catch (error) { out[name] = { error: String(error?.message ?? error) }; }
  }
  return out;
}
