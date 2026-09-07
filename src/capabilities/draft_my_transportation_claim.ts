import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { ID_PATTERN } from '@/contracts/ids';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { stableHash } from '@/lib/crypto';
import { providerDisplayName } from '@/domain/external/handoff';
import { getTransportVault } from '@/domain/external/vault';
import { benefitViewsFor, TRANSPORTATION_CITATIONS } from '@/domain/transport';
import { appServices } from './context';
import { benefitViewSchema } from './get_my_transportation_options';

const input = z.object({ entitlementId: z.string().regex(ID_PATTERN) });

const output = z.object({
  benefit: benefitViewSchema,
  claimable: z.boolean(),
  provider: z.object({ name: z.string(), displayName: z.string(), testMode: z.boolean(), redemptionKind: z.enum(['link', 'code']) }),
  disclosure: z.string(),
  /** Exact input the confirm step must receive. */
  confirmInput: z.object({ entitlementId: z.string() }),
});

export const CLAIM_DISCLOSURE = 'Claiming issues a ride credit that is personal to you. It can be claimed once. We never see your Uber account or payment details.';

/**
 * Draft step of the ride-benefit claim: re-checks ownership and eligibility, describes what
 * will happen, and issues the confirmation token bound to this exact payload. The concierge
 * and WebMCP may draft (their tokens are not redeemable); a human confirms on the website.
 */
export const draftMyTransportationClaim = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'draft_my_transportation_claim',
  title: 'Review a ride benefit claim',
  description:
    'Prepares a claim of the signed-in guest’s own ride benefit: shows the amount, validity and area notes, which provider issues it, ' +
    'and returns a confirmation the guest must approve on the website. It changes nothing by itself and never claims for another guest.',
  kind: 'draft',
  auth: 'guest',
  requires: ['claim_transportation_benefit'],
  flag: 'TRANSPORT_BENEFITS',
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 4_000,
  async handler(ctx, { entitlementId }) {
    if (ctx.principal.kind !== 'guest') return err(new CapabilityError('forbidden', 'Ride benefits are claimed by the guest they belong to.'));
    const { db, providers, confirmation } = appServices(ctx);
    const views = await benefitViewsFor(db, await getTransportVault(), ctx.principal, ctx.now, ctx.surface ?? 'ui');
    const benefit = views.find((b) => b.entitlementId === entitlementId);
    // Not found rather than forbidden: benefits are only ever looked up by the owner's own id, so anything else is simply not theirs.
    if (!benefit) return err(new CapabilityError('not_found', 'We could not find that ride benefit on your invitation.'));
    const provider = providers('transport-benefit');
    const redemptionKind = provider.capabilities.getRedemptionLink ? 'link' : 'code';
    const claimable = benefit.status === 'eligible' || benefit.status === 'failed';
    const confirmInput = { entitlementId };
    const data = {
      benefit: benefit.redemption ? { ...benefit, redemption: undefined } : benefit,
      claimable,
      provider: { name: provider.name, displayName: providerDisplayName(provider.name, 'uber.com'), testMode: provider.name === 'mock', redemptionKind: redemptionKind as 'link' | 'code' },
      disclosure: CLAIM_DISCLOSURE,
      confirmInput,
    };
    if (!claimable || !confirmation) return ok({ data, sources: TRANSPORTATION_CITATIONS });
    const issued = confirmation.issue({ capability: 'claim_my_transportation_benefit', principalRef: toPrincipalRef(ctx.principal), payloadHash: stableHash(confirmInput), surface: ctx.surface ?? 'ui' }, { now: ctx.now });
    return ok({
      data,
      sources: TRANSPORTATION_CITATIONS,
      confirmation: { token: issued.token, expiresAt: issued.expiresAt, summary: `Claim your ride benefit (${benefit.program}) with ${data.provider.displayName}.` },
    });
  },
});
