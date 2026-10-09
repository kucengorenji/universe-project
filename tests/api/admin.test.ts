import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN, DASHBOARD, batch, call, deviceA, deviceB, makeEnv, session1, session2, snapshotBody } from './helpers.ts';
import { DAY } from '../../server/maintenance.ts';

const NOW = Date.parse('2026-10-09T12:00:00Z');
const WORLD = 'world:123:grid:5';

async function seed(env: Parameters<typeof call>[0]) {
  await call(env, 'POST', '/api/telemetry', { now: NOW, body: batch(deviceA, session1, [
    { type: 'session_start' },
    { type: 'world', name: 'created', data: { worldId: WORLD } },
    { type: 'mode', name: 'planet' },
    { type: 'mission', name: 'home.enter' },
    { type: 'mission', name: 'home.sit' },
    { type: 'mission_done', name: 'home' },
    { type: 'heartbeat', value: 50 },
    { type: 'error', name: 'TypeError: x is undefined', data: { message: 'TypeError: x is undefined' } }
  ], { quality: 'high' }, 0) });
  await call(env, 'POST', '/api/telemetry', { now: NOW, body: batch(deviceB, session2, [
    { type: 'session_start' },
    { type: 'mode', name: 'space' },
    { type: 'mode', name: 'planet' },
    { type: 'mission', name: 'home.enter' },
    { type: 'heartbeat', value: 30 }
  ], { quality: 'low' }, 0) });
  await call(env, 'POST', '/api/me/devices', { as: 'alice@example.com', body: { deviceId: deviceA }, now: NOW });
  await call(env, 'PUT', `/api/me/worlds/${encodeURIComponent(WORLD)}`, { as: 'alice@example.com', body: snapshotBody(WORLD, 0), now: NOW });
}

test('admin routes need a verified email from ADMIN_EMAILS', async () => {
  const { env } = makeEnv();
  assert.equal((await call(env, 'GET', '/api/admin/overview')).status, 401);
  assert.equal((await call(env, 'GET', '/api/admin/overview', { as: 'alice@example.com' })).status, 403);
  assert.equal((await call(env, 'GET', '/api/admin/overview', { as: ADMIN })).status, 200);
  assert.equal((await call(env, 'GET', '/api/me', { as: ADMIN })).json.isAdmin, true);
  // Dev tokens only work on localhost with DEV_AUTH.
  assert.equal((await call(env, 'GET', '/api/admin/overview', { as: ADMIN, host: 'aethergate.cloud' })).status, 401);
  const { env: prod } = makeEnv({ DEV_AUTH: undefined });
  assert.equal((await call(prod, 'GET', '/api/admin/overview', { as: ADMIN })).status, 401);
});

test('the overview counts players, sessions, missions, modes and errors', async () => {
  const { env } = makeEnv();
  await seed(env);
  const { json } = await call(env, 'GET', '/api/admin/overview?days=7', { as: ADMIN, now: NOW });
  assert.equal(json.kpis.activeToday, 2);
  assert.equal(json.kpis.sessionsToday, 2);
  assert.equal(json.kpis.players, 2, 'alice (signed in) + one anonymous device');
  assert.equal(json.kpis.signedIn, 1);
  assert.equal(json.kpis.worlds, 1);
  assert.equal(json.kpis.cloudSaves, 1);
  assert.equal(json.kpis.fps7d, 40);
  assert.equal(json.kpis.errors24h, 1);
  assert.equal(json.daily.length, 7);
  assert.equal(json.daily.at(-1).activeDevices, 2);
  assert.equal(json.daily.at(-1).worldsCreated, 1);
  const home = json.missions.find((m: { mission: string }) => m.mission === 'home');
  assert.equal(home.done, 1);
  assert.deepEqual(home.items.sort((a: { item: string }, b: { item: string }) => a.item.localeCompare(b.item)), [{ item: 'enter', done: 2 }, { item: 'sit', done: 1 }]);
  assert.deepEqual(json.modes[0], { mode: 'planet', count: 2 });
  assert.deepEqual(json.quality.map((q: { quality: string }) => q.quality).sort(), ['high', 'low']);
  assert.equal(json.errors[0].message, 'TypeError: x is undefined');
});

