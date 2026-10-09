import test from 'node:test';
import assert from 'node:assert/strict';
import { batch, call, deviceA, makeEnv, session1, snapshotBody } from './helpers.ts';

const WORLD = 'world:123:grid:5';
const path = `/api/me/worlds/${encodeURIComponent(WORLD)}`;

test('saves need a signed-in player', async () => {
  const { env } = makeEnv();
  assert.equal((await call(env, 'GET', '/api/me/worlds')).status, 401);
  assert.equal((await call(env, 'PUT', path, { body: snapshotBody(WORLD, 0) })).status, 401);
});

test('a snapshot round-trips and advances its revision', async () => {
  const { env, db } = makeEnv();
  const first = await call(env, 'PUT', path, { as: 'alice@example.com', body: snapshotBody(WORLD, 0), now: 1000 });
  assert.equal(first.status, 200);
  assert.deepEqual(first.json, { rev: 1, updatedAt: 1000 });
  const second = await call(env, 'PUT', path, { as: 'alice@example.com', body: snapshotBody(WORLD, 1), now: 2000 });
  assert.deepEqual(second.json, { rev: 2, updatedAt: 2000 });

  const list = await call(env, 'GET', '/api/me/worlds', { as: 'alice@example.com' });
  assert.equal(list.json.items.length, 1);
  assert.equal(list.json.items[0].rev, 2);
  assert.equal(list.json.items[0].meta.townsVisited, 3);
  assert.equal(list.json.items[0].deviceId, deviceA);

  const save = await call(env, 'GET', path, { as: 'alice@example.com' });
  assert.equal(save.json.snapshot.storage.planet_globe_map_v5, '{"seed":123}');
  assert.deepEqual(save.json.snapshot.entities['home:0:1:abc'], { id: 'abc' });
  // Stored compressed, but sized by the JSON the client sent.
  const [row] = db.rows('SELECT size, length(data) AS stored FROM snapshots');
  assert.ok(Number(row.stored) > 0 && Number(row.size) > 0);
});

test('a stale revision gets 409 with the cloud state', async () => {
  const { env } = makeEnv();
  await call(env, 'PUT', path, { as: 'alice@example.com', body: snapshotBody(WORLD, 0) });
  await call(env, 'PUT', path, { as: 'alice@example.com', body: snapshotBody(WORLD, 1), now: 5000 });
  const stale = await call(env, 'PUT', path, { as: 'alice@example.com', body: snapshotBody(WORLD, 1) });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error, 'conflict');
  assert.equal(stale.json.rev, 2);
  assert.equal(stale.json.updatedAt, 5000);
  assert.equal(stale.json.meta.seed, 123);
  // "Use this device" resolves by writing on top of the cloud revision.
  assert.equal((await call(env, 'PUT', path, { as: 'alice@example.com', body: snapshotBody(WORLD, 2) })).json.rev, 3);
  // Creating over an existing copy is a conflict too.
  assert.equal((await call(env, 'PUT', path, { as: 'alice@example.com', body: snapshotBody(WORLD, 0) })).status, 409);
});

test('after a cloud delete the conflict reports revision 0', async () => {
  const { env } = makeEnv();
  await call(env, 'PUT', path, { as: 'alice@example.com', body: snapshotBody(WORLD, 0) });
  assert.equal((await call(env, 'DELETE', path, { as: 'alice@example.com' })).status, 204);
  const res = await call(env, 'PUT', path, { as: 'alice@example.com', body: snapshotBody(WORLD, 1) });
  assert.equal(res.status, 409);
  assert.equal(res.json.rev, 0);
  assert.equal(res.json.meta, null);
});

test('players only see their own saves', async () => {
  const { env } = makeEnv();
  await call(env, 'PUT', path, { as: 'alice@example.com', body: snapshotBody(WORLD, 0) });
  assert.equal((await call(env, 'GET', path, { as: 'bob@example.com' })).status, 404);
  assert.deepEqual((await call(env, 'GET', '/api/me/worlds', { as: 'bob@example.com' })).json.items, []);
  // Bob's first save of the same seed is his own copy, not a conflict with Alice.
  assert.equal((await call(env, 'PUT', path, { as: 'bob@example.com', body: snapshotBody(WORLD, 0) })).status, 200);
});

