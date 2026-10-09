import type { SaveConflict, Snapshot, WorldMeta, WorldSave, WorldSummary } from '../shared/api.ts';
import { HttpError, badRequest, isObject, json, readJson } from './http.ts';
import { blobBytes } from './rows.ts';
import { finite, parseJson, uuid, worldId } from './validate.ts';

export const SAVE_BODY_LIMIT = 8 * 1024 * 1024;
const MAX_COMPRESSED = 1_900_000; // D1 rows top out at 2 MB
const STORAGE_KEY = /^planet_globe_\w{1,40}$/;

export async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export function cleanMeta(value: unknown): WorldMeta {
  const o = isObject(value) ? value : {};
  const n = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.round(finite(v) ?? 0)));
  const items = isObject(o.missionItems) ? o.missionItems : {};
  return {
    seed: finite(o.seed) ?? 0,
    subdivision: n(o.subdivision, 10),
    planetsLanded: n(o.planetsLanded, 1000),
    townsVisited: n(o.townsVisited, 100_000),
    playtimeSec: n(o.playtimeSec, 1e9),
    homes: n(o.homes, 100_000),
    missionsDone: Array.isArray(o.missionsDone) ? o.missionsDone.filter((s): s is string => typeof s === 'string' && /^[\w-]{1,32}$/.test(s)).slice(0, 50) : [],
    missionItems: { done: n(items.done, 1000), total: n(items.total, 1000) }
  };
}

export function cleanSnapshot(value: unknown, id: string): Snapshot {
  if (!isObject(value) || value.schemaVersion !== 1) throw badRequest('snapshot.schemaVersion must be 1');
  if (value.worldId !== id) throw badRequest('snapshot.worldId does not match the URL');
  const storage = value.storage, entities = value.entities;
  if (!isObject(storage) || !isObject(entities)) throw badRequest('snapshot.storage and snapshot.entities must be objects');
  const keys = Object.keys(storage);
  if (keys.length > 32 || keys.some(k => !STORAGE_KEY.test(k) || typeof storage[k] !== 'string')) throw badRequest('snapshot.storage holds planet_globe_* strings only');
  if (Object.keys(entities).length > 20_000 || Object.keys(entities).some(k => k.length > 300)) throw badRequest('snapshot.entities is too large');
  return { schemaVersion: 1, worldId: id, savedAt: finite(value.savedAt) ?? Date.now(), storage: storage as Record<string, string>, entities };
}

const summary = (r: Record<string, unknown>): WorldSummary => ({
  worldId: String(r.world_id),
  rev: Number(r.rev),
  updatedAt: Number(r.updated_at),
  size: Number(r.size),
  deviceId: (r.device_id as string) ?? null,
  meta: parseJson<WorldMeta>(r.meta) ?? cleanMeta(null)
});

export async function listSaves(db: D1Database, userId: string): Promise<WorldSummary[]> {
  const rows = await db.prepare('SELECT world_id, rev, updated_at, size, device_id, meta FROM snapshots WHERE user_id = ?1 ORDER BY updated_at DESC')
    .bind(userId).all<Record<string, unknown>>();
  return rows.results.map(summary);
}

export async function readSave(db: D1Database, userId: string, id: string): Promise<WorldSave | null> {
  const row = await db.prepare('SELECT world_id, rev, updated_at, size, device_id, meta, data FROM snapshots WHERE user_id = ?1 AND world_id = ?2')
    .bind(userId, id).first<Record<string, unknown>>();
  if (!row) return null;
  return { ...summary(row), snapshot: JSON.parse(await gunzip(blobBytes(row.data))) as Snapshot };
}

/** Optimistic write: baseRev must equal the cloud rev (0 = no cloud copy), else 409 with the cloud's state. */
export async function writeSave(request: Request, db: D1Database, userId: string, rawId: string, now: number): Promise<Response> {
  const id = worldId(rawId);
  const body = await readJson(request, SAVE_BODY_LIMIT);
  if (!isObject(body)) throw badRequest('body must be an object');
  const baseRev = finite(body.baseRev);
  if (baseRev === null || baseRev < 0 || !Number.isInteger(baseRev)) throw badRequest('baseRev must be a non-negative integer');
  const deviceId = body.deviceId === undefined ? null : uuid(body.deviceId, 'deviceId');
  const meta = JSON.stringify(cleanMeta(body.meta));
  const text = JSON.stringify(cleanSnapshot(body.snapshot, id));
  const size = new TextEncoder().encode(text).byteLength;
  const data = await gzip(text);
  if (data.byteLength > MAX_COMPRESSED) throw new HttpError(413, 'too_large', { limit: MAX_COMPRESSED });

  const result = baseRev === 0
    ? await db.prepare(`INSERT INTO snapshots (user_id, world_id, rev, device_id, meta, data, size, created_at, updated_at)
        VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?7, ?7) ON CONFLICT(user_id, world_id) DO NOTHING`)
      .bind(userId, id, deviceId, meta, data, size, now).run()
    : await db.prepare(`UPDATE snapshots SET rev = rev + 1, device_id = ?3, meta = ?4, data = ?5, size = ?6, updated_at = ?7
        WHERE user_id = ?1 AND world_id = ?2 AND rev = ?8`)
      .bind(userId, id, deviceId, meta, data, size, now, baseRev).run();
  if (result.meta.changes) return json({ rev: baseRev + 1, updatedAt: now });

  const current = await db.prepare('SELECT rev, updated_at, device_id, meta FROM snapshots WHERE user_id = ?1 AND world_id = ?2')
    .bind(userId, id).first<Record<string, unknown>>();
  const conflict: SaveConflict = {
    error: 'conflict',
    rev: current ? Number(current.rev) : 0,
    updatedAt: current ? Number(current.updated_at) : null,
    deviceId: (current?.device_id as string) ?? null,
    meta: current ? parseJson<WorldMeta>(current.meta) : null
  };
  return json(conflict, 409);
}
