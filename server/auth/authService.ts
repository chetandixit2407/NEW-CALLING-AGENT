import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Request, Response } from 'express';
import type { UserRole } from '../repositories/userRepository';

export interface VerifiedTokenClaims {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  photoURL: string;
  authProvider: 'firebase_google' | 'google' | 'password';
  exp: number;
  iat: number;
}

export interface SessionPayload {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  role: UserRole;
  authProvider: 'firebase_google' | 'google' | 'password';
  iat: number;
  exp: number;
}

export class AuthError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(code: string, message: string, status: number = 401) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
  }
}

export const SESSION_COOKIE_NAME = 'wcr_session';
export const OAUTH_STATE_COOKIE_NAME = 'wcr_oauth_state';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const OAUTH_STATE_TTL_SECONDS = 60 * 10; // 10 minutes

// Session secret from env or secure per-process ephemeral key (never hardcoded)
const EPHEMERAL_SESSION_SECRET = crypto.randomBytes(32).toString('hex');
function getSessionSecret(): string {
  const configured = process.env.SESSION_SECRET?.trim();
  return configured && configured.length >= 16 ? configured : EPHEMERAL_SESSION_SECRET;
}

interface FirebaseClientConfig {
  projectId: string;
  apiKey: string;
  authDomain: string;
  oAuthClientId?: string;
}

let cachedFirebaseConfig: FirebaseClientConfig | null = null;
export function getFirebaseClientConfig(): FirebaseClientConfig | null {
  if (cachedFirebaseConfig) return cachedFirebaseConfig;
  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(configPath)) return null;
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    cachedFirebaseConfig = {
      projectId: raw.projectId || '',
      apiKey: raw.apiKey || '',
      authDomain: raw.authDomain || '',
      oAuthClientId: raw.oAuthClientId || '',
    };
    return cachedFirebaseConfig;
  } catch (err) {
    console.error('[AuthService] Failed to load firebase-applet-config.json:', err);
    return null;
  }
}

// Certificate cache for Firebase & Google X.509 certs
interface CertCacheEntry {
  certs: Record<string, string>;
  expiresAt: number;
}
const certCache = new Map<string, CertCacheEntry>();

async function fetchX509Certs(url: string, forceRefresh = false): Promise<Record<string, string>> {
  const now = Date.now();
  const cached = certCache.get(url);
  if (!forceRefresh && cached && cached.expiresAt > now) {
    return cached.certs;
  }

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new AuthError('CERT_FETCH_FAILED', `Failed to fetch verification certificates (HTTP ${resp.status})`, 503);
  }
  const certs = (await resp.json()) as Record<string, string>;
  const cacheControl = resp.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? Math.max(60, parseInt(maxAgeMatch[1], 10)) : 3600;
  certCache.set(url, {
    certs,
    expiresAt: now + maxAgeSec * 1000,
  });
  return certs;
}

function decodeBase64Url(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + '='.repeat(padLen), 'base64');
}

function encodeBase64Url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function verifyRs256Jwt(
  token: string,
  certsUrl: string
): Promise<{ header: any; payload: any }> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new AuthError('INVALID_TOKEN', 'Malformed JWT token structure.', 401);
  }

  let header: any;
  let payload: any;
  try {
    header = JSON.parse(decodeBase64Url(parts[0]).toString('utf8'));
    payload = JSON.parse(decodeBase64Url(parts[1]).toString('utf8'));
  } catch {
    throw new AuthError('INVALID_TOKEN', 'Unable to decode token header or payload.', 401);
  }

  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
    throw new AuthError('INVALID_TOKEN', 'Unsupported token algorithm or missing key identifier.', 401);
  }

  let certs = await fetchX509Certs(certsUrl, false);
  let pem = certs[header.kid];
  if (!pem) {
    certs = await fetchX509Certs(certsUrl, true);
    pem = certs[header.kid];
  }
  if (!pem) {
    throw new AuthError('INVALID_TOKEN_KEY', 'Token signing key could not be verified.', 401);
  }

  const signingInput = `${parts[0]}.${parts[1]}`;
  const signature = decodeBase64Url(parts[2]);
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(signingInput);
  verifier.end();

  const isValid = verifier.verify(pem, signature);
  if (!isValid) {
    throw new AuthError('INVALID_SIGNATURE', 'Token signature verification failed.', 401);
  }

  return { header, payload };
}

/**
 * Cryptographically verifies a Firebase Auth ID token using Google's public X.509 certificates.
 */
