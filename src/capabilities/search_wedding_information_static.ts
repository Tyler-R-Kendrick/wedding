import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { ok } from '@/contracts/result';
import type { Db } from '@/db/client';
import { createReadContext } from '@/domain/content/read-context';
import { searchResultSchema } from '@/domain/content/views';
import { searchKnowledge } from '@/domain/knowledge/repo';
import { requireService } from './services';

const input = z.object({
  query: z.string().trim().min(2).max(200),
  limit: z.number().int().min(1).max(20).optional(),
});
const output = z.object({ query: z.string(), results: z.array(searchResultSchema) });
export type StaticSearchData = z.infer<typeof output>;

export const searchWeddingInformationStatic = defineCapability<z.infer<typeof input>, StaticSearchData>({
  name: 'search_wedding_information_static',
  title: 'Search wedding information',
  description:
    "Keyword search over the site's own content: story, adventures, recommendations, itineraries, venue history and spaces, operational records (outlets, valet, parking, accessibility) and the FAQ. " +
    'Deterministic, no model. Results carry a route to cite, a source type, a verification date and freshness; when a result has a caveat, repeat it. Drafts and placeholders are never returned. ' +
    'If nothing matches, say you do not have that information. Read only.',
  kind: 'read',
  auth: 'anonymous',
  requires: [],
  annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 12_000,
  async handler(ctx, { query, limit }) {
    const db = requireService<Db>(ctx, 'db');
    const rctx = await createReadContext(db, ctx.principal, ctx.surface ?? 'ui', ctx.now);
    const { results, sources } = await searchKnowledge(rctx, query, limit ?? 8);
    return ok({ data: { query, results }, sources });
  },
});
