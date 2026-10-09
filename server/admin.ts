import type { AdminLogRow, DailyStat, EventRow, Overview, PlayerDetail, WorldRow } from '../shared/api.ts';
import { HttpError } from './http.ts';
import { DAY, DAY_STATS_SELECT, dayKey, dayStart, maintainIfDue } from './maintenance.ts';
import { playerRowFor, resolvePlayer } from './players.ts';
import { EVENT_COLUMNS, SESSION_COLUMNS, deviceRow, eventRow, sessionRow, worldRow } from './rows.ts';

type Row = Record<string, unknown>;

const dailyStat = (r: Row): DailyStat => ({
  day: String(r.day),
  activeDevices: Number(r.active_devices) || 0,
  sessions: Number(r.sessions) || 0,
  playtimeSec: Number(r.playtime_sec) || 0,
  newDevices: Number(r.new_devices) || 0,
  worldsCreated: Number(r.worlds_created) || 0,
  missionsDone: Number(r.missions_done) || 0,
  errors: Number(r.errors) || 0
});

export async function overview(db: D1Database, now: number, days: number): Promise<Overview> {
  await maintainIfDue(db, now);
  const todayKey = dayKey(now), today = dayStart(todayKey), week = now - 7 * DAY;
  const [kpi, daily, live, missions, modes, quality, errors] = await db.batch<Row>([
    db.prepare(`SELECT
      (SELECT COUNT(DISTINCT device_id) FROM sessions WHERE last_seen_at >= ?1) AS active_today,
      (SELECT COUNT(DISTINCT device_id) FROM sessions WHERE last_seen_at >= ?2) AS active_7d,
      (SELECT COUNT(*) FROM sessions WHERE started_at >= ?1) AS sessions_today,
      (SELECT COUNT(*) FROM devices WHERE user_id IS NULL) + (SELECT COUNT(*) FROM users) AS players,
      (SELECT COUNT(*) FROM users) AS signed_in,
      (SELECT COUNT(*) FROM worlds) AS worlds,
      (SELECT COUNT(*) FROM snapshots) AS cloud_saves,
      (SELECT COALESCE(AVG(last_seen_at - started_at), 0) / 1000 FROM sessions WHERE started_at >= ?2) AS avg_session_sec,
      (SELECT CASE WHEN SUM(fps_n) > 0 THEN SUM(fps_sum) / SUM(fps_n) END FROM sessions WHERE started_at >= ?2) AS fps,
      (SELECT COUNT(*) FROM events WHERE type = 'error' AND at >= ?3) AS errors_24h`).bind(today, week, now - DAY),
    db.prepare('SELECT * FROM daily_stats WHERE day >= ?1 AND day < ?2 ORDER BY day').bind(dayKey(today - (days - 1) * DAY), todayKey),
    db.prepare(DAY_STATS_SELECT).bind(todayKey, today, today + DAY),
    db.prepare(`SELECT type, name, COUNT(DISTINCT device_id) AS n FROM events WHERE type IN ('mission', 'mission_done') AND name IS NOT NULL GROUP BY type, name`),
    db.prepare(`SELECT name, COUNT(*) AS n FROM events WHERE type = 'mode' AND at >= ?1 AND name IS NOT NULL GROUP BY name ORDER BY n DESC`).bind(week),
    db.prepare(`SELECT COALESCE(quality, 'unknown') AS quality, COUNT(*) AS n FROM sessions WHERE started_at >= ?1 GROUP BY 1 ORDER BY n DESC`).bind(week),
    db.prepare(`SELECT name, COUNT(*) AS n, MAX(at) AS last_at FROM events WHERE type = 'error' AND at >= ?1 GROUP BY name ORDER BY n DESC LIMIT 10`).bind(week)
  ]);
  const k = kpi.results[0] || {};

  // Fill gaps so the chart has one point per day, including today's live numbers.
  const byDay = new Map(daily.results.map(r => [String(r.day), dailyStat(r)]));
  if (live.results[0]) byDay.set(todayKey, dailyStat(live.results[0]));
  const series: DailyStat[] = [];
  for (let d = today - (days - 1) * DAY; d <= today; d += DAY) {
    const key = dayKey(d);
    series.push(byDay.get(key) || dailyStat({ day: key }));
  }

  const funnel = new Map<string, { mission: string; done: number; items: { item: string; done: number }[] }>();
  const missionOf = (id: string) => {
    if (!funnel.has(id)) funnel.set(id, { mission: id, done: 0, items: [] });
    return funnel.get(id)!;
  };
  for (const r of missions.results) {
    const name = String(r.name);
    if (r.type === 'mission_done') missionOf(name).done = Number(r.n);
    else {
      const [mission, item] = name.split('.');
      if (mission && item) missionOf(mission).items.push({ item, done: Number(r.n) });
    }
  }

  return {
    generatedAt: now,
    kpis: {
      activeToday: Number(k.active_today) || 0,
      active7d: Number(k.active_7d) || 0,
      sessionsToday: Number(k.sessions_today) || 0,
      players: Number(k.players) || 0,
      signedIn: Number(k.signed_in) || 0,
      worlds: Number(k.worlds) || 0,
      cloudSaves: Number(k.cloud_saves) || 0,
      avgSessionSec7d: Math.round(Number(k.avg_session_sec) || 0),
      fps7d: k.fps == null ? null : Math.round(Number(k.fps) * 10) / 10,
      errors24h: Number(k.errors_24h) || 0
    },
    daily: series,
    missions: [...funnel.values()],
    modes: modes.results.map(r => ({ mode: String(r.name), count: Number(r.n) })),
    quality: quality.results.map(r => ({ quality: String(r.quality), sessions: Number(r.n) })),
    errors: errors.results.map(r => ({ message: String(r.name), count: Number(r.n), lastAt: Number(r.last_at) }))
  };
}

