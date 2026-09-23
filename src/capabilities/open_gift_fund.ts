import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { GIFT_RAILS } from '@/db/schema';
import { recordExternalAction } from '@/domain/external/records';
import { SLUG } from '@/domain/external/schemas';
import { listGiftFunds } from '@/domain/gifts';
import { appServices } from './context';
import { BRIEF_CITATION, giftFundLinkSchema } from './list_gift_links';

const input = z.object({ fundId: z.string().regex(SLUG), rail: z.enum(GIFT_RAILS) });
const output = z.object({ fundId: z.string(), handoff: giftFundLinkSchema, externalActionId: z.string() });

/**
 * Hands the guest to Venmo, PayPal or Cash App to give toward one fund (ADR-0013). Like
 * `open_gift_link` it is a log of a link handed over, never a payment: the site does not learn
 * whether anything was sent, or how much, and never asks. Zelle and checks have no link, so they
 * are not openable here — `list_gift_links` carries their instructions.
 */
export const openGiftFund = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'open_gift_fund',
  title: 'Give toward a fund',
  description:
    'Hands the guest off to Venmo, PayPal or Cash App to give toward one of the couple’s funds (honeymoon, home, adoption, next adventures), by returning the link to the couple’s own account. ' +
    'Use it only when the guest asks to send a gift that way. It records the handoff; it never sends, confirms, or suggests an amount.',
  kind: 'external',
  auth: 'anonymous',
  requires: [],
  confirmation: 'inline',
  idempotent: false,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 2_000,
  async handler(ctx, { fundId, rail }) {
    const { db } = appServices(ctx);
    const { funds } = await listGiftFunds(db, ctx.principal);
    const fund = funds.find((f) => f.id === fundId);
    const link = fund?.links.find((l) => l.rail === rail);
    if (!fund || !link) return err(new CapabilityError('not_found', 'That way to give is not available.'));
    const externalActionId = await recordExternalAction(db, ctx.audit, {
      kind: 'gift_fund',
      provider: rail,
      status: 'initiated',
      actor: toPrincipalRef(ctx.principal),
      target: { type: 'gift_fund', id: fund.id },
      url: link.url,
      surface: ctx.surface ?? 'ui',
      requestId: ctx.requestId,
      metadata: { rail },
    });
    return ok({ data: { fundId: fund.id, handoff: link, externalActionId }, sources: [BRIEF_CITATION], handoffUrl: link.url });
  },
});
