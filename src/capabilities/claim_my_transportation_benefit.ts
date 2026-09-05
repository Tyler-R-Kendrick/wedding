import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { ID_PATTERN } from '@/contracts/ids';
import { err, ok } from '@/contracts/result';
import { getTransportVault } from '@/domain/external/vault';
import { claimBenefit, TRANSPORTATION_CITATIONS } from '@/domain/transport';
import { appServices } from './context';

const input = z.object({ entitlementId: z.string().regex(ID_PATTERN) });

/**
 * The secret itself is NOT in this output: the pipeline stores outcomes in the idempotency
 * table for replay and audits a keyed fingerprint, so the redemption link/code is returned
 * only by the owner's `get_my_transportation_options` read on the ui surface.
 */
const output = z.object({
  claimId: z.string(),
  entitlementId: z.string(),
  status: z.literal('issued'),
  provider: z.string(),
  providerDisplayName: z.string(),
  testMode: z.boolean(),
  claimedAt: z.string(),
  expiresAt: z.string().optional(),
  redemptionKind: z.enum(['link', 'code']),
  revealRoute: z.literal('/transportation'),
});

export type ClaimResult = z.infer<typeof output>;

export const claimMyTransportationBenefit = defineCapability<z.infer<typeof input>, ClaimResult>({
  name: 'claim_my_transportation_benefit',
  title: 'Claim my ride benefit',
  description:
    'Claims the signed-in guest’s own ride benefit once, issuing a personal Uber credit (a link to open in the Uber app, or a code). ' +
    'Requires a fresh sign-in and the guest’s explicit confirmation on the website; it cannot be completed from a conversation. ' +
    'It never claims for another guest, never pays for anything, and never returns the code here.',
  kind: 'transaction',
  auth: 'guest',
  requires: ['claim_transportation_benefit'],
  stepUp: true,
  confirmation: 'explicit',
  idempotent: true,
  flag: 'TRANSPORT_BENEFITS',
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 2_000,
  async handler(ctx, { entitlementId }) {
    const { db, providers } = appServices(ctx);
    const result = await claimBenefit({
      db,
      audit: ctx.audit,
      vault: await getTransportVault(),
      provider: providers('transport-benefit'),
      principal: ctx.principal,
      entitlementId,
      requestId: ctx.requestId,
      now: ctx.now,
      surface: ctx.surface ?? 'ui',
    });
    if (!result.ok) return err(result.error);
    const { redemption, ...rest } = result.value;
    return ok({ data: { ...rest, redemptionKind: redemption.kind, revealRoute: '/transportation' as const }, sources: TRANSPORTATION_CITATIONS });
  },
});
