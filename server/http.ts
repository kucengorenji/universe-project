export class HttpError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, error: string, extra: Record<string, unknown> = {}) {
    super(error);
    this.status = status;
    this.body = { error, ...extra };
  }
}

export const badRequest = (detail: string) => new HttpError(400, 'bad_request', { detail });

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
  });
}

export const noContent = () => new Response(null, { status: 204 });

/** Reads a JSON body without trusting Content-Length: the stream is cut at `limit` bytes. */
export async function readJson(request: Request, limit: number): Promise<unknown> {
  if (!request.body) throw badRequest('empty body');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new HttpError(413, 'too_large', { limit });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw badRequest('invalid JSON'); }
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function int(value: string | null, fallback: number, min: number, max: number): number {
  const n = value === null ? NaN : Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback;
}

/** Applies CORS for allowed dashboard origins; other origins get no CORS headers. */
export function withCors(response: Response, origin: string | null, allowed: string[]): Response {
  if (!origin || !allowed.includes(origin)) return response;
  const res = new Response(response.body, response);
  res.headers.set('access-control-allow-origin', origin);
  res.headers.append('vary', 'Origin');
  return res;
}

export function preflight(origin: string | null, allowed: string[]): Response {
  if (!origin || !allowed.includes(origin)) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-max-age': '86400',
      vary: 'Origin'
    }
  });
}

export const allowedOrigins = (list: string | undefined) => (list || '').split(',').map(s => s.trim()).filter(Boolean);