export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedTokenClaims> {
  if (!idToken || typeof idToken !== 'string') {
    throw new AuthError('MISSING_TOKEN', 'Authentication token is missing.', 401);
  }

  const fbConfig = getFirebaseClientConfig();
  if (!fbConfig?.projectId) {
    throw new AuthError('AUTH_MISCONFIGURED', 'Firebase project configuration is missing on server.', 500);
  }

  const { payload } = await verifyRs256Jwt(
    idToken,
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
  );

  const nowSec = Math.floor(Date.now() / 1000);
  const expectedIssuer = `https://securetoken.google.com/${fbConfig.projectId}`;

  if (payload.aud !== fbConfig.projectId) {
    throw new AuthError('INVALID_AUDIENCE', 'Token audience does not match this application.', 401);
  }
  if (payload.iss !== expectedIssuer) {
    throw new AuthError('INVALID_ISSUER', 'Token issuer is invalid.', 401);
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new AuthError('TOKEN_EXPIRED', 'Your authentication session has expired. Please sign in again.', 401);
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) {
    throw new AuthError('INVALID_TOKEN_TIME', 'Token issued-at timestamp is invalid.', 401);
  }
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128) {
    throw new AuthError('INVALID_SUBJECT', 'Token subject identifier is invalid.', 401);
  }
  if (!payload.email || typeof payload.email !== 'string') {
    throw new AuthError('MISSING_EMAIL', 'Verified email address is required for authentication.', 401);
  }

  const signInProvider = payload?.firebase?.sign_in_provider;
  const authProvider: 'firebase_google' | 'password' =
    signInProvider === 'password' ? 'password' : 'firebase_google';

  return {
    uid: payload.sub,
    email: payload.email.trim().toLowerCase(),
    emailVerified: Boolean(payload.email_verified),
    displayName: typeof payload.name === 'string' ? payload.name : payload.email.split('@')[0],
    photoURL: typeof payload.picture === 'string' ? payload.picture : '',
    authProvider,
    exp: payload.exp,
    iat: payload.iat,
  };
}

/**
 * Cryptographically verifies a Google OAuth 2.0 ID token using Google's public OAuth certs.
 */
export async function verifyGoogleOAuthIdToken(
  idToken: string,
  expectedClientId: string
): Promise<VerifiedTokenClaims> {
  const { payload } = await verifyRs256Jwt(idToken, 'https://www.googleapis.com/oauth2/v1/certs');
  const nowSec = Math.floor(Date.now() / 1000);

  if (payload.aud !== expectedClientId) {
    throw new AuthError('INVALID_AUDIENCE', 'Google OAuth ID token audience mismatch.', 401);
  }
  if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
    throw new AuthError('INVALID_ISSUER', 'Google OAuth ID token issuer mismatch.', 401);
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new AuthError('TOKEN_EXPIRED', 'Google OAuth token expired. Please sign in again.', 401);
  }
  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new AuthError('INVALID_SUBJECT', 'Google account identifier is missing.', 401);
  }
  if (!payload.email || typeof payload.email !== 'string') {
    throw new AuthError('MISSING_EMAIL', 'Google account did not provide an email address.', 401);
  }
  if (payload.email_verified === false) {
    throw new AuthError('EMAIL_NOT_VERIFIED', 'Your Google email address is not verified.', 403);
  }

  return {
    uid: `google_${payload.sub}`,
    email: payload.email.trim().toLowerCase(),
    emailVerified: Boolean(payload.email_verified ?? true),
    displayName: typeof payload.name === 'string' ? payload.name : payload.email.split('@')[0],
    photoURL: typeof payload.picture === 'string' ? payload.picture : '',
    authProvider: 'google',
    exp: payload.exp,
    iat: typeof payload.iat === 'number' ? payload.iat : nowSec,
  };
}

// ==========================================
// SIGNED SESSION COOKIE & PKCE STATE HELPERS
// ==========================================

function signData(encodedPayload: string): string {
  return encodeBase64Url(
    crypto.createHmac('sha256', getSessionSecret()).update(encodedPayload).digest()
  );
}

export function createSignedToken<T extends object>(payload: T): string {
  const encoded = encodeBase64Url(JSON.stringify(payload));
  const sig = signData(encoded);
  return `${encoded}.${sig}`;
}

export function verifySignedToken<T extends { exp?: number }>(token: string): T | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [encoded, sig] = parts;
  const expectedSig = signData(encoded);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(decodeBase64Url(encoded).toString('utf8')) as T;
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof parsed.exp === 'number' && parsed.exp <= nowSec) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function createSessionToken(user: {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  role: UserRole;
  authProvider: 'firebase_google' | 'google' | 'password';
}): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
    role: user.role,
    authProvider: user.authProvider,
    iat: nowSec,
    exp: nowSec + SESSION_TTL_SECONDS,
  };
  return createSignedToken(payload);
}

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  const cookies: Record<string, string> = {};
  if (!header) return cookies;

  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        cookies[key] = decodeURIComponent(val);
      } catch {
        cookies[key] = val;
      }
    }
  }
  return cookies;
}

