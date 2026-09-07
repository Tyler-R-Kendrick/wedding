import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, ok } from '@/contracts/result';
import { biometricFeatureReady, currentConsentPolicy, describeConsent, describeDeletion, getConsentState, getIdentityRef, listDeletions, listMatches } from '@/domain/biometrics';
import { biometricServices, consentPolicySchema, consentRecordSchema, deletionRecordSchema } from './_shared';

const input = z.object({}).optional();
const output = z.object({
  /** Flag AND readiness: whether the feature can run at all. When false the page shows an honest unavailable state. */
  available: z.boolean(),
  unavailableReason: z.enum(['flag_off', 'readiness_off']).nullable(),
  policy: consentPolicySchema.nullable(),
  consent: z.object({ status: z.enum(['none', 'active', 'revoked', 'superseded']), record: consentRecordSchema.nullable(), revokedAt: z.string().nullable(), supersededBy: z.string().nullable() }),
  enrolment: z.object({ enrolledAt: z.string(), references: z.number(), sourceAssetIds: z.array(z.string()) }).nullable(),
  matches: z.array(z.object({ assetId: z.string(), score: z.number(), matchedAt: z.string() })),
  deletions: z.array(deletionRecordSchema),
  /** True when any facial data exists for this guest, so "delete my facial data" is offered even when the feature is off. */
  hasData: z.boolean(),
});
export type MyBiometricConsent = z.infer<typeof output>;

export const getMyBiometricConsent = defineCapability<z.infer<typeof input>, MyBiometricConsent>({
  name: 'get_my_biometric_consent',
  title: 'My face-matching consent',
  description:
    'Returns the signed-in guest\'s own face-matching status: whether the feature is available, the consent policy text, the current consent state, ' +
    'reference enrolment, match results and deletion records. Never returns another guest\'s data. Reads only.',
  kind: 'read',
  auth: 'guest',
  requires: [],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx) {
    if (ctx.principal.kind !== 'guest') return err(new CapabilityError('forbidden', 'This page is for signed-in guests.'));
    const services = biometricServices(ctx);
    const guestId = ctx.principal.guestId;
    const feature = await biometricFeatureReady({ flags: ctx.flags, readiness: services.readiness });
    const state = await getConsentState(services.db, guestId);
    const [ref, matches, deletions] = await Promise.all([getIdentityRef(services.db, guestId), listMatches(services.db, guestId), listDeletions(services.db, guestId)]);
    return ok({
      data: {
        available: feature.ready,
        unavailableReason: feature.ready ? null : feature.reason,
        // ADR-0006 §1: no UI hints at the feature while it is off, but existing consent history stays visible to its owner.
        policy: feature.ready ? currentConsentPolicy() : null,
        consent: { status: state.status, record: state.grant ? describeConsent(state.grant) : null, revokedAt: state.revokedAt, supersededBy: state.supersededBy?.version ?? null },
        enrolment: ref ? { enrolledAt: ref.enrolledAt.toISOString(), references: ref.sourceAssetIds.length, sourceAssetIds: ref.sourceAssetIds } : null,
        matches: matches.map((m) => ({ assetId: m.assetId, score: Number(m.score.toFixed(3)), matchedAt: m.matchedAt.toISOString() })),
        deletions: deletions.map(describeDeletion),
        hasData: !!ref || matches.length > 0,
      },
      sources: [],
    });
  },
});
