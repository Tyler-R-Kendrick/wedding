import { desc } from 'drizzle-orm';
import type { Citation } from '@/contracts/provenance';
import type { Db } from '@/db/client';
import { knowledgeRecords, type KnowledgeRecordRow } from '@/db/schema';
import { dedupeCitations, publicUrlFor } from '@/domain/content/provenance';
import type { ReadContext } from '@/domain/content/read-context';
import { filterVisible } from '@/domain/content/visibility';
import { rankRecords, snippetFor, toSearchResult } from '@/domain/knowledge/search';
import type { SearchResult } from '@/domain/content/views';
import { getProvider } from '@/providers/registry';

/**
 * Retrieval over `knowledge_records` (ADR-0003 rule 2). Visibility is always the caller's
 * (`filterVisible` with principal + surface), so drafts and out-of-scope rows never reach the model.
 *
 *  - `static`  deterministic keyword ranking (swarm C's search). Default; what CI runs.
 *  - `hybrid`  keyword ranking first, then the embeddings + vector-index providers fill the
 *              remaining slots. Providers resolve to the hashed mock / in-memory index when nothing
 *              is configured, so the seam is exercised without keys.
 */
export type RetrievalMode = 'static' | 'hybrid';

/**
 * A search hit plus the record's full text (capped), so the model quotes whole sentences, not
 * snippets, and the record's own provenance so each hit becomes its own citable evidence block.
 * `url` is the public route or the official source URL — never a repository path.
 */
export type RetrievedResult = SearchResult & { content: string; sourceId: string; url: string };

export interface RetrievalResult {
  results: RetrievedResult[];
  sources: Citation[];
  mode: RetrievalMode;
}

export const MAX_CONTENT_CHARS = 1_200;

function withContent(results: readonly SearchResult[], byId: ReadonlyMap<string, KnowledgeRecordRow>): RetrievedResult[] {
  return results.flatMap((r) => {
    const row = byId.get(r.id);
    if (!row) return [];
    const content = row.content;
    return [
      {
        ...r,
        content: content.length > MAX_CONTENT_CHARS ? `${content.slice(0, MAX_CONTENT_CHARS - 1)}…` : content,
        sourceId: row.sourceId,
        url: publicUrlFor(row, row.route),
      },
    ];
  });
}

const NAMESPACE = 'knowledge_records';

function citationsFor(results: readonly SearchResult[], byId: ReadonlyMap<string, KnowledgeRecordRow>): Citation[] {
  return dedupeCitations(
    results.flatMap((r) => {
      const row = byId.get(r.id);
      if (!row) return [];
      return [{ sourceId: row.sourceId as Citation['sourceId'], title: row.title, url: publicUrlFor(row, row.route), verifiedAt: r.verifiedAt, recordRef: r.recordRef }];
    }),
  );
}

export async function retrieveStatic(ctx: ReadContext, query: string, limit: number): Promise<RetrievalResult> {
  const rows = await ctx.db.select().from(knowledgeRecords);
  const visible = filterVisible(rows, ctx.principal, ctx.surface, ctx.now);
  const byId = new Map(visible.map((r) => [r.id, r]));
  const results = rankRecords(visible, query, ctx.now, limit);
  return { results: withContent(results, byId), sources: citationsFor(results, byId), mode: 'static' };
}

let indexedFingerprint: string | undefined;

/** (Re)builds the vector index when the corpus changed. Cheap for a corpus this size. */
async function ensureIndexed(db: Db, rows: readonly KnowledgeRecordRow[]): Promise<boolean> {
  const latest = await db.select({ updatedAt: knowledgeRecords.updatedAt }).from(knowledgeRecords).orderBy(desc(knowledgeRecords.updatedAt)).limit(1);
  const fingerprint = `${rows.length}:${latest[0]?.updatedAt?.toISOString() ?? ''}`;
  if (indexedFingerprint === fingerprint) return true;
  const embeddings = getProvider('embeddings');
  const index = getProvider('vector-index', { db });
  if (index.dims !== embeddings.dims) return false;
  const batch = await embeddings.embed(rows.map((r) => `${r.title}\n${r.content}`));
  if (!batch.ok) return false;
  const upsert = await index.upsert(
    NAMESPACE,
    rows.map((r, i) => ({ id: r.id, vector: batch.value.vectors[i]!, metadata: { visibility: r.visibility, kind: r.kind } })),
  );
  if (!upsert.ok) return false;
  indexedFingerprint = fingerprint;
  return true;
}

export async function retrieveHybrid(ctx: ReadContext, query: string, limit: number): Promise<RetrievalResult> {
  const rows = await ctx.db.select().from(knowledgeRecords);
  const visible = filterVisible(rows, ctx.principal, ctx.surface, ctx.now);
  const byId = new Map(visible.map((r) => [r.id, r]));
  const results = rankRecords(visible, query, ctx.now, limit);
  if (results.length < limit && (await ensureIndexed(ctx.db, rows))) {
    const embeddings = getProvider('embeddings');
    const index = getProvider('vector-index', { db: ctx.db });
    const q = await embeddings.embed([query]);
    if (q.ok && q.value.vectors[0]) {
      const matches = await index.query(NAMESPACE, { vector: q.value.vectors[0], k: limit * 3 });
      if (matches.ok) {
        for (const m of matches.value) {
          if (results.length >= limit) break;
          if (results.some((r) => r.id === m.id) || m.score < 0.15) continue;
          const row = byId.get(m.id); // visibility re-checked: only rows this principal may see are in byId
          if (!row) continue;
          results.push({ ...toSearchResult(row, query, ctx.now), snippet: snippetFor(row.content, query), score: Math.round(m.score * 100) / 100 });
        }
      }
    }
  }
  return { results: withContent(results, byId), sources: citationsFor(results, byId), mode: 'hybrid' };
}

export function retrieve(ctx: ReadContext, query: string, limit: number, mode: RetrievalMode): Promise<RetrievalResult> {
  return mode === 'hybrid' ? retrieveHybrid(ctx, query, limit) : retrieveStatic(ctx, query, limit);
}

/** Tests: forget the index fingerprint so the next hybrid search re-embeds. */
export function resetRetrievalIndex(): void {
  indexedFingerprint = undefined;
}
