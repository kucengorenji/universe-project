/**
 * A pack the town can do without (another source or a primitive stands in): a failed load
 * becomes `null` and a console warning instead of failing the whole mode.
 */
export function optionalPack(promise, label = 'pack') {
  return Promise.resolve(promise).catch((error) => {
    console.warn(`Optional ${label} failed to load; continuing without it:`, error);
    return null;
  });
}
