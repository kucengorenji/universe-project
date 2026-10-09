import { BUILD, KEYS, apiUrl, storageOr } from './config.js';
import { SESSION_ID, deviceId } from './device.js';

// Anonymous usage data: session lifecycle, mode changes, mission progress,
// worlds, errors and frame rate. Events queue in memory and leave in batches
// (sendBeacon, so a closing tab still delivers). The player can opt out in the
// pause menu; automated browsers (navigator.webdriver) never send.

const MAX_QUEUE = 300;
const MAX_BATCH = 100;
const MAX_ERRORS = 10;

export function beacon(url, body) {
  try {
    if (navigator.sendBeacon?.(url, new Blob([body], { type: 'application/json' }))) return;
  } catch { /* fall back to fetch */ }
  fetch(url, { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: body.length < 60_000 }).catch(() => {});
}

export function telemetryAllowed(storage) {
  try {
    if (storage?.getItem(KEYS.telemetry) === 'off') return false;
  } catch { /* storage blocked: the default applies */ }
  return !globalThis.navigator?.webdriver;
}

export class Telemetry {
  /**
   * @param {{ storage?: Storage, send?: (url: string, body: string) => void, now?: () => number,
   *           context?: () => Record<string, unknown>, enabled?: boolean }} [options]
   *   enabled: false turns it off regardless of the player's choice (inspect mode)
   */
  constructor({ storage, send = beacon, now = () => Date.now(), context = () => ({}), enabled } = {}) {
    this.storage = storageOr(storage);
    this.send = send;
    this.now = now;
    this.context = context;
    this.forced = enabled;
    this.deviceId = deviceId(this.storage);
    this.sessionId = SESSION_ID || crypto.randomUUID();
    this.queue = [];
    this.errors = new Set();
  }

  get enabled() {
    return this.forced !== false && telemetryAllowed(this.storage);
  }

  setEnabled(on) {
    try {
      if (on) this.storage?.removeItem(KEYS.telemetry);
      else this.storage?.setItem(KEYS.telemetry, 'off');
    } catch { /* the choice lasts for this page only */ }
    if (!on) this.queue = [];
  }

  /** type: see shared/api.ts EventType. */
  track(type, name, value, data) {
    if (!this.enabled) return;
    const event = { t: this.now(), type };
    if (name != null) event.name = String(name).slice(0, 64);
    if (typeof value === 'number' && Number.isFinite(value)) event.value = value;
    if (data) event.data = data;
    this.queue.push(event);
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    if (this.queue.length >= MAX_BATCH) this.flush();
  }

  /** Each distinct message once per session, at most MAX_ERRORS. */
  error(message, source, line) {
    const text = String(message || 'Error').slice(0, 300);
    if (this.errors.has(text) || this.errors.size >= MAX_ERRORS) return;
    this.errors.add(text);
    const file = source ? String(source).split(/[?#]/)[0].split('/').filter(Boolean).pop()?.slice(0, 80) : undefined;
    this.track('error', text, undefined, { message: text, source: file, line: Number.isFinite(line) ? line : undefined });
  }

  flush() {
    if (!this.enabled || !this.queue.length) return false;
    while (this.queue.length) {
      const events = this.queue.splice(0, MAX_BATCH);
      this.send(apiUrl('/telemetry'), JSON.stringify({
        deviceId: this.deviceId, sessionId: this.sessionId, sentAt: this.now(), build: BUILD, ...this.context(), events
      }));
    }
    return true;
  }
}
