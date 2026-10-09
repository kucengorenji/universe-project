// Contract between the game (/play/), the API (functions/ + server/) and the
// dashboard (dashboard/). The game is plain JS and follows these shapes by
// convention; the server validates everything it receives.

export type Surface = 'game' | 'landing';
export type Level = 'info' | 'important';

// ---------------------------------------------------------------- telemetry

/**
 * session_start / heartbeat / session_end: session lifecycle (heartbeat.value = fps)
 * mode:         name = space | planet | town | home | interior
 * mission:      name = "<mission>.<item>" ticked
 * mission_done: name = "<mission>" completed
 * world:        name = created | loaded, data = { worldId, seed, subdivision }
 * error:        name = short message, data = { message, source, line }
 */
export type EventType = 'session_start' | 'heartbeat' | 'session_end' | 'mode' | 'mission' | 'mission_done' | 'world' | 'error';

export interface TelemetryEvent {
  t: number; // client clock, ms
  type: EventType;
  name?: string;
  value?: number;
  data?: Record<string, unknown>;
}

export interface TelemetryBatch {
  deviceId: string;
  sessionId: string;
  sentAt: number; // client clock when the batch left, used to correct skew
  locale?: string;
  quality?: string;
  build?: string;
  worldId?: string;
  events: TelemetryEvent[];
}

// ---------------------------------------------------------------- players

export interface Device {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  country: string | null;
}

export interface Me {
  id: string;
  email: string | null;
  name: string | null;
  photoUrl: string | null;
  isAdmin: boolean;
  createdAt: number;
  devices: Device[];
}

/** Summary the game computes when it uploads, so lists never decompress snapshots. */
export interface WorldMeta {
  seed: number;
  subdivision: number;
  planetsLanded: number;
  townsVisited: number;
  playtimeSec: number;
  homes: number;
  missionsDone: string[];
  missionItems: { done: number; total: number };
}

export interface Snapshot {
  schemaVersion: 1;
  worldId: string;
  savedAt: number;
  /** Raw localStorage values (map, missions, clock, ship, progress). */
  storage: Record<string, string>;
  /** WorldStateStore records (IndexedDB): homes, interiors, town layouts, location. */
  entities: Record<string, unknown>;
}

export interface WorldSummary {
  worldId: string;
  rev: number;
  updatedAt: number;
  size: number;
  deviceId: string | null;
  meta: WorldMeta;
}

export interface WorldSave extends WorldSummary {
  snapshot: Snapshot;
}

export interface SaveRequest {
  baseRev: number; // 0 = the client believes the cloud has no copy
  deviceId?: string;
  meta: WorldMeta;
  snapshot: Snapshot;
}

export interface SaveResult {
  rev: number;
  updatedAt: number;
}

/** 409 body: the cloud moved on since baseRev (rev 0 = the cloud copy was deleted). */
export interface SaveConflict {
  error: 'conflict';
  rev: number;
  updatedAt: number | null;
  deviceId: string | null;
  meta: WorldMeta | null;
}

export interface PlayerExport {
  exportedAt: number;
  user: Me;
  worlds: WorldSave[];
  sessions: SessionRow[];
  events: EventRow[];
}

// ---------------------------------------------------------------- announcements

export interface Localized {
  id: string;
  en: string;
}

export interface Announcement {
  id: string;
  level: Level;
  surfaces: Surface[];
  title: Localized;
  body: Localized;
  startsAt: number;
  endsAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type AnnouncementInput = Pick<Announcement, 'level' | 'surfaces' | 'title' | 'body' | 'startsAt' | 'endsAt'>;

// ---------------------------------------------------------------- admin

export interface DailyStat {
  day: string; // YYYY-MM-DD (UTC)
  activeDevices: number;
  sessions: number;
  playtimeSec: number;
  newDevices: number;
  worldsCreated: number;
  missionsDone: number;
  errors: number;
}

export interface Overview {
  generatedAt: number;
  kpis: {
    activeToday: number;
    active7d: number;
    sessionsToday: number;
    players: number;
    signedIn: number;
    worlds: number;
    cloudSaves: number;
    avgSessionSec7d: number;
    fps7d: number | null;
    errors24h: number;
  };
  daily: DailyStat[];
  missions: { mission: string; done: number; items: { item: string; done: number }[] }[];
  modes: { mode: string; count: number }[];
  quality: { quality: string; sessions: number }[];
  errors: { message: string; count: number; lastAt: number }[];
}

export interface PlayerRow {
  key: string; // u:<uid> for signed-in players, d:<deviceId> for anonymous ones
  userId: string | null;
  email: string | null;
  name: string | null;
  devices: number;
  firstSeen: number;
  lastSeen: number;
  country: string | null;
}

export interface SessionRow {
  id: string;
  deviceId: string;
  startedAt: number;
  lastSeenAt: number;
  endedAt: number | null;
  worldId: string | null;
  mode: string | null;
  quality: string | null;
  ua: string | null;
  country: string | null;
  fps: number | null;
  errors: number;
}

export interface EventRow {
  id: number;
  at: number;
  deviceId: string;
  sessionId: string | null;
  userId: string | null;
  type: string;
  name: string | null;
  value: number | null;
  data: Record<string, unknown> | null;
}

export interface WorldRow {
  worldId: string;
  seed: number | null;
  deviceId: string | null;
  userId: string | null;
  email: string | null;
  firstSeen: number;
  lastSeen: number;
  rev: number | null;
  size: number | null;
  meta: WorldMeta | null;
}

export interface PlayerDetail {
  player: PlayerRow;
  devices: (Device & { userId: string | null })[];
  sessions: SessionRow[];
  events: EventRow[];
  worlds: WorldRow[];
}

export interface Page<T> {
  items: T[];
  total: number;
}

export interface AdminLogRow {
  id: number;
  at: number;
  adminEmail: string;
  action: string;
  target: string;
  detail: string | null;
}
