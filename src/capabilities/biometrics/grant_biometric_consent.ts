import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { biometricFeatureReady, describeConsent, grantConsent } from '@/domain/biometrics';
import { biometricServices, consentRecordSchema, grantPayloadSchema } from './_shared';

const output = z.object({ consent: consentRecordSchema });

/**
 * The consent itself. Explicit confirmation (token from draft_biometric_consent, ui-only, single
 * use), fresh session (step-up), idempotent, and only through /api/biometrics/grant so the ledger
 * row carries a keyed IP hash. Appends to the ledger; never updates.
 */
export const grantBiometricConsent = defineCapability<z.infer<typeof grantPayloadSchema>, z.infer<typeof output>>({
  name: 'grant_biometric_consent',
  title: 'Agree to face matching',
  description: 'Records the guest\'s consent to face matching for the exact policy text they reviewed. Requires the confirmation token from draft_biometric_consent and a fresh session. Guests only, for themselves.',
  kind: 'action',
  auth: 'guest',
  requires: ['use_face_matching'],
  flag: 'BIOMETRICS_ENABLED',
  stepUp: true,
  confirmation: 'explicit',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  exposure: { ui: true, ai: false, webmcp: false },
  input: grantPayloadSchema,
  output,
  async handler(ctx, i) {
    if (ctx.principal.kind !== 'guest') return err(new CapabilityError('forbidden', 'Face matching is only available to signed-in guests.'));
    const services = biometricServices(ctx);
    const feature = await biometricFeatureReady({ flags: ctx.flags, readiness: services.readiness });
    if (!feature.ready) return err(new CapabilityError('feature_disabled', 'Face matching is not available.', { reason: feature.reason }));
    if (!services.clientIpHash) {
      // The ledger must carry an IP hash: only the consent endpoint supplies one.
      return err(new CapabilityError('conflict', 'Please agree from the face-matching page.', { reason: 'consent_endpoint_required' }));
    }
    const granted = await grantConsent(services.db, {
      guestId: ctx.principal.guestId,
      householdId: ctx.principal.householdId,
      policyVersion: i.policyVersion,
      textHash: i.textHash,
      adultAttested: i.adultAttested,
      ipHash: services.clientIpHash,
      surface: ctx.surface ?? 'ui',
      requestId: ctx.requestId,
      now: ctx.now,
    });
    if (!granted.ok) {
      if (granted.reason === 'already_active') return err(new CapabilityError('conflict', 'You have already agreed.', { reason: granted.reason }));
      if (granted.reason === 'policy_mismatch') return err(new CapabilityError('conflict', 'The consent text has changed since you reviewed it. Please review it again.', { reason: granted.reason }));
      return err(new CapabilityError('validation', 'You must be 18 or older to opt in.', { reason: granted.reason }));
    }
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'biometric.consent_granted', target: { type: 'guest', id: ctx.principal.guestId }, outcome: 'success', requestId: ctx.requestId, metadata: { consentId: granted.row.id, policyVersion: granted.row.policyVersion, textHash: granted.row.textHash } });
    return ok({ data: { consent: describeConsent(granted.row) }, sources: [] });
  },
});
