import { describe, expect, it } from 'vitest';
import { CHALLENGE_TOKEN_PATTERN, issueChallenge, MemoryChallengeStore, readChallenge, consumeChallenge } from '@/domain/identity/challenge';
import { maskEmail, normalizeEmail } from '@/domain/identity/mask';
import { computeLockout, OTP_POLICY } from '@/domain/identity/otp';
import { defaultInvitationExpiry, generateInvitationToken, hashInvitationToken, invitationLifecycle, invitationTokenPrefix, invitationUrl, isInvitationTokenShape } from '@/domain/identity/tokens';
import { isTrustedMutationRequest } from '@/lib/auth/csrf';

describe('invitation tokens', () => {
  it('are high-entropy, URL-safe, hashed at rest, and only the prefix is kept for display', () => {
    const a = generateInvitationToken();
    const b = generateInvitationToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isInvitationTokenShape(a)).toBe(true);
    expect(isInvitationTokenShape('short')).toBe(false);
    expect(isInvitationTokenShape('x'.repeat(65))).toBe(false);
    expect(hashInvitationToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInvitationToken(a)).not.toContain(a);
    expect(hashInvitationToken(a)).toBe(hashInvitationToken(a));
    expect(invitationTokenPrefix(a)).toHaveLength(6);
    expect(invitationUrl('https://sara-tyler.example/', a)).toBe(`https://sara-tyler.example/invite/${a}`);
  });

  it('lifecycle: revoked beats expired beats claimed beats active', () => {
    const now = new Date('2026-09-05T12:00:00Z');
    const future = new Date('2027-01-01T00:00:00Z');
    const past = new Date('2026-01-01T00:00:00Z');
    expect(invitationLifecycle({ status: 'issued', expiresAt: future }, now)).toBe('active');
    expect(invitationLifecycle({ status: 'claimed', expiresAt: future }, now)).toBe('claimed');
    expect(invitationLifecycle({ status: 'claimed', expiresAt: past }, now)).toBe('expired');
    expect(invitationLifecycle({ status: 'issued', expiresAt: past }, now)).toBe('expired');
    expect(invitationLifecycle({ status: 'revoked', expiresAt: future }, now)).toBe('revoked');
    expect(invitationLifecycle({ status: 'issued', expiresAt: past, revokedAt: now }, now)).toBe('revoked');
    expect(defaultInvitationExpiry(now).getTime() - now.getTime()).toBe(365 * 86_400_000);
  });
});

describe('opaque OTP challenges', () => {
  const secret = 'challenge-test-secret-0123456789';
  it('hands out nonce.sig only, round-trips through the store, expires, and rejects tampering or a different secret', async () => {
    const store = new MemoryChallengeStore();
    const now = new Date('2026-09-05T12:00:00Z');
    const { token, expiresAt } = await issueChallenge(store, secret, { kind: 'claim', email: 'a@b.co', guestIds: ['G1'], invitationId: 'I1', userId: null }, { now, ttlSeconds: 600 });
    expect(expiresAt).toBe('2026-09-05T12:10:00.000Z');
    expect(token).toMatch(CHALLENGE_TOKEN_PATTERN);
    // Nothing in the token decodes to the body: it is 32 random bytes plus an HMAC (single characters may occur by chance).
    const decoded = Buffer.from(token.split('.')[0]!, 'base64url').toString('utf8');
    expect(decoded).not.toContain('a@b.co');
    expect(decoded).not.toContain('"kind"');
    expect(() => JSON.parse(decoded)).toThrow();
    const read = await readChallenge(store, secret, token, now);
    expect(read).toMatchObject({ kind: 'claim', email: 'a@b.co', guestIds: ['G1'], invitationId: 'I1' });
    expect(await readChallenge(store, secret, token, new Date('2026-09-05T12:10:00Z'))).toBeNull();
    const { token: fresh } = await issueChallenge(store, secret, { kind: 'sign_in', email: null, guestIds: [], invitationId: null, userId: null }, { now });
    expect(await readChallenge(store, 'other-secret-0123456789abcdef', fresh, now)).toBeNull();
    const [nonce] = fresh.split('.');
    expect(await readChallenge(store, secret, `${nonce}.${'A'.repeat(43)}`, now)).toBeNull();
    expect(await readChallenge(store, secret, 'garbage', now)).toBeNull();
    expect(await readChallenge(store, secret, undefined, now)).toBeNull();
    await consumeChallenge(store, secret, fresh);
    expect(await readChallenge(store, secret, fresh, now)).toBeNull();
  });

  it('known and unknown recipients get byte-identical token shapes', async () => {
    const store = new MemoryChallengeStore();
    const a = await issueChallenge(store, secret, { kind: 'sign_in', email: 'known@example.test', guestIds: ['G1', 'G2'], invitationId: null, userId: null });
    const b = await issueChallenge(store, secret, { kind: 'sign_in', email: null, guestIds: [], invitationId: null, userId: null });
    expect(a.token).toHaveLength(b.token.length);
    expect(a.token).toMatch(CHALLENGE_TOKEN_PATTERN);
    expect(b.token).toMatch(CHALLENGE_TOKEN_PATTERN);
  });
});

