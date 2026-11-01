import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { resolveAuthSecret } from '@/lib/auth/config';
import type { SocialProvider } from '@/db/schema/social-auth';

const COOKIE = 'wedding.social_oauth';
const MAX_AGE_SECONDS = 600;

export interface SocialOAuthState {
  provider: SocialProvider;
  codeVerifier: string;
  state: string;
  next: string | null;
  exp: number;
}

function sign(payload: string): string {
  return createHmac('sha256', resolveAuthSecret()).update(payload).digest('base64url');
}

export function encodeOAuthState(input: Omit<SocialOAuthState, 'exp'> & { exp?: number }): string {
  const body: SocialOAuthState = { ...input, exp: input.exp ?? Date.now() + MAX_AGE_SECONDS * 1000 };
  const json = Buffer.from(JSON.stringify(body)).toString('base64url');
  return `${json}.${sign(json)}`;
}

export function decodeOAuthState(raw: string | undefined | null): SocialOAuthState | null {
  if (!raw) return null;
  const [json, sig] = raw.split('.');
  if (!json || !sig) return null;
  const expected = sign(json);
  try {
    if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(json, 'base64url').toString('utf8')) as SocialOAuthState;
    if (!parsed?.provider || !parsed.codeVerifier || !parsed.state || typeof parsed.exp !== 'number') return null;
    if (parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function oauthStateCookieOptions(secure: boolean) {
  return {
    name: COOKIE,
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure,
    maxAge: MAX_AGE_SECONDS,
  };
}

export function newPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function newOAuthStateToken(): string {
  return randomBytes(16).toString('base64url');
}
