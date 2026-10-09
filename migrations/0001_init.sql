-- Game dashboard backend. Times are milliseconds since the Unix epoch (UTC).
-- Deletes cascade in code (server/players.ts), not through foreign keys.

-- An anonymous install of the game: the id lives in the player's localStorage.
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  country TEXT,
  locale TEXT,
  build TEXT
);
CREATE INDEX devices_user ON devices(user_id);
CREATE INDEX devices_seen ON devices(last_seen_at);

-- A Google account (Firebase Auth uid). Devices are linked to it on sign-in.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT,
  name TEXT,
  photo_url TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX users_email ON users(email);

-- One page load of /play/. Heartbeats only update this row; they are not events.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  user_id TEXT,
  started_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  ended_at INTEGER,
  world_id TEXT,
  mode TEXT,
  quality TEXT,
  ua TEXT,
  country TEXT,
  fps_sum REAL NOT NULL DEFAULT 0,
  fps_n INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX sessions_device ON sessions(device_id, started_at);
CREATE INDEX sessions_started ON sessions(started_at);
CREATE INDEX sessions_seen ON sessions(last_seen_at);

-- Raw telemetry, kept for 90 days (server/maintenance.ts rolls it into daily_stats first).
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  session_id TEXT,
  user_id TEXT,
  type TEXT NOT NULL,
  name TEXT,
  value REAL,
  data TEXT
);
CREATE INDEX events_at ON events(at);
CREATE INDEX events_type_at ON events(type, at);
CREATE INDEX events_device_at ON events(device_id, at);
CREATE INDEX events_user ON events(user_id);

-- Worlds a device has played, from telemetry. Seeds collide across players, so the key includes the device.
CREATE TABLE worlds (
  device_id TEXT NOT NULL,
  world_id TEXT NOT NULL,
  user_id TEXT,
  seed INTEGER,
  subdivision INTEGER,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (device_id, world_id)
);
CREATE INDEX worlds_seen ON worlds(last_seen);
CREATE INDEX worlds_user ON worlds(user_id);

-- Cloud saves: one gzip'd snapshot per signed-in player and world, guarded by rev.
CREATE TABLE snapshots (
  user_id TEXT NOT NULL,
  world_id TEXT NOT NULL,
  rev INTEGER NOT NULL,
  device_id TEXT,
  meta TEXT NOT NULL,
  data BLOB NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, world_id)
);
CREATE INDEX snapshots_updated ON snapshots(updated_at);

CREATE TABLE announcements (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL CHECK (level IN ('info', 'important')),
  surfaces TEXT NOT NULL,
  title_id TEXT NOT NULL,
  title_en TEXT NOT NULL,
  body_id TEXT NOT NULL,
  body_en TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT
);
CREATE INDEX announcements_window ON announcements(starts_at, ends_at);

-- Permanent per-day rollup, so charts survive the 90-day raw retention.
CREATE TABLE daily_stats (
  day TEXT PRIMARY KEY,
  active_devices INTEGER NOT NULL,
  sessions INTEGER NOT NULL,
  playtime_sec INTEGER NOT NULL,
  new_devices INTEGER NOT NULL,
  worlds_created INTEGER NOT NULL,
  missions_done INTEGER NOT NULL,
  errors INTEGER NOT NULL
);

CREATE TABLE admin_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX admin_log_at ON admin_log(at);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
