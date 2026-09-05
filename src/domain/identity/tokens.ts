import { randomToken, sha256Hex } from '@/lib/crypto';

/**
 * Invitation discovery tokens (ADR-0001 rule 1). 32 random bytes, base64url (43 chars).
 * Only the SHA-256 hash is stored; the token is shown once when issued and lives in the
 * printed/mailed link. A token never grants a session: it only unlocks the household preview.
 */
export const INVITATION_TOKEN_BYTES = 32;
export const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;
export const TOKEN_PREFIX_CHARS = 6;
export const DEFAULT_INVITATION_TTL_DAYS = 365;

export function generateInvitationToken(): string {
  return randomToken(INVITATION_TOKEN_BYTES);
}

export function isInvitationTokenShape(value: unknown): value is string {
  return typeof value === 'string' && INVITATION_TOKEN_PATTERN.test(value);
}

export function hashInvitationToken(token: string): string {
  return sha256Hex(`invitation:${token}`);
}

export function invitationTokenPrefix(token: string): string {
  return token.slice(0, TOKEN_PREFIX_CHARS);
}

export type InvitationLifecycle = 'active' | 'claimed' | 'expired' | 'revoked';

/** Revoked beats expired beats claimed beats active; claimed links stay usable for the household. */
export function invitationLifecycle(row: { status: string; expiresAt: Date; revokedAt?: Date | null }, now: Date = new Date()): InvitationLifecycle {
  if (row.status === 'revoked' || row.revokedAt) return 'revoked';
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
  if (row.status === 'claimed') return 'claimed';
  return 'active';
}

export function defaultInvitationExpiry(now: Date = new Date(), ttlDays = DEFAULT_INVITATION_TTL_DAYS): Date {
  return new Date(now.getTime() + ttlDays * 86_400_000);
}

/** Absolute invite URL for a token; the path is stable so printed cards never break. */
export function invitationUrl(siteUrl: string, token: string): string {
  const base = siteUrl.replace(/\/+$/, '');
  return `${base}/invite/${token}`;
}
