import type { Me, PlayerExport } from '../shared/api.ts';
import type { AuthUser } from './auth.ts';
import { badRequest, isObject, readJson } from './http.ts';
import { deletePlayer, resolvePlayer } from './players.ts';
import { EVENT_COLUMNS, SESSION_COLUMNS, deviceRow, eventRow, sessionRow } from './rows.ts';
import { listSaves, readSave } from './saves.ts';
import { uuid } from './validate.ts';

export async function upsertUser(db: D1Database, user: AuthUser, now: number): Promise<void> {
  await db.prepare(`INSERT INTO users (id, email, name, photo_url, created_at, last_seen_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
    ON CONFLICT(id) DO UPDATE SET email = ?2, name = COALESCE(?3, name), photo_url = COALESCE(?4, photo_url), last_seen_at = ?5`)
    .bind(user.uid, user.email, user.name, user.picture, now).run();
}

export async function getMe(db: D1Database, user: AuthUser, admin: boolean): Promise<Me> {
  const [row, devices] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT created_at FROM users WHERE id = ?1').bind(user.uid),
    db.prepare('SELECT id, user_id, created_at, last_seen_at, country FROM devices WHERE user_id = ?1 ORDER BY last_seen_at DESC').bind(user.uid)
  ]);
  return {
    id: user.uid,
    email: user.email,
    name: user.name,
    photoUrl: user.picture,
    isAdmin: admin,
    createdAt: Number(row.results[0]?.created_at) || Date.now(),
    devices: devices.results.map(r => { const { userId: _, ...d } = deviceRow(r); return d; })
  };
}

/** Signing in on a device attaches its anonymous history to the account. */
export async function linkDevice(request: Request, db: D1Database, user: AuthUser, now: number): Promise<void> {
  const body = await readJson(request, 1024);
  if (!isObject(body)) throw badRequest('body must be an object');
  const deviceId = uuid(body.deviceId, 'deviceId');
  await db.batch([
    db.prepare(`INSERT INTO devices (id, user_id, created_at, last_seen_at) VALUES (?1, ?2, ?3, ?3)
      ON CONFLICT(id) DO UPDATE SET user_id = ?2, last_seen_at = ?3`).bind(deviceId, user.uid, now),
    db.prepare('UPDATE sessions SET user_id = ?2 WHERE device_id = ?1').bind(deviceId, user.uid),
    db.prepare('UPDATE events SET user_id = ?2 WHERE device_id = ?1').bind(deviceId, user.uid),
    db.prepare('UPDATE worlds SET user_id = ?2 WHERE device_id = ?1').bind(deviceId, user.uid)
  ]);
}

export async function unlinkDevice(db: D1Database, user: AuthUser, rawId: string): Promise<void> {
  const deviceId = uuid(rawId, 'deviceId');
  const owned = await db.prepare('SELECT id FROM devices WHERE id = ?1 AND user_id = ?2').bind(deviceId, user.uid).first();
  if (!owned) return;
  await db.batch([
    db.prepare('UPDATE devices SET user_id = NULL WHERE id = ?1').bind(deviceId),
    db.prepare('UPDATE sessions SET user_id = NULL WHERE device_id = ?1').bind(deviceId),
    db.prepare('UPDATE events SET user_id = NULL WHERE device_id = ?1').bind(deviceId),
    db.prepare('UPDATE worlds SET user_id = NULL WHERE device_id = ?1').bind(deviceId)
  ]);
}

export async function deleteMe(db: D1Database, user: AuthUser): Promise<void> {
  try { await deletePlayer(db, await resolvePlayer(db, `u:${user.uid}`)); }
  catch (error) { if ((error as { status?: number }).status !== 404) throw error; }
}

export async function exportMe(db: D1Database, user: AuthUser, admin: boolean): Promise<PlayerExport> {
  const me = await getMe(db, user, admin);
  const ids = JSON.stringify(me.devices.map(d => d.id));
  const [sessions, events] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE device_id IN (SELECT value FROM json_each(?1)) OR user_id = ?2 ORDER BY started_at DESC LIMIT 2000`).bind(ids, user.uid),
    db.prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE device_id IN (SELECT value FROM json_each(?1)) OR user_id = ?2 ORDER BY at DESC LIMIT 5000`).bind(ids, user.uid)
  ]);
  const worlds = [];
  for (const s of await listSaves(db, user.uid)) {
    const save = await readSave(db, user.uid, s.worldId);
    if (save) worlds.push(save);
  }
  return { exportedAt: Date.now(), user: me, worlds, sessions: sessions.results.map(sessionRow), events: events.results.map(eventRow) };
}
