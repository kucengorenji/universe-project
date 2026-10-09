import { apiUrl } from './config.js';

/** JSON request to the game API. Never throws on HTTP errors: check `ok`/`status`. Network failures throw. */
export async function apiFetch(path, { method = 'GET', body, token, keepalive = false } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const payload = body === undefined ? undefined : JSON.stringify(body);
  if (payload !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(apiUrl(path), { method, headers, body: payload, keepalive: keepalive && (payload?.length ?? 0) < 60_000 });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}
