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
export const HOME_ROUTE: Record<string, string> = {
  site_status: ROUTES.wedding,
  get_story: ROUTES.story,
  list_adventures: ROUTES.adventures,
  show_adventure: ROUTES.adventures,
  find_adventures: ROUTES.share,
  list_itineraries: ROUTES.share,
  show_venue_room: ROUTES.exploreCaa,
  get_venue_facts: ROUTES.exploreCaa,
  get_faq: ROUTES.ask,
  // Level 06 onwards. Without these every answer built from a personal or travel capability cited
  // `/ask-us`, the page the guest is already reading, instead of the page that holds the fact.
  get_my_table: '/your-weekend',
  get_my_rsvp: '/rsvp',
  draft_rsvp: '/rsvp',
  list_my_events: '/your-weekend',
  get_my_invitation: '/your-weekend',
  get_my_household: '/your-weekend',
  get_my_itinerary: '/trip',
  get_my_trip: '/trip',
  get_my_travel_profile: ROUTES.travel,
  list_hotel_recommendations: ROUTES.travel,
  search_travel_options: ROUTES.travel,
  get_my_transportation_options: ROUTES.transportation,
  get_reservation_options: ROUTES.transportation,
  list_gift_links: ROUTES.gifts,
  list_gallery: ROUTES.photos,
  get_media_item: ROUTES.photos,
  search_media: ROUTES.photoSearch,
};

const SKIP_KEYS = new Set([
  'id', 'slug', 'href', 'route', 'provenance', 'recordRef', 'score', 'visibility', 'draft', 'sourceType', 'trustClass', 'freshness', 'policy', 'external',
  'contentVersion', 'editedBy', 'sourceId', 'media', 'verifiedAt', 'kind', 'category', 'buckets', 'tags', 'seasons', 'total', 'limit', 'interests', 'expired', 'key',
  'handoffs', 'lifecycle', 'themes', 'defaultTheme', 'placeholder', 'experienceId', 'experienceSlug', 'experienceHref', 'ttlSeconds', 'provider', 'opensNewTab',
  // The caller's own words must never come back as evidence: a question is not a source.
  'query', 'q', 'question_text', 'mode', 'snippet', 'url', 'results', 'bucket', 'order', 'chapter', 'count', 'index',
  // A page's own furniture — headings, eyebrows, a closing "Thank you. Truly." — is not evidence.
  // Flattened into an answer it arrives as internal field paths ("Copy › Registry intro: …") and,
  // worse, as page copy written for a state the site is not in. A capability that wants the model
  // to have prose gives it a `statement`, computed from what is actually configured.
  'copy',
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
  // Only at depth 0. These keys are the BLOCK's identity, which `titleOf` reads from the top-level
  // object; a nested object's `name` is an ordinary fact. Dropping it at every depth is why
  // `get_my_table` rendered "Table › Seat number: 2" and never said Table 3 — the answer to the
  // question was the one field thrown away.
  if (TITLE_ONLY.has(key) && depth === 0) return [];
  const prefix = PRIMARY.has(key) ? '' : `${label(key)}: `;
  if (isTextBlock(value)) return textLines(prefix, value.text, value.placeholder, depth);
  if (typeof value === 'string') return value.trim() ? textLines(prefix, value, false, depth) : [];
  if (typeof value === 'boolean') return []; // "Kid friendly: true" is a field, not a sentence a guest asked for
  if (typeof value === 'number') return [`${prefix}${String(value)}.`];
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === 'string')) {
      // Through `textLines`, not straight to a join. This branch used to render `string[]` verbatim,
      // which was the ONE path in this file that never saw `isPlaceholderText` — so a list whose
      // members included a typed placeholder shipped the marker and its backlog reference into a
      // guest-facing answer ("… personal to you.; TODO(Tyler & Sara): ride benefit amount, area and
      // validity (backlog P-05)"), from `get_my_transportation_options`. A hint is not knowledge
      // (ADR-0003 rule 6), and dropping one silently would leave the rest reading as a complete list.
      const items = (value as string[]).map((v) => v.trim()).filter(Boolean);
      if (!items.length) return [];
      const facts = items.filter((v) => !isPlaceholderText(v));
      const joined = facts.join('; ');
      return textLines(prefix, joined ? `${joined.replace(/[.;]+$/, '')}.` : '', facts.length !== items.length, depth);
    }
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
    // Same rule for the caveat: it is authored text and can carry a marker like any other field.
    if (raw.caveat && !isPlaceholderText(raw.caveat)) lines.push(raw.caveat);
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
  // The leftovers block is the capability's own answer, not any one record's, so it keeps the
  // CAPABILITY's title: borrowing `sources[0].title` would put a specific record's name on a
  // sentence that record never said. The ROUTE is a different question, and taking the home route
  // for it was wrong. `HOME_ROUTE` covers level 05's nine content capabilities and nothing since, so
  // everything from level 06 onwards fell through to `/ask-us` — the page the guest is already
  // reading. `get_my_table` answered "you are at Table 3" and cited Ask Us, when the fact came from
  // the published seating chart on Your Weekend. A wrong citation is worse than none: it invites the
  // guest to go and check a page that does not contain the fact. When the outcome names exactly one
  // source there is no ambiguity about where the answer came from, so that source's route is used.
  // Order matters: the authored route wins. `get_venue_facts` returns one synthesis over many
  // records, so its sole source ("Built in 1893", /explore-caa#history) is not where the leftovers
  // came from and its anchor would send the guest to the wrong section. Only when no route was
  // authored for this capability — every capability from level 06 on — is a single unambiguous
  // source better than guessing `/ask-us`.
  const soleSource = outcome.sources.length === 1 ? outcome.sources[0] : undefined;
  const homeRoute = HOME_ROUTE[descriptor.name] ?? soleSource?.url ?? ROUTES.ask;
  const baseTrust = trustForCapability(descriptor, outcome);
  const fallbackCitation: Citation = {
    sourceId: `capability:${descriptor.name}` as ContentSourceId,
    title: descriptor.title,
    url: homeRoute,
    verifiedAt: soleSource?.verifiedAt ?? outcome.retrievedAt,
    ...(soleSource?.recordRef ? { recordRef: soleSource.recordRef } : {}),
  };
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