const WORLD_SELECT = `SELECT w.world_id, w.seed, w.device_id, w.user_id, u.email, w.first_seen, w.last_seen, s.rev, s.size, s.meta
    FROM worlds w LEFT JOIN snapshots s ON s.world_id = w.world_id AND s.user_id = w.user_id LEFT JOIN users u ON u.id = w.user_id
  UNION ALL
  SELECT s.world_id, json_extract(s.meta, '$.seed'), s.device_id, s.user_id, u.email, s.created_at, s.updated_at, s.rev, s.size, s.meta
    FROM snapshots s LEFT JOIN users u ON u.id = s.user_id
    WHERE NOT EXISTS (SELECT 1 FROM worlds w WHERE w.world_id = s.world_id AND w.user_id = s.user_id)`;

export async function playerDetail(db: D1Database, key: string): Promise<PlayerDetail> {
  const player = await resolvePlayer(db, key);
  const row = await playerRowFor(db, key);
  if (!row) throw new HttpError(404, 'not_found');
  const ids = JSON.stringify(player.deviceIds);
  const owned = '(device_id IN (SELECT value FROM json_each(?1)) OR (?2 IS NOT NULL AND user_id = ?2))';
  const [devices, sessions, events, worlds] = await db.batch<Row>([
    db.prepare('SELECT id, user_id, created_at, last_seen_at, country FROM devices WHERE id IN (SELECT value FROM json_each(?1)) ORDER BY last_seen_at DESC').bind(ids),
    db.prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE ${owned} ORDER BY started_at DESC LIMIT 50`).bind(ids, player.userId),
    db.prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE ${owned} ORDER BY at DESC LIMIT 100`).bind(ids, player.userId),
    db.prepare(`SELECT * FROM (${WORLD_SELECT}) WHERE ${owned} ORDER BY last_seen DESC LIMIT 100`).bind(ids, player.userId)
  ]);
  return {
    player: row,
    devices: devices.results.map(deviceRow),
    sessions: sessions.results.map(sessionRow),
    events: events.results.map(eventRow),
    worlds: worlds.results.map(worldRow)
  };
}

export async function listWorlds(db: D1Database, limit: number, offset: number): Promise<{ items: WorldRow[]; total: number }> {
  const [rows, total] = await db.batch<Row>([
    db.prepare(`SELECT * FROM (${WORLD_SELECT}) ORDER BY last_seen DESC LIMIT ?1 OFFSET ?2`).bind(limit, offset),
    db.prepare(`SELECT COUNT(*) AS n FROM (${WORLD_SELECT})`)
  ]);
  return { items: rows.results.map(worldRow), total: Number(total.results[0]?.n) || 0 };
}

export async function listEvents(db: D1Database, filter: { type: string; device: string; before: number; limit: number }): Promise<EventRow[]> {
  const rows = await db.prepare(`SELECT ${EVENT_COLUMNS} FROM events
    WHERE (?1 = '' OR type = ?1) AND (?2 = '' OR device_id = ?2) AND (?3 = 0 OR id < ?3) ORDER BY id DESC LIMIT ?4`)
    .bind(filter.type, filter.device, filter.before, filter.limit).all<Row>();
  return rows.results.map(eventRow);
}

export async function logAction(db: D1Database, admin: string, action: string, target: string, detail: unknown, now: number): Promise<void> {
  await db.prepare('INSERT INTO admin_log (at, admin_email, action, target, detail) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(now, admin, action, target, detail == null ? null : JSON.stringify(detail)).run();
}

export async function listLog(db: D1Database, limit: number): Promise<AdminLogRow[]> {
  const rows = await db.prepare('SELECT id, at, admin_email, action, target, detail FROM admin_log ORDER BY id DESC LIMIT ?1').bind(limit).all<Row>();
  return rows.results.map(r => ({
    id: Number(r.id), at: Number(r.at), adminEmail: String(r.admin_email), action: String(r.action), target: String(r.target), detail: (r.detail as string) ?? null
  }));
}
