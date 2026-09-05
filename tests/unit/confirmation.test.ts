import { describe, expect, it } from 'vitest';
import type { GuestId, HouseholdId } from '@/contracts/ids';
import { ConfirmationService } from '@/policy/confirmation';

const svc = new ConfirmationService('unit-test-secret-at-least-16');
const ref = { kind: 'guest' as const, guestId: 'G1' as GuestId, householdId: 'H1' as HouseholdId };
const claims = { capability: 'submit_rsvp', principalRef: ref, payloadHash: 'abc' };

describe('confirmation tokens', () => {
  it('issues and verifies a token bound to capability, principal and payload', () => {
    const now = new Date('2026-09-05T12:00:00Z');
    const { token, expiresAt } = svc.issue(claims, { now, ttlSeconds: 60 });
    expect(expiresAt).toBe('2026-09-05T12:01:00.000Z');
    const ok = svc.verify(token, claims, now);
    expect(ok.ok).toBe(true);
  });

  it('rejects missing, expired, and mismatched tokens with confirmation_required', () => {
    const now = new Date('2026-09-05T12:00:00Z');
    const { token } = svc.issue(claims, { now, ttlSeconds: 60 });
    const missing = svc.verify(undefined, claims, now);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.details?.reason).toBe('missing');

    const expired = svc.verify(token, claims, new Date('2026-09-05T12:02:00Z'));
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.error.details?.reason).toBe('expired');

    expect(svc.verify(token, { ...claims, payloadHash: 'other' }, now).ok).toBe(false);
    expect(svc.verify(token, { ...claims, capability: 'other' }, now).ok).toBe(false);
    expect(svc.verify(token, { ...claims, principalRef: { kind: 'anonymous' } }, now).ok).toBe(false);
  });

  it('rejects tampered signatures and bodies', () => {
    const { token } = svc.issue(claims);
    const [body, sig] = token.split('.') as [string, string];
    expect(svc.verify(`${body}.${sig.slice(0, -2)}xx`, claims).ok).toBe(false);
    const other = new ConfirmationService('a-different-secret-1234567');
    expect(other.verify(token, claims).ok).toBe(false);
    expect(svc.verify('garbage', claims).ok).toBe(false);
    const forged = Buffer.from(JSON.stringify({ v: 1, c: 'submit_rsvp', p: 'guest:G1', h: 'abc', iat: 0, exp: 9e9, n: 'x' })).toString('base64url');
    expect(svc.verify(`${forged}.${sig}`, claims).ok).toBe(false);
  });

  it('refuses weak secrets', () => {
    expect(() => new ConfirmationService('short')).toThrow();
  });
});
