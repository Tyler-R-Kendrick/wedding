import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { ok } from '@/contracts/result';
import type { Db } from '@/db/client';
import { ITINERARY_BUCKETS } from '@/db/schema/content';
import { listItineraries as readItineraries } from '@/domain/adventures/repo';
import { createReadContext } from '@/domain/content/read-context';
import { itineraryViewSchema } from '@/domain/content/views';
import { ROUTES } from '@/domain/routes';
import { requireService } from './services';

const input = z.object({ bucket: z.enum(ITINERARY_BUCKETS).optional() }).optional();
const output = z.object({ route: z.string(), buckets: z.array(z.enum(ITINERARY_BUCKETS)), itineraries: z.array(itineraryViewSchema) });
export type ItinerariesData = z.infer<typeof output>;

export const listItineraries = defineCapability<z.infer<typeof input>, ItinerariesData>({
  name: 'list_itineraries',
  title: 'Itineraries',
  description:
    'Lists curated itineraries by bucket: 45 minutes, 2-3 hours, Friday afternoon, Saturday morning, with kids, architecture, food and drink, and staying inside the CAA. ' +
    'Each stop is a recommendation with its practical layer and handoffs. Itineraries marked draft are not yet curated by the couple. Read only.',
  kind: 'read',
  auth: 'anonymous',
  requires: [],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 24_000,
  async handler(ctx, i) {
    const db = requireService<Db>(ctx, 'db');
    const rctx = await createReadContext(db, ctx.principal, ctx.surface ?? 'ui', ctx.now);
    const { itineraries, sources } = await readItineraries(rctx, { bucket: i?.bucket });
    return ok({ data: { route: ROUTES.share, buckets: [...ITINERARY_BUCKETS], itineraries }, sources });
  },
});