test('players merge a signed-in account with its devices and can be searched', async () => {
  const { env } = makeEnv();
  await seed(env);
  const all = await call(env, 'GET', '/api/admin/players', { as: ADMIN });
  assert.equal(all.json.total, 2);
  const keys = all.json.items.map((p: { key: string }) => p.key).sort();
  assert.deepEqual(keys, [`d:${deviceB}`, 'u:dev-alice-example-com']);
  const alice = all.json.items.find((p: { key: string }) => p.key.startsWith('u:'));
  assert.equal(alice.email, 'alice@example.com');
  assert.equal(alice.devices, 1);
  const found = await call(env, 'GET', '/api/admin/players?q=alice', { as: ADMIN });
  assert.deepEqual(found.json.items.map((p: { key: string }) => p.key), ['u:dev-alice-example-com']);
  assert.equal((await call(env, 'GET', '/api/admin/players?q=100%25', { as: ADMIN })).json.total, 0, 'LIKE wildcards are escaped');

  const detail = await call(env, 'GET', `/api/admin/players/${encodeURIComponent('u:dev-alice-example-com')}`, { as: ADMIN });
  assert.equal(detail.status, 200);
  assert.equal(detail.json.devices[0].id, deviceA);
  assert.equal(detail.json.sessions.length, 1);
  assert.ok(detail.json.events.length >= 6);
  assert.equal(detail.json.worlds[0].rev, 1, 'the telemetry world joins its cloud save');
  assert.equal((await call(env, 'GET', '/api/admin/players/u%3Anobody', { as: ADMIN })).status, 404);
});

test('worlds list telemetry worlds and cloud saves once each', async () => {
  const { env } = makeEnv();
  await seed(env);
  await call(env, 'PUT', `/api/me/worlds/${encodeURIComponent('world:777:grid:5')}`, { as: 'carol@example.com', body: snapshotBody('world:777:grid:5', 0) });
  const { json } = await call(env, 'GET', '/api/admin/worlds', { as: ADMIN });
  assert.equal(json.total, 2);
  const carol = json.items.find((w: { worldId: string }) => w.worldId === 'world:777:grid:5');
  assert.equal(carol.email, 'carol@example.com');
  assert.equal(carol.seed, 123, 'seed comes from the snapshot meta');
});

test('deleting a player removes everything and is logged', async () => {
  const { env, db } = makeEnv();
  await seed(env);
  const res = await call(env, 'DELETE', `/api/admin/players/${encodeURIComponent('u:dev-alice-example-com')}`, { as: ADMIN, now: NOW });
  assert.equal(res.status, 200);
  assert.equal(res.json.snapshots, 1);
  assert.equal(db.rows('SELECT * FROM devices WHERE id = ?', deviceA).length, 0);
  assert.equal(db.rows('SELECT * FROM events WHERE device_id = ?', deviceA).length, 0);
  assert.equal(db.count('snapshots'), 0);
  assert.equal(db.count('users'), 0);
  assert.equal(db.rows('SELECT * FROM events WHERE device_id = ?', deviceB).length, 4, 'other players are untouched');
  const log = await call(env, 'GET', '/api/admin/log', { as: ADMIN });
  assert.equal(log.json.items[0].action, 'player.delete');
  assert.equal(log.json.items[0].adminEmail, ADMIN);
  // Anonymous players are deleted by device.
  assert.equal((await call(env, 'DELETE', `/api/admin/players/d:${deviceB}`, { as: ADMIN })).status, 200);
  assert.equal(db.count('events'), 0);
});

test('the event stream filters by type and pages backwards', async () => {
  const { env } = makeEnv();
  await seed(env);
  const modes = await call(env, 'GET', '/api/admin/events?type=mode', { as: ADMIN });
  assert.equal(modes.json.items.length, 3);
  const page = await call(env, 'GET', '/api/admin/events?limit=2', { as: ADMIN });
  const next = await call(env, 'GET', `/api/admin/events?limit=2&before=${page.json.items[1].id}`, { as: ADMIN });
  assert.ok(next.json.items.every((e: { id: number }) => e.id < page.json.items[1].id));
  assert.equal(page.json.items[0].deviceId, deviceB);
});

test('announcements are scheduled per surface', async () => {
  const { env } = makeEnv();
  const base = { level: 'info', surfaces: ['game'], title: { id: 'Update 10', en: 'Update 10' }, body: { id: 'Isi', en: 'Body' } };
  const live = await call(env, 'POST', '/api/admin/announcements', { as: ADMIN, now: NOW, body: { ...base, startsAt: NOW - DAY, endsAt: NOW + DAY } });
  assert.equal(live.status, 201);
  await call(env, 'POST', '/api/admin/announcements', { as: ADMIN, body: { ...base, surfaces: ['landing'], startsAt: NOW - DAY, endsAt: null } });
  await call(env, 'POST', '/api/admin/announcements', { as: ADMIN, body: { ...base, startsAt: NOW + DAY, endsAt: null } });
  await call(env, 'POST', '/api/admin/announcements', { as: ADMIN, body: { ...base, startsAt: NOW - 3 * DAY, endsAt: NOW - DAY } });

  const game = await call(env, 'GET', '/api/announcements?surface=game', { now: NOW });
  assert.deepEqual(game.json.items.map((a: { id: string }) => a.id), [live.json.id]);
  assert.match(game.headers.get('cache-control') || '', /max-age=60/);
  assert.equal((await call(env, 'GET', '/api/announcements?surface=landing', { now: NOW })).json.items.length, 1);

  const updated = await call(env, 'PUT', `/api/admin/announcements/${live.json.id}`, { as: ADMIN, body: { ...base, level: 'important', startsAt: NOW - DAY, endsAt: null } });
  assert.equal(updated.json.level, 'important');
  assert.equal(updated.json.endsAt, null);
  assert.equal((await call(env, 'GET', '/api/admin/announcements', { as: ADMIN })).json.items.length, 4);
  assert.equal((await call(env, 'DELETE', `/api/admin/announcements/${live.json.id}`, { as: ADMIN })).status, 204);
  assert.equal((await call(env, 'DELETE', `/api/admin/announcements/${live.json.id}`, { as: ADMIN })).status, 404);

  const bad = [
    { ...base, level: 'urgent', startsAt: NOW },
    { ...base, surfaces: [], startsAt: NOW },
    { ...base, title: { id: '', en: '' }, startsAt: NOW },
    { ...base, startsAt: NOW, endsAt: NOW - 1 },
    { ...base, startsAt: 'soon' },
    { ...base, title: { id: 'x'.repeat(121), en: '' }, startsAt: NOW }
  ];
  for (const body of bad) assert.equal((await call(env, 'POST', '/api/admin/announcements', { as: ADMIN, body })).status, 400, JSON.stringify(body).slice(0, 80));
  assert.equal((await call(env, 'POST', '/api/admin/announcements', { as: 'alice@example.com', body: { ...base, startsAt: NOW } })).status, 403);
});

