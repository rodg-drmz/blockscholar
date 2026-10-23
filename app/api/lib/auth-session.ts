import { createHash, createHmac } from 'node:crypto';
import { NextResponse } from 'next/server';
import { normalizeEmail } from '@/app/lib/normalizeEmail';
import { secretsEqual } from '@/lib/security/secret-equality';

export const APP_SESSION_COOKIE = 'drmz_user';
const APP_SESSION_VERSION = 'v1';
const APP_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const MIN_SESSION_SECRET_LENGTH = 32;

export type DrmzUser = {
  id: string;
  name: string;
  email: string | null;
  picture?: string | null;
  provider: string;
  did?: string | null;
  wallet?: {
    chain: 'cardano' | 'midnight' | 'ethereum' | 'solana';
    address: string;
    /** Canonical identity returned by signature verification, never client supplied. */
    key?: string;
    walletName?: string | null;
    network?: string | null;
  } | null;
};

type AppSessionPayload = {
  version: 1;
  issuedAt: number;
  expiresAt: number;
  user: DrmzUser;
};

export type AppSessionResult =
  | { kind: 'verified'; user: DrmzUser; expiresAt: number }
  | { kind: 'legacy'; user: DrmzUser }
  | { kind: 'invalid' }
  | { kind: 'none' };

export function userIdFromEmail(email: string): string {
  return createHash('sha256').update(email.toLowerCase().trim()).digest('hex').slice(0, 24);
}

export function buildUser(params: {
  email: string;
  name?: string;
  provider: string;
  id?: string;
}): DrmzUser & { email: string } {
  const email = params.email.toLowerCase().trim();
  const local = email.split('@')[0] || 'User';
  return {
    id: params.id || userIdFromEmail(email),
    name: params.name?.trim() || local,
    email,
    picture: null,
    provider: params.provider,
  };
}

export function appSessionSecretStatus(): 'configured' | 'missing' | 'invalid' {
  const secret = process.env.DRMZ_APP_SESSION_SECRET?.trim();
  if (!secret) return 'missing';
  return secret.length >= MIN_SESSION_SECRET_LENGTH ? 'configured' : 'invalid';
}

function sessionSecrets(): string[] {
  const primary = process.env.DRMZ_APP_SESSION_SECRET?.trim();
  const previous =
    process.env.DRMZ_APP_SESSION_PREVIOUS_SECRETS?.split(',')
      .map((secret) => secret.trim())
      .filter(Boolean) ?? [];
  return [primary, ...previous].filter(
    (secret): secret is string => Boolean(secret && secret.length >= MIN_SESSION_SECRET_LENGTH),
  );
}

function normalizeSessionUser(value: unknown): DrmzUser | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Partial<DrmzUser>;
  const email = normalizeEmail(typeof row.email === 'string' ? row.email : null);
  const provider = typeof row.provider === 'string' ? row.provider.trim() : '';
  const rawWallet = row.wallet;
  const wallet =
    rawWallet &&
    typeof rawWallet === 'object' &&
    (rawWallet.chain === 'cardano' ||
      rawWallet.chain === 'midnight' ||
      rawWallet.chain === 'ethereum' ||
      rawWallet.chain === 'solana') &&
    typeof rawWallet.address === 'string' &&
    rawWallet.address.trim() &&
    rawWallet.address.length <= 512
      ? {
          chain: rawWallet.chain,
          address: rawWallet.address.trim(),
          ...(typeof rawWallet.key === 'string' && rawWallet.key.length > 0 && rawWallet.key.length <= 512
            ? { key: rawWallet.key } : {}),
          walletName:
            typeof rawWallet.walletName === 'string'
              ? rawWallet.walletName.trim().slice(0, 120)
              : null,
          network:
            typeof rawWallet.network === 'string'
              ? rawWallet.network.trim().slice(0, 120)
              : null,
        }
      : null;
  const social = (provider === 'discord' || provider === 'twitter') && typeof row.id === 'string' && new RegExp(`^oauth:${provider}:\\d{1,30}$`).test(row.id);
  if (
    typeof row.id !== 'string' ||
    !row.id.trim() ||
    !provider ||
    (!email && !wallet && !social)
  ) {
    return null;
  }
  return {
    id: row.id.trim(),
    name:
      typeof row.name === 'string' && row.name.trim()
        ? row.name.trim()
        : email?.split('@')[0] || wallet?.walletName || 'Learner',
    email,
    picture: typeof row.picture === 'string' ? row.picture : null,
    provider,
    ...(typeof row.did === 'string' &&
    /^did:veridian:[a-f0-9]{32}$/.test(row.did.trim())
      ? { did: row.did.trim() }
      : {}),
    ...(wallet ? { wallet } : {}),
  };
}

