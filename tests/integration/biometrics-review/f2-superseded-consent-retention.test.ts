import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newId } from '@/contracts/ids';
import { getDb } from '@/db/client';
import { biometricConsents, biometricDeletions, biometricIdentityRefs, biometricMatches } from '@/db/schema/biometrics';
import { getConsentState, sweepRetention } from '@/domain/biometrics';
import { buildRig, call, GUEST_A, grantThroughEndpoint, guestA, setFlag, setReady, type Rig } from './harness';
import type { MyBiometricConsent } from '@/capabilities/biometrics';

/**
 * FINDING 2 — a superseded consent stops processing but never stops STORAGE.
 *
 * `sweepRetention` (src/domain/biometrics/deletion.ts:109-123) is documented as covering
 * "guests whose latest consent is revoked/superseded but still have data", but the loop only
 * compares `ref.enrolledAt` against the retention cutoff. Editing one character of the consent
 * copy moves every grant to `superseded` (src/domain/biometrics/consent.ts:30-32); the guest can
 * no longer match, but their sealed face template and their stored match rows stay in the vault
 * until the 365-day cutoff, under a consent text they never agreed to.
 */
describe('F2: superseded consent leaves the face template in the vault', () => {
  let rig: Rig;

  beforeAll(async () => {
    rig = await buildRig();
    await setFlag(true);
    await setReady(true);
    await grantThroughEndpoint('guestA');
    expect((await call(guestA, 'enroll_biometric_reference', { assetIds: [rig.corpus.get('mine-1')!.assetId] })).ok).toBe(true);
    expect((await call(guestA, 'find_photos_of_me', { candidateAssetIds: [rig.corpus.get('mine-1')!.assetId] })).ok).toBe(true);
  });

  afterAll(async () => {
    await setFlag(false);
    await setReady(false);
  });

  it('a consent-copy change supersedes the grant but neither deletes nor queues deletion of the template', async () => {
    const db = await getDb();
    expect(await db.select().from(biometricIdentityRefs).where(eq(biometricIdentityRefs.guestId, GUEST_A))).toHaveLength(1);
    expect(await db.select().from(biometricMatches).where(eq(biometricMatches.guestId, GUEST_A))).toHaveLength(1);

    // The couple edit one word of the consent copy. In production that is a source change; here we
    // move the stored grant off the current version, which is exactly what consentState compares.
    await db.update(biometricConsents).set({ policyVersion: '2026-09-05.draft-0' }).where(eq(biometricConsents.guestId, GUEST_A));
    expect((await getConsentState(db, GUEST_A)).status).toBe('superseded');

    // Processing correctly stops...
    const blocked = await call(guestA, 'find_photos_of_me', { candidateAssetIds: [rig.corpus.get('mine-1')!.assetId] });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.details?.reason).toBe('consent_superseded');

    // ...and the retention sweep, which the docstring says covers this case, must act on it.
    const requested = await sweepRetention(db, { retentionDays: 365, now: new Date(), requestId: newId() });
    // The sweep queues a deletion rather than deleting inline (same audited, idempotent path as a
    // guest's own request), so drain the queue before asking whether the template survived. Before
    // the fix this drained an empty queue and changed nothing; the assertions below are unchanged.
    const { runDueJobs } = await import('@/lib/jobs');
    for (let i = 0; i < 3; i++) await runDueJobs(db, { worker: 'review-I', limit: 50 });
    const queued = await db.select().from(biometricDeletions).where(eq(biometricDeletions.guestId, GUEST_A));
    const refs = await db.select().from(biometricIdentityRefs).where(eq(biometricIdentityRefs.guestId, GUEST_A));
    const matches = await db.select().from(biometricMatches).where(eq(biometricMatches.guestId, GUEST_A));
    const view = await call<MyBiometricConsent>(guestA, 'get_my_biometric_consent', {});
    console.info('[F2] sweep requested=%d deletions=%d refs=%d matches=%d hasData=%s templateBytes=%d',
      requested, queued.length, refs.length, matches.length, view.ok && view.data.hasData, refs[0]?.templateSealed.length ?? 0);

    expect(refs, 'a template stored under a consent the guest never agreed to must not survive').toHaveLength(0);
    expect(requested, 'the retention sweep should request deletion for a superseded consent').toBe(1);
  });
});
