import type { AnyCapability, CapabilityOutcome } from '@/contracts/capability';
import type { ContentSourceId } from '@/contracts/ids';
import type { Citation, TrustClass } from '@/contracts/provenance';
import { isPlaceholderText } from '@/content/schemas';
import { formatDateWithWeekday } from '@/domain/content/format';
import { ROUTES } from '@/domain/routes';
import { splitSentences } from './text';
import { trustForCapability, trustFromProvenance } from './trust';
import type { SpotlightedSource } from './types';

/**
 * Turns a capability outcome into evidence blocks the model may quote. Every block is one
 * provenance-bearing record (a FAQ entry, a venue fact, a search hit) with its own citation, so the
 * "Based on…" list points at the exact record. Typed placeholders are rendered as
 * "not yet decided by the couple" and their hint text never reaches the model: a TODO is not
 * knowledge (ADR-0003 rule 6).
 */
export const UNDECIDED = 'not yet decided by the couple';

/** Where a capability's uncited facts live on the site, for citations without a URL. */
const HOME_ROUTE: Record<string, string> = {
  site_status: ROUTES.wedding,
  get_story: ROUTES.story,
  list_adventures: ROUTES.adventures,
  show_adventure: ROUTES.adventures,
  find_adventures: ROUTES.share,
  list_itineraries: ROUTES.share,
  show_venue_room: ROUTES.exploreCaa,
  get_venue_facts: ROUTES.exploreCaa,
  get_faq: ROUTES.ask,
};

const SKIP_KEYS = new Set([
  'id', 'slug', 'href', 'route', 'provenance', 'recordRef', 'score', 'visibility', 'draft', 'sourceType', 'trustClass', 'freshness', 'policy', 'external',
  'contentVersion', 'editedBy', 'sourceId', 'media', 'verifiedAt', 'kind', 'category', 'buckets', 'tags', 'seasons', 'total', 'limit', 'interests', 'expired', 'key',
  'handoffs', 'lifecycle', 'themes', 'defaultTheme', 'placeholder', 'experienceId', 'experienceSlug', 'experienceHref', 'ttlSeconds', 'provider', 'opensNewTab',
  // The caller's own words must never come back as evidence: a question is not a source.
  'query', 'q', 'question_text', 'mode', 'snippet', 'url', 'results', 'bucket', 'order', 'chapter', 'count', 'index',
]);

/**
 * Keys whose value is the block's own identity: the title already carries them, so repeating them
 * as lines only gives an extractive model a question to quote back as if it were an answer.
 */
const TITLE_ONLY = new Set(['title', 'name', 'question', 'label']);

/** Keys that ARE the fact: rendered as bare sentences, without a "Answer: " style prefix. */
const PRIMARY = new Set(['statement', 'answer', 'what', 'summary', 'character', 'content', 'paragraphs', 'memory', 'intro', 'lede', 'body', 'text', 'value', 'description']);

const label = (key: string) => {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

type TextBlock = { text: string; placeholder: boolean };
const isTextBlock = (v: unknown): v is TextBlock => !!v && typeof v === 'object' && typeof (v as TextBlock).text === 'string' && typeof (v as TextBlock).placeholder === 'boolean';
const hasProvenance = (v: unknown): v is Record<string, unknown> & { provenance: Record<string, unknown> } =>
  !!v && typeof v === 'object' && !Array.isArray(v) && !!(v as Record<string, unknown>).provenance && typeof (v as Record<string, unknown>).provenance === 'object';

/** Placeholder-aware sentences: facts kept, hints dropped, an explicit "undecided" line when anything was dropped. */
export function textLines(prefix: string, text: string, placeholder = false, depth = 0): string[] {
  const sentences = splitSentences(text);
  const facts = sentences.filter((s) => !isPlaceholderText(s));
  const dropped = placeholder || sentences.length !== facts.length || (facts.length === 0 && isPlaceholderText(text));
  // A nested field with nothing but a placeholder ("Recommendation › this is not yet decided") is
  // noise: the record's own top-level fields already say what is undecided.
  if (depth > 0 && facts.length === 0) return [];
  const out: string[] = [];
  if (facts.length) out.push(`${prefix}${facts.join(' ')}`);
  if (dropped) {
    // Without a "Label: " prefix the undecided line has to stand as its own sentence.
    if (prefix) out.push(facts.length ? `${prefix}other details ${UNDECIDED}.` : `${prefix}${UNDECIDED}.`);
    else out.push(facts.length ? `Other details are ${UNDECIDED}.` : `This is ${UNDECIDED}.`);
  }
  return out;
}

function scalarLines(key: string, value: unknown, depth: number): string[] {
  if (TITLE_ONLY.has(key)) return [];
  const prefix = PRIMARY.has(key) ? '' : `${label(key)}: `;
  if (isTextBlock(value)) return textLines(prefix, value.text, value.placeholder, depth);
  if (typeof value === 'string') return value.trim() ? textLines(prefix, value, false, depth) : [];
  if (typeof value === 'boolean') return []; // "Kid friendly: true" is a field, not a sentence a guest asked for
  if (typeof value === 'number') return [`${prefix}${String(value)}.`];
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === 'string')) return value.length ? [`${prefix}${(value as string[]).join('; ')}.`] : [];
    if (value.every(isTextBlock)) return value.flatMap((v) => textLines(prefix, v.text, v.placeholder, depth));
    if (depth >= 2) return [];
    return value.flatMap((v) => (hasProvenance(v) ? [] : objectLines(v, depth + 1)));
  }
  if (value && typeof value === 'object' && depth < 2 && !hasProvenance(value)) return objectLines(value, depth + 1).map((l) => `${label(key)} › ${l}`);
  return [];
}

