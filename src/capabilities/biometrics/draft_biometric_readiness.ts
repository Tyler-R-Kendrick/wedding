import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { currentConsentPolicy } from '@/domain/biometrics';
import { stableHash } from '@/lib/crypto';
import type { ConfirmationService } from '@/policy/confirmation';
import { requireService } from '../services';
import { COUNSEL_REVIEW_REF } from './admin_enable_biometric_readiness';
import { biometricServices } from './_shared';

const input = z.object({ counselReviewRef: COUNSEL_REVIEW_REF });
const output = z.object({
  /** Exactly what `admin_set_biometric_readiness` must receive, bound into the confirmation token. */
  readiness: z.object({ counselReviewRef: z.string() }),
  policyVersion: z.string(),
  /** What switching this on actually permits, restated at the moment of the decision. */
  consequences: z.array(z.string()),
});

/**
 * Draft step for switching face matching on. The guest-facing grant has required an explicit,
 * single-use, UI-only confirmation since it was written; the admin switch that makes any grant
 * *usable* — the one ADR-0006 §7 puts behind a named attorney's review — only had an inline one.
 * This makes the two consequential switches symmetric, and gives the confirmation something to
 * confirm: the reference being recorded and what turning it on permits.
 */
export const draftBiometricReadiness = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'draft_biometric_readiness',
  title: 'Review switching face matching on',
  description: 'Prepares the biometric readiness switch: restates what switching it on permits and returns a confirmation token bound to the counsel review reference being recorded. No side effects. Admins only.',
  kind: 'draft',
  auth: 'admin',
  requires: ['admin_ai', 'admin_lifecycle'],
  stepUp: true,
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx, i) {
    const services = biometricServices(ctx);
    if (!ctx.flags.BIOMETRICS_ENABLED) {
      return err(new CapabilityError('feature_disabled', 'FLAG_BIOMETRICS_ENABLED is off in this environment, so the readiness switch would change nothing.', { reason: 'flag_off' }));
    }
    const policy = currentConsentPolicy();
    const readiness = { counselReviewRef: i.counselReviewRef };
    const confirmation = requireService<ConfirmationService>(ctx, 'confirmation');
    const issued = confirmation.issue(
      { capability: 'admin_enable_biometric_readiness', principalRef: toPrincipalRef(ctx.principal), payloadHash: stableHash(readiness), surface: ctx.surface ?? 'ui' },
      { now: ctx.now },
    );
    return ok({
      data: {
        readiness,
        policyVersion: policy.version,
        consequences: [
          `Guests will be offered consent policy ${policy.version}, which is marked as not reviewed by counsel in the code.`,
          'A guest who agrees can enrol a face template from their own uploads; it is sealed in the biometric vault.',
          'A durable record of which photographs each consenting guest appears in starts being stored.',
          `The vault key currently comes from: ${services.biometric.name} / ${services.biometric.mode} provider.`,
          'Nothing happens for any guest who does not opt in, and withdrawal and deletion keep working either way.',
        ],
      },
      sources: [],
      confirmation: { token: issued.token, expiresAt: issued.expiresAt, summary: `Switch face matching on, recording: ${i.counselReviewRef}` },
    });
  },
});
