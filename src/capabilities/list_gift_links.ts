import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import type { ContentSourceId } from '@/contracts/ids';
import { ok } from '@/contracts/result';
import { seedId } from '@/db/seed/sources';
import { guestHandoffSchema } from '@/domain/external/schemas';
import { GIFTS_COPY, listGiftLinks } from '@/domain/gifts';
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
    thanks: z.string(),
  }),
  links: z.array(giftLinkViewSchema),
});

export type GiftLinks = z.infer<typeof output>;

export const BRIEF_CITATION = { sourceId: seedId<ContentSourceId>(101), title: "Tyler's brief 2026-09-04", url: '/the-wedding', verifiedAt: '2026-09-04T00:00:00.000Z' };

export const listGiftLinksCapability = defineCapability<z.infer<typeof input>, GiftLinks>({
  name: 'list_gift_links',
  title: 'Gift links',
  description:
    'Where to find the couple’s wishlist and how to help with their next adventures: the registry provider links they have configured. ' +
    'Reads only. Purchases and gifts happen on the provider’s own site; this never takes payment and never suggests amounts.',
  kind: 'read',
  auth: 'anonymous',
  requires: [],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 6_000,
  async handler(ctx) {
    const { db, providers } = appServices(ctx);
    const links = await listGiftLinks(db, { registry: providers('registry'), cashFund: providers('cash-fund') });
    return ok({ data: { copy: GIFTS_COPY, links }, sources: [BRIEF_CITATION] });
  },
});
