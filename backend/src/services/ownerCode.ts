import type { Bindings } from '../types';

export const ownerCredentialsTable = `CREATE TABLE IF NOT EXISTS owner_credentials (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  salt TEXT NOT NULL,
  code_mac TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  last_change_id TEXT NOT NULL,
  last_change_mac TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

export const ownerAuthThrottleTable = `CREATE TABLE IF NOT EXISTS owner_auth_throttle (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  failures INTEGER NOT NULL DEFAULT 0,
  window_until INTEGER NOT NULL
)`;

export interface OwnerCredential {
  salt: string;
  code_mac: string;
  revision: number;
  last_change_id: string;
  last_change_mac: string;
}

export class OwnerCodeUnavailableError extends Error {}
export class OwnerCodeRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) { super('Owner authentication is temporarily limited'); }
}

const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;
const encoder = new TextEncoder();

function primary(db: D1Database): D1Database {
  return ((db as any).withSession?.('first-primary') || db) as D1Database;
}

export async function readOwnerCredential(db: D1Database): Promise<OwnerCredential | null> {
  try {
    return await primary(db).prepare('SELECT salt, code_mac, revision, last_change_id, last_change_mac FROM owner_credentials WHERE id = 1')
      .first<OwnerCredential>();
  } catch { throw new OwnerCodeUnavailableError(); }
}

async function macKey(pepper: string | undefined): Promise<CryptoKey> {
  if (!pepper || pepper.length < 32) throw new OwnerCodeUnavailableError();
  return crypto.subtle.importKey('raw', encoder.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function ownerCodeMac(pepper: string | undefined, parts: string[]): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await macKey(pepper), encoder.encode(JSON.stringify(parts)));
  return Array.from(new Uint8Array(signature), value => value.toString(16).padStart(2, '0')).join('');
}

export async function ownerCodeMacMatches(pepper: string | undefined, parts: string[], expected: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(expected)) throw new OwnerCodeUnavailableError();
  const bytes = new Uint8Array(expected.match(/../g)!.map(value => Number.parseInt(value, 16)));
  return crypto.subtle.verify('HMAC', await macKey(pepper), bytes, encoder.encode(JSON.stringify(parts)));
}

// A single account-wide window also covers requests using an owner bearer token.
export async function recordOwnerAttempt(db: D1Database, valid: boolean): Promise<void> {
  const now = Date.now();
  const until = now + WINDOW_MS;
  try {
    const result = await primary(db).prepare(`INSERT INTO owner_auth_throttle (id, failures, window_until)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        failures = CASE
          WHEN window_until <= ? THEN ?
          WHEN failures >= ? THEN failures
          WHEN ? = 1 THEN 0
          ELSE failures + 1 END,
        window_until = CASE
          WHEN window_until <= ? OR failures = 0 OR (? = 1 AND failures < ?) THEN ?
          ELSE window_until END
      RETURNING failures, window_until`)
      .bind(valid ? 0 : 1, until, now, valid ? 0 : 1, MAX_FAILURES, Number(valid),
        now, Number(valid), MAX_FAILURES, until)
      .first<{ failures: number; window_until: number }>();
    if (!result) throw new OwnerCodeUnavailableError();
    if (result.failures >= MAX_FAILURES) {
      throw new OwnerCodeRateLimitError(Math.max(1, Math.ceil((result.window_until - now) / 1000)));
    }
  } catch (error) {
    if (error instanceof OwnerCodeRateLimitError || error instanceof OwnerCodeUnavailableError) throw error;
    throw new OwnerCodeUnavailableError();
  }
}

export async function checkOwnerCode(db: D1Database, env: Bindings, candidate: unknown): Promise<{
  configured: boolean;
  valid: boolean;
  credential: OwnerCredential | null;
}> {
  const credential = await readOwnerCredential(db);
  const configured = Boolean(credential || env.OWNER_API_TOKEN);
  if (!configured) return { configured, valid: false, credential };
  const code = typeof candidate === 'string' && candidate.length <= 256 ? candidate.trim() : '';
  let valid = false;
  if (credential) {
    valid = await ownerCodeMacMatches(env.OWNER_CODE_PEPPER, ['qltc-owner-code-v1', credential.salt, code], credential.code_mac);
  } else {
    valid = Boolean(code && code === env.OWNER_API_TOKEN);
  }
  await recordOwnerAttempt(db, valid);
  return { configured, valid, credential };
}