export function objectLines(value: unknown, depth = 0): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SKIP_KEYS.has(k) || v === null || v === undefined) continue;
    out.push(...scalarLines(k, v, depth));
  }
  return out;
}

function titleOf(obj: Record<string, unknown>, fallback: string): string {
  for (const k of ['title', 'name', 'question', 'label', 'statement']) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return fallback;
}

function provenanceCitation(obj: Record<string, unknown> & { provenance: Record<string, unknown> }, fallbackTitle: string, homeRoute: string): { citation: Citation; trust: TrustClass } {
  const p = obj.provenance;
  const url = typeof p.url === 'string' ? p.url : typeof obj.href === 'string' ? (obj.href as string) : homeRoute;
  return {
    citation: {
      sourceId: String(p.sourceId ?? 'unknown') as ContentSourceId,
      title: titleOf(obj, fallbackTitle),
      url,
      verifiedAt: typeof p.verifiedAt === 'string' ? p.verifiedAt : undefined,
      ...(typeof obj.id === 'string' && typeof obj.slug === 'string' ? { recordRef: { type: 'content', id: obj.id as string } } : {}),
    },
    trust: trustFromProvenance(obj, 'TRUSTED_WEDDING'),
  };
}

/** Walks the data, emitting one block per provenance-bearing object and one for the leftovers. */
function collect(value: unknown, into: SpotlightedSource[], marker: () => string, origin: string, fallback: { citation: Citation; trust: TrustClass; retrievedAt?: string }, homeRoute: string, leftovers: string[], depth = 0): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const v of value) collect(v, into, marker, origin, fallback, homeRoute, leftovers, depth);
    return;
  }
  const obj = value as Record<string, unknown>;
  if (hasProvenance(obj)) {
    const { citation, trust } = provenanceCitation(obj, fallback.citation.title, homeRoute);
    const lines = objectLines(obj);
    if (lines.length) into.push({ marker: marker(), citation, trust, lines, origin, kind: typeof obj.kind === 'string' ? obj.kind : undefined });
    for (const v of Object.values(obj)) if (v && typeof v === 'object' && depth < 3) collect(v, into, marker, origin, fallback, homeRoute, [], depth + 1);
    return;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (SKIP_KEYS.has(k) || v === null || v === undefined) continue;
    if (v && typeof v === 'object' && !isTextBlock(v)) {
      const nested = Array.isArray(v) ? v : [v];
      if (nested.some((n) => hasProvenance(n) || (n && typeof n === 'object' && Object.values(n as object).some(hasProvenance)))) {
        collect(v, into, marker, origin, fallback, homeRoute, leftovers, depth + 1);
        continue;
      }
    }
    leftovers.push(...scalarLines(k, v, depth));
  }
}

export interface FactsOptions {
  /** Next marker number; incremented per block. */
  next: () => string;
}

