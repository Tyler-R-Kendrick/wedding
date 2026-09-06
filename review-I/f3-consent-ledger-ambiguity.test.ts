import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { BiometricStatusView } from '@/capabilities/biometrics';
import { newId } from '@/contracts/ids';
import { getDb } from '@/db/client';
import { biometricConsents } from '@/db/schema/biometrics';
import { CONSENT_POLICY_VERSION, CONSENT_TEXT_HASH, consentState, getConsentState, grantConsent, revokeConsent } from '@/domain/biometrics';
import { admin, buildRig, call, GUEST_A, post, setFlag, setReady, type Rig } from './harness';

/**
 * FINDING 3 — the consent ledger admits two simultaneous, un-withdrawable grants.
 *
 * `grantConsent` (src/domain/biometrics/consent.ts:62-94) reads the derived state and then
 * INSERTs; `biometric.consents` has no uniqueness constraint that would make the read-then-write
 * safe (src/db/schema/biometrics.ts:25-55, migration 0003 lines 40-61). Two consent flows racing
 * (two browser tabs, two idempotency keys, two valid draft tokens) both see `status: 'none'` and
 * both append a grant. `revokeConsent` then writes a revoke row for the LATEST grant only
 * (consent.ts:97-124), so the ledger keeps a grant with no matching withdrawal for ever.
 */
describe('F3: concurrent grants leave the consent ledger ambiguous', () => {
  let _rig: Rig;

  beforeAll(async () => {
    _rig = await buildRig();
    await setFlag(true);
    await setReady(true);
  });

  afterAll(async () => {
    await setFlag(false);
    await setReady(false);
  });

  it('two concurrent grants for one guest both succeed, and only one can ever be withdrawn', async () => {
    const db = await getDb();
    await db.delete(biometricConsents);
    const base = { guestId: GUEST_A, householdId: 'HOUSEA', policyVersion: CONSENT_POLICY_VERSION, textHash: CONSENT_TEXT_HASH, adultAttested: true, ipHash: 'h', surface: 'ui' };
    const [one, two] = await Promise.all([
      grantConsent(db, { ...base, requestId: newId(), now: new Date() }),
      grantConsent(db, { ...base, requestId: newId(), now: new Date(Date.now() + 1) }),
    ]);
    const rows = await db.select().from(biometricConsents).where(eq(biometricConsents.guestId, GUEST_A));
    console.info('[F3] grant1.ok=%s grant2.ok=%s ledgerRows=%d entries=%s', one.ok, two.ok, rows.length, rows.map((r) => r.entry).join(','));

    // The guest withdraws once, as the UI offers.
    const revoked = await revokeConsent(db, { guestId: GUEST_A, ipHash: 'h', surface: 'ui', requestId: newId(), now: new Date(Date.now() + 2) });
    const after = await db.select().from(biometricConsents).where(eq(biometricConsents.guestId, GUEST_A));
    const grants = after.filter((r) => r.entry === 'grant');
    const revokes = after.filter((r) => r.entry === 'revoke');
    const orphans = grants.filter((g) => !revokes.some((r) => r.grantId === g.id));
    const status = await call<BiometricStatusView>(admin, 'admin_biometric_status', {});
    console.info('[F3] after one withdrawal: grants=%d revokes=%d neverWithdrawn=%d derivedStatus=%s adminCounts=%s',
      grants.length, revokes.length, orphans.length, consentState(after).status, status.ok ? JSON.stringify(status.data.consents) : 'n/a');
    expect(revoked.revoked).toBe(true);

    expect(rows.filter((r) => r.entry === 'grant'), 'a guest must never hold two simultaneous grants').toHaveLength(1);
    expect(orphans, 'every grant in the ledger must be withdrawable').toHaveLength(0);
  });

  it('the same race is reachable through the public consent endpoint (two tabs)', async () => {
    const db = await getDb();
    await db.delete(biometricConsents);
    const [d1, d2] = await Promise.all([
      post<unknown>('draft', { input: { adultAttested: true } }, 'guestB'),
      post<unknown>('draft', { input: { adultAttested: true } }, 'guestB'),
    ]);
    expect(d1.ok && d2.ok).toBe(true);
    const body = { input: { policyVersion: CONSENT_POLICY_VERSION, textHash: CONSENT_TEXT_HASH, adultAttested: true } };
    const [g1, g2] = await Promise.all([
      post('grant', { ...body, confirmationToken: d1.confirmation!.token, idempotencyKey: newId() }, 'guestB'),
      post('grant', { ...body, confirmationToken: d2.confirmation!.token, idempotencyKey: newId() }, 'guestB'),
    ]);
    const rows = (await db.select().from(biometricConsents).where(eq(biometricConsents.guestId, 'GUESTB'))).filter((r) => r.entry === 'grant');
    console.info('[F3-http] grant1=%s grant2=%s ledgerGrants=%d state=%s', g1.ok, g2.ok, rows.length, (await getConsentState(db, 'GUESTB')).status);
    expect(rows, 'the consent endpoint must not be able to append two grants for one guest').toHaveLength(1);
  });
});
