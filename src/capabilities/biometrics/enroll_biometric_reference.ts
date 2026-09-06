import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { biometricGate, enrollFromOwnAssets, gateDepsFrom, gateError, MAX_REFERENCE_ASSETS } from '@/domain/biometrics';
import { biometricServices, ID, vaultKey } from './_shared';

const input = z.object({ assetIds: z.array(ID).min(1).max(MAX_REFERENCE_ASSETS) });
const output = z.object({ identityRefId: z.string(), enrolledAt: z.string(), references: z.number() });

/** Builds the guest's own reference template from 1..3 of their own uploads. Gate: flag AND readiness AND consent. */
export const enrollBiometricReference = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'enroll_biometric_reference',
  title: 'Add reference photos of me',
  description: 'Creates the guest\'s face reference from up to three of their own uploaded photos. Requires face-matching consent. Replaces any earlier reference. Guests only, for themselves.',
  kind: 'action',
  auth: 'guest',
  requires: ['use_face_matching'],
  flag: 'BIOMETRICS_ENABLED',
  confirmation: 'inline',
  idempotent: true,
  // Never cache the response: a replay after deletion would report a destroyed reference as live.
  replayable: false,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx, i) {
    const services = biometricServices(ctx);
    const gate = await biometricGate(gateDepsFrom(ctx, services.db), ctx.principal);
    if (!gate.ok) return err(gateError(gate.error));
    const key = vaultKey();
    if (!key.ok) return err(new CapabilityError('provider_unavailable', 'Face matching is not configured.', { reason: key.reason }));
    const result = await enrollFromOwnAssets({ db: services.db, storage: services.storage, biometric: services.biometric, vaultKey: key.key, flags: ctx.flags, readiness: services.readiness, now: ctx.now, requestId: ctx.requestId }, gate.value.guest, gate.value.consentId, i.assetIds);
    if (!result.ok) return err(result.error);
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'identity.bound', target: { type: 'biometric_identity_ref', id: result.value.identityRefId }, outcome: 'success', requestId: ctx.requestId, metadata: { references: result.value.references, consentId: gate.value.consentId } });
    return ok({ data: result.value, sources: [] });
  },
});
