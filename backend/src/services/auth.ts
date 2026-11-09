import type { Context } from 'hono';
import { Bindings, AuthPrincipal, UserRole } from '../types';

type AuthContext = Context<{ Bindings: Bindings; Variables: { principal: AuthPrincipal } }>;

type AccessClaims = {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  nbf?: unknown;
  email?: unknown;
};

export const OWNER_SESSION_COOKIE = '__Secure-qltc_session';
export const OWNER_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_FRONTEND_ORIGIN = 'https://qltc-app.dtd-store.workers.dev';

function parseCookie(header: string | undefined, name: string): string {
  if (!header) return '';
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) {
      try { return decodeURIComponent(value.join('=')); } catch { return ''; }
    }
  }
  return '';
}

function configuredFrontendOrigin(configured?: string): string | null {
  try {
    const url = new URL(configured || DEFAULT_FRONTEND_ORIGIN);
    const isHttps = url.protocol === 'https:';
    const isLocalDev = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    if ((!isHttps && !isLocalDev) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

export function hasOwnerSessionCookie(c: AuthContext): boolean {
  return Boolean(parseCookie(c.req.header('Cookie'), OWNER_SESSION_COOKIE));
}

export function isAllowedSessionMutationOrigin(c: AuthContext): boolean {
  const origin = c.req.header('Origin');
  const allowedOrigin = configuredFrontendOrigin(c.env.FRONTEND_ORIGIN);
  if (!origin || !allowedOrigin) return false;
  try { return new URL(origin).origin === allowedOrigin && origin === allowedOrigin; } catch { return false; }
}

export function readOwnerSessionCookie(c: AuthContext): string {
  return parseCookie(c.req.header('Cookie'), OWNER_SESSION_COOKIE);
}

function decodeJwtPart(part: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Error('Invalid JWT encoding');
  const binary = atob(part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - part.length % 4) % 4));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function accessTeamOrigin(configuredDomain: string): string | null {
  try {
    const url = new URL(configuredDomain);
    if (
      url.protocol !== 'https:' ||
      !url.hostname.endsWith('.cloudflareaccess.com') ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/'
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function verifiedAccessEmail(jwt: string, teamDomain?: string, audience?: string): Promise<string | null> {
  if (!jwt || !teamDomain || !audience) return null;
  const issuer = accessTeamOrigin(teamDomain);
  if (!issuer) return null;
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const header = decodeJwtPart(parts[0]) as { alg?: unknown; kid?: unknown };
    const claims = decodeJwtPart(parts[1]) as AccessClaims;
    if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) return null;
    if (!claims || claims.iss !== issuer) return null;
    if (!(claims.aud === audience || (Array.isArray(claims.aud) && claims.aud.includes(audience)))) return null;
    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp <= now) return null;
    if (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf > now)) return null;
    if (typeof claims.email !== 'string' || !claims.email.trim()) return null;

    const response = await fetch(`${issuer}/cdn-cgi/access/certs`);
    if (!response.ok) return null;
    const jwks = await response.json() as { keys?: (JsonWebKey & { kid?: string; alg?: string; use?: string })[] };
    if (!Array.isArray(jwks.keys)) return null;
    const matchingKeys = jwks.keys.filter((key) =>
      key.kty === 'RSA' && key.kid === header.kid && (key.alg === undefined || key.alg === 'RS256') &&
      (key.use === undefined || key.use === 'sig')
    );
    if (matchingKeys.length !== 1) return null;
    const key = await crypto.subtle.importKey(
      'jwk', matchingKeys[0], { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
    const signaturePart = parts[2];
    if (!/^[A-Za-z0-9_-]+$/.test(signaturePart)) return null;
    const signatureBinary = atob(signaturePart.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - signaturePart.length % 4) % 4));
    const signature = Uint8Array.from(signatureBinary, (char) => char.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', key, signature, new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
    return valid ? claims.email.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generateRandomToken(prefix = 'qltc_dev_'): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${prefix}${hex}`;
}

export function generatePairCode(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  const code = (bytes[0] % 900000) + 100000;
  return String(code);
}

/**
 * Resolves the authenticated principal from request headers.
 * Strict V2-01 enforcement:
 * - Never falls back to owner when credentials are missing or invalid.
 * - Never accepts arbitrary token strings based on prefix or length.
 * - Distinguishes 'owner' and 'device' roles.
 */
export async function resolveAuthPrincipal(c: AuthContext): Promise<AuthPrincipal | null> {
  const db = c.env.DB;
  const authHeader = c.req.header('Authorization') || '';
  const deviceHeader = c.req.header('X-Device-Token') || '';
  const ownerHeader = c.req.header('X-Owner-Token') || '';
  const cfJwt = c.req.header('Cf-Access-Jwt-Assertion');

  const sessionToken = readOwnerSessionCookie(c);
  if (sessionToken) {
    try {
      const tokenHash = await sha256Hex(sessionToken);
      const session = await db.prepare(
        `SELECT user_id FROM web_sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ? LIMIT 1`
      ).bind(tokenHash, new Date().toISOString()).first<{ user_id: string }>();
      return session ? { userId: session.user_id, role: 'owner' } : null;
    } catch {
      return null;
    }
  }

  // Cloudflare Access headers are untrusted until the JWT has been verified.
  const cfEmail = await verifiedAccessEmail(cfJwt || '', c.env.CF_ACCESS_TEAM_DOMAIN, c.env.CF_ACCESS_AUD);
  if (cfEmail && c.env.OWNER_EMAIL && cfEmail === c.env.OWNER_EMAIL.trim().toLowerCase()) {
    return { userId: 'user_default', role: 'owner' };
  }

  // Extract token candidate
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  // 2. Explicit Device Token header or Bearer token matching a registered active device in DB
  const deviceTokenCandidate = deviceHeader.trim() || bearerToken;
  if (deviceTokenCandidate) {
    // Check if it is an Owner token first (unless sent via X-Device-Token explicitly)
    const configuredOwnerToken = c.env.OWNER_API_TOKEN;
    if (configuredOwnerToken && !deviceHeader && (bearerToken === configuredOwnerToken || ownerHeader === configuredOwnerToken)) {
      return { userId: 'user_default', role: 'owner' };
    }

    // Look up device token hash in DB
    try {
      const tokenHash = await sha256Hex(deviceTokenCandidate);
      const device = await db
        .prepare(
          `SELECT id, user_id, scopes FROM devices WHERE token_hash = ? AND status = 'active' AND revoked_at IS NULL LIMIT 1`
        )
        .bind(tokenHash)
        .first<{ id: string; user_id: string; scopes: string }>();

      if (device && typeof device.scopes === 'string' && device.scopes.split(/[\s,]+/).includes('notifications:ingest')) {
        return {
          userId: device.user_id,
          role: 'device',
          deviceId: device.id
        };
      }
    } catch {
      // DB error or table not initialized yet
    }
  }

  // 3. Explicit X-Owner-Token check
  const configuredOwnerToken = c.env.OWNER_API_TOKEN;
  if (configuredOwnerToken && ownerHeader === configuredOwnerToken) {
    return { userId: 'user_default', role: 'owner' };
  }

  return null;
}

export function isAuthorizedRole(principal: AuthPrincipal | null, allowedRoles: UserRole[]): boolean {
  if (!principal) return false;
  return allowedRoles.includes(principal.role);
}
