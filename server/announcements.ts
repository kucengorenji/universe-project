import type { Announcement, AnnouncementInput, Level, Surface } from '../shared/api.ts';
import { badRequest, isObject } from './http.ts';
import { finite, text } from './validate.ts';

const LEVELS = new Set<Level>(['info', 'important']);
const SURFACES = new Set<Surface>(['game', 'landing']);
const COLUMNS = 'id, level, surfaces, title_id, title_en, body_id, body_en, starts_at, ends_at, created_at, updated_at';

const row = (r: Record<string, unknown>): Announcement => ({
  id: String(r.id),
  level: r.level as Level,
  surfaces: String(r.surfaces).split(',').filter((s): s is Surface => SURFACES.has(s as Surface)),
  title: { id: String(r.title_id), en: String(r.title_en) },
  body: { id: String(r.body_id), en: String(r.body_en) },
  startsAt: Number(r.starts_at),
  endsAt: r.ends_at == null ? null : Number(r.ends_at),
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at)
});

export function cleanAnnouncement(value: unknown): AnnouncementInput {
  if (!isObject(value)) throw badRequest('body must be an object');
  const level = value.level as Level;
  if (!LEVELS.has(level)) throw badRequest('level must be info or important');
  const surfaces = Array.isArray(value.surfaces) ? [...new Set(value.surfaces)].filter((s): s is Surface => SURFACES.has(s as Surface)) : [];
  if (!surfaces.length) throw badRequest('surfaces must include game and/or landing');
  const title = isObject(value.title) ? value.title : {}, body = isObject(value.body) ? value.body : {};
  const out: AnnouncementInput = {
    level,
    surfaces,
    title: { id: text(title.id ?? '', 'title.id', 120, { allowEmpty: true }), en: text(title.en ?? '', 'title.en', 120, { allowEmpty: true }) },
    body: { id: text(body.id ?? '', 'body.id', 1000, { allowEmpty: true }), en: text(body.en ?? '', 'body.en', 1000, { allowEmpty: true }) },
    startsAt: finite(value.startsAt) ?? NaN,
    endsAt: value.endsAt == null ? null : finite(value.endsAt) ?? NaN
  };
  if (!out.title.id && !out.title.en) throw badRequest('a title in at least one language is required');
  if (!Number.isFinite(out.startsAt)) throw badRequest('startsAt must be a timestamp');
  if (out.endsAt !== null && !(Number.isFinite(out.endsAt) && out.endsAt > out.startsAt)) throw badRequest('endsAt must be after startsAt');
  return out;
}

const binds = (a: AnnouncementInput) => [a.level, a.surfaces.join(','), a.title.id, a.title.en, a.body.id, a.body.en, a.startsAt, a.endsAt] as const;

export async function activeAnnouncements(db: D1Database, surface: Surface, now: number): Promise<Announcement[]> {
  const rows = await db.prepare(`SELECT ${COLUMNS} FROM announcements
    WHERE starts_at <= ?1 AND (ends_at IS NULL OR ends_at > ?1) AND (',' || surfaces || ',') LIKE ?2
    ORDER BY level = 'important' DESC, starts_at DESC LIMIT 5`).bind(now, `%,${surface},%`).all<Record<string, unknown>>();
  return rows.results.map(row);
}

export async function listAnnouncements(db: D1Database): Promise<Announcement[]> {
  const rows = await db.prepare(`SELECT ${COLUMNS} FROM announcements ORDER BY starts_at DESC LIMIT 200`).all<Record<string, unknown>>();
  return rows.results.map(row);
}

export async function createAnnouncement(db: D1Database, input: AnnouncementInput, by: string, now: number): Promise<Announcement> {
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO announcements (id, level, surfaces, title_id, title_en, body_id, body_en, starts_at, ends_at, created_at, updated_at, created_by)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?11)`).bind(id, ...binds(input), now, by).run();
  return { id, ...input, createdAt: now, updatedAt: now };
}

export async function updateAnnouncement(db: D1Database, id: string, input: AnnouncementInput, now: number): Promise<Announcement | null> {
  const result = await db.prepare(`UPDATE announcements SET level = ?2, surfaces = ?3, title_id = ?4, title_en = ?5, body_id = ?6, body_en = ?7,
    starts_at = ?8, ends_at = ?9, updated_at = ?10 WHERE id = ?1`).bind(id, ...binds(input), now).run();
  if (!result.meta.changes) return null;
  const r = await db.prepare(`SELECT ${COLUMNS} FROM announcements WHERE id = ?1`).bind(id).first<Record<string, unknown>>();
  return r ? row(r) : null;
}

export async function deleteAnnouncement(db: D1Database, id: string): Promise<boolean> {
  return (await db.prepare('DELETE FROM announcements WHERE id = ?1').bind(id).run()).meta.changes > 0;
}
