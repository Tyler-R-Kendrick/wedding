import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import type { ContentSourceId } from '@/contracts/ids';
import { ok } from '@/contracts/result';
import { seedId } from '@/db/seed/sources';
import { guestHandoffSchema } from '@/domain/external/schemas';
import { GIFT_RAILS } from '@/db/schema';
import { GIFTS_COPY, giftsStatement, isMissingGiftTable, listGiftFunds, listGiftLinks, type GiftFunds } from '@/domain/gifts';
import { logger } from '@/lib/logger';
import { appServices } from './context';

const input = z.object({}).optional();

export const giftLinkViewSchema = guestHandoffSchema.extend({
  id: z.string(),
  kind: z.enum(['registry', 'adventure-fund']),
  note: z.string().nullable(),
  placeholder: z.boolean(),
  origin: z.enum(['admin', 'configured', 'placeholder']),
  verifiedAt: z.string().nullable(),
});

const railEnum = z.enum(GIFT_RAILS);

export const giftFundLinkSchema = guestHandoffSchema.extend({ rail: railEnum });

/** A fund and one hand-off per link rail (ADR-0013). */
export const giftFundViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  links: z.array(giftFundLinkSchema),
});

export const giftRailViewSchema = z.object({
  rail: railEnum,
  displayName: z.string(),
  mode: z.enum(['link', 'direct']),
  fee: z.string(),
  /** Where the fee line was read, and when (ADR-0011). */
  source: z.object({ url: z.string(), verifiedAt: z.string() }),
  recipientName: z.string().nullable(),
  /** Null when the details are personal and the viewer did not arrive through an invitation. */
  instructions: z.string().nullable(),
  needsInvitation: z.boolean(),
});

const output = z.object({
  copy: z.object({
    eyebrow: z.string(),
    title: z.string(),
    lede: z.string(),
    registryHeading: z.string(),
    registryIntro: z.string(),
    adventureHeading: z.string(),
    adventureIntro: z.string(),
    handoffNote: z.string(),
    placeholderNote: z.string(),
    // Editorial empty states. A section with no configured links says what is still to come; it
    // never names a provider the couple have not chosen (brief §2: Registry is NOT settled).
    registryPending: z.string(),
    adventurePending: z.string(),
    fundsIntro: z.string(),
    waysHeading: z.string(),
    waysIntro: z.string(),
    needsInvitation: z.string(),
    confirmName: z.string(),
    venmoPrivacy: z.string(),
    askIntro: z.string(),
    askLabel: z.string(),
    thanks: z.string(),
  }),
  links: z.array(giftLinkViewSchema),
  /**
   * What a gift of money can go toward, and the ways to send it. Empty until the couple add at least
   * one way to give in /admin/gifts. Zelle and mailing details are personal: an anonymous viewer (and
   * the concierge answering one) gets the rail and its fee, never the email, phone or address.
   */
  funds: z.array(giftFundViewSchema),
  rails: z.array(giftRailViewSchema),
  /**
   * The gift arrangements in prose, computed from what is actually configured.
   *
   * `copy` above is the page's furniture, and the AI fact renderer used to flatten all of it into
   * an answer — field paths and all: "Copy › Registry intro: A conventional list of things for our
   * home, kept with a registry provider." Two defects in one line: an internal path shown to a
   * guest, and a registry asserted to exist. `copy` is skipped by that renderer now, and this is
   * what it reads instead.
   */
  statement: z.string(),
});

export type GiftLinks = z.infer<typeof output>;

export const BRIEF_CITATION = { sourceId: seedId<ContentSourceId>(101), title: "Tyler's brief 2026-09-04", url: '/the-wedding', verifiedAt: '2026-09-04T00:00:00.000Z' };

export const listGiftLinksCapability = defineCapability<z.infer<typeof input>, GiftLinks>({
  name: 'list_gift_links',
  title: 'Gift links',
  description:
    'Where to find the couple’s wishlist and how to help with their next adventures: the registry provider links they have configured, ' +
    'the funds a gift of money can go toward (honeymoon, home, adoption, next adventures) and the ways to send one (Zelle, Venmo, PayPal, Cash App, a check), each with what that network charges. ' +
    'Reads only. Money goes from the guest’s own account straight to the couple’s; this never takes payment, never holds money, and never suggests amounts.',
  kind: 'read',
  auth: 'anonymous',
  requires: [],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 12_000,
  async handler(ctx) {
    const { db, providers } = appServices(ctx);
    const fundsOrNothing = listGiftFunds(db, ctx.principal).catch((e: unknown): GiftFunds => {
      // A database the gifts-of-money migration has not reached yet (a preview): the registry links
      // still show, and the section says what is still to come, exactly as with nothing configured.
      if (!isMissingGiftTable(e)) throw e;
      logger.warn('gift funds unavailable: migration 0011 has not been applied to this database');
      return { funds: [], rails: [] };
    });
    const [links, { funds, rails }] = await Promise.all([listGiftLinks(db, { registry: providers('registry'), cashFund: providers('cash-fund') }), fundsOrNothing]);
    const counts = {
      registry: links.filter((l) => l.kind === 'registry' && !l.placeholder).length,
      adventures: links.filter((l) => l.kind === 'adventure-fund' && !l.placeholder).length,
      funds: funds.map((f) => f.title),
      rails: rails.map((r) => (r.rail === 'check' ? 'a check by mail' : r.displayName)),
    };
    return ok({ data: { copy: GIFTS_COPY, links, funds, rails, statement: giftsStatement(counts) }, sources: [BRIEF_CITATION] });
  },
});
