import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST as capabilityRoute } from '@/app/api/capabilities/[name]/route';
import { newId } from '@/contracts/ids';
import { getDb } from '@/db/client';
import { biometricConsents } from '@/db/schema/biometrics';
import { CONSENT_POLICY_VERSION, CONSENT_TEXT_HASH } from '@/domain/biometrics';
import { buildRig, call, GUEST_A, grantThroughEndpoint, guestA, post, setFlag, setReady, TEST_AUTH_SECRET, type Rig } from './harness';

async function capPost(name: string, body: Record<string, unknown>) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json', 'sec-fetch-site': 'same-origin', 'x-forwarded-for': '203.0.113.7',
    'x-test-principal': JSON.stringify({ kind: 'guest', guestId: GUEST_A, householdId: 'HOUSEA', entitlements: ['upload_media', 'view_private_media', 'use_face_matching'] }),
    'x-test-auth-secret': TEST_AUTH_SECRET,
  };
  const res = await capabilityRoute(new Request(`http://localhost:3000/api/capabilities/${name}`, { method: 'POST', headers, body: JSON.stringify(body) }), { params: Promise.resolve({ name }) });
  return { status: res.status, ...(await res.json()) } as { status: number; ok: boolean; data?: unknown; error?: { code: string; details?: Record<string, unknown> } };
}

describe('extra probes', () => {
  let rig: Rig;

  beforeAll(async () => {
    rig = await buildRig();
    await setFlag(true);
    await setReady(true);
  });

  afterAll(async () => {
    await setFlag(false);
    await setReady(false);
  });

  it('HOLDS: a draft token cannot be redeemed through the generic capability route (no IP hash, no ledger row)', async () => {
    const db = await getDb();
    await db.delete(biometricConsents);
    const draft = await post<unknown>('draft', { input: { adultAttested: true } });
    expect(draft.ok).toBe(true);
    const sneaky = await capPost('grant_biometric_consent', {
      input: { policyVersion: CONSENT_POLICY_VERSION, textHash: CONSENT_TEXT_HASH, adultAttested: true },
      confirmationToken: draft.confirmation!.token,
      idempotencyKey: newId(),
    });
    console.info('[probe] grant via /api/capabilities ->', JSON.stringify(sneaky));
    expect(sneaky.ok).toBe(false);
    expect(sneaky.error?.details?.['reason']).toBe('consent_endpoint_required');
    expect(await db.select().from(biometricConsents).where(eq(biometricConsents.guestId, GUEST_A))).toHaveLength(0);
  });

  /**
   * NIT 12 (fixed) — `find_photos_of_me` used to distinguish "asset does not exist" from
   * "asset exists but is not yours": `skipped` was built only from rows the query found, so an
   * unknown id was silently absent while a real-but-invisible id came back as `not_visible`.
   *
   * ORIGINAL ASSERTION: `expect(r.data.skipped.map((s) => s.assetId)).toEqual([hiddenFromMe])` —
   * i.e. it pinned the leak, asserting the non-existent id was NOT reported. That assertion
   * inverts by construction once the oracle is closed, so it now asserts the property the nit
   * asked for: both ids come back, with the same reason, indistinguishable from each other.
   */
  it('NIT (fixed): find_photos_of_me cannot be used to ask whether an asset exists', async () => {
    await grantThroughEndpoint('guestA');
    expect((await call(guestA, 'enroll_biometric_reference', { assetIds: [rig.corpus.get('mine-1')!.assetId] })).ok).toBe(true);
    const hidden = rig.corpus.get('hidden-from-me')!.assetId;
    const nonexistent = '00000000000000000000000000';
    const r = await call<{ skipped: { assetId: string; reason: string }[] }>(guestA, 'find_photos_of_me', {
      candidateAssetIds: [hidden, nonexistent],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    console.info('[probe] skipped=%s', JSON.stringify(r.data.skipped));
    expect(r.data.skipped.map((s) => s.assetId).sort()).toEqual([hidden, nonexistent].sort());
    expect(new Set(r.data.skipped.map((s) => s.reason))).toEqual(new Set(['not_visible']));
  });

  it('FINDING 1b: enrolment outcomes are cached and replayable after deletion, same as matches', async () => {
    const db = await getDb();
    const KEY = 'review-I-enrol-key-000000001';
    const first = await call<{ identityRefId: string }>(guestA, 'enroll_biometric_reference', { assetIds: [rig.corpus.get('mine-2')!.assetId] }, { idempotencyKey: KEY });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const del = await call(guestA, 'request_biometric_deletion', {});
    expect(del.ok).toBe(true);
    const { runDueJobs } = await import('@/lib/jobs');
    for (let i = 0; i < 3; i++) await runDueJobs(db, { worker: 'review-I', limit: 50 });
    const replay = await call<{ identityRefId: string }>(guestA, 'enroll_biometric_reference', { assetIds: [rig.corpus.get('mine-2')!.assetId] }, { idempotencyKey: KEY });
    console.info('[probe] enrol replay after deletion ok=%s sameRefId=%s', replay.ok, replay.ok && replay.data.identityRefId === first.data.identityRefId);
    expect(replay.ok, 'a replayed enrolment must not report a deleted reference as live').toBe(false);
  });
});
