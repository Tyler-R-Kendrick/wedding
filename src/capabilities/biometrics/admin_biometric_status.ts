import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { ok } from '@/contracts/result';
import { DELETION_REASONS, DELETION_STATUSES } from '@/db/schema/biometrics';
import { computeBiometricStatus, latestDeletions } from '@/domain/biometrics';
import { biometricServices, vaultKey } from './_shared';

const input = z.object({}).optional();
const output = z.object({
  flag: z.boolean(),
  readiness: z.boolean(),
  enabled: z.boolean(),
  policy: z.object({ version: z.string(), textHash: z.string(), counselReviewed: z.literal(false) }),
  consents: z.object({ grants: z.number(), revokes: z.number(), active: z.number(), superseded: z.number() }),
  enrolments: z.number(),
  matches: z.number(),
  deletions: z.record(z.string(), z.number()),
  provider: z.object({ name: z.string(), mode: z.string() }),
  vaultKeySource: z.enum(['env', 'derived', 'missing']),
  counselReviewRef: z.string().nullable(),
  /** Recent deletion records (guest ids are opaque ULIDs; no templates, no IP hashes). */
  recentDeletions: z.array(z.object({ id: z.string(), guestId: z.string(), reason: z.enum(DELETION_REASONS), status: z.enum(DELETION_STATUSES), requestedAt: z.string(), completedAt: z.string().nullable(), proof: z.object({ identityRefsDeleted: z.number(), matchesDeleted: z.number(), providerSubjectsDeleted: z.number(), vectorEntriesDeleted: z.number(), vectorEntriesRemaining: z.number(), cachedResponsesDeleted: z.number() }).nullable() })),
  checklist: z.array(z.object({ item: z.string(), done: z.boolean(), note: z.string() })),
});
export type BiometricStatusView = z.infer<typeof output>;

export const adminBiometricStatus = defineCapability<z.infer<typeof input>, BiometricStatusView>({
  name: 'admin_biometric_status',
  title: 'Biometric readiness status',
  description: 'Flag and readiness state, consent ledger counts, enrolments, deletion records and the BIPA readiness checklist. Never exposes templates or IP hashes. Admins only; reads only.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_ai'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx) {
    const services = biometricServices(ctx);
    const key = vaultKey();
    const status = await computeBiometricStatus(services.db, { flags: ctx.flags, readiness: services.readiness, provider: { name: services.biometric.name, mode: services.biometric.mode }, vaultKeySource: key.ok ? key.key.source : 'missing' });
    const recent = await latestDeletions(services.db, 20);
    const checklist = [
      { item: 'Illinois privacy counsel has reviewed the consent text, retention schedule and vendor arrangement', done: false, note: 'TODO(Tyler & Sara): link the review from ADR-0006 before enabling.' },
      { item: 'Written confirmation from Brooke Alaina Photography and Oakhouse Visuals for AI/biometric processing', done: false, note: 'PRO_MEDIA_AI_PROCESSING stays off until it is on file.' },
      { item: 'A real provider with a data processing agreement (or on-device / in-VPC processing) is selected', done: status.provider.mode !== 'mock', note: `Current provider: ${status.provider.name} (${status.provider.mode}).` },
      { item: 'BIOMETRIC_VAULT_KEY is set from a secret manager', done: status.vaultKeySource === 'env', note: `Vault key source: ${status.vaultKeySource}.` },
      { item: 'FLAG_BIOMETRICS_ENABLED is on in the environment', done: status.flag, note: 'Second gate: the readiness switch below.' },
      { item: 'Readiness switch (counsel sign-off recorded) is on', done: status.readiness, note: status.counselReviewRef ? `Linked review: ${status.counselReviewRef}` : 'Flip with admin_set_biometric_readiness once the review is linked; the reference is stored on the flag row.' },
    ];
    return ok({
      data: {
        ...status,
        recentDeletions: recent.map((d) => ({ id: d.id, guestId: d.guestId, reason: d.reason, status: d.status, requestedAt: d.requestedAt.toISOString(), completedAt: d.completedAt?.toISOString() ?? null, proof: d.proof ? { identityRefsDeleted: d.proof.identityRefsDeleted, matchesDeleted: d.proof.matchesDeleted, providerSubjectsDeleted: d.proof.providerSubjectsDeleted, vectorEntriesDeleted: d.proof.vectorEntriesDeleted, vectorEntriesRemaining: d.proof.vectorEntriesRemaining ?? 0, cachedResponsesDeleted: d.proof.cachedResponsesDeleted ?? 0 } : null })),
        checklist,
      },
      sources: [],
    });
  },
});