describe('OTP lockout', () => {
  const t = (s: number) => new Date(Date.UTC(2026, 8, 5, 12, 0, s));
  it('locks after 5 failures inside the window and lifts after the lock period', () => {
    const now = t(60);
    expect(computeLockout([t(0), t(10), t(20), t(30)], now)).toEqual({ locked: false, failures: 4 });
    const locked = computeLockout([t(0), t(10), t(20), t(30), t(40)], now);
    expect(locked.locked).toBe(true);
    expect(locked.until).toBe(new Date(t(40).getTime() + OTP_POLICY.lockout.lockMs).toISOString());
    expect(computeLockout([t(0), t(10), t(20), t(30), t(40)], new Date(t(40).getTime() + OTP_POLICY.lockout.lockMs + 1)).locked).toBe(false);
  });
  it('ignores failures outside the window', () => {
    const old = new Date(t(0).getTime() - OTP_POLICY.lockout.windowMs - 1);
    expect(computeLockout([old, old, old, old, old], t(0)).locked).toBe(false);
  });
});

describe('email helpers', () => {
  it('masks to one local and one domain character', () => {
    expect(maskEmail('tyler@gmail.com')).toBe('t•••@g•••.com');
    expect(maskEmail('a@b.co.uk')).toBe('a•••@b•••.uk');
    expect(maskEmail('nonsense')).toBe('•••');
    expect(normalizeEmail('  Sara@Example.COM ')).toBe('sara@example.com');
  });
});

describe('same-origin mutation gate', () => {
  const req = (method: string, headers: Record<string, string>) => new Request('http://localhost:3000/api/capabilities/x', { method, headers });
  it('lets reads and header-less clients through, blocks cross-site origins and fetch metadata', () => {
    expect(isTrustedMutationRequest(req('GET', { origin: 'https://evil.example' }))).toBe(true);
    expect(isTrustedMutationRequest(req('POST', {}))).toBe(true);
    expect(isTrustedMutationRequest(req('POST', { host: 'localhost:3000', origin: 'http://localhost:3000' }))).toBe(true);
    expect(isTrustedMutationRequest(req('POST', { host: 'localhost:3000', origin: 'https://evil.example' }))).toBe(false);
    expect(isTrustedMutationRequest(req('POST', { host: 'localhost:3000', origin: 'https://sara-tyler.example' }), ['https://sara-tyler.example'])).toBe(true);
    expect(isTrustedMutationRequest(req('POST', { 'sec-fetch-site': 'cross-site' }))).toBe(false);
    expect(isTrustedMutationRequest(req('POST', { 'sec-fetch-site': 'same-site', origin: 'http://localhost:3000', host: 'localhost:3000' }))).toBe(false);
    expect(isTrustedMutationRequest(req('POST', { 'sec-fetch-site': 'same-origin', origin: 'http://localhost:3000', host: 'localhost:3000' }))).toBe(true);
    expect(isTrustedMutationRequest(req('POST', { origin: 'null' }))).toBe(false);
    expect(isTrustedMutationRequest(req('POST', { origin: 'not a url' }))).toBe(false);
  });
});
