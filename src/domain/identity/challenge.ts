import { and, eq, gt, lt } from 'drizzle-orm';
import { newId } from '@/contracts/ids';
import type { Db } from '@/db/client';
import { authVerifications } from '@/db/schema';
import { hmacSha256, randomToken, timingSafeEqualString } from '@/lib/crypto';

/**
 * A challenge records *who* an OTP was issued for between "send code" and "verify code".
 * The body (email, guest ids, invitation id, user id) lives only on the server, keyed by a
 * random nonce; the browser receives `nonce.sig` — 43 + 1 + 43 URL-safe characters that are
 * byte-indistinguishable for known and unknown addresses and decode to nothing. The HMAC lets
 * the server reject forged nonces without touching the database.
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
  /** Guests without their own inbox that the bound guest will manage after this claim. */
  managedGuestIds?: string[];
  /** Free-form, non-sensitive continuation (an internal returnTo path). */
  next?: string;
}

export const DEFAULT_CHALLENGE_TTL_SECONDS = 10 * 60;
export const CHALLENGE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/;
const IDENTIFIER_PREFIX = 'challenge:';

/** Storage seam: the app uses auth_verifications; unit tests use memory. */
export interface ChallengeStore {
  put(id: string, value: string, expiresAt: Date): Promise<void>;
  get(id: string): Promise<{ value: string; expiresAt: Date } | null>;
  delete(id: string): Promise<void>;
}

export class DbChallengeStore implements ChallengeStore {
  constructor(private readonly db: Db) {}
  async put(id: string, value: string, expiresAt: Date) {
    const now = new Date();
    await this.db.insert(authVerifications).values({ id: newId(), identifier: IDENTIFIER_PREFIX + id, value, expiresAt, createdAt: now, updatedAt: now });
    // Opportunistic sweep of expired challenges so the table never grows unbounded.
    await this.db.delete(authVerifications).where(and(lt(authVerifications.expiresAt, now), gt(authVerifications.identifier, IDENTIFIER_PREFIX), lt(authVerifications.identifier, IDENTIFIER_PREFIX + '~')));
  }
  async get(id: string) {
    const rows = await this.db.select({ value: authVerifications.value, expiresAt: authVerifications.expiresAt }).from(authVerifications).where(eq(authVerifications.identifier, IDENTIFIER_PREFIX + id)).limit(1);
    return rows[0] ?? null;
  }
  async delete(id: string) {
    await this.db.delete(authVerifications).where(eq(authVerifications.identifier, IDENTIFIER_PREFIX + id));
  }
}

export class MemoryChallengeStore implements ChallengeStore {
  private readonly rows = new Map<string, { value: string; expiresAt: Date }>();
  async put(id: string, value: string, expiresAt: Date) {
    this.rows.set(id, { value, expiresAt });
  }
  async get(id: string) {
    return this.rows.get(id) ?? null;
  }
  async delete(id: string) {
    this.rows.delete(id);
  }
}

const sign = (secret: string, nonce: string) => hmacSha256(secret, `challenge:${nonce}`);

export async function issueChallenge(store: ChallengeStore, secret: string, payload: ChallengePayload, opts: { now?: Date; ttlSeconds?: number } = {}): Promise<{ token: string; expiresAt: string }> {
  const now = opts.now ?? new Date();
  const expiresAt = new Date(now.getTime() + (opts.ttlSeconds ?? DEFAULT_CHALLENGE_TTL_SECONDS) * 1000);
  const nonce = randomToken(32);
  await store.put(nonce, JSON.stringify({ ...payload, iat: now.toISOString() }), expiresAt);
  return { token: `${nonce}.${sign(secret, nonce)}`, expiresAt: expiresAt.toISOString() };
}

function parseToken(secret: string, token: unknown): string | null {
  if (typeof token !== 'string' || !CHALLENGE_TOKEN_PATTERN.test(token)) return null;
  const [nonce, sig] = token.split('.') as [string, string];
  return timingSafeEqualString(sign(secret, nonce), sig) ? nonce : null;
}

/** Returns the payload when the signature is valid and the challenge is unexpired; otherwise null. */
export async function readChallenge(store: ChallengeStore, secret: string, token: unknown, now: Date = new Date()): Promise<(ChallengePayload & { issuedAt: string }) | null> {
  const nonce = parseToken(secret, token);
  if (!nonce) return null;
  const row = await store.get(nonce);
  if (!row) return null;
  if (row.expiresAt.getTime() <= now.getTime()) {
    await store.delete(nonce);
    return null;
  }
  let body: ChallengePayload & { iat?: string };
  try {
    body = JSON.parse(row.value) as ChallengePayload & { iat?: string };
  } catch {
    return null;
  }
  if (!CHALLENGE_KINDS.includes(body.kind)) return null;
  const { iat, ...payload } = body;
  return { ...payload, guestIds: Array.isArray(payload.guestIds) ? payload.guestIds.filter((g) => typeof g === 'string') : [], issuedAt: iat ?? now.toISOString() };
}

/** Forgets a challenge (after a successful verification). */
export async function consumeChallenge(store: ChallengeStore, secret: string, token: unknown): Promise<void> {
  const nonce = parseToken(secret, token);
  if (nonce) await store.delete(nonce);
}
