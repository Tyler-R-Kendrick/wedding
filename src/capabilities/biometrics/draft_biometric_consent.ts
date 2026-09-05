import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { biometricFeatureReady, currentConsentPolicy, getConsentState } from '@/domain/biometrics';
import { stableHash } from '@/lib/crypto';
import type { ConfirmationService } from '@/policy/confirmation';
import { requireService } from '../services';
import { biometricServices, consentPolicySchema, grantPayloadSchema, type GrantPayload } from './_shared';

const input = z.object({
  /** The guest ticked "I am 18 or older". Required: minors are blocked pending a guardian-consent design. */
  adultAttested: z.boolean(),
});
const output = z.object({
  policy: consentPolicySchema,
  /** Exactly what `grant_biometric_consent` must receive, bound into the confirmation token. */
  grant: grantPayloadSchema,
});

/**
 * Draft step of the opt-in: shows the exact policy text and issues a single-use confirmation token
 * bound to (this guest, this policy version, this text hash). The grant step refuses anything else.
 */
export const draftBiometricConsent = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'draft_biometric_consent',
  title: 'Review face-matching consent',
  description: 'Prepares the face-matching consent for review: returns the exact policy text and a confirmation token for grant_biometric_consent. No side effects. Guests only, for themselves.',
  kind: 'draft',
  auth: 'guest',
  requires: ['use_face_matching'],
  flag: 'BIOMETRICS_ENABLED',
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx, i) {
    if (ctx.principal.kind !== 'guest') return err(new CapabilityError('forbidden', 'Face matching is only available to signed-in guests.'));
    const services = biometricServices(ctx);
    const feature = await biometricFeatureReady({ flags: ctx.flags, readiness: services.readiness });
    if (!feature.ready) return err(new CapabilityError('feature_disabled', 'Face matching is not available.', { reason: feature.reason }));
    if (!i.adultAttested) return err(new CapabilityError('validation', 'You must be 18 or older to opt in.', { issues: [{ path: 'adultAttested', message: 'required' }] }));
    const state = await getConsentState(services.db, ctx.principal.guestId);
    if (state.status === 'active') return err(new CapabilityError('conflict', 'You have already agreed.', { reason: 'already_active' }));
    const policy = currentConsentPolicy();
    const grant: GrantPayload = { policyVersion: policy.version, textHash: policy.textHash, adultAttested: true };
    const confirmation = requireService<ConfirmationService>(ctx, 'confirmation');
    const issued = confirmation.issue({ capability: 'grant_biometric_consent', principalRef: toPrincipalRef(ctx.principal), payloadHash: stableHash(grant), surface: ctx.surface ?? 'ui' }, { now: ctx.now });
    return ok({
      data: { policy, grant },
      sources: [],
      confirmation: { token: issued.token, expiresAt: issued.expiresAt, summary: `Agree to face matching, policy ${policy.version}, for yourself only.` },
    });
  },
});
