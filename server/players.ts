import type { PlayerRow } from '../shared/api.ts';
import { HttpError } from './http.ts';

// A player is a Google account (u:<uid>) with its linked devices, or one
// anonymous device (d:<deviceId>) that never signed in.

export interface ResolvedPlayer {
  key: string;
  userId: string | null;
  deviceIds: string[];
}

export async function resolvePlayer(db: D1Database, key: string): Promise<ResolvedPlayer> {
  const m = /^(u|d):(.{1,128})$/.exec(key);
  if (!m) throw new HttpError(400, 'bad_request', { detail: 'player key must be u:<uid> or d:<deviceId>' });
  if (m[1] === 'u') {
    const user = await db.prepare('SELECT id FROM users WHERE id = ?1').bind(m[2]).first<{ id: string }>();
    const devices = await db.prepare('SELECT id FROM devices WHERE user_id = ?1').bind(m[2]).all<{ id: string }>();
    if (!user && !devices.results.length) throw new HttpError(404, 'not_found');
    return { key, userId: m[2], deviceIds: devices.results.map(d => d.id) };
  }
  const device = await db.prepare('SELECT id, user_id FROM devices WHERE id = ?1').bind(m[2]).first<{ id: string; user_id: string | null }>();
  if (!device) throw new HttpError(404, 'not_found');
  return { key, userId: null, deviceIds: [device.id] };
}

/** Removes every row the player owns. Returns what went, for the audit log. */
export async function deletePlayer(db: D1Database, player: ResolvedPlayer): Promise<{ devices: number; snapshots: number; events: number }> {
  const ids = JSON.stringify(player.deviceIds);
  const uid = player.userId;
  const owned = '(device_id IN (SELECT value FROM json_each(?1)) OR (?2 IS NOT NULL AND user_id = ?2))';
  const results = await db.batch([
    db.prepare(`DELETE FROM events WHERE ${owned}`).bind(ids, uid),
    db.prepare(`DELETE FROM sessions WHERE ${owned}`).bind(ids, uid),
    db.prepare(`DELETE FROM worlds WHERE ${owned}`).bind(ids, uid),
    db.prepare('DELETE FROM devices WHERE id IN (SELECT value FROM json_each(?1))').bind(ids),
    db.prepare('DELETE FROM snapshots WHERE user_id = ?1').bind(uid),
    db.prepare('DELETE FROM users WHERE id = ?1').bind(uid)
  ]);
  return { events: results[0].meta.changes, devices: results[3].meta.changes, snapshots: results[4].meta.changes };
}

const PLAYERS_CTE = `WITH p AS (
    SELECT CASE WHEN user_id IS NULL THEN 'd:' || id ELSE 'u:' || user_id END AS key, user_id, created_at, last_seen_at, country, 1 AS is_device FROM devices
    UNION ALL
    SELECT 'u:' || id, id, created_at, last_seen_at, NULL, 0 FROM users
  ), filtered AS (
    SELECT p.*, u.email, u.name FROM p LEFT JOIN users u ON u.id = p.user_id
    WHERE ?1 = '' OR u.email LIKE ?2 ESCAPE '\\' OR u.name LIKE ?2 ESCAPE '\\' OR p.key LIKE ?2 ESCAPE '\\'
  )`;

export async function listPlayers(db: D1Database, q: string, limit: number, offset: number): Promise<{ items: PlayerRow[]; total: number }> {
  const like = `%${q.replace(/[\\%_]/g, c => `\\${c}`)}%`;
  const [rows, total] = await db.batch<Record<string, unknown>>([
    db.prepare(`${PLAYERS_CTE}
      SELECT key, MAX(user_id) AS user_id, MAX(email) AS email, MAX(name) AS name, SUM(is_device) AS devices,
        MIN(created_at) AS first_seen, MAX(last_seen_at) AS last_seen, MAX(country) AS country
      FROM filtered GROUP BY key ORDER BY last_seen DESC LIMIT ?3 OFFSET ?4`).bind(q, like, limit, offset),
    db.prepare(`${PLAYERS_CTE} SELECT COUNT(DISTINCT key) AS n FROM filtered`).bind(q, like)
  ]);
  return { items: rows.results.map(playerRow), total: Number(total.results[0]?.n) || 0 };
}

export async function playerRowFor(db: D1Database, key: string): Promise<PlayerRow | null> {
  const row = await db.prepare(`${PLAYERS_CTE}
    SELECT key, MAX(user_id) AS user_id, MAX(email) AS email, MAX(name) AS name, SUM(is_device) AS devices,
      MIN(created_at) AS first_seen, MAX(last_seen_at) AS last_seen, MAX(country) AS country
    FROM filtered WHERE key = ?3 GROUP BY key`).bind('', '%', key).first<Record<string, unknown>>();
  return row ? playerRow(row) : null;
}

const playerRow = (r: Record<string, unknown>): PlayerRow => ({
  key: String(r.key),
  userId: (r.user_id as string) ?? null,
  email: (r.email as string) ?? null,
  name: (r.name as string) ?? null,
  devices: Number(r.devices) || 0,
  firstSeen: Number(r.first_seen),
  lastSeen: Number(r.last_seen),
  country: (r.country as string) ?? null
});
