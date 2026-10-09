// "Open this world" links for admins: a short-lived HMAC token naming one
// snapshot, so the game can load it read-only without the admin signing in there.

export const INSPECT_TTL = 15 * 60_000;

export interface InspectClaim {
  u: string; // snapshot owner (user id)
  w: string; // world id
  exp: number;
}

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0));

const hmacKey = (secret: string) => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

export async function signInspect(secret: string, claim: InspectClaim): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify(claim)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

export async function verifyInspect(secret: string, token: string, now: number): Promise<InspectClaim | null> {
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined || token.length > 2048) return null;
  try {
    // subtle.verify compares in constant time.
    if (!await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64url(sig), enc.encode(payload))) return null;
    const claim = JSON.parse(new TextDecoder().decode(unb64url(payload))) as InspectClaim;
    return typeof claim.u === 'string' && typeof claim.w === 'string' && typeof claim.exp === 'number' && claim.exp > now ? claim : null;
  } catch { return null; }
}
