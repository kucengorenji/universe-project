import type { Surface } from '../shared/api.ts';
import { listEvents, listLog, listWorlds, logAction, overview, playerDetail } from './admin.ts';
import { activeAnnouncements, cleanAnnouncement, createAnnouncement, deleteAnnouncement, listAnnouncements, updateAnnouncement } from './announcements.ts';
import { isAdmin, requireAdmin, requireUser } from './auth.ts';
import type { Ctx, Env } from './env.ts';
import { HttpError, allowedOrigins, badRequest, int, isObject, json, noContent, preflight, readJson, withCors } from './http.ts';
import { INSPECT_TTL, signInspect, verifyInspect } from './inspect.ts';
import { deleteMe, exportMe, getMe, linkDevice, unlinkDevice, upsertUser } from './me.ts';
import { deletePlayer, listPlayers, resolvePlayer } from './players.ts';
import { listSaves, readSave, writeSave } from './saves.ts';
import { ingestTelemetry } from './telemetry.ts';
import { text, worldId } from './validate.ts';

interface Call {
  request: Request;
  env: Env;
  ctx: Ctx;
  url: URL;
  params: Record<string, string>;
  now: number;
}

type Handler = (call: Call) => Promise<Response>;

const routes: { method: string; pattern: RegExp; keys: string[]; handler: Handler }[] = [];

function route(method: string, path: string, handler: Handler) {
  const keys: string[] = [];
  const pattern = new RegExp(`^${path.replace(/:(\w+)/g, (_, key: string) => { keys.push(key); return '([^/]+)'; })}$`);
  routes.push({ method, pattern, keys, handler });
}

// ---------------------------------------------------------------- public (the game)

route('POST', '/api/telemetry', ({ request, env, ctx, now }) => ingestTelemetry(request, env, ctx, now));

route('GET', '/api/announcements', async ({ env, url, now }) => {
  const surface = url.searchParams.get('surface') === 'landing' ? 'landing' : 'game';
  const items = await activeAnnouncements(env.DB, surface as Surface, now);
  return json({ items }, 200, { 'cache-control': 'public, max-age=60' });
});

route('GET', '/api/inspect/:token', async ({ env, params, now }) => {
  if (!env.INSPECT_SECRET) throw new HttpError(503, 'inspect_not_configured');
  const claim = await verifyInspect(env.INSPECT_SECRET, params.token, now);
  if (!claim) throw new HttpError(401, 'unauthorized', { reason: 'inspect_token' });
  const save = await readSave(env.DB, claim.u, claim.w);
  if (!save) throw new HttpError(404, 'not_found');
  return json(save);
});

// ---------------------------------------------------------------- player (signed in)

route('GET', '/api/me', async ({ request, env, now }) => {
  const user = await requireUser(request, env);
  await upsertUser(env.DB, user, now);
  return json(await getMe(env.DB, user, isAdmin(user, env)));
});

route('DELETE', '/api/me', async ({ request, env }) => {
  await deleteMe(env.DB, await requireUser(request, env));
  return noContent();
});

route('GET', '/api/me/export', async ({ request, env }) => {
  const user = await requireUser(request, env);
  return json(await exportMe(env.DB, user, isAdmin(user, env)), 200, { 'content-disposition': 'attachment; filename="aethergate-data.json"' });
});

route('POST', '/api/me/devices', async ({ request, env, now }) => {
  const user = await requireUser(request, env);
  await upsertUser(env.DB, user, now);
  await linkDevice(request, env.DB, user, now);
  return noContent();
});

route('DELETE', '/api/me/devices/:deviceId', async ({ request, env, params }) => {
  await unlinkDevice(env.DB, await requireUser(request, env), params.deviceId);
  return noContent();
});

route('GET', '/api/me/worlds', async ({ request, env }) => {
  const user = await requireUser(request, env);
  return json({ items: await listSaves(env.DB, user.uid) });
});

route('GET', '/api/me/worlds/:worldId', async ({ request, env, params }) => {
  const user = await requireUser(request, env);
  const save = await readSave(env.DB, user.uid, worldId(params.worldId));
  if (!save) throw new HttpError(404, 'not_found');
  return json(save);
});

route('PUT', '/api/me/worlds/:worldId', async ({ request, env, params, now }) => {
  const user = await requireUser(request, env);
  await upsertUser(env.DB, user, now);
  return writeSave(request, env.DB, user.uid, params.worldId, now);
});

route('DELETE', '/api/me/worlds/:worldId', async ({ request, env, params }) => {
  const user = await requireUser(request, env);
  await env.DB.prepare('DELETE FROM snapshots WHERE user_id = ?1 AND world_id = ?2').bind(user.uid, worldId(params.worldId)).run();
  return noContent();
});

// ---------------------------------------------------------------- admin

route('GET', '/api/admin/overview', async ({ request, env, url, now }) => {
  await requireAdmin(request, env);
  return json(await overview(env.DB, now, int(url.searchParams.get('days'), 30, 7, 180)));
});

route('GET', '/api/admin/players', async ({ request, env, url }) => {
  await requireAdmin(request, env);
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
  return json(await listPlayers(env.DB, q, int(url.searchParams.get('limit'), 50, 1, 200), int(url.searchParams.get('offset'), 0, 0, 1e6)));
});

