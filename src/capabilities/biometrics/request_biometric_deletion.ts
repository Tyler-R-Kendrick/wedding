import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { describeDeletion, requestDeletion, revokeConsent } from '@/domain/biometrics';
import { biometricServices, deletionRecordSchema } from './_shared';

const input = z.object({}).optional();
const output = z.object({ deletion: deletionRecordSchema, consentRevoked: z.boolean() });

/** "Delete my facial data": also withdraws any live consent. Not flag-gated on purpose (retention obligations). */
export const requestBiometricDeletion = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'request_biometric_deletion',
  title: 'Delete my facial data',
  description: 'Queues permanent deletion of the guest\'s face template, reference and match results, withdrawing consent if still active. Produces a deletion record with proof. Works even when the feature is switched off.',
  kind: 'action',
  auth: 'guest',
  requires: [],
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx) {
    if (ctx.principal.kind !== 'guest') return err(new CapabilityError('forbidden', 'This action is for signed-in guests.'));
    const services = biometricServices(ctx);
    const guestId = ctx.principal.guestId;
    const revoked = await revokeConsent(services.db, { guestId, ipHash: services.clientIpHash, surface: ctx.surface ?? 'ui', requestId: ctx.requestId, now: ctx.now });
    const deletion = await requestDeletion(services.db, { guestId, reason: 'guest_request', requestedBy: toPrincipalRef(ctx.principal), requestId: ctx.requestId, now: ctx.now });
    if (revoked.revoked) {
      await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'biometric.consent_revoked', target: { type: 'guest', id: guestId }, outcome: 'success', requestId: ctx.requestId, metadata: { consentId: revoked.grant?.id, deletionId: deletion.id, via: 'deletion_request' } });
    }
    return ok({ data: { deletion: describeDeletion(deletion), consentRevoked: revoked.revoked }, sources: [] });
  },
});
