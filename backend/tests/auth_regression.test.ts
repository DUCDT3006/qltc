import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import workerApp from '../src/index';
import { createSqliteD1 } from './d1Helper';

const DEFAULT_TOKEN = 'qltc_owner_session_v2_default';
const OWNER_TOKEN = 'explicit_test_owner_token';
const FRONTEND_ORIGIN = 'https://qltc-app.dtd-store.workers.dev';

function testEnv(extra: Record<string, string> = {}) {
  return { DB: createSqliteD1().db, ...extra };
}

async function request(env: any, path: string, headers: Record<string, string> = {}, body?: object) {
  const response = await workerApp.fetch(
    new Request(`http://localhost${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
      body: body ? JSON.stringify(body) : undefined
    }),
    env,
    { waitUntil: () => {} }
  );
  return { status: response.status, data: await response.json().catch(() => null) };
}

function b64url(value: Uint8Array | string): string {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return Buffer.from(bytes).toString('base64url');
}

async function signedJwt(
  key: CryptoKey,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'RS256', kid: 'test-key', typ: 'JWT' }
) {
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input));
  return `${input}.${b64url(new Uint8Array(signature))}`;
}

describe('V2-01 auth regressions through worker.fetch and in-memory D1', () => {
  it('rejects the published fallback token for protected route and login when owner secret is absent', async () => {
    const env = testEnv();
    assert.equal((await request(env, '/api/accounts', { Authorization: `Bearer ${DEFAULT_TOKEN}` })).status, 401);
    assert.equal((await request(env, '/api/auth/login', { Origin: FRONTEND_ORIGIN }, { token: DEFAULT_TOKEN })).status, 503);
  });

  it('accepts only a configured owner token and rejects an arbitrary token', async () => {
    const env = testEnv({ OWNER_API_TOKEN: OWNER_TOKEN });
    assert.equal((await request(env, '/api/auth/session', { Authorization: `Bearer ${OWNER_TOKEN}` })).status, 200);
    assert.equal((await request(env, '/api/auth/session', { Authorization: 'Bearer random_fake_token_12345' })).status, 401);
    const login = await request(env, '/api/auth/login', { Origin: FRONTEND_ORIGIN }, { token: OWNER_TOKEN });
    assert.equal(login.status, 200);
    assert.equal(login.data.token, undefined, 'login must not echo the long-lived owner secret');
  });

  it('creates a short-lived HttpOnly cookie session, survives refresh, enforces Origin, and revokes on logout', async () => {
    const harness = createSqliteD1();
    const env = { DB: harness.db, OWNER_API_TOKEN: OWNER_TOKEN, FRONTEND_ORIGIN };
    const noOrigin = await request(env, '/api/auth/login', {}, { token: OWNER_TOKEN });
    assert.equal(noOrigin.status, 403);
    const badOrigin = await request(env, '/api/auth/login', { Origin: 'https://attacker.example' }, { token: OWNER_TOKEN });
    assert.equal(badOrigin.status, 403);

    const loginResponse = await workerApp.fetch(new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { Origin: FRONTEND_ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: OWNER_TOKEN })
    }), env, { waitUntil: () => {} });
    assert.equal(loginResponse.status, 200);
    const setCookie = loginResponse.headers.get('Set-Cookie') || '';
    assert.match(setCookie, /^__Secure-qltc_session=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /Secure/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.match(setCookie, /Path=\/api/i);
    assert.match(setCookie, /Max-Age=604800/i);
    assert.equal((await loginResponse.clone().json() as any).token, undefined);
    const cookie = setCookie.split(';', 1)[0];
    const stored = harness.rawDb.prepare('SELECT token_hash, expires_at FROM web_sessions').get() as any;
    assert.ok(stored.token_hash);
    assert.equal(stored.token_hash.includes(cookie.split('=')[1]), false, 'only a hash of the raw session token is stored');
    assert.ok(Date.parse(stored.expires_at) > Date.now());
    assert.ok(Date.parse(stored.expires_at) <= Date.now() + 7 * 24 * 60 * 60 * 1000 + 5000);

    assert.equal((await request(env, '/api/auth/session')).status, 401);
    assert.equal((await request(env, '/api/auth/session', { Cookie: cookie })).status, 200);
    assert.equal((await request(env, '/api/accounts', { Cookie: cookie })).status, 200);
    assert.equal((await request(env, '/api/user/profile', { Cookie: cookie }, {})).status, 403, 'cookie mutations reject missing Origin');
    assert.equal((await request(env, '/api/user/profile', { Cookie: cookie, Origin: 'https://attacker.example' }, {})).status, 403);
    assert.equal((await request(env, '/api/user/profile', { Cookie: cookie, Origin: FRONTEND_ORIGIN }, {})).status, 404, 'same-origin mutation reaches the protected route');

    const logout = await request(env, '/api/auth/logout', { Cookie: cookie, Origin: FRONTEND_ORIGIN }, {});
    assert.equal(logout.status, 200);
    assert.equal((await request(env, '/api/auth/session', { Cookie: cookie })).status, 401);
  });

  it('keeps a paired device limited to ingest and rejects it after revocation', async () => {
    const harness = createSqliteD1();
    const env = { DB: harness.db, OWNER_API_TOKEN: OWNER_TOKEN };
    const owner = { Authorization: `Bearer ${OWNER_TOKEN}` };
    const pair = await request(env, '/api/devices/pair-code', owner, { deviceName: 'Test Listener' });
    assert.equal(pair.status, 200);
    const exchanged = await request(env, '/api/auth/pair-exchange', {}, { code: pair.data.code, deviceId: 'test-device' });
    assert.equal(exchanged.status, 200);
    const device = { 'X-Device-Token': exchanged.data.deviceToken };
    assert.equal((await request(env, '/api/accounts', device)).status, 403);
    assert.equal((await request(env, '/api/notifications/ingest', device, {
      packageName: 'com.test.bank', title: 'Bank', text: 'SD TK 0011001234567 -50,000VND. SD: 1,950,000VND. ND: Mua cafe', eventId: 'auth-scope-test'
    })).status, 200);
    harness.rawDb.prepare("UPDATE devices SET scopes = 'unrelated:scope' WHERE id = 'test-device'").run();
    assert.equal((await request(env, '/api/notifications/ingest', device, {
      packageName: 'com.test.bank', title: 'Bank', text: 'Another notification', eventId: 'auth-scope-test-no-scope'
    })).status, 401);
    harness.rawDb.prepare("UPDATE devices SET scopes = 'notifications:ingest' WHERE id = 'test-device'").run();
    assert.equal((await request(env, '/api/devices/test-device/revoke', owner, {})).status, 200);
    assert.equal((await request(env, '/api/notifications/ingest', device, {
      packageName: 'com.test.bank', title: 'Bank', text: 'Another notification', eventId: 'auth-scope-test-2'
    })).status, 401);
  });

  it('rejects a forged Access JWT and client email header even when a team domain is configured', async () => {
    const env = testEnv({ CF_ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com', OWNER_EMAIL: 'owner@example.com' });
    const claims = { iss: 'https://team.cloudflareaccess.com', aud: ['app-aud'], email: 'owner@example.com', exp: Math.floor(Date.now() / 1000) + 600 };
    const jwt = `${b64url(JSON.stringify({ alg: 'RS256', kid: 'fake' }))}.${b64url(JSON.stringify(claims))}.${b64url('fake')}`;
    assert.equal((await request(env, '/api/auth/session', {
      'Cf-Access-Authenticated-User-Email': 'owner@example.com',
      'Cf-Access-Jwt-Assertion': jwt
    })).status, 401);
    assert.equal((await request(env, '/api/auth/session', {
      'Cf-Access-Authenticated-User-Email': 'owner@example.com'
    })).status, 401);
  });

  it('validates signature, issuer, audience, expiry, and the signed email claim against mock JWKS', async () => {
    const keys = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    );
    const publicJwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
    const originalFetch = globalThis.fetch;
    const requested: string[] = [];
    globalThis.fetch = async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] }), {
        headers: { 'Content-Type': 'application/json' }
      });
    };
    try {
      const env = testEnv({
        CF_ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com',
        CF_ACCESS_AUD: 'app-aud',
        OWNER_EMAIL: 'owner@example.com'
      });
      const now = Math.floor(Date.now() / 1000);
      const base = { iss: 'https://team.cloudflareaccess.com', aud: ['app-aud'], email: 'owner@example.com', iat: now, exp: now + 600 };
      const call = async (claims: Record<string, unknown>, key = keys.privateKey) => request(env, '/api/auth/session', {
        'Cf-Access-Authenticated-User-Email': 'attacker@example.com',
        'Cf-Access-Jwt-Assertion': await signedJwt(key, claims)
      });
      const valid = await call(base);
      assert.equal(valid.status, 200);
      assert.equal(valid.data?.userId, 'user_default');
      assert.equal((await call({ ...base, aud: ['wrong-app'] })).status, 401);
      assert.equal((await call({ ...base, iss: 'https://other.cloudflareaccess.com' })).status, 401);
      assert.equal((await call({ ...base, exp: now - 1 })).status, 401);
      assert.equal((await call({ ...base, email: 'attacker@example.com' })).status, 401);
      const attackerKeys = await crypto.subtle.generateKey(
        { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
        true,
        ['sign', 'verify']
      );
      assert.equal((await call(base, attackerKeys.privateKey)).status, 401);
      assert.ok(requested.every((url) => url === 'https://team.cloudflareaccess.com/cdn-cgi/access/certs'));
      assert.ok(requested.length > 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