function siteStatusLines(data: Record<string, unknown>): string[] {
  const w = data.wedding as Record<string, string> | undefined;
  if (!w) return [];
  return [
    `The wedding is on ${formatDateWithWeekday(w.date ?? '')} (time zone ${w.timezone}).`,
    `The venue is ${w.venueName}, ${w.venueAddress}.`,
    `The couple is ${w.coupleDisplayName}.`,
    ...(w.venueUrl ? [`The venue's official website is ${w.venueUrl}.`] : []),
  ];
}

/** Search hits become one evidence block each: the record's own title, route/official URL and date. */
const SEARCH_CAPABILITIES = new Set(['search_wedding_information', 'search_wedding_information_static']);
const MAX_SEARCH_LINES = 10;

interface SearchHit {
  title: string;
  content?: string;
  snippet: string;
  route: string;
  url?: string;
  sourceId?: string;
  verifiedAt: string;
  trustClass: TrustClass;
  caveat?: string;
  kind: string;
  recordRef?: { type: string; id: string };
}

function searchBlocks(data: unknown, origin: string, opts: FactsOptions): SpotlightedSource[] {
  const results = (data as { results?: unknown[] } | undefined)?.results;
  if (!Array.isArray(results)) return [];
  const out: SpotlightedSource[] = [];
  for (const raw of results as SearchHit[]) {
    if (!raw || typeof raw !== 'object' || typeof raw.title !== 'string') continue;
    const body = typeof raw.content === 'string' && raw.content ? raw.content : raw.snippet;
    const lines = splitSentences(body)
      .filter((line) => !isPlaceholderText(line))
      .slice(0, MAX_SEARCH_LINES);
    if (raw.caveat) lines.push(raw.caveat);
    if (!lines.length) continue;
    out.push({
      marker: opts.next(),
      citation: {
        sourceId: String(raw.sourceId ?? `knowledge:${raw.kind}`) as ContentSourceId,
        title: raw.title,
        url: raw.url ?? raw.route,
        verifiedAt: raw.verifiedAt,
        ...(raw.recordRef ? { recordRef: raw.recordRef } : {}),
      },
      trust: raw.trustClass ?? 'TRUSTED_WEDDING',
      lines,
      origin,
      kind: raw.kind,
    });
  }
  return out;
}

/** Evidence blocks from a capability outcome. Never throws; unknown shapes flatten generically. */
export function factsFromOutcome(descriptor: Pick<AnyCapability, 'name' | 'title' | 'kind' | 'annotations'>, outcome: CapabilityOutcome<unknown>, opts: FactsOptions): SpotlightedSource[] {
  const out: SpotlightedSource[] = [];
  const homeRoute = HOME_ROUTE[descriptor.name] ?? ROUTES.ask;
  const baseTrust = trustForCapability(descriptor, outcome);
  // The leftovers block is the capability's own answer, not any one record's, so it is cited to the
  // capability and its page. Borrowing `sources[0]` would put a specific record's title on a
  // sentence that record never said.
  const fallbackCitation: Citation = { sourceId: `capability:${descriptor.name}` as ContentSourceId, title: descriptor.title, url: homeRoute, verifiedAt: outcome.retrievedAt };
  const fallback = { citation: fallbackCitation, trust: baseTrust, retrievedAt: outcome.retrievedAt };
  const data = outcome.data;

  if (descriptor.name === 'site_status' && data && typeof data === 'object') {
    out.push({ marker: opts.next(), citation: fallbackCitation, trust: 'TRUSTED_WEDDING', lines: siteStatusLines(data as Record<string, unknown>), origin: descriptor.name, kind: 'site' });
    return out;
  }
  if (descriptor.name === 'navigate_to') return out;
  if (SEARCH_CAPABILITIES.has(descriptor.name)) return searchBlocks(data, descriptor.name, opts);

  const leftovers: string[] = [];
  collect(data, out, opts.next, descriptor.name, fallback, homeRoute, leftovers);
  if (leftovers.length) {
    out.push({ marker: opts.next(), citation: fallbackCitation, trust: baseTrust, lines: leftovers, origin: descriptor.name, retrievedAt: outcome.retrievedAt });
  }
  if (outcome.retrievedAt) {
    const stamp = `As of ${outcome.retrievedAt.replace('T', ' ').slice(0, 16)} UTC (live data): `;
    for (const s of out) {
      s.trust = 'EXTERNAL_DATA';
      s.retrievedAt = outcome.retrievedAt;
      s.lines = s.lines.map((l) => (l.startsWith('As of ') ? l : `${stamp}${l}`));
    }
  }
  return out;
}
