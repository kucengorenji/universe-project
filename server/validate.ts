import { badRequest, isObject } from './http.ts';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// world.js: `world:${seed}:grid:${subdivision}`; seeds are any Number the player typed.
export const WORLD_ID = /^world:[-+.\deE]{1,32}:grid:\d{1,2}$/;
const NAME = /^[\w.:\-/ ]{1,64}$/;

export function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw badRequest(`${field} must be a UUID`);
  return value.toLowerCase();
}

export function worldId(value: unknown): string {
  if (typeof value !== 'string' || !WORLD_ID.test(value)) throw badRequest('invalid worldId');
  return value;
}

export function optionalText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim().slice(0, max);
  return s || null;
}

export function text(value: unknown, field: string, max: number, { allowEmpty = false } = {}): string {
  if (typeof value !== 'string') throw badRequest(`${field} must be text`);
  const s = value.trim();
  if (!allowEmpty && !s) throw badRequest(`${field} is required`);
  if (s.length > max) throw badRequest(`${field} is longer than ${max}`);
  return s;
}

export function eventName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.slice(0, 64);
  return NAME.test(s) ? s : s.replace(/[^\w.:\-/ ]/g, '_') || null;
}

export function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** JSON-encodes a small object, or null if it is missing or larger than `max` bytes. */
export function smallJson(value: unknown, max: number): string | null {
  if (!isObject(value)) return null;
  const s = JSON.stringify(value);
  return s.length <= max ? s : null;
}

export function parseJson<T>(value: unknown): T | null {
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

/** Seed and grid level from a world id; null parts when they are not plain numbers. */
export function worldParts(id: string): { seed: number | null; subdivision: number | null } {
  const m = /^world:(.+):grid:(\d+)$/.exec(id);
  const seed = m ? Number(m[1]) : NaN;
  return { seed: Number.isFinite(seed) ? seed : null, subdivision: m ? Number(m[2]) : null };
}
