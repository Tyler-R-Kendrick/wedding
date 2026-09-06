import { describe, expect, it } from 'vitest';
import type { GuestId, HouseholdId } from '@/contracts/ids';
import type { GuestPrincipal } from '@/contracts/principal';
import { toPrincipalRef } from '@/contracts/principal';
import { BIOMETRIC_RESPONSE_SCOPES, guestScopeKey } from '@/domain/biometrics/deletion';
import { principalKey } from '@/policy/confirmation';

/**
 * The deletion job purges cached capability responses by reconstructing the idempotency scope the
 * invoke pipeline writes (`<capability>:<principalKey>`). It only has a guest id, not a principal,
 * so this pins the two together: if `principalKey` ever starts keying a guest on anything else,
 * these fail rather than the purge silently missing every row.
 */
const guest: GuestPrincipal = {
  kind: 'guest',
  authIdentityId: 'auth-a' as never,
  guestId: 'GUESTA' as GuestId,
  householdId: 'HOUSEA' as HouseholdId,
  actsFor: ['GUESTA' as GuestId],
  entitlements: new Set(['use_face_matching']),
  authenticatedAt: new Date().toISOString(),
  sessionId: 's',
};

describe('the scope the deletion job purges', () => {
  it('matches the scope the pipeline writes for that guest', () => {
    expect(guestScopeKey('GUESTA')).toBe(principalKey(toPrincipalRef(guest)));
  });

  it('does not depend on the household, which the job never knows', () => {
    const other: GuestPrincipal = { ...guest, householdId: 'SOMEWHERE-ELSE' as HouseholdId };
    expect(principalKey(toPrincipalRef(other))).toBe(guestScopeKey('GUESTA'));
  });

  it('is per-guest: one guest\'s deletion never reaches another guest\'s rows', () => {
    expect(guestScopeKey('GUESTA')).not.toBe(guestScopeKey('GUESTB'));
  });

  it('covers every biometric capability that could hold a result, including the confirmation nonces', () => {
    expect([...BIOMETRIC_RESPONSE_SCOPES]).toEqual(
      expect.arrayContaining(['find_photos_of_me', 'enroll_biometric_reference', 'grant_biometric_consent', 'revoke_biometric_consent', 'request_biometric_deletion']),
    );
  });
});
