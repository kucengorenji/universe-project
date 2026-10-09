import type { Env } from './env.ts';
import { HttpError } from './http.ts';

export interface AuthUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

// Firebase ID tokens are RS256 JWTs signed by these rotating keys.
export const FIREBASE_JWKS = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const SKEW = 60; // seconds of clock skew tolerated
const DEFAULT_KEY_TTL = 3600_000;

let keyCache: { keys: Map<string, CryptoKey>; expires: number } | null = null;

export function resetKeyCache() { keyCache = null; }

async function loadKeys(now: number): Promise<Map<string, CryptoKey>> {
  const res = await fetch(FIREBASE_JWKS);
  if (!res.ok) throw new HttpError(503, 'auth_keys_unavailable');
  const body = await res.json() as { keys?: (JsonWebKey & { kid?: string })[] };
  const keys = new Map<string, CryptoKey>();
  for (const jwk of body.keys || []) {
    if (!jwk.kid || jwk.kty !== 'RSA') continue;
    keys.set(jwk.kid, await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
  }
  const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
  keyCache = { keys, expires: now + (maxAge ? Number(maxAge[1]) * 1000 : DEFAULT_KEY_TTL) };
  return keys;
}

async function keyFor(kid: string, now: number): Promise<CryptoKey | undefined> {
  if (keyCache && keyCache.expires > now && keyCache.keys.has(kid)) return keyCache.keys.get(kid);
  // Unknown kid: Google rotated keys, so refetch once.
  return (await loadKeys(now)).get(kid);
}

const b64urlBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0));
const b64urlJson = (s: string): unknown => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

const unauthorized = (reason: string) => new HttpError(401, 'unauthorized', { reason });

/** Verifies a Firebase ID token per https://firebase.google.com/docs/auth/admin/verify-id-tokens. */
export async function verifyFirebaseToken(token: string, projectId: string, now = Date.now()): Promise<AuthUser> {
  const parts = token.split('.');
  if (parts.length !== 3) throw unauthorized('malformed');
  let header: Record<string, unknown>, claims: Record<string, unknown>;
  try {
    header = b64urlJson(parts[0]) as Record<string, unknown>;
    claims = b64urlJson(parts[1]) as Record<string, unknown>;
  } catch { throw unauthorized('malformed'); }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw unauthorized('alg');
  const key = await keyFor(header.kid, now);
  if (!key) throw unauthorized('kid');
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw unauthorized('signature');
  const sec = now / 1000;
  if (claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}`) throw unauthorized('audience');
  if (typeof claims.exp !== 'number' || claims.exp < sec - SKEW) throw unauthorized('expired');
  if (typeof claims.iat !== 'number' || claims.iat > sec + SKEW) throw unauthorized('iat');
  if (typeof claims.auth_time === 'number' && claims.auth_time > sec + SKEW) throw unauthorized('auth_time');
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128) throw unauthorized('sub');
  return {
    uid: claims.sub,
    email: typeof claims.email === 'string' ? claims.email.toLowerCase() : null,
    emailVerified: claims.email_verified === true,
    name: typeof claims.name === 'string' ? claims.name.slice(0, 120) : null,
    picture: typeof claims.picture === 'string' ? claims.picture.slice(0, 500) : null
  };
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The signed-in caller, or a 401. `Bearer dev:<email>` works only with DEV_AUTH=1 on localhost. */
export async function requireUser(request: Request, env: Env): Promise<AuthUser> {
  const header = request.headers.get('authorization') || '';
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
  if (!token) throw unauthorized('missing');
  if (token.startsWith('dev:')) {
    if (env.DEV_AUTH !== '1' || !LOCAL_HOSTS.has(new URL(request.url).hostname)) throw unauthorized('dev');
    const email = token.slice(4).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw unauthorized('dev');
    return { uid: `dev-${email.replace(/[^a-z0-9]/g, '-')}`, email, emailVerified: true, name: email.split('@')[0], picture: null };
  }
  if (!env.FIREBASE_PROJECT_ID) throw new HttpError(503, 'auth_not_configured');
  return verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID);
}

export function isAdmin(user: AuthUser, env: Env): boolean {
  if (!user.email || !user.emailVerified) return false;
  const admins = (env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return admins.includes(user.email);
}

export async function requireAdmin(request: Request, env: Env): Promise<AuthUser> {
  const user = await requireUser(request, env);
  if (!isAdmin(user, env)) throw new HttpError(403, 'forbidden');
  return user;
}
