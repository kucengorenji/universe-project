import type { EventRow, SessionRow, WorldMeta, WorldRow, Device } from '../shared/api.ts';
import { parseJson } from './validate.ts';

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' ? v : v == null ? null : Number(v));
const str = (v: unknown) => (typeof v === 'string' ? v : null);

export const SESSION_COLUMNS = 'id, device_id, started_at, last_seen_at, ended_at, world_id, mode, quality, ua, country, fps_sum, fps_n, errors';
export const EVENT_COLUMNS = 'id, at, device_id, session_id, user_id, type, name, value, data';

export const sessionRow = (r: Row): SessionRow => ({
  id: String(r.id),
  deviceId: String(r.device_id),
  startedAt: Number(r.started_at),
  lastSeenAt: Number(r.last_seen_at),
  endedAt: num(r.ended_at),
  worldId: str(r.world_id),
  mode: str(r.mode),
  quality: str(r.quality),
  ua: str(r.ua),
  country: str(r.country),
  fps: Number(r.fps_n) > 0 ? Math.round((Number(r.fps_sum) / Number(r.fps_n)) * 10) / 10 : null,
  errors: Number(r.errors) || 0
});

export const eventRow = (r: Row): EventRow => ({
  id: Number(r.id),
  at: Number(r.at),
  deviceId: String(r.device_id),
  sessionId: str(r.session_id),
  userId: str(r.user_id),
  type: String(r.type),
  name: str(r.name),
  value: num(r.value),
  data: parseJson<Record<string, unknown>>(r.data)
});

export const deviceRow = (r: Row): Device & { userId: string | null } => ({
  id: String(r.id),
  userId: str(r.user_id),
  createdAt: Number(r.created_at),
  lastSeenAt: Number(r.last_seen_at),
  country: str(r.country)
});

export const worldRow = (r: Row): WorldRow => ({
  worldId: String(r.world_id),
  seed: num(r.seed),
  deviceId: str(r.device_id),
  userId: str(r.user_id),
  email: str(r.email),
  firstSeen: Number(r.first_seen),
  lastSeen: Number(r.last_seen),
  rev: num(r.rev),
  size: num(r.size),
  meta: parseJson<WorldMeta>(r.meta)
});

/** D1 returns BLOBs as number arrays; node:sqlite as Uint8Array. */
export function blobBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  throw new Error('unexpected BLOB value');
}
