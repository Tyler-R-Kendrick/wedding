import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { recordExternalAction } from '@/domain/external/records';
import { SLUG } from '@/domain/external/schemas';
import { listGiftLinks } from '@/domain/gifts';
import { appServices } from './context';
import { BRIEF_CITATION, giftLinkViewSchema } from './list_gift_links';

const input = z.object({ linkId: z.string().regex(SLUG) });
const output = z.object({ handoff: giftLinkViewSchema, externalActionId: z.string() });

/**
 * Explicit handoff to a registry / next-adventures provider. Not idempotent on purpose:
 * anonymous visitors cannot hold idempotency keys, and the record is a log of a link handed
 * over, never a commitment. Nothing is purchased or reserved by calling this.
 */
export const openGiftLink = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'open_gift_link',
  title: 'Open a gift link',
  description:
    'Hands the guest off to a registry or gift provider (Zola, The Knot, Joy, …) by returning the allowlisted link to open in a new tab. ' +
    'Use it only when the guest asks to go to the registry. It records the handoff; it never buys, reserves, or confirms anything.',
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
  async handler(ctx, { linkId }) {
    const { db, providers } = appServices(ctx);
    const links = await listGiftLinks(db, { registry: providers('registry'), cashFund: providers('cash-fund') });
    const link = links.find((l) => l.id === linkId);
    if (!link) return err(new CapabilityError('not_found', 'That gift link is not available.'));
    const externalActionId = await recordExternalAction(db, ctx.audit, {
      kind: 'gift_link',
      provider: link.provider,
      status: 'initiated',
      actor: toPrincipalRef(ctx.principal),
      target: { type: 'gift_link', id: link.id },
      url: link.url,
      surface: ctx.surface ?? 'ui',
      requestId: ctx.requestId,
      metadata: { kind: link.kind, placeholder: link.placeholder },
    });
    return ok({ data: { handoff: link, externalActionId }, sources: [BRIEF_CITATION], handoffUrl: link.url });
  },
});
