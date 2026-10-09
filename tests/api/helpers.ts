// Runs the API against node:sqlite through a minimal D1 look-alike, so route
// handlers are tested with the real SQL and migrations.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handle } from '../../server/router.ts';
import type { Env } from '../../server/env.ts';

type Value = string | number | bigint | null | Uint8Array;
const toSql = (v: unknown): Value => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v as Value);
const plain = (row: unknown) => (row ? { ...(row as object) } : null);

class Statement {
  db: DatabaseSync;
  sql: string;
  args: Value[];
  constructor(db: DatabaseSync, sql: string, args: Value[] = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }
  bind(...args: unknown[]) { return new Statement(this.db, this.sql, args.map(toSql)); }
  async first(column?: string) {
    const row = plain(this.db.prepare(this.sql).get(...this.args)) as Record<string, unknown> | null;
    return row && column ? row[column] : row;
  }
  async all() { return this.allSync(); }
  async run() { return this.runSync(); }
  allSync() { return { success: true, results: this.db.prepare(this.sql).all(...this.args).map(plain), meta: { changes: 0 } }; }
  runSync() {
    const r = this.db.prepare(this.sql).run(...this.args);
    return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  returnsRows() { return /^\s*(SELECT|WITH)\b/i.test(this.sql) || /\bRETURNING\b/i.test(this.sql); }
}

export class FakeD1 {
  sqlite = new DatabaseSync(':memory:');
  constructor() {
    const dir = new URL('../../migrations/', import.meta.url);
    for (const file of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) this.sqlite.exec(readFileSync(new URL(file, dir), 'utf8'));
  }
  prepare(sql: string) { return new Statement(this.sqlite, sql); }
  /** D1 batches are one transaction. */
  async batch(statements: Statement[]) {
    this.sqlite.exec('BEGIN');
    try {
      const out = statements.map(s => (s.returnsRows() ? s.allSync() : s.runSync()));
      this.sqlite.exec('COMMIT');
      return out;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
  rows(sql: string, ...args: unknown[]) { return this.sqlite.prepare(sql).all(...args.map(toSql)).map(plain) as Record<string, unknown>[]; }
  count(table: string) { return Number((this.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n); }
}

export const ADMIN = 'admin@example.com';
export const DASHBOARD = 'https://dashboard.example';

export function makeEnv(overrides: Partial<Env> = {}) {
  const db = new FakeD1();
  const env = {
    DB: db as unknown as D1Database,
    FIREBASE_PROJECT_ID: 'test-project',
    ADMIN_EMAILS: ` ${ADMIN.toUpperCase()} , other-admin@example.com`,
    DASHBOARD_ORIGINS: `${DASHBOARD},http://localhost:5174`,
    INSPECT_SECRET: 'test-inspect-secret',
    DEV_AUTH: '1',
    ...overrides
  } as Env;
  return { env, db };
}

export interface CallOptions {
  body?: unknown;
  raw?: string;
  as?: string; // email for a dev token
  token?: string;
  headers?: Record<string, string>;
  host?: string;
  now?: number;
}

export async function call(env: Env, method: string, path: string, opts: CallOptions = {}) {
  const headers = new Headers(opts.headers);
  if (opts.as) headers.set('authorization', `Bearer dev:${opts.as}`);
  if (opts.token) headers.set('authorization', `Bearer ${opts.token}`);
  const body = opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
  if (body !== undefined) headers.set('content-type', 'application/json');
  const waits: Promise<unknown>[] = [];
  const res = await handle(new Request(`http://${opts.host || 'localhost'}${path}`, { method, headers, body }), env, { waitUntil: p => waits.push(p) }, opts.now);
  await Promise.all(waits);
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: res.status, headers: res.headers, json, text };
}

export const deviceA = '11111111-1111-4111-8111-111111111111';
export const deviceB = '22222222-2222-4222-8222-222222222222';
export const session1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const session2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

export function batch(deviceId: string, sessionId: string, events: unknown[], extra: Record<string, unknown> = {}, sentAt = 1_000_000) {
  return { deviceId, sessionId, sentAt, locale: 'id', quality: 'high', build: 'test', events, ...extra };
}

export function snapshotBody(worldId: string, baseRev: number, extra: Record<string, unknown> = {}) {
  return {
    baseRev,
    deviceId: deviceA,
    meta: { seed: 123, subdivision: 5, planetsLanded: 2, townsVisited: 3, playtimeSec: 600, homes: 1, missionsDone: ['home'], missionItems: { done: 8, total: 18 } },
    snapshot: {
      schemaVersion: 1,
      worldId,
      savedAt: 1,
      storage: { planet_globe_map_v5: '{"seed":123}', planet_globe_missions: '{}' },
      entities: { manifest: { worldId }, 'home:0:1:abc': { id: 'abc' } }
    },
    ...extra
  };
}