function sessionMac(encodedPayload: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`drmz-app-session:${APP_SESSION_VERSION}:`)
    .update(encodedPayload)
    .digest('base64url');
}

export function createAppSessionToken(
  user: DrmzUser,
  nowMs = Date.now(),
): string {
  const status = appSessionSecretStatus();
  if (status !== 'configured') {
    throw new Error(
      status === 'invalid'
        ? `DRMZ_APP_SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters.`
        : 'DRMZ_APP_SESSION_SECRET is not configured.',
    );
  }
  const normalized = normalizeSessionUser(user);
  if (!normalized) {
    throw new Error('Cannot create an app session without a verified email or wallet identity.');
  }

  const issuedAt = Math.floor(nowMs / 1000);
  const payload: AppSessionPayload = {
    version: 1,
    issuedAt,
    expiresAt: issuedAt + APP_SESSION_TTL_SECONDS,
    user: normalized,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const secret = process.env.DRMZ_APP_SESSION_SECRET!.trim();
  return `${APP_SESSION_VERSION}.${encodedPayload}.${sessionMac(encodedPayload, secret)}`;
}

export function verifyAppSessionToken(
  token: string,
  nowMs = Date.now(),
): { user: DrmzUser; expiresAt: number } | null {
  const [version, encodedPayload, providedMac, extra] = token.split('.');
  if (
    version !== APP_SESSION_VERSION ||
    !encodedPayload ||
    !providedMac ||
    extra !== undefined
  ) {
    return null;
  }

  const matched = sessionSecrets().some((secret) =>
    secretsEqual(providedMac, sessionMac(encodedPayload, secret)),
  );
  if (!matched) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as Partial<AppSessionPayload>;
    const user = normalizeSessionUser(payload.user);
    const now = Math.floor(nowMs / 1000);
    if (
      payload.version !== 1 ||
      typeof payload.issuedAt !== 'number' ||
      typeof payload.expiresAt !== 'number' ||
      payload.issuedAt > now + 60 ||
      payload.expiresAt <= now ||
      payload.expiresAt - payload.issuedAt > APP_SESSION_TTL_SECONDS ||
      !user
    ) {
      return null;
    }
    return { user, expiresAt: payload.expiresAt };
  } catch {
    return null;
  }
}

function cookieValue(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

export function readAppSession(req: Request): AppSessionResult {
  const raw = cookieValue(req, APP_SESSION_COOKIE);
  if (!raw) return { kind: 'none' };
  if (raw.length > 8192) return { kind: 'invalid' };


  if (raw.startsWith(`${APP_SESSION_VERSION}.`)) {
    const verified = verifyAppSessionToken(raw);
    return verified ? { kind: 'verified', ...verified } : { kind: 'invalid' };
  }

  try {
    const user = normalizeSessionUser(JSON.parse(raw));
    return user ? { kind: 'legacy', user } : { kind: 'invalid' };
  } catch {
    return { kind: 'invalid' };
  }
}

export function jsonWithUser(user: DrmzUser, body: Record<string, unknown>, status = 200): NextResponse {
  return setUserSession(NextResponse.json(body, { status }), user);
}

export function setUserSession(response: NextResponse, user: DrmzUser): NextResponse {
  const normalized = normalizeSessionUser(user);
  const secretStatus = appSessionSecretStatus();
  if (secretStatus === 'invalid') {
    throw new Error(
      `DRMZ_APP_SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters.`,
    );
  }

  // Missing key preserves existing pilots. Strict Learn enforcement refuses this legacy form.
  const value =
    secretStatus === 'configured' && normalized
      ? createAppSessionToken(normalized)
      : JSON.stringify(user);
  response.cookies.set(APP_SESSION_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: APP_SESSION_TTL_SECONDS,
    path: '/',
    sameSite: 'lax',
  });
  return response;
}

export function redirectWithUser(requestUrl: URL | string, returnTo: string, user: DrmzUser): NextResponse {
  const origin = typeof requestUrl === 'string' ? requestUrl : requestUrl.origin;
  const safePath = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/home';
  const dest = new URL(safePath, origin);
  dest.searchParams.set('auth', 'success');
  const response = NextResponse.redirect(dest);
  return setUserSession(response, user);
}

export function getWebAuthnConfig(requestUrl: URL) {
  const origin = requestUrl.origin;
  const rpId =
    process.env.WEBAUTHN_RP_ID?.trim() ||
    (origin.includes('localhost') ? 'localhost' : new URL(origin).hostname);
  const rpName = process.env.WEBAUTHN_RP_NAME?.trim() || 'DRMZ Network';
  return { origin, rpId, rpName };
}

export function isValidEmail(raw: string): boolean {
  return normalizeEmail(raw) !== null;
}
