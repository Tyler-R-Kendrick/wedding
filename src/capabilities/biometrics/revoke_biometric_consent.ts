import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { describeDeletion, requestDeletion, revokeConsent } from '@/domain/biometrics';
import { biometricServices, deletionRecordSchema } from './_shared';

const input = z.object({}).optional();
const output = z.object({ revoked: z.boolean(), revokedAt: z.string().nullable(), deletion: deletionRecordSchema.nullable() });

/**
 * Withdrawal. Deliberately NOT behind the feature flag: a guest must be able to withdraw and
 * trigger deletion even after the feature has been switched off (ADR-0006 §3, §5).
 */
export const revokeBiometricConsent = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'revoke_biometric_consent',
  title: 'Withdraw face-matching consent',
  description: 'Withdraws the guest\'s face-matching consent and queues deletion of their face template and match results. Works even when the feature is switched off. Guests only, for themselves.',
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
    if (!revoked.revoked) return ok({ data: { revoked: false, revokedAt: null, deletion: null }, sources: [] });
    const deletion = await requestDeletion(services.db, { guestId, reason: 'revocation', requestedBy: toPrincipalRef(ctx.principal), requestId: ctx.requestId, now: ctx.now });
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'biometric.consent_revoked', target: { type: 'guest', id: guestId }, outcome: 'success', requestId: ctx.requestId, metadata: { consentId: revoked.grant?.id, deletionId: deletion.id } });
    return ok({ data: { revoked: true, revokedAt: ctx.now.toISOString(), deletion: describeDeletion(deletion) }, sources: [] });
  },
});
