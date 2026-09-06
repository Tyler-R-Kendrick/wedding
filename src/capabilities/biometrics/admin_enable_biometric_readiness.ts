import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { readinessNote, setReadiness } from '@/lib/flags';
import { biometricServices } from './_shared';

/**
 * The counsel review reference (ADR-0006 §7). "asd" used to be enough. It must now look like
 * something a person can actually go and read — a URL, an ADR section, or a dated memo reference —
 * and it is stored on the flag row it authorises, not only in an audit entry nobody will correlate.
 * This is a shape check, not a truth check: it cannot verify a review happened, only make a
 * placeholder look like a placeholder.
 */
export const COUNSEL_REVIEW_REF = z
  .string()
  .trim()
  .min(12, 'Reference the review itself: a URL, an ADR section, or a dated memo reference.')
  .max(200)
  .regex(/^(https?:\/\/\S+|ADR-\d{4}|[A-Z]{2,}-\d+|.*\d{4}-\d{2}-\d{2}.*)/, 'Reference the review itself: a URL, an ADR section (ADR-0006 §7), a ticket, or a dated memo.');

const input = z.object({
  /** Persisted on the flag row and shown on the admin page. */
  counselReviewRef: COUNSEL_REVIEW_REF,
});
const output = z.object({ flag: z.boolean(), readiness: z.boolean(), enabled: z.boolean(), counselReviewRef: z.string().nullable() });

/**
 * Switching the persisted half of the BIOMETRICS_ENABLED gate ON. The env flag is the other half;
 * both must be on. Deliberately a separate capability from disabling: this one carries an explicit,
 * single-use, UI-only confirmation (the token from `draft_biometric_readiness`, bound to the exact
 * reference being recorded), matching the guest-facing grant it authorises, while
 * `admin_disable_biometric_readiness` requires none of that so the off switch can never be blocked.
 */
export const adminEnableBiometricReadiness = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'admin_enable_biometric_readiness',
  title: 'Switch biometric readiness on',
  description: 'Flips the persisted readiness switch for face matching. Turning it on requires the confirmation token from draft_biometric_readiness, a counsel review reference (recorded on the flag row) and a fresh admin session; the FLAG_BIOMETRICS_ENABLED environment flag must also be on before anything runs. Turning it off needs none of that. Admins only.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_ai', 'admin_lifecycle'],
  stepUp: true,
  // Explicit, like the guest-facing grant it authorises: the token comes from
  // draft_biometric_readiness, is bound to this exact reference, is single-use, and is redeemable
  // only from the website. Switching OFF needs no token — see the handler.
  confirmation: 'explicit',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx, i) {
    const services = biometricServices(ctx);
    if (!ctx.flags.BIOMETRICS_ENABLED) {
      return err(new CapabilityError('feature_disabled', 'FLAG_BIOMETRICS_ENABLED is off in this environment, so the readiness switch would change nothing.', { reason: 'flag_off' }));
    }
    await setReadiness(services.db, { flag: 'BIOMETRICS_ENABLED', ready: true, actor: toPrincipalRef(ctx.principal), requestId: ctx.requestId, audit: ctx.audit, note: i.counselReviewRef });
    const readiness = await services.readiness('BIOMETRICS_ENABLED');
    return ok({ data: { flag: ctx.flags.BIOMETRICS_ENABLED, readiness, enabled: ctx.flags.BIOMETRICS_ENABLED && readiness, counselReviewRef: await readinessNote('BIOMETRICS_ENABLED', services.db) }, sources: [] });
  },
});
