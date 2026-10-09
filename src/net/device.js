import { KEYS, storageOr } from './config.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The anonymous id of this browser install; created on first use. */
export function deviceId(storage) {
  const s = storageOr(storage);
  try {
    const saved = s?.getItem(KEYS.device);
    if (saved && UUID.test(saved)) return saved;
  } catch { /* fall through */ }
  const id = crypto.randomUUID();
  try { s?.setItem(KEYS.device, id); } catch { /* an id per page load is still fine */ }
  return id;
}

/** One id per page load of /play/. */
export const SESSION_ID = globalThis.crypto?.randomUUID ? crypto.randomUUID() : null;