test('inspect links open one cloud save read-only for 15 minutes', async () => {
  const { env } = makeEnv();
  await seed(env);
  const res = await call(env, 'POST', '/api/admin/inspect', { as: ADMIN, now: NOW, body: { userId: 'dev-alice-example-com', worldId: WORLD } });
  assert.equal(res.status, 200);
  const url = new URL(res.json.url);
  assert.equal(url.pathname, '/play/');
  const token = url.searchParams.get('inspect')!;
  const save = await call(env, 'GET', `/api/inspect/${encodeURIComponent(token)}`, { now: NOW + 60_000 });
  assert.equal(save.status, 200);
  assert.equal(save.json.snapshot.worldId, WORLD);
  assert.equal((await call(env, 'GET', `/api/inspect/${encodeURIComponent(token)}`, { now: NOW + 16 * 60_000 })).status, 401, 'expired');
  const [payload, sig] = token.split('.');
  const forged = `${payload.slice(0, -2)}AA.${sig}`;
  assert.equal((await call(env, 'GET', `/api/inspect/${encodeURIComponent(forged)}`, { now: NOW })).status, 401, 'tampered');
  assert.equal((await call(env, 'POST', '/api/admin/inspect', { as: ADMIN, body: { userId: 'dev-alice-example-com', worldId: 'world:1:grid:5' } })).status, 404);
  const { env: off } = makeEnv({ INSPECT_SECRET: undefined });
  assert.equal((await call(off, 'GET', `/api/inspect/${encodeURIComponent(token)}`)).status, 503);
  // GAME_ORIGIN points the link at the game when the API is reached through another host.
  const { env: pointed } = makeEnv({ GAME_ORIGIN: 'https://aethergate.cloud/' });
  await seed(pointed);
  const link = await call(pointed, 'POST', '/api/admin/inspect', { as: ADMIN, body: { userId: 'dev-alice-example-com', worldId: WORLD } });
  assert.match(link.json.url, /^https:\/\/aethergate\.cloud\/play\/\?inspect=/);
});

test('CORS is granted to dashboard origins only', async () => {
  const { env } = makeEnv();
  const pre = await call(env, 'OPTIONS', '/api/me', { headers: { origin: DASHBOARD, 'access-control-request-method': 'GET' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), DASHBOARD);
  assert.match(pre.headers.get('access-control-allow-headers') || '', /authorization/);
  assert.equal((await call(env, 'OPTIONS', '/api/me', { headers: { origin: 'https://evil.example' } })).status, 403);
  const res = await call(env, 'GET', '/api/me', { as: 'alice@example.com', headers: { origin: DASHBOARD } });
  assert.equal(res.headers.get('access-control-allow-origin'), DASHBOARD);
  const other = await call(env, 'GET', '/api/me', { as: 'alice@example.com', headers: { origin: 'https://evil.example' } });
  assert.equal(other.headers.get('access-control-allow-origin'), null);
  // Errors carry CORS too, so the dashboard can read them.
  const err = await call(env, 'GET', '/api/admin/overview', { headers: { origin: DASHBOARD } });
  assert.equal(err.status, 401);
  assert.equal(err.headers.get('access-control-allow-origin'), DASHBOARD);
});

test('unknown routes and methods', async () => {
  const { env } = makeEnv();
  assert.equal((await call(env, 'GET', '/api/nope')).status, 404);
  const wrong = await call(env, 'PATCH', '/api/me');
  assert.equal(wrong.status, 405);
  assert.match(wrong.headers.get('allow') || '', /GET/);
  assert.equal((await call(env, 'GET', '/api/admin/players/%E0%A4%A', { as: ADMIN })).status, 400);
});
