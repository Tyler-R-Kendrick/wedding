import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getDb } from '@/db/client';
import { biometricConsents } from '@/db/schema/biometrics';
import { getConsentState } from '@/domain/biometrics';
import { buildRig, call, GUEST_A, grantThroughEndpoint, guestA, setFlag, setReady, type Rig } from './harness';

/**
 * FINDING 4 — the provider seam's own gate is not consent-scoped for `match()`.
 *
 * `createBiometricProvider` builds the readiness check as: flag AND readiness, and — only when a
 * subjectId is supplied — that subject's consent (src/providers/biometric/index.ts:28-36).
 * `BiometricProvider.match` declares `subjectId` OPTIONAL (src/providers/biometric/types.ts:38),
 * and `MockBiometric.match` calls `assertReady(input.subjectId)` (mock.ts:66). With no subject the
 * check degenerates to flag+readiness, and the search runs against EVERY enrolled subject
 * (mock.ts:70). That is the 1:N identification query — "who is this?" — which is exactly what the
 * consent text promises never happens ("never used to identify anyone who has not opted in",
 * src/domain/biometrics/policy.ts:18) and what the readiness note claims the seam prevents
 * ("a caller that skips the domain still gets nothing", biometrics-bipa-readiness.md:35-38).
 */
describe('F4: the seam identifies subjects who have withdrawn (or never gave) consent', () => {
  let rig: Rig;
  let vector: number[];

  beforeAll(async () => {
    rig = await buildRig();
    await setFlag(true);
    await setReady(true);
    await grantThroughEndpoint('guestA');
    expect((await call(guestA, 'enroll_biometric_reference', { assetIds: [rig.corpus.get('mine-1')!.assetId] })).ok).toBe(true);
    const bytes = await rig.storage.getObject(rig.corpus.get('mine-1')!.derivativeKey);
    const t = await rig.spy.extract({ subjectId: GUEST_A, bytes: bytes.ok && bytes.value ? bytes.value.body : new Uint8Array([1]), contentType: 'image/jpeg' });
    expect(t.ok).toBe(true);
    if (t.ok) vector = t.value.vector;
  });

  afterAll(async () => {
    await setFlag(false);
    await setReady(false);
  });

  it('a match with no subjectId runs after every consent in the system is gone', async () => {
    const db = await getDb();
    // Wipe the whole consent ledger: nobody in this system has consented to anything.
    await db.delete(biometricConsents);
    expect((await getConsentState(db, GUEST_A)).status).toBe('none');

    // Subject-scoped calls fail closed, as documented.
    await expect(rig.spy.extract({ subjectId: GUEST_A, bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' })).rejects.toMatchObject({ code: 'feature_disabled' });
    await expect(rig.spy.match({ vector, subjectId: GUEST_A })).rejects.toMatchObject({ code: 'feature_disabled' });

    // The 1:N identification query. `subjectId` is now required by the seam's type, so expressing
    // this attack at all takes a cast — which is the point: a future adapter author cannot omit the
    // argument by accident. At runtime it must fail closed rather than answer "who is this?".
    //
    // ORIGINAL ASSERTION (pre-fix, unchanged in meaning): `const anonymousMatch = await
    // rig.spy.match({ vector, threshold: 0.8, k: 5 })` followed by
    // `expect(anonymousMatch.ok && anonymousMatch.value.length, 'an un-scoped match must not
    // identify an enrolled guest who holds no consent').toBe(0)`. That call now rejects instead of
    // resolving, so the assertion is expressed as "zero identifications, however it fails" — a
    // rejection and an empty result both satisfy it, a hit does not.
    const unscoped = rig.spy.match as unknown as (i: { vector: number[]; threshold?: number; k?: number }) => Promise<{ ok: boolean; value?: { subjectId: string }[] }>;
    let identified: { subjectId: string }[] = [];
    let refusal: unknown;
    try {
      const anonymousMatch = await unscoped.call(rig.spy, { vector, threshold: 0.8, k: 5 });
      identified = anonymousMatch.ok ? (anonymousMatch.value ?? []) : [];
    } catch (e) {
      refusal = e;
    }
    console.info('[F4] match without subjectId refused=%s hits=%s', refusal !== undefined, JSON.stringify(identified));

    expect(
      identified.length,
      'an un-scoped match must not identify an enrolled guest who holds no consent',
    ).toBe(0);
    expect(refusal, 'an un-scoped match must fail closed, not return an empty answer by luck').toMatchObject({ code: 'feature_disabled' });
  });
});
