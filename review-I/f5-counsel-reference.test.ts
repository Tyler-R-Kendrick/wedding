import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { BiometricStatusView } from '@/capabilities/biometrics';
import { getDb } from '@/db/client';
import { featureFlags } from '@/db/schema';
import { invalidateReadinessCache } from '@/lib/flags';
import { admin, buildRig, call, setFlag, setReady, type Rig } from './harness';

/**
 * FINDING 5 — the counsel gate (ADR-0006 §7) is "type any three characters", and what was typed
 * is not recoverable from the readiness state.
 *
 * `counselReviewRef: z.string().trim().min(3).max(200).optional()`
 * (src/capabilities/biometrics/admin_set_biometric_readiness.ts:12) is the only validation, and
 * the value is written to one audit row (line 39) — never to `feature_flags`
 * (src/lib/flags.ts:47-51), never to `computeBiometricStatus`
 * (src/domain/biometrics/status.ts:41-52), never to the admin page. The checklist then renders
 * "Readiness switch (counsel sign-off recorded) is on ✓" with no way to see whose sign-off.
 */
describe('F5: the counsel review reference is unvalidated and unrecorded', () => {
  let _rig: Rig;

  beforeAll(async () => {
    _rig = await buildRig();
    await setFlag(true);
    await setReady(false);
  });

  afterAll(async () => {
    await setFlag(false);
    await setReady(false);
  });

  it('"asd" switches on the Illinois BIPA readiness gate and nothing records what it was', async () => {
    const db = await getDb();
    const flipped = await call<{ readiness: boolean; enabled: boolean }>(admin, 'admin_set_biometric_readiness', { ready: true, counselReviewRef: 'asd' });
    console.info('[F5] flip with counselReviewRef="asd" ->', JSON.stringify(flipped));
    expect(flipped.ok).toBe(true);
    invalidateReadinessCache();

    const row = (await db.select().from(featureFlags).where(eq(featureFlags.name, 'BIOMETRICS_ENABLED')))[0];
    const status = await call<BiometricStatusView>(admin, 'admin_biometric_status', {});
    const checklistItem = status.ok ? status.data.checklist.find((c) => c.item.includes('Readiness switch')) : undefined;
    console.info('[F5] feature_flags row keys=%s | readiness=%s | checklist=%s',
      JSON.stringify(Object.keys(row ?? {})), status.ok && status.data.readiness, JSON.stringify(checklistItem));

    expect(JSON.stringify(row), 'the persisted readiness row should carry the counsel reference that authorised it').toContain('asd');
    expect(JSON.stringify(status.ok ? status.data : {}), 'the admin readiness view should show which review authorised the switch').toContain('asd');
  });
});
