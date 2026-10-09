import type { Env, Ctx } from './env.ts';
import { HttpError, badRequest, isObject, readJson } from './http.ts';
import { maintainIfDue, DAY } from './maintenance.ts';
import { WORLD_ID, eventName, finite, optionalText, smallJson, uuid, worldParts } from './validate.ts';

const TYPES = new Set(['session_start', 'heartbeat', 'session_end', 'mode', 'mission', 'mission_done', 'world', 'error']);
// Heartbeats only move the session row; storing them as events would cost a write per minute per player.
const STORED = new Set(['session_start', 'session_end', 'mode', 'mission', 'mission_done', 'world', 'error']);
const QUALITIES = new Set(['auto', 'high', 'medium', 'low']);
const MAX_EVENTS = 100;
export const TELEMETRY_LIMIT = 64 * 1024; // sendBeacon's own cap

/** "Chrome · macOS" style label; the raw user agent is never stored. */
export function coarseUserAgent(ua: string | null): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'Other';
  return `${browser} · ${os}${/Mobi/.test(ua) ? ' · mobile' : ''}`;
}

export function countryOf(request: Request): string | null {
  const cf = (request as Request & { cf?: { country?: unknown } }).cf;
  const c = typeof cf?.country === 'string' ? cf.country : request.headers.get('cf-ipcountry');
  return c && /^[A-Z0-9]{2}$/.test(c) ? c : null;
}

interface Parsed { at: number; type: string; name: string | null; value: number | null; data: string | null }

export async function ingestTelemetry(request: Request, env: Env, ctx: Ctx, now = Date.now()): Promise<Response> {
  const body = await readJson(request, TELEMETRY_LIMIT);
  if (!isObject(body)) throw badRequest('body must be an object');
  const deviceId = uuid(body.deviceId, 'deviceId');
  const sessionId = uuid(body.sessionId, 'sessionId');
  if (!Array.isArray(body.events) || body.events.length === 0) throw badRequest('events must be a non-empty array');
  if (body.events.length > MAX_EVENTS) throw new HttpError(413, 'too_many_events', { limit: MAX_EVENTS });
  // Client clocks drift: place each event at server time minus its age within the batch.
  const sentAt = finite(body.sentAt) ?? now;
  const locale = optionalText(body.locale, 10);
  const quality = typeof body.quality === 'string' && QUALITIES.has(body.quality) ? body.quality : null;
  const build = optionalText(body.build, 40);
  const country = countryOf(request);
  const ua = coarseUserAgent(request.headers.get('user-agent'));

  let worldId = typeof body.worldId === 'string' && WORLD_ID.test(body.worldId) ? body.worldId : null;
  let valid = 0, fpsSum = 0, fpsN = 0, errors = 0, ended: number | null = null, mode: string | null = null;
  const events: Parsed[] = [];
  const worlds = new Map<string, number>();
  for (const raw of body.events) {
    if (!isObject(raw) || typeof raw.type !== 'string' || !TYPES.has(raw.type)) continue;
    valid++;
    const t = finite(raw.t);
    const at = t === null ? now : now - Math.min(DAY, Math.max(0, sentAt - t));
    const name = eventName(raw.name);
    const value = finite(raw.value);
    if (raw.type === 'heartbeat' && value !== null && value > 0 && value < 1000) { fpsSum += value; fpsN++; }
    if (raw.type === 'error') errors++;
    if (raw.type === 'session_end') ended = at;
    if (raw.type === 'mode' && name) mode = name;
    if (raw.type === 'world' && isObject(raw.data) && typeof raw.data.worldId === 'string' && WORLD_ID.test(raw.data.worldId)) {
      worldId = raw.data.worldId;
      worlds.set(worldId, at);
    }
    if (STORED.has(raw.type)) events.push({ at, type: raw.type, name, value, data: smallJson(raw.data, 2048) });
  }
  // A heartbeat without a frame rate (menu open) still keeps the session alive.
  if (!valid) return new Response(null, { status: 204 });
  const startedAt = Math.min(now, ...events.map(e => e.at));

  const db = env.DB;
  const device = await db.prepare(`INSERT INTO devices (id, created_at, last_seen_at, country, locale, build) VALUES (?1, ?2, ?2, ?3, ?4, ?5)
    ON CONFLICT(id) DO UPDATE SET last_seen_at = ?2, country = COALESCE(?3, country), locale = COALESCE(?4, locale), build = COALESCE(?5, build)
    RETURNING user_id`).bind(deviceId, now, country, locale, build).first<{ user_id: string | null }>();
  const userId = device?.user_id ?? null;

  const statements: D1PreparedStatement[] = [
    // The WHERE keeps another device from writing into a session id it guessed.
    db.prepare(`INSERT INTO sessions (id, device_id, user_id, started_at, last_seen_at, ended_at, world_id, mode, quality, ua, country, fps_sum, fps_n, errors)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
      ON CONFLICT(id) DO UPDATE SET last_seen_at = MAX(last_seen_at, ?5), ended_at = COALESCE(?6, ended_at), world_id = COALESCE(?7, world_id),
        mode = COALESCE(?8, mode), quality = COALESCE(?9, quality), user_id = COALESCE(?3, user_id),
        fps_sum = fps_sum + ?12, fps_n = fps_n + ?13, errors = errors + ?14
      WHERE device_id = ?2`)
      .bind(sessionId, deviceId, userId, startedAt, now, ended, worldId, mode, quality, ua, country, fpsSum, fpsN, errors)
  ];
  for (const [id, at] of worlds) {
    const { seed, subdivision } = worldParts(id);
    statements.push(db.prepare(`INSERT INTO worlds (device_id, world_id, user_id, seed, subdivision, first_seen, last_seen) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
      ON CONFLICT(device_id, world_id) DO UPDATE SET last_seen = MAX(last_seen, ?6), user_id = COALESCE(?3, user_id)`)
      .bind(deviceId, id, userId, seed, subdivision, at));
  }
  for (const e of events) {
    statements.push(db.prepare('INSERT INTO events (at, device_id, session_id, user_id, type, name, value, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)')
      .bind(e.at, deviceId, sessionId, userId, e.type, e.name, e.value, e.data));
  }
  await db.batch(statements);
  ctx.waitUntil(maintainIfDue(db, now).catch(error => console.error('maintenance failed', error)));
  return new Response(null, { status: 204 });
}