test('snapshots are validated', async () => {
  const { env } = makeEnv();
  const as = 'alice@example.com';
  const other = snapshotBody('world:999:grid:5', 0);
  assert.equal((await call(env, 'PUT', path, { as, body: other })).status, 400, 'worldId must match the URL');
  const badKey = snapshotBody(WORLD, 0);
  (badKey.snapshot.storage as Record<string, string>)['firebase:authUser'] = 'x';
  assert.equal((await call(env, 'PUT', path, { as, body: badKey })).status, 400, 'only planet_globe_* keys');
  assert.equal((await call(env, 'PUT', path, { as, body: { ...snapshotBody(WORLD, 0), baseRev: -1 } })).status, 400);
  assert.equal((await call(env, 'PUT', '/api/me/worlds/not-a-world', { as, body: snapshotBody(WORLD, 0) })).status, 400);
  const meta = snapshotBody(WORLD, 0, { meta: { seed: 1, playtimeSec: -5, missionsDone: ['ok', '<script>', 7] } });
  await call(env, 'PUT', path, { as, body: meta });
  const [save] = (await call(env, 'GET', '/api/me/worlds', { as })).json.items;
  assert.equal(save.meta.playtimeSec, 0);
  assert.deepEqual(save.meta.missionsDone, ['ok']);
});

test('a full-size home map compresses well under the D1 row limit', async () => {
  const { env, db } = makeEnv();
  // Shape of a packed subdivision-5 map: ~150 KB of numeric columns.
  const columns = Array.from({ length: 10_242 }, (_, i) => (i * 7919) % 13).join(',');
  const body = snapshotBody(WORLD, 0);
  body.snapshot.storage.planet_globe_map_v5 = JSON.stringify({ biome: columns, elevation: columns, moisture: columns, owner: columns, extra: columns });
  const res = await call(env, 'PUT', path, { as: 'alice@example.com', body });
  assert.equal(res.status, 200);
  const [row] = db.rows('SELECT size, length(data) AS stored FROM snapshots');
  assert.ok(Number(row.size) > 100_000);
  assert.ok(Number(row.stored) < Number(row.size) / 4, `stored ${row.stored} of ${row.size}`);
});

test('signing in links the device and its anonymous history', async () => {
  const { env, db } = makeEnv();
  await call(env, 'POST', '/api/telemetry', { body: batch(deviceA, session1, [{ type: 'world', name: 'loaded', data: { worldId: WORLD } }]) });
  assert.equal((await call(env, 'POST', '/api/me/devices', { as: 'alice@example.com', body: { deviceId: deviceA } })).status, 204);
  const uid = 'dev-alice-example-com';
  assert.equal(db.rows('SELECT user_id FROM devices')[0].user_id, uid);
  assert.equal(db.rows('SELECT user_id FROM events')[0].user_id, uid);
  assert.equal(db.rows('SELECT user_id FROM worlds')[0].user_id, uid);
  const me = await call(env, 'GET', '/api/me', { as: 'alice@example.com' });
  assert.equal(me.json.devices.length, 1);
  assert.equal(me.json.isAdmin, false);
  // New telemetry from that device carries the user.
  await call(env, 'POST', '/api/telemetry', { body: batch(deviceA, session1, [{ type: 'mode', name: 'town' }]) });
  assert.equal(db.rows(`SELECT user_id FROM events WHERE type = 'mode'`)[0].user_id, uid);
  // Unlinking returns the history to the anonymous device.
  await call(env, 'DELETE', `/api/me/devices/${deviceA}`, { as: 'alice@example.com' });
  assert.equal(db.rows('SELECT user_id FROM devices')[0].user_id, null);
});

test('deleting the account removes saves, devices and history', async () => {
  const { env, db } = makeEnv();
  await call(env, 'POST', '/api/telemetry', { body: batch(deviceA, session1, [{ type: 'mode', name: 'space' }]) });
  await call(env, 'POST', '/api/me/devices', { as: 'alice@example.com', body: { deviceId: deviceA } });
  await call(env, 'PUT', path, { as: 'alice@example.com', body: snapshotBody(WORLD, 0) });
  const exported = await call(env, 'GET', '/api/me/export', { as: 'alice@example.com' });
  assert.equal(exported.json.worlds[0].snapshot.worldId, WORLD);
  assert.equal(exported.json.events.length, 1);
  assert.match(exported.headers.get('content-disposition') || '', /attachment/);

  assert.equal((await call(env, 'DELETE', '/api/me', { as: 'alice@example.com' })).status, 204);
  for (const table of ['users', 'devices', 'sessions', 'events', 'snapshots']) assert.equal(db.count(table), 0, table);
  // Deleting again is harmless.
  assert.equal((await call(env, 'DELETE', '/api/me', { as: 'alice@example.com' })).status, 204);
});