export function isHttpsRequest(req: Request): boolean {
  const forwardedProto = (req.get('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
  if (forwardedProto === 'https') return true;
  if (req.secure) return true;
  const origin = req.get('origin') || '';
  if (origin.startsWith('https://')) return true;
  return false;
}

export function getRequestOrigin(req: Request): string {
  const forwardedHost = (req.get('x-forwarded-host') || '').split(',')[0].trim();
  const host = forwardedHost || req.get('host') || 'localhost:3000';
  const proto = isHttpsRequest(req) ? 'https' : 'http';
  return `${proto}://${host}`;
}

function appendSetCookieHeader(res: Response, cookieStr: string): void {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', [cookieStr]);
  } else if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, cookieStr]);
  } else {
    res.setHeader('Set-Cookie', [String(existing), cookieStr]);
  }
}

export function setAuthCookie(
  req: Request,
  res: Response,
  name: string,
  value: string,
  maxAgeSeconds: number
): void {
  const secure = isHttpsRequest(req);
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
  ];
  if (secure) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  appendSetCookieHeader(res, parts.join('; '));
}

export function clearAuthCookie(req: Request, res: Response, name: string): void {
  const secure = isHttpsRequest(req);
  const parts = [
    `${name}=`,
    'Path=/',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'HttpOnly',
  ];
  if (secure) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  appendSetCookieHeader(res, parts.join('; '));
}

export function getAllowedOrigins(req: Request): Set<string> {
  const allowed = new Set<string>();
  allowed.add(getRequestOrigin(req));
  const envOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  for (const o of envOrigins) {
    allowed.add(o.replace(/\/+$/, ''));
  }
  return allowed;
}

export function verifySameOriginForCookieMutation(req: Request): boolean {
  const origin = req.get('origin');
  const allowed = getAllowedOrigins(req);

  if (origin) {
    return allowed.has(origin.replace(/\/+$/, ''));
  }

  const referer = req.get('referer');
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      return allowed.has(refOrigin);
    } catch {
      return false;
    }
  }

  // Require explicit XMLHttpRequest header if Origin/Referer omitted
  return req.get('x-requested-with') === 'XMLHttpRequest';
}

// ==========================================
// GOOGLE OAUTH 2.0 CONFIG & PKCE HELPERS
// ==========================================

export interface GoogleOAuthConfig {
  configured: boolean;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function getGoogleOAuthConfig(req: Request): GoogleOAuthConfig {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const explicitRedirect = (process.env.GOOGLE_REDIRECT_URI || '').trim();
  const redirectUri = explicitRedirect || `${getRequestOrigin(req)}/api/auth/google/callback`;

  return {
    configured: Boolean(clientId && clientSecret),
    clientId,
    clientSecret,
    redirectUri,
  };
}

export function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = encodeBase64Url(crypto.randomBytes(32));
  const codeChallenge = encodeBase64Url(
    crypto.createHash('sha256').update(codeVerifier).digest()
  );
  return { codeVerifier, codeChallenge };
}

// ==========================================
// FIREBASE AUTHORIZED DOMAINS DIAGNOSTIC
// ==========================================

let cachedAuthorizedDomains: { domains: string[]; fetchedAt: number } | null = null;

export async function getFirebaseAuthorizedDomains(forceRefresh = false): Promise<string[]> {
  const now = Date.now();
  if (!forceRefresh && cachedAuthorizedDomains && now - cachedAuthorizedDomains.fetchedAt < 60_000) {
    return cachedAuthorizedDomains.domains;
  }

  const fbConfig = getFirebaseClientConfig();
  if (!fbConfig?.apiKey) return [];

  try {
    const resp = await fetch(
      `https://www.googleapis.com/identitytoolkit/v3/relyingparty/getProjectConfig?key=${encodeURIComponent(fbConfig.apiKey)}`
    );
    if (!resp.ok) return cachedAuthorizedDomains?.domains || [];
    const data = (await resp.json()) as { authorizedDomains?: string[] };
    const domains = Array.isArray(data.authorizedDomains) ? data.authorizedDomains : [];
    cachedAuthorizedDomains = { domains, fetchedAt: now };
    return domains;
  } catch (err) {
    console.warn('[AuthService] Unable to query Firebase authorized domains:', err);
    return cachedAuthorizedDomains?.domains || [];
  }
}

export function extractBearerToken(req: Request): string | null {
  const authHeader = req.get('authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    return token || null;
  }
  return null;
}

export { OAUTH_STATE_TTL_SECONDS, SESSION_TTL_SECONDS };
