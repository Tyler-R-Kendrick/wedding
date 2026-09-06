import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newId } from '@/contracts/ids';
import { getDb } from '@/db/client';
import { biometricDeletions, biometricIdentityRefs, biometricMatches } from '@/db/schema/biometrics';
import { idempotencyKeys } from '@/db/schema/idempotency';
import { getConsentState } from '@/domain/biometrics';
import { runDueJobs } from '@/lib/jobs';
import { buildRig, call, GUEST_A, grantThroughEndpoint, guestA, setFlag, setReady, type Rig } from './harness';

/**
 * FINDING 1 — deletion does not delete every copy.
 *
 * `find_photos_of_me` is `idempotent: true`, so the invoke pipeline stores its FULL RESPONSE
 * (which photos this guest's face was found in, plus scores and signed URLs) in the PUBLIC
 * `idempotency_keys` table for 24 hours (src/lib/idempotency.ts:6). Neither `runDeletion`
 * (src/domain/biometrics/deletion.ts:52) nor `revokeConsent` touches that table, and the
 * pipeline replays a stored outcome at step 6 (src/capabilities/invoke.ts:148-165) BEFORE the
 * handler — so it never re-runs `biometricGate`.
 */
describe('F1: biometric match results survive a completed deletion', () => {
  let rig: Rig;
  const KEY = 'review-I-find-key-0000000001';

  beforeAll(async () => {
    rig = await buildRig();
    await setFlag(true);
    await setReady(true);
    await grantThroughEndpoint('guestA');
    expect((await call(guestA, 'enroll_biometric_reference', { assetIds: [rig.corpus.get('mine-1')!.assetId] })).ok).toBe(true);
  });

  afterAll(async () => {
    await setFlag(false);
    await setReady(false);
  });

  it('a completed deletion leaves the match results readable in the public schema, and replayable', async () => {
    const db = await getDb();
    const mineId = rig.corpus.get('mine-1')!.assetId;

    // 1. The guest runs "check my photos for me" once. The UI sends one idempotency key per click.
    const found = await call<{ matched: { id: string; score: number }[] }>(guestA, 'find_photos_of_me', { candidateAssetIds: [mineId] }, { idempotencyKey: KEY });
    expect(found.ok, JSON.stringify(found)).toBe(true);
    if (!found.ok) return;
    expect(found.data.matched.map((m) => m.id)).toEqual([mineId]);

    // 2. The guest asks for deletion. The job completes and reports proof.
    const deletion = await call<{ deletion: { id: string } }>(guestA, 'request_biometric_deletion', {});
    expect(deletion.ok).toBe(true);
    if (!deletion.ok) return;
    for (let i = 0; i < 3; i++) await runDueJobs(db, { worker: 'review-I', limit: 50 });
    const row = (await db.select().from(biometricDeletions).where(eq(biometricDeletions.id, deletion.data.deletion.id)))[0]!;
    expect(row.status).toBe('completed');
    expect(row.proof).toMatchObject({ identityRefsDeleted: 1, matchesDeleted: 1 });
    expect(await db.select().from(biometricMatches).where(eq(biometricMatches.guestId, GUEST_A))).toHaveLength(0);
    expect(await db.select().from(biometricIdentityRefs).where(eq(biometricIdentityRefs.guestId, GUEST_A))).toHaveLength(0);
    expect((await getConsentState(db, GUEST_A)).status).toBe('revoked');

    // 3. A fresh call is correctly refused: the gate works.
    const fresh = await call(guestA, 'find_photos_of_me', { candidateAssetIds: [mineId] }, { idempotencyKey: newId() });
    expect(fresh.ok).toBe(false);
    if (!fresh.ok) expect(fresh.error.details?.reason).toBe('consent_revoked');

    // 4. ATTACK/HARM A: the biometric result is still sitting in the public schema.
    const cached = await db.select().from(idempotencyKeys).where(and(like(idempotencyKeys.scope, 'find_photos_of_me:%'), eq(idempotencyKeys.key, KEY)));
    console.info('[F1] surviving idempotency rows:', cached.length, JSON.stringify(cached[0]?.response).slice(0, 300));

    // 5. ATTACK/HARM B: replaying the original request returns the deleted results verbatim.
    const replay = await call<{ matched: { id: string }[] }>(guestA, 'find_photos_of_me', { candidateAssetIds: [mineId] }, { idempotencyKey: KEY });
    console.info('[F1] replay after deletion ok=%s matched=%s', replay.ok, replay.ok ? JSON.stringify(replay.data.matched.map((m) => m.id)) : replay.error.code);

    expect(replay.ok, 'a replay after deletion must not return biometric match results').toBe(false);
    expect(cached, 'no cached copy of the match result should survive a completed deletion').toHaveLength(0);
  });
});
