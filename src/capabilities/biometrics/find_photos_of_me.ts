import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, ok } from '@/contracts/result';
import { biometricGate, findPhotosOfGuest, gateDepsFrom, gateError, MAX_CANDIDATES_PER_CALL } from '@/domain/biometrics';
import { getAssets } from '@/domain/media';
import { galleryItemSchema, mediaServices, toGalleryItems } from '../media/_shared';
import { biometricServices, ID, vaultKey } from './_shared';

const input = z.object({
  /** Photos the guest chose to check (from an album they can see). Nothing outside this list is ever processed. */
  candidateAssetIds: z.array(ID).min(1).max(MAX_CANDIDATES_PER_CALL),
});
const output = z.object({
  matched: z.array(galleryItemSchema.extend({ score: z.number() })),
  checked: z.number(),
  skipped: z.array(z.object({ assetId: z.string(), reason: z.enum(['not_visible', 'professional_gate', 'not_ready']) })),
});
export type FindPhotosOfMeResult = z.infer<typeof output>;

/**
 * Consent-scoped matching. The pipeline's flag check returns `feature_disabled` before this
 * handler runs when BIOMETRICS_ENABLED (env + readiness) is off; the gate re-checks and adds
 * consent. An `action` (not a read) because it processes faces and records results.
 */
export const findPhotosOfMe = defineCapability<z.infer<typeof input>, FindPhotosOfMeResult>({
  name: 'find_photos_of_me',
  title: 'Find photos of me',
  description: 'Checks the photos the guest picked for their own face, using their reference. Requires face-matching consent and a reference. Only the guest\'s own face is ever matched; nobody else is identified. Guests only, on the website.',
  kind: 'action',
  auth: 'guest',
  requires: ['use_face_matching'],
  flag: 'BIOMETRICS_ENABLED',
  confirmation: 'inline',
  idempotent: true,
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
    const result = await findPhotosOfGuest({ db: services.db, storage: services.storage, biometric: services.biometric, vaultKey: key.key, flags: ctx.flags, readiness: services.readiness, now: ctx.now, requestId: ctx.requestId }, gate.value.guest, i.candidateAssetIds);
    if (!result.ok) return err(result.error);
    const assets = await getAssets(services.db, result.value.matched.map((m) => m.assetId));
    const items = await toGalleryItems(mediaServices(ctx), assets);
    const score = new Map(result.value.matched.map((m) => [m.assetId, m.score]));
    return ok({ data: { matched: items.map((it) => ({ ...it, score: score.get(it.id) ?? 0 })), checked: result.value.checked, skipped: result.value.skipped }, sources: [] });
  },
});
