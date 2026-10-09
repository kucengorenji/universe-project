// Pages Functions have no cron, so the daily rollup and the 90-day retention
// run lazily: the first telemetry batch (or admin overview) of a UTC day does it.

export const DAY = 86_400_000;
export const RETENTION_MS = 90 * DAY;
const BACKFILL_DAYS = 120;

export const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const dayStart = (key: string) => Date.parse(`${key}T00:00:00Z`);

/** Stats for the window [?2, ?3) named ?1; the same columns as daily_stats. */
export const DAY_STATS_SELECT = `SELECT ?1 AS day,
  (SELECT COUNT(DISTINCT device_id) FROM sessions WHERE last_seen_at >= ?2 AND started_at < ?3) AS active_devices,
  (SELECT COUNT(*) FROM sessions WHERE started_at >= ?2 AND started_at < ?3) AS sessions,
  (SELECT COALESCE(SUM(MIN(last_seen_at, ?3) - MAX(started_at, ?2)), 0) / 1000 FROM sessions WHERE last_seen_at >= ?2 AND started_at < ?3) AS playtime_sec,
  (SELECT COUNT(*) FROM devices WHERE created_at >= ?2 AND created_at < ?3) AS new_devices,
  (SELECT COUNT(*) FROM events WHERE type = 'world' AND name = 'created' AND at >= ?2 AND at < ?3) AS worlds_created,
  (SELECT COUNT(*) FROM events WHERE type = 'mission_done' AND at >= ?2 AND at < ?3) AS missions_done,
  (SELECT COUNT(*) FROM events WHERE type = 'error' AND at >= ?2 AND at < ?3) AS errors`;

export async function maintainIfDue(db: D1Database, now: number): Promise<boolean> {
  const row = await db.prepare(`SELECT value FROM meta WHERE key = 'maintained_day'`).first<{ value: string }>();
  if (row?.value === dayKey(now)) return false;
  await maintain(db, now);
  return true;
}

/** Rolls up every finished day not yet in daily_stats, then drops raw rows past retention. */
export async function maintain(db: D1Database, now: number): Promise<void> {
  const today = dayStart(dayKey(now));
  const last = await db.prepare('SELECT MAX(day) AS day FROM daily_stats').first<{ day: string | null }>();
  let start: number;
  if (last?.day) start = dayStart(last.day) + DAY;
  else {
    const oldest = await db.prepare('SELECT MIN(started_at) AS at FROM sessions').first<{ at: number | null }>();
    start = oldest?.at != null ? dayStart(dayKey(oldest.at)) : today;
  }
  start = Math.max(start, today - BACKFILL_DAYS * DAY);
  const statements: D1PreparedStatement[] = [];
  for (let d = start; d < today; d += DAY) {
    statements.push(db.prepare(`INSERT OR REPLACE INTO daily_stats (day, active_devices, sessions, playtime_sec, new_devices, worlds_created, missions_done, errors) ${DAY_STATS_SELECT}`).bind(dayKey(d), d, d + DAY));
  }
  // The rollup runs first in the same batch, so retention never deletes rows that were not counted.
  const cutoff = now - RETENTION_MS;
  statements.push(
    db.prepare('DELETE FROM events WHERE at < ?1').bind(cutoff),
    db.prepare('DELETE FROM sessions WHERE last_seen_at < ?1').bind(cutoff),
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('maintained_day', ?1)`).bind(dayKey(now))
  );
  await db.batch(statements);
}