route('GET', '/api/admin/players/:key', async ({ request, env, params }) => {
  await requireAdmin(request, env);
  return json(await playerDetail(env.DB, params.key));
});

route('DELETE', '/api/admin/players/:key', async ({ request, env, params, now }) => {
  const admin = await requireAdmin(request, env);
  const removed = await deletePlayer(env.DB, await resolvePlayer(env.DB, params.key));
  await logAction(env.DB, admin.email!, 'player.delete', params.key, removed, now);
  return json(removed);
});

route('GET', '/api/admin/worlds', async ({ request, env, url }) => {
  await requireAdmin(request, env);
  return json(await listWorlds(env.DB, int(url.searchParams.get('limit'), 50, 1, 200), int(url.searchParams.get('offset'), 0, 0, 1e6)));
});

route('GET', '/api/admin/events', async ({ request, env, url }) => {
  await requireAdmin(request, env);
  return json({ items: await listEvents(env.DB, {
    type: (url.searchParams.get('type') || '').slice(0, 32),
    device: (url.searchParams.get('device') || '').slice(0, 64),
    before: int(url.searchParams.get('before'), 0, 0, Number.MAX_SAFE_INTEGER),
    limit: int(url.searchParams.get('limit'), 100, 1, 500)
  }) });
});

route('GET', '/api/admin/log', async ({ request, env, url }) => {
  await requireAdmin(request, env);
  return json({ items: await listLog(env.DB, int(url.searchParams.get('limit'), 100, 1, 500)) });
});

route('POST', '/api/admin/inspect', async ({ request, env, url, now }) => {
  const admin = await requireAdmin(request, env);
  if (!env.INSPECT_SECRET) throw new HttpError(503, 'inspect_not_configured');
  const body = await readJson(request, 2048);
  if (!isObject(body)) throw badRequest('body must be an object');
  const userId = text(body.userId, 'userId', 128), world = worldId(body.worldId);
  const exists = await env.DB.prepare('SELECT 1 FROM snapshots WHERE user_id = ?1 AND world_id = ?2').bind(userId, world).first();
  if (!exists) throw new HttpError(404, 'not_found');
  const expiresAt = now + INSPECT_TTL;
  const token = await signInspect(env.INSPECT_SECRET, { u: userId, w: world, exp: expiresAt });
  await logAction(env.DB, admin.email!, 'world.inspect', `u:${userId}`, { worldId: world }, now);
  const origin = (env.GAME_ORIGIN || url.origin).replace(/\/$/, '');
  return json({ url: `${origin}/play/?inspect=${encodeURIComponent(token)}`, expiresAt });
});

route('GET', '/api/admin/announcements', async ({ request, env }) => {
  await requireAdmin(request, env);
  return json({ items: await listAnnouncements(env.DB) });
});

route('POST', '/api/admin/announcements', async ({ request, env, now }) => {
  const admin = await requireAdmin(request, env);
  const created = await createAnnouncement(env.DB, cleanAnnouncement(await readJson(request, 16 * 1024)), admin.email!, now);
  await logAction(env.DB, admin.email!, 'announcement.create', created.id, null, now);
  return json(created, 201);
});

route('PUT', '/api/admin/announcements/:id', async ({ request, env, params, now }) => {
  const admin = await requireAdmin(request, env);
  const updated = await updateAnnouncement(env.DB, params.id, cleanAnnouncement(await readJson(request, 16 * 1024)), now);
  if (!updated) throw new HttpError(404, 'not_found');
  await logAction(env.DB, admin.email!, 'announcement.update', params.id, null, now);
  return json(updated);
});

route('DELETE', '/api/admin/announcements/:id', async ({ request, env, params, now }) => {
  const admin = await requireAdmin(request, env);
  if (!await deleteAnnouncement(env.DB, params.id)) throw new HttpError(404, 'not_found');
  await logAction(env.DB, admin.email!, 'announcement.delete', params.id, null, now);
  return noContent();
});

// ---------------------------------------------------------------- dispatch

export async function handle(request: Request, env: Env, ctx: Ctx, now = Date.now()): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  const allowed = allowedOrigins(env.DASHBOARD_ORIGINS);
  if (request.method === 'OPTIONS') return preflight(origin, allowed);
  let response: Response;
  try {
    const candidates = routes.filter(r => r.pattern.test(url.pathname));
    const match = candidates.find(r => r.method === request.method);
    if (!match) {
      response = candidates.length ? json({ error: 'method_not_allowed' }, 405, { allow: candidates.map(r => r.method).join(', ') }) : json({ error: 'not_found' }, 404);
    } else {
      const values = match.pattern.exec(url.pathname)!.slice(1);
      let params: Record<string, string>;
      try { params = Object.fromEntries(match.keys.map((k, i) => [k, decodeURIComponent(values[i])])); }
      catch { throw badRequest('malformed path'); }
      response = await match.handler({ request, env, ctx, url, params, now });
    }
  } catch (error) {
    if (error instanceof HttpError) response = json(error.body, error.status);
    else {
      console.error('api error', error);
      response = json({ error: 'internal' }, 500);
    }
  }
  return withCors(response, origin, allowed);
}
