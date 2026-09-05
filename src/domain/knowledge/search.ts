import type { KnowledgeRecordRow } from '@/db/schema/knowledge';
import { computeFreshness, needsCaveat } from '@/domain/content/freshness';
import type { SearchResult } from '@/domain/content/views';
import { toTerms } from './projection';

/**
 * Deterministic keyword search over the projected corpus. No model, no embeddings: the
 * "static" search the concierge can fall back to and the UI can use without AI. Scoring is
 * simple and explainable: title hits weigh 3, content hits 1, exact phrase in content +2.
 */
export function scoreRecord(record: Pick<KnowledgeRecordRow, 'title' | 'content' | 'terms'>, query: string): number {
  const queryTerms = toTerms(query);
  if (!queryTerms.length) return 0;
  const titleTerms = new Set(toTerms(record.title));
  const recordTerms = new Set(record.terms);
  let score = 0;
  for (const t of queryTerms) {
    if (titleTerms.has(t)) score += 3;
    else if (recordTerms.has(t)) score += 1;
  }
  const phrase = query.trim().toLowerCase();
  if (phrase.length >= 4 && record.content.toLowerCase().includes(phrase)) score += 2;
  return score;
}

export function snippetFor(content: string, query: string, max = 220): string {
  const lower = content.toLowerCase();
  const terms = toTerms(query);
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  const start = Math.max(0, (at < 0 ? 0 : at) - 60);
  const slice = content.slice(start, start + max);
  return `${start > 0 ? '…' : ''}${slice}${start + max < content.length ? '…' : ''}`;
}

export function toSearchResult(record: KnowledgeRecordRow, query: string, now: Date): SearchResult {
  const freshness = computeFreshness(record, now);
  const verifiedAt = record.verifiedAt.toISOString();
  const caveat = needsCaveat(freshness)
    ? `Last checked ${verifiedAt.slice(0, 10)}${record.sourceUrl ? ` — confirm with ${record.sourceUrl}` : ''}.`
    : undefined;
  return {
    id: record.id,
    kind: record.kind,
    title: record.title,
    snippet: snippetFor(record.content, query),
    route: record.route,
    score: scoreRecord(record, query),
    sourceType: record.sourceType,
    trustClass: record.trustClass,
    verifiedAt,
    freshness,
    ...(caveat ? { caveat } : {}),
    recordRef: record.recordRef,
  };
}

/** Ranks visible records for a query; ties break by freshness then title so results are stable. */
export function rankRecords(records: readonly KnowledgeRecordRow[], query: string, now: Date, limit: number): SearchResult[] {
  const order = { fresh: 0, aging: 1, stale: 2, not_yet_valid: 3, expired: 4 } as const;
  return records
    .map((r) => toSearchResult(r, query, now))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || order[a.freshness] - order[b.freshness] || a.title.localeCompare(b.title))
    .slice(0, limit);
}
