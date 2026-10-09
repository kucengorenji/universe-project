import test from 'node:test';
import assert from 'node:assert/strict';
import { batch, call, deviceA, deviceB, makeEnv, session1, session2 } from './helpers.ts';
import { DAY, RETENTION_MS, dayKey } from '../../server/maintenance.ts';
import { coarseUserAgent } from '../../server/telemetry.ts';

const NOW = Date.parse('2026-10-09T12:00:00Z');
const WORLD = 'world:123456:grid:5';

test('a batch records the device, the session and meaningful events, but not heartbeats', async () => {
  const { env, db } = makeEnv();
  const res = await call(env, 'POST', '/api/telemetry', {
    now: NOW,
    headers: { 'cf-ipcountry': 'ID', 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/141.0 Safari/537.36' },
    body: batch(deviceA, session1, [
      { t: 1000, type: 'session_start' },
      { t: 2000, type: 'world', name: 'created', data: { worldId: WORLD, seed: 123456 } },
      { t: 3000, type: 'mode', name: 'planet' },
      { t: 4000, type: 'heartbeat', value: 58 },
      { t: 5000, type: 'heartbeat', value: 62 },
      { t: 6000, type: 'mission', name: 'home.enter' },
      { t: 7000, type: 'nonsense' }
    ], { worldId: WORLD }, 10_000)
  });
  assert.equal(res.status, 204);
  const [device] = db.rows('SELECT * FROM devices');
  assert.equal(device.id, deviceA);
  assert.equal(device.country, 'ID');
  assert.equal(device.locale, 'id');
  const [session] = db.rows('SELECT * FROM sessions');
  assert.equal(session.world_id, WORLD);
  assert.equal(session.mode, 'planet');
  assert.equal(session.quality, 'high');
  assert.equal(session.ua, 'Chrome · macOS');
  assert.equal(Number(session.fps_sum) / Number(session.fps_n), 60);
  assert.deepEqual(db.rows('SELECT type FROM events ORDER BY id').map(r => r.type), ['session_start', 'world', 'mode', 'mission']);
  const [world] = db.rows('SELECT * FROM worlds');
  assert.equal(world.world_id, WORLD);
  assert.equal(world.seed, 123456);
  assert.equal(world.subdivision, 5);
});

test('event times are placed by their age within the batch, not the client clock', async () => {
  const { env, db } = makeEnv();
  const clientClock = NOW + 365 * DAY; // a device whose clock is a year ahead
  await call(env, 'POST', '/api/telemetry', { now: NOW, body: batch(deviceA, session1, [{ t: clientClock - 5000, type: 'session_start' }, { t: clientClock - 3 * DAY, type: 'mode', name: 'space' }], {}, clientClock) });
  const ats = db.rows('SELECT at FROM events ORDER BY id').map(r => Number(r.at));
  assert.deepEqual(ats, [NOW - 5000, NOW - DAY]); // ages are capped at one day
  assert.equal(Number(db.rows('SELECT started_at FROM sessions')[0].started_at), NOW - DAY);
});

test('invalid batches are rejected', async () => {
  const { env } = makeEnv();
  assert.equal((await call(env, 'POST', '/api/telemetry', { body: batch('not-a-uuid', session1, [{ type: 'session_start' }]) })).status, 400);
  assert.equal((await call(env, 'POST', '/api/telemetry', { body: batch(deviceA, session1, []) })).status, 400);
  assert.equal((await call(env, 'POST', '/api/telemetry', { raw: '{nope' })).status, 400);
  const many = Array.from({ length: 101 }, () => ({ type: 'mode', name: 'space' }));
  assert.equal((await call(env, 'POST', '/api/telemetry', { body: batch(deviceA, session1, many) })).status, 413);
  const huge = batch(deviceA, session1, [{ type: 'error', name: 'x', data: { message: 'x'.repeat(70_000) } }]);
  assert.equal((await call(env, 'POST', '/api/telemetry', { body: huge })).status, 413);
});

test('a device cannot write into another device\'s session', async () => {
  const { env, db } = makeEnv();
  await call(env, 'POST', '/api/telemetry', { now: NOW, body: batch(deviceA, session1, [{ type: 'mode', name: 'space' }]) });
  await call(env, 'POST', '/api/telemetry', { now: NOW + 1000, body: batch(deviceB, session1, [{ type: 'session_end' }, { type: 'error', name: 'boom' }]) });
  const [session] = db.rows('SELECT * FROM sessions');
  assert.equal(session.device_id, deviceA);
  assert.equal(session.ended_at, null);
  assert.equal(session.errors, 0);
});

test('oversized event data is dropped, not stored', async () => {
  const { env, db } = makeEnv();
  await call(env, 'POST', '/api/telemetry', { body: batch(deviceA, session1, [{ type: 'error', name: 'Bad thing', data: { message: 'y'.repeat(3000) } }]) });
  const [event] = db.rows('SELECT name, data FROM events');
  assert.equal(event.name, 'Bad thing');
  assert.equal(event.data, null);
});

test('the daily rollup counts raw rows before retention deletes them', async () => {
  const { env, db } = makeEnv();
  const old = NOW - RETENTION_MS - 2 * DAY;
  // Raw data from 92 days ago and from yesterday; nothing rolled up yet.
  db.sqlite.prepare('INSERT INTO devices (id, created_at, last_seen_at) VALUES (?, ?, ?)').run(deviceA, old, NOW - DAY);
  db.sqlite.prepare('INSERT INTO sessions (id, device_id, started_at, last_seen_at) VALUES (?, ?, ?, ?)').run(session1, deviceA, old, old + 600_000);
  db.sqlite.prepare('INSERT INTO sessions (id, device_id, started_at, last_seen_at) VALUES (?, ?, ?, ?)').run(session2, deviceA, NOW - DAY, NOW - DAY + 1_200_000);
  db.sqlite.prepare(`INSERT INTO events (at, device_id, type, name) VALUES (?, ?, 'mission_done', 'home'), (?, ?, 'world', 'created')`).run(old, deviceA, NOW - DAY, deviceA);

  await call(env, 'POST', '/api/telemetry', { now: NOW, body: batch(deviceB, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', [{ type: 'mode', name: 'space' }], {}, 0) });

  const stats = new Map(db.rows('SELECT * FROM daily_stats').map(r => [r.day, r]));
  const oldDay = stats.get(dayKey(old))!, yesterday = stats.get(dayKey(NOW - DAY))!;
  assert.equal(oldDay.missions_done, 1);
  assert.equal(oldDay.sessions, 1);
  assert.equal(oldDay.playtime_sec, 600);
  assert.equal(yesterday.worlds_created, 1);
  assert.equal(yesterday.active_devices, 1);
  assert.equal(stats.has(dayKey(NOW)), false, 'today is still live');
  // Retention removed the 92-day-old rows, and the rollup is not repeated today.
  assert.equal(db.rows('SELECT * FROM events WHERE at < ?', NOW - RETENTION_MS).length, 0);
  assert.equal(db.rows('SELECT * FROM sessions WHERE id = ?', session1).length, 0);
  assert.equal(db.rows(`SELECT value FROM meta WHERE key = 'maintained_day'`)[0].value, dayKey(NOW));
});

test('user agents are reduced to browser and OS', () => {
  assert.equal(coarseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'), 'Safari · iOS · mobile');
  assert.equal(coarseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36 Edg/141.0'), 'Edge · Windows');
  assert.equal(coarseUserAgent(null), null);
});

test('a heartbeat without a frame rate (menu open) still keeps the session alive', async () => {
  const { env, db } = makeEnv();
  await call(env, 'POST', '/api/telemetry', { now: NOW, body: batch(deviceA, session1, [{ type: 'session_start' }], {}, 0) });
  await call(env, 'POST', '/api/telemetry', { now: NOW + 60_000, body: batch(deviceA, session1, [{ type: 'heartbeat' }], {}, 0) });
  const [session] = db.rows('SELECT * FROM sessions');
  assert.equal(session.last_seen_at, NOW + 60_000);
  assert.equal(session.fps_n, 0);
  assert.equal(db.count('events'), 1);
});
