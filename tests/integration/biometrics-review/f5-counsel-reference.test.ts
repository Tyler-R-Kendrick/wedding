import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { BiometricStatusView } from '@/capabilities/biometrics';
import { getDb } from '@/db/client';
import { featureFlags } from '@/db/schema';
import { invalidateReadinessCache } from '@/lib/flags';
import { admin, buildRig, call, draft, setFlag, setReady, type Rig } from './harness';

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

  /**
   * ORIGINAL FIRST STEP: this flipped the switch with `counselReviewRef: 'asd'` and asserted the
   * flip succeeded, to show that three characters opened the gate. That step inverts by
   * construction now the schema is tightened, so it is split in two: "asd" must be REFUSED, and a
   * reference someone can read is used for the rest. The substantive assertions at the end — the
   * persisted row and the admin view must carry what authorised the switch — are unchanged in
   * meaning; only the string they look for changed with the input.
   */
  const REVIEW_REF = 'ADR-0006 §7 addendum, counsel memo of 2027-01-14';

  it('a placeholder cannot open the Illinois BIPA readiness gate, and a real reference is recorded', async () => {
    const db = await getDb();
    const placeholder = await call(admin, 'admin_enable_biometric_readiness', { counselReviewRef: 'asd' });
    console.info('[F5] flip with counselReviewRef="asd" ->', JSON.stringify(placeholder));
    expect(placeholder.ok, 'a three-character string must not open the BIPA gate').toBe(false);

    // Enabling is now a two-step, explicitly-confirmed flow (see nit 14): draft, then redeem.
    const drafted = await draft(admin, 'draft_biometric_readiness', { counselReviewRef: REVIEW_REF });
    expect(drafted.ok, JSON.stringify(drafted)).toBe(true);
    if (!drafted.ok) return;
    const flipped = await call<{ readiness: boolean; enabled: boolean }>(admin, 'admin_enable_biometric_readiness', { counselReviewRef: REVIEW_REF }, { confirmationToken: drafted.confirmation!.token });
    console.info('[F5] flip with a real reference ->', JSON.stringify(flipped));
    expect(flipped.ok).toBe(true);
    invalidateReadinessCache();

    const row = (await db.select().from(featureFlags).where(eq(featureFlags.name, 'BIOMETRICS_ENABLED')))[0];
    const status = await call<BiometricStatusView>(admin, 'admin_biometric_status', {});
    const checklistItem = status.ok ? status.data.checklist.find((c) => c.item.includes('Readiness switch')) : undefined;
    console.info('[F5] feature_flags row keys=%s | readiness=%s | checklist=%s',
      JSON.stringify(Object.keys(row ?? {})), status.ok && status.data.readiness, JSON.stringify(checklistItem));

    expect(JSON.stringify(row), 'the persisted readiness row should carry the counsel reference that authorised it').toContain(REVIEW_REF);
    expect(JSON.stringify(status.ok ? status.data : {}), 'the admin readiness view should show which review authorised the switch').toContain(REVIEW_REF);
    // Switching off must not leave a stale reference looking like it justifies a live gate.
    expect((await call(admin, 'admin_disable_biometric_readiness', {})).ok).toBe(true);
    invalidateReadinessCache();
    const off = (await db.select().from(featureFlags).where(eq(featureFlags.name, 'BIOMETRICS_ENABLED')))[0];
    expect(off?.note ?? null).toBeNull();
  });
});
