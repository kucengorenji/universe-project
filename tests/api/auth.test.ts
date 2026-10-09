import test from 'node:test';
import assert from 'node:assert/strict';
import { FIREBASE_JWKS, resetKeyCache, verifyFirebaseToken } from '../../server/auth.ts';
import { ADMIN, call, makeEnv } from './helpers.ts';

const PROJECT = 'test-project';
const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

async function keyPair() {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  return { ...pair, jwk: await crypto.subtle.exportKey('jwk', pair.publicKey) };
}

async function sign(privateKey: CryptoKey, kid: string, claims: Record<string, unknown>) {
  const head = enc({ alg: 'RS256', kid, typ: 'JWT' }), body = enc(claims);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${Buffer.from(sig).toString('base64url')}`;
}

const now = Date.parse('2026-10-09T12:00:00Z');
const sec = now / 1000;
const claims = (extra: Record<string, unknown> = {}) => ({
  iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: 'uid-123', iat: sec - 10, exp: sec + 3600, auth_time: sec - 20,
  email: 'Player@Example.com', email_verified: true, name: 'Player', picture: 'https://example.com/p.png', ...extra
});

test('Firebase ID tokens are verified against Google\'s keys', async t => {
  const good = await keyPair(), other = await keyPair();
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    assert.equal(url, FIREBASE_JWKS);
    fetches++;
    return new Response(JSON.stringify({ keys: [{ ...good.jwk, kid: 'k1', alg: 'RS256' }] }), { headers: { 'cache-control': 'public, max-age=20000' } });
  });
  resetKeyCache();

  const user = await verifyFirebaseToken(await sign(good.privateKey, 'k1', claims()), PROJECT, now);
  assert.deepEqual(user, { uid: 'uid-123', email: 'player@example.com', emailVerified: true, name: 'Player', picture: 'https://example.com/p.png' });
  await verifyFirebaseToken(await sign(good.privateKey, 'k1', claims()), PROJECT, now);
  assert.equal(fetches, 1, 'keys are cached for max-age');

  const reject = async (token: string, reason: string) => {
    await assert.rejects(verifyFirebaseToken(token, PROJECT, now), (e: { status: number; body: { reason: string } }) => e.status === 401 && e.body.reason === reason);
  };
  await reject(await sign(good.privateKey, 'k1', claims({ aud: 'someone-else' })), 'audience');
  await reject(await sign(good.privateKey, 'k1', claims({ iss: 'https://evil.example' })), 'audience');
  await reject(await sign(good.privateKey, 'k1', claims({ exp: sec - 3600 })), 'expired');
  await reject(await sign(good.privateKey, 'k1', claims({ iat: sec + 3600 })), 'iat');
  await reject(await sign(good.privateKey, 'k1', claims({ sub: '' })), 'sub');
  await reject(await sign(other.privateKey, 'k1', claims()), 'signature');
  await reject('not.a.jwt.at-all', 'malformed');
  const unsigned = `${enc({ alg: 'none', kid: 'k1' })}.${enc(claims())}.`;
  await reject(unsigned, 'alg');
  // An unknown kid triggers one refetch (key rotation), then fails.
  await reject(await sign(other.privateKey, 'k2', claims()), 'kid');
  assert.equal(fetches, 2);
});

test('a real token signs players in through the router; admin needs a verified email', async t => {
  const pair = await keyPair();
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ keys: [{ ...pair.jwk, kid: 'k1' }] })));
  resetKeyCache();
  const { env } = makeEnv({ DEV_AUTH: undefined });
  const real = Date.now() / 1000;
  const fresh = (extra: Record<string, unknown>) => claims({ iat: real - 10, exp: real + 3600, auth_time: real - 20, ...extra });
  const player = await sign(pair.privateKey, 'k1', fresh({}));
  const me = await call(env, 'GET', '/api/me', { token: player });
  assert.equal(me.status, 200);
  assert.equal(me.json.email, 'player@example.com');
  assert.equal(me.json.isAdmin, false);

  const admin = await sign(pair.privateKey, 'k1', fresh({ sub: 'admin-uid', email: ADMIN }));
  assert.equal((await call(env, 'GET', '/api/admin/overview', { token: admin })).status, 200);
  const unverified = await sign(pair.privateKey, 'k1', fresh({ sub: 'admin-uid', email: ADMIN, email_verified: false }));
  assert.equal((await call(env, 'GET', '/api/admin/overview', { token: unverified })).status, 403);
});
