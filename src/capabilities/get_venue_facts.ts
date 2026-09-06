import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { ok } from '@/contracts/result';
import type { Db } from '@/db/client';
import { VENUE_FACT_CATEGORIES } from '@/db/schema/content';
import { createReadContext } from '@/domain/content/read-context';
import { operationalFieldViewSchema, textBlockSchema, venueFactViewSchema, venueSpaceViewSchema } from '@/domain/content/views';
import { getVenueFacts as readVenueFacts } from '@/domain/venue/repo';
import { ROUTES } from '@/domain/routes';
import { requireService } from './services';

const input = z
  .object({
    category: z.enum(VENUE_FACT_CATEGORIES).optional(),
    /** Admins only (ignored otherwise): include expired records such as closed outlets, flagged as expired. */
    includeExpired: z.boolean().optional(),
  })
  .optional();

const output = z.object({
  route: z.string(),
  venueName: z.string(),
  history: z.array(venueFactViewSchema),
  lookForThis: z.array(venueFactViewSchema),
  spaces: z.array(venueSpaceViewSchema),
  outlets: z.array(operationalFieldViewSchema),
  gettingHere: z.array(operationalFieldViewSchema),
  roomsNotConfirmed: textBlockSchema,
});
export type ExploreCaaPageData = z.infer<typeof output>;

export const getVenueFacts = defineCapability<z.infer<typeof input>, ExploreCaaPageData>({
  name: 'get_venue_facts',
  title: 'Explore the CAA',
  description:
    'Returns the venue docent: cited history of the Chicago Athletic Association building, the four event spaces from the kit, self-guided "look for this" details, and the current ' +
    'on-property outlets, valet, parking, transit and accessibility as dated operational records with official links. Every operational fact carries a verification date; ' +
    'always mention the date and the official link when a record is aging or stale. Closed outlets are excluded for guests. Read only.',
  kind: 'read',
  auth: 'anonymous',
  requires: [],
  annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 32_000,
  async handler(ctx, i) {
    const db = requireService<Db>(ctx, 'db');
    const rctx = await createReadContext(db, ctx.principal, ctx.surface ?? 'ui', ctx.now);
    const { history, lookForThis, spaces, outlets, gettingHere, roomsNotConfirmed, sources } = await readVenueFacts(rctx, { category: i?.category, includeExpired: i?.includeExpired });
    return ok({ data: { route: ROUTES.exploreCaa, venueName: 'Chicago Athletic Association Hotel', history, lookForThis, spaces, outlets, gettingHere, roomsNotConfirmed }, sources });
  },
});
