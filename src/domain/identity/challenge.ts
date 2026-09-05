import { hmacSha256, randomToken, timingSafeEqualString } from '@/lib/crypto';

/**
 * A challenge is a signed, short-lived, stateless description of *who* an OTP was issued for.
 * The browser holds it between "send code" and "verify code"; it never contains the code.
 * Signing keeps callers from steering a code to a guest they did not pick, and lets the
 * server answer identically for known and unknown emails (a challenge is issued either way).
 */
export const CHALLENGE_KINDS = ['claim', 'sign_in', 'step_up', 'admin_sign_in', 'change_email'] as const;
export type ChallengeKind = (typeof CHALLENGE_KINDS)[number];

export interface ChallengePayload {
  kind: ChallengeKind;
  /** Lower-cased address the code went to, or null when nothing was sent (unknown email). */
  email: string | null;
  /** Guests this verification may bind (claim / sign-in). Empty when nothing matched. */
  guestIds: string[];
  invitationId: string | null;
  /** Auth user the challenge belongs to (step-up / change-email). */
  userId: string | null;
  /** Free-form, non-sensitive continuation (e.g. an internal returnTo path). */
  next?: string;
}

interface Body extends ChallengePayload {
  v: 1;
  iat: number;
  exp: number;
  n: string;
}

export const DEFAULT_CHALLENGE_TTL_SECONDS = 10 * 60;

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url').toString('utf8');

export function issueChallenge(secret: string, payload: ChallengePayload, opts: { now?: Date; ttlSeconds?: number } = {}): { token: string; expiresAt: string } {
  const now = opts.now ?? new Date();
  const ttl = opts.ttlSeconds ?? DEFAULT_CHALLENGE_TTL_SECONDS;
  const body: Body = { ...payload, v: 1, iat: Math.floor(now.getTime() / 1000), exp: Math.floor(now.getTime() / 1000) + ttl, n: randomToken(8) };
  const encoded = b64(JSON.stringify(body));
  return { token: `${encoded}.${hmacSha256(secret, encoded)}`, expiresAt: new Date(body.exp * 1000).toISOString() };
}

/** Returns the payload when the signature is valid and the challenge is unexpired; otherwise null. */
export function readChallenge(secret: string, token: unknown, now: Date = new Date()): (ChallengePayload & { issuedAt: string }) | null {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;
  if (!timingSafeEqualString(hmacSha256(secret, encoded), sig)) return null;
  let body: Body;
  try {
    body = JSON.parse(unb64(encoded)) as Body;
  } catch {
    return null;
  }
  if (body.v !== 1 || !CHALLENGE_KINDS.includes(body.kind)) return null;
  if (Math.floor(now.getTime() / 1000) >= body.exp) return null;
  const { v: _v, iat, exp: _exp, n: _n, ...payload } = body;
  return { ...payload, guestIds: Array.isArray(payload.guestIds) ? payload.guestIds.filter((g) => typeof g === 'string') : [], issuedAt: new Date(iat * 1000).toISOString() };
}
