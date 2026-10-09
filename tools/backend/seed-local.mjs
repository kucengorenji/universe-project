// Fills the LOCAL D1 database (wrangler pages dev) with 30 days of made-up
// players so the dashboard has something to show. Never touches a remote
// database: it always runs `wrangler d1 execute --local`.
//
//   npm run db:migrate:local && npm run db:seed:local
//
// Existing local rows are deleted first.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const DAY = 86_400_000;
const now = Date.now();
let seed = 20261009;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (list) => list[Math.floor(rnd() * list.length)];
const uuid = () => 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(rnd() * 16).toString(16));
const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

const MISSIONS = {
  home: ['enter', 'sit', 'light', 'fridge', 'apple', 'sleep'],
  cozy: ['tv', 'fire', 'book', 'place'],
  explorer: ['land3', 'town', 'drive', 'jack'],
  pilot: ['boost', 'hangar', 'orbit3', 'rover']
};
const UAS = ['Chrome · Windows', 'Chrome · macOS', 'Safari · macOS', 'Safari · iOS · mobile', 'Chrome · Android · mobile', 'Firefox · Linux', 'Edge · Windows'];
const COUNTRIES = ['ID', 'ID', 'ID', 'ID', 'SG', 'MY', 'US', 'NL', 'JP'];
const QUALITIES = ['auto', 'auto', 'auto', 'high', 'medium', 'low'];
const ERRORS = ['TypeError: Cannot read properties of undefined (reading \'position\')', 'WebGL: CONTEXT_LOST_WEBGL', 'RangeError: Invalid array length'];

const sql = ['DELETE FROM events', 'DELETE FROM sessions', 'DELETE FROM worlds', 'DELETE FROM snapshots', 'DELETE FROM devices', 'DELETE FROM users',
  'DELETE FROM announcements', 'DELETE FROM daily_stats', 'DELETE FROM admin_log', "DELETE FROM meta WHERE key = 'maintained_day'"];
const insert = (table, row) => sql.push(`INSERT INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).map(q).join(', ')})`);

