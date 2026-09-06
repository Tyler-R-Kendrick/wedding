import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { describeDeletion, guestHasBiometricData, requestDeletion, revokeConsent } from '@/domain/biometrics';
import { biometricServices, deletionRecordSchema } from './_shared';

/**
 * A guest id as the rest of the system carries it: an opaque, bounded identifier. Deliberately not
 * the ULID pattern used for rows this feature creates — the guest id comes from the identity layer,
 * and a deletion request must not be refused because someone's id has a different shape.
 */
const GUEST_REF = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, 'invalid guest id');

const input = z.object({
  guestId: GUEST_REF,
  /**
   * `guest_deleted` when the guest record itself is going; `admin` for a request that arrived off
   * the site (by email or in person) that an admin is serving on the guest's behalf.
   */
  reason: z.enum(['guest_deleted', 'admin']),
  /** How the request reached you. Recorded in the audit row; a deletion on someone's behalf needs a trail. */
  note: z.string().trim().min(3).max(500),
});
const output = z.object({ deletion: deletionRecordSchema, consentRevoked: z.boolean(), hadData: z.boolean() });

/**
 * Deletion on a guest's behalf. Two things depended on this existing: the consent text promises
 * deletion "if your guest record is deleted", and the readiness checklist asks who fields a
 * deletion request that arrives by email. Without it the answer to both was "write SQL".
 *
 * Not flag-gated, for the same reason the guest's own withdrawal is not: the obligation outlives
 * the feature. It withdraws any live consent first, then queues the same audited, idempotent
 * deletion job.
 */
export const adminDeleteBiometricData = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'admin_delete_biometric_data',
  title: 'Delete a guest\'s facial data',
  description: 'Withdraws a guest\'s face-matching consent and queues permanent deletion of their template, reference and match results, on their behalf — for a request that arrived off the site, or when the guest record itself is being deleted. Works when the feature is switched off. Admins only.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_guest_ops', 'admin_ai'],
  stepUp: true,
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx, i) {
    const services = biometricServices(ctx);
    const hadData = await guestHasBiometricData(services.db, i.guestId);
    const revoked = await revokeConsent(services.db, { guestId: i.guestId, ipHash: null, surface: ctx.surface ?? 'ui', requestId: ctx.requestId, now: ctx.now });
    if (!hadData && !revoked.revoked && !revoked.grant) {
      return err(new CapabilityError('not_found', 'That guest has no face-matching consent or data.', { reason: 'nothing_to_delete' }));
    }
    const deletion = await requestDeletion(services.db, { guestId: i.guestId, reason: i.reason, requestedBy: toPrincipalRef(ctx.principal), requestId: ctx.requestId, now: ctx.now });
    await ctx.audit.record({
      actor: toPrincipalRef(ctx.principal),
      action: 'biometric.deleted',
      target: { type: 'guest', id: i.guestId },
      outcome: 'success',
      requestId: ctx.requestId,
      metadata: { deletionId: deletion.id, reason: i.reason, note: i.note, onBehalfOf: i.guestId, consentRevoked: revoked.revoked },
    });
    return ok({ data: { deletion: describeDeletion(deletion), consentRevoked: revoked.revoked, hadData }, sources: [] });
  },
});
