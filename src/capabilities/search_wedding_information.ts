import { z } from 'zod';
import { aiConfig } from '@/ai/config';
import { retrieve } from '@/ai/retrieval';
import { defineCapability } from '@/contracts/capability';
import { ok } from '@/contracts/result';
import type { Db } from '@/db/client';
import { createReadContext } from '@/domain/content/read-context';
import { searchResultSchema } from '@/domain/content/views';
import { requireService } from './services';

const input = z.object({
  query: z.string().trim().min(2).max(200),
  limit: z.number().int().min(1).max(20).optional(),
});
const resultSchema = searchResultSchema.extend({
  /** Full record text (capped) so an answer can quote whole sentences; the snippet is for lists. */
  content: z.string(),
  /** The record's own content source, so each hit is cited individually rather than as one blob. */
  sourceId: z.string(),
  /** Public route or official source URL for the citation. Never a repository path. */
  url: z.string(),
});
const output = z.object({ query: z.string(), mode: z.enum(['static', 'hybrid']), results: z.array(resultSchema) });
export type SearchWeddingInformationData = z.infer<typeof output>;

/**
 * The concierge's retrieval tool (ADR-0003 rule 2). Same corpus and visibility rules as
 * `search_wedding_information_static`; adds the record text and the embeddings seam
 * (`AI_RETRIEVAL_MODE=hybrid`). Every hit carries a trust class, a route or official URL, a
 * verification date, and a caveat when the record is aging or stale.
 */
export const searchWeddingInformation = defineCapability<z.infer<typeof input>, SearchWeddingInformationData>({
  name: 'search_wedding_information',
  title: 'Search what the site knows',
  description:
    "Retrieves passages from the site's own content (story, adventures, recommendations, itineraries, venue history and spaces, operational records, FAQ) that match a question. " +
    'Each result has a trust class, a route or official link to cite, a verification date and, when the record is aging or stale, a caveat to repeat. ' +
    'Placeholders (undecided details) and drafts are never returned; if nothing matches, the information is not on the site. Read only.',
  kind: 'read',
  auth: 'anonymous',
  requires: [],
  flag: 'AI_CONCIERGE',
  annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 16_000,
  async handler(ctx, { query, limit }) {
    const db = requireService<Db>(ctx, 'db');
    const rctx = await createReadContext(db, ctx.principal, ctx.surface ?? 'ui', ctx.now);
    const { results, sources, mode } = await retrieve(rctx, query, limit ?? aiConfig.AI_RETRIEVAL_LIMIT, aiConfig.AI_RETRIEVAL_MODE);
    return ok({ data: { query, mode, results }, sources });
  },
});
