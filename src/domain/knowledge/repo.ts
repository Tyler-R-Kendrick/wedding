import { asc, eq } from 'drizzle-orm';
import type { Citation } from '@/contracts/provenance';
import { faqEntries, knowledgeRecords, type FaqEntryRow } from '@/db/schema';
import { dedupeCitations, publicUrlFor, toProvenanceView, toRecordCitation } from '@/domain/content/provenance';
import type { ReadContext } from '@/domain/content/read-context';
import { textBlock } from '@/domain/content/text';
import type { FaqView, SearchResult } from '@/domain/content/views';
import { filterVisible } from '@/domain/content/visibility';
import { isBuiltRoute, ROUTES } from '@/domain/routes';
import { rankRecords } from './search';

/**
 * Static search over the projected corpus, scoped by the caller's visibility. Drafts never
 * reach guests or the AI because `filterVisible` runs with the caller's principal and surface.
 */
export async function searchKnowledge(ctx: ReadContext, query: string, limit = 8): Promise<{ results: SearchResult[]; sources: Citation[] }> {
  const rows = await ctx.db.select().from(knowledgeRecords);
  const visible = filterVisible(rows, ctx.principal, ctx.surface, ctx.now);
  const results = rankRecords(visible, query, ctx.now, limit);
  const byId = new Map(visible.map((r) => [r.id, r]));
  const sources = dedupeCitations(
    results.map((r) => {
      const row = byId.get(r.id)!;
      return { sourceId: row.sourceId as Citation['sourceId'], title: row.title, url: publicUrlFor(row, row.route), verifiedAt: r.verifiedAt, recordRef: r.recordRef };
    }),
  );
  return { results, sources };
}

export function toFaqView(row: FaqEntryRow, ctx: ReadContext): FaqView {
  const route = `${ROUTES.ask}#${row.slug}`;
  return {
    id: row.id,
    slug: row.slug,
    category: row.category,
    question: row.question,
    answer: textBlock(row.answer),
    ...(row.route && isBuiltRoute(row.route) ? { route: row.route } : {}),
    placeholder: row.placeholder,
    provenance: toProvenanceView(row, { route, sources: ctx.sources, now: ctx.now }),
  };
}

export async function listFaq(ctx: ReadContext): Promise<{ entries: FaqView[]; sources: Citation[] }> {
  const rows = await ctx.db.select().from(faqEntries).orderBy(asc(faqEntries.order));
  const visible = filterVisible(rows, ctx.principal, ctx.surface, ctx.now);
  return {
    entries: visible.map((r) => toFaqView(r, ctx)),
    sources: dedupeCitations(visible.map((r) => toRecordCitation(r, { route: `${ROUTES.ask}#${r.slug}`, title: `Ask Us › ${r.question}`, recordRef: { type: 'faq_entries', id: r.id }, now: ctx.now }))),
  };
}

export async function getFaqEntry(ctx: ReadContext, slug: string): Promise<FaqView | undefined> {
  const rows = await ctx.db.select().from(faqEntries).where(eq(faqEntries.slug, slug)).limit(1);
  const row = rows[0];
  if (!row || filterVisible([row], ctx.principal, ctx.surface, ctx.now).length === 0) return undefined;
  return toFaqView(row, ctx);
}
