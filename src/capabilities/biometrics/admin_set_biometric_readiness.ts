import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { setReadiness } from '@/lib/flags';
import { biometricServices } from './_shared';

const input = z.object({
  ready: z.boolean(),
  /** Reference to the counsel review (ADR-0006 §7). Required to switch on; recorded in the audit row. */
  counselReviewRef: z.string().trim().min(3).max(200).optional(),
});
const output = z.object({ flag: z.boolean(), readiness: z.boolean(), enabled: z.boolean() });

/**
 * The persisted half of the BIOMETRICS_ENABLED gate. The env flag is the other half; both must
 * be on. Switching on needs a counsel review reference; switching off never does.
 */
export const adminSetBiometricReadiness = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'admin_set_biometric_readiness',
  title: 'Set biometric readiness switch',
  description: 'Flips the persisted readiness switch for face matching. Turning it on requires a counsel review reference and a fresh admin session; the FLAG_BIOMETRICS_ENABLED environment flag must also be on before anything runs. Admins only.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_ai', 'admin_lifecycle'],
  stepUp: true,
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx, i) {
    const services = biometricServices(ctx);
    if (i.ready && !i.counselReviewRef) return err(new CapabilityError('validation', 'A counsel review reference is required to switch face matching on.', { issues: [{ path: 'counselReviewRef', message: 'required when ready is true' }] }));
    await setReadiness(services.db, { flag: 'BIOMETRICS_ENABLED', ready: i.ready, actor: toPrincipalRef(ctx.principal), requestId: ctx.requestId, audit: ctx.audit });
    if (i.ready) {
      await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'flag.changed', target: { type: 'feature_flag', id: 'BIOMETRICS_ENABLED' }, outcome: 'success', requestId: ctx.requestId, metadata: { counselReviewRef: i.counselReviewRef } });
    }
    const readiness = await services.readiness('BIOMETRICS_ENABLED');
    return ok({ data: { flag: ctx.flags.BIOMETRICS_ENABLED, readiness, enabled: ctx.flags.BIOMETRICS_ENABLED && readiness }, sources: [] });
  },
});
