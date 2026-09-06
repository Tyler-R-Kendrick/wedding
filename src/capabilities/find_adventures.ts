import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, ok } from '@/contracts/result';
import type { Db } from '@/db/client';
import { RECOMMENDATION_CATEGORIES } from '@/db/schema/content';
import { findRecommendations, getRecommendation } from '@/domain/adventures/repo';
import { createReadContext } from '@/domain/content/read-context';
import { recommendationCardSchema, recommendationSummarySchema } from '@/domain/content/views';
import { ROUTES } from '@/domain/routes';
import { requireService } from './services';

const input = z
  .object({
    /** Exact recommendation slug; when given, returns just that card. */
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80).optional(),
    /** Free text matched against titles, descriptions, tags and place names. */
    query: z.string().trim().min(1).max(120).optional(),
    category: z.enum(RECOMMENDATION_CATEGORIES).optional(),
    /** Interest tags such as "architecture", "food", "kids", "walk", "inside-caa". */
    interests: z.array(z.string().regex(/^[a-z0-9-]{1,40}$/)).max(10).optional(),
    /** Time available; when set, a composed plan that fits is returned alongside the cards. */
    maxMinutes: z.number().int().min(15).max(720).optional(),
    kids: z.boolean().optional(),
    insideCaa: z.boolean().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .optional();

const output = z.object({
  route: z.string(),
  items: z.array(recommendationCardSchema),
  plan: z
    .object({
      stops: z.array(z.object({ recommendation: recommendationSummarySchema, minutes: z.number().int() })),
      totalMinutes: z.number().int(),
      skippedForTime: z.array(z.string()),
    })
    .optional(),
});
export type FindAdventuresData = z.infer<typeof output>;

export const findAdventures = defineCapability<z.infer<typeof input>, FindAdventuresData>({
  name: 'find_adventures',
  title: 'Find adventures to share',
  description:
    "Searches Sara and Tyler's recommendations (Share an Adventure): the practical layer (what, where, how long, cost, accessibility, directions/booking handoffs) plus, when the couple " +
    'allows it, the memory behind it. Filter by text, category, interests, time available, kids, or inside-the-hotel. With maxMinutes it also returns a composed plan. ' +
    'Recommendations marked draft are not yet curated; never present a draft or placeholder as a settled recommendation. Read only.',
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
    if (i?.slug) {
      const one = await getRecommendation(rctx, i.slug);
      if (!one) return err(new CapabilityError('not_found', "We don't have a recommendation by that name."));
      return ok({ data: { route: ROUTES.share, items: [one.card] }, sources: one.sources });
    }
    const { items, plan, sources } = await findRecommendations(rctx, {
      query: i?.query, category: i?.category, interests: i?.interests, maxMinutes: i?.maxMinutes, kids: i?.kids, insideCaa: i?.insideCaa, limit: i?.limit,
    });
    return ok({
      data: {
        route: ROUTES.share,
        items,
        ...(plan ? { plan: { stops: plan.stops.map(({ item: { interests: _i, ...recommendation }, minutes }) => ({ recommendation, minutes })), totalMinutes: plan.totalMinutes, skippedForTime: plan.skippedForTime } } : {}),
      },
      sources,
    });
  },
});