for (let p = 0; p < 64; p++) {
  const deviceId = uuid();
  const firstSeen = now - Math.floor(rnd() ** 0.7 * 30 * DAY);
  const signedIn = rnd() < 0.22;
  const userId = signedIn ? `seed-user-${p}` : null;
  const country = pick(COUNTRIES);
  const ua = pick(UAS);
  const quality = pick(QUALITIES);
  const engagement = rnd(); // how far this player gets
  const worldSeed = 100000 + Math.floor(rnd() * 900000);
  const worldId = `world:${worldSeed}:grid:5`;
  if (userId) insert('users', { id: userId, email: `pemain${String(p).padStart(2, '0')}@example.com`, name: `Pemain ${p}`, photo_url: null, created_at: firstSeen, last_seen_at: firstSeen });

  let last = firstSeen;
  const sessions = 1 + Math.floor(engagement * 14 * rnd());
  let t = firstSeen;
  const reached = new Set();
  for (let s = 0; s < sessions && t < now; s++) {
    const sessionId = uuid();
    const minutes = 2 + Math.floor(rnd() * 55 * (0.4 + engagement));
    const end = Math.min(now, t + minutes * 60_000);
    const fps = quality === 'low' ? 32 + rnd() * 18 : 48 + rnd() * 12;
    const errors = rnd() < 0.08 ? 1 : 0;
    insert('sessions', { id: sessionId, device_id: deviceId, user_id: userId, started_at: t, last_seen_at: end, ended_at: end, world_id: worldId, mode: pick(['space', 'planet', 'town']), quality, ua, country, fps_sum: fps * minutes, fps_n: minutes, errors });
    const ev = (at, type, name, data) => insert('events', { at, device_id: deviceId, session_id: sessionId, user_id: userId, type, name, value: null, data: data ? JSON.stringify(data) : null });
    ev(t, 'session_start');
    ev(t + 500, 'world', s === 0 ? 'created' : 'loaded', { worldId, seed: worldSeed, subdivision: 5 });
    if (s === 0) insert('worlds', { device_id: deviceId, world_id: worldId, user_id: userId, seed: worldSeed, subdivision: 5, first_seen: t, last_seen: end });
    ev(t + 1000, 'mode', 'space');
    if (rnd() < 0.85) ev(t + 60_000, 'mode', 'planet');
    if (rnd() < 0.6 * (0.5 + engagement)) ev(t + 120_000, 'mode', 'town');
    if (rnd() < 0.2 * engagement) ev(t + 180_000, 'mode', 'home');
    // Missions tick in order; each step is a little less likely than the last.
    for (const [mission, items] of Object.entries(MISSIONS)) {
      let all = true;
      items.forEach((item, i) => {
        const key = `${mission}.${item}`;
        if (reached.has(key)) return;
        const odds = engagement * (mission === 'home' || mission === 'explorer' ? 0.9 : 0.6) * (1 - i * 0.12);
        if (rnd() < odds * 0.5) {
          reached.add(key);
          ev(t + 200_000 + i * 30_000, 'mission', key);
        }
        if (!reached.has(key)) all = false;
      });
      if (all && !reached.has(`done:${mission}`)) {
        reached.add(`done:${mission}`);
        ev(t + 400_000, 'mission_done', mission);
      }
    }
    if (errors) ev(t + 90_000, 'error', pick(ERRORS).slice(0, 64), { message: pick(ERRORS), source: 'TownMode.js', line: 812 });
    ev(end, 'session_end');
    last = end;
    t = end + Math.floor((0.2 + rnd() * 3) * DAY);
  }
  insert('devices', { id: deviceId, user_id: userId, created_at: firstSeen, last_seen_at: last, country, locale: country === 'ID' ? 'id' : 'en', build: 'seed' });
  if (userId) {
    sql.push(`UPDATE users SET last_seen_at = ${last} WHERE id = ${q(userId)}`);
    const done = [...reached].filter((k) => !k.startsWith('done:')).length;
    const meta = { seed: worldSeed, subdivision: 5, planetsLanded: 1 + Math.floor(engagement * 4), townsVisited: Math.floor(engagement * 7), playtimeSec: Math.floor((last - firstSeen) / 50_000), homes: Math.floor(engagement * 2),
      missionsDone: Object.keys(MISSIONS).filter((m) => reached.has(`done:${m}`)), missionItems: { done, total: 18 } };
    const snapshot = JSON.stringify({ schemaVersion: 1, worldId, savedAt: last, storage: { planet_globe_missions: '{}' }, entities: { manifest: { worldId } } });
    const blob = gzipSync(snapshot).toString('hex');
    sql.push(`INSERT INTO snapshots (user_id, world_id, rev, device_id, meta, data, size, created_at, updated_at) VALUES (${q(userId)}, ${q(worldId)}, ${1 + Math.floor(rnd() * 20)}, ${q(deviceId)}, ${q(JSON.stringify(meta))}, X'${blob}', ${snapshot.length}, ${firstSeen}, ${last})`);
  }
}

insert('announcements', { id: uuid(), level: 'important', surfaces: 'game,landing', title_id: 'Update 10: cloud save', title_en: 'Update 10: cloud saves', body_id: 'Masuk dengan Google di menu (P) untuk menyimpan dunia di cloud.', body_en: 'Sign in with Google in the menu (P) to keep your world in the cloud.', starts_at: now - 2 * DAY, ends_at: now + 5 * DAY, created_at: now - 2 * DAY, updated_at: now - 2 * DAY, created_by: 'seed' });
insert('announcements', { id: uuid(), level: 'info', surfaces: 'game', title_id: 'Event akhir pekan', title_en: 'Weekend event', body_id: 'Selesaikan misi Pilot untuk lencana khusus.', body_en: 'Finish the Pilot mission for a special badge.', starts_at: now + 3 * DAY, ends_at: now + 5 * DAY, created_at: now, updated_at: now, created_by: 'seed' });

const dir = mkdtempSync(join(tmpdir(), 'aethergate-seed-'));
const file = join(dir, 'seed.sql');
writeFileSync(file, `${sql.join(';\n')};\n`);
execFileSync('npx', ['wrangler', 'd1', 'execute', 'aethergate', '--local', `--file=${file}`], { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
console.log(`Seeded ${sql.length} statements into the local database.`);
