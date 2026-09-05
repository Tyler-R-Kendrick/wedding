import { asc, eq } from 'drizzle-orm';
import type { ExternalHandoff } from '@/contracts/providers';
import type { Citation } from '@/contracts/provenance';
import {
  adventureMemories, itineraryTemplates, operationalFields, places, recommendations,
  type AdventureMemoryRow, type ItineraryTemplateRow, type OperationalFieldRow, type PlaceRow, type RecommendationRow,
} from '@/db/schema';
import { assertAllowedRedirect } from '@/lib/redirects';
import { getProvider } from '@/providers/registry';
import { dedupeCitations, toProvenanceView, toRecordCitation } from '@/domain/content/provenance';
import type { ReadContext } from '@/domain/content/read-context';
import { optionalText, textBlock, textBlocks } from '@/domain/content/text';
import type { AdventureCard, AdventureDetail, HandoffView, ItineraryView, PlaceView, RecommendationCard } from '@/domain/content/views';
import { filterVisible, isValidAt } from '@/domain/content/visibility';
import { toOperationalFieldView } from '@/domain/venue/repo';
import { ROUTES } from '@/domain/routes';
import { composeItinerary, totalMinutes, type ComposeOptions } from './itineraries';

// ------------------------------------------------------------------------------------ places

export function toPlaceView(row: PlaceRow): PlaceView {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    address: optionalText(row.address),
    ...(row.city ? { city: row.city } : {}),
    ...(row.region ? { region: row.region } : {}),
    ...(row.url && /^https:\/\//.test(row.url) ? { url: row.url } : {}),
    insideVenue: row.insideVenue,
    placeholder: row.placeholder,
  };
}

/** Places the principal may see, keyed by id. Private places simply disappear from views. */
export async function visiblePlaces(ctx: ReadContext): Promise<Map<string, PlaceRow>> {
  const rows = await ctx.db.select().from(places);
  return new Map(filterVisible(rows, ctx.principal, ctx.surface, ctx.now).map((p) => [p.id, p]));
}

// ---------------------------------------------------------------------------------- handoffs

function toHandoffView(h: ExternalHandoff): HandoffView | undefined {
  return assertAllowedRedirect(h.url).ok ? { provider: h.provider, label: h.label, url: h.url, disclosure: h.disclosure, opensNewTab: h.opensNewTab } : undefined;
}

/** Directions deep link (Google Maps) through the redirect allowlist. Never a Maps API call. */
export function directionsHandoff(place: PlaceRow, opts: { mode?: 'driving' | 'transit' | 'walking' } = {}): HandoffView | undefined {
  if (place.placeholder && !place.lat && !place.address) return undefined;
  const maps = getProvider('maps');
  const url = maps.directionsUrl({ name: place.name, address: place.address ?? undefined, lat: place.lat ?? undefined, lng: place.lng ?? undefined }, { mode: opts.mode ?? 'transit' });
  return toHandoffView({ provider: 'google-maps', label: 'Open directions in Google Maps', url, opensNewTab: true, disclosure: `You will leave our site for Google Maps to get directions to ${place.name}.` });
}

/** Booking handoff via the reservations ladder (deep link → admin URL → honest nothing). */
export async function bookingHandoff(place: PlaceRow, rec: RecommendationRow): Promise<HandoffView | undefined> {
  const reservations = getProvider('reservations');
  const result = await reservations.options({ name: place.name, resySlug: place.resySlug ?? undefined, openTableId: place.openTableId ?? undefined, url: rec.bookingUrl ?? undefined });
  if (!result.ok || result.value.rung === 'unavailable' || !result.value.handoff) return undefined;
  return toHandoffView(result.value.handoff);
}

/** "Details on the official page" when the official site is on the allowlist (CAA pages are). */
export function officialHandoff(url: string | null | undefined, name: string): HandoffView | undefined {
  if (!url) return undefined;
  return toHandoffView({ provider: 'official-site', label: `Details on ${name}'s official page`, url, opensNewTab: true, disclosure: `You will leave our site for ${name}'s official page.` });
}

// ------------------------------------------------------------------------- recommendations

export interface RecommendationDeps {
  places: Map<string, PlaceRow>;
  memories: Map<string, AdventureMemoryRow>;
  operational: Map<string, OperationalFieldRow>;
}

export async function recommendationDeps(ctx: ReadContext): Promise<RecommendationDeps> {
  const [placeMap, memoryRows, opRows] = await Promise.all([visiblePlaces(ctx), ctx.db.select().from(adventureMemories), ctx.db.select().from(operationalFields)]);
  return {
    places: placeMap,
    memories: new Map(filterVisible(memoryRows, ctx.principal, ctx.surface, ctx.now).map((m) => [m.id, m])),
    operational: new Map(filterVisible(opRows, ctx.principal, ctx.surface, ctx.now).map((o) => [o.key, o])),
  };
}

export async function toRecommendationCard(row: RecommendationRow, ctx: ReadContext, deps: RecommendationDeps): Promise<RecommendationCard> {
  const place = row.placeId ? deps.places.get(row.placeId) : undefined;
  const memory = row.experienceId ? deps.memories.get(row.experienceId) : undefined;
  const operational = row.operationalKey ? deps.operational.get(row.operationalKey) : undefined;
  const route = `${ROUTES.share}/${row.slug}`;
  const handoffs: RecommendationCard['handoffs'] = {};
  if (place) {
    const directions = directionsHandoff(place, { mode: row.category === 'day-trip' ? 'driving' : 'transit' });
    if (directions) handoffs.directions = directions;
    const booking = await bookingHandoff(place, row);
    if (booking) handoffs.booking = booking;
  }
  const official = officialHandoff(operational?.url ?? row.sourceUrl ?? place?.url, row.title);
  if (official && !handoffs.booking) handoffs.official = official;
  return {
    id: row.id,
    slug: row.slug,
    href: route,
    title: row.title,
    category: row.category,
    interests: row.interests,
    what: textBlock(row.what),
    ...(place ? { place: toPlaceView(place) } : {}),
    durationMinutes: row.durationMinutes,
    distanceFromCaa: optionalText(row.distanceFromCaa),
    cost: optionalText(row.cost),
    accessibility: optionalText(row.accessibility),
    kidFriendly: row.kidFriendly,
    draft: row.draft,
    placeholder: row.placeholder,
    ...(operational ? { operational: toOperationalFieldView(operational, ctx) } : {}),
    handoffs,
    // The memory layer exists only when the linked memory itself is visible to this principal.
    ...(memory
      ? { why: { experienceId: memory.id, experienceSlug: memory.slug, experienceHref: `${ROUTES.adventures}/${memory.slug}`, experienceTitle: memory.title, text: textBlock(row.whyWeShareThis ?? memory.summary) } }
      : {}),
    provenance: toProvenanceView(row, { route, sources: ctx.sources, now: ctx.now }),
  };
}

export function recommendationCitation(row: RecommendationRow, ctx: ReadContext): Citation {
  return toRecordCitation(row, { route: `${ROUTES.share}/${row.slug}`, title: `Share an Adventure › ${row.title}`, recordRef: { type: 'recommendations', id: row.id }, now: ctx.now });
}

export async function visibleRecommendations(ctx: ReadContext): Promise<RecommendationRow[]> {
  const rows = await ctx.db.select().from(recommendations).orderBy(asc(recommendations.title));
  return filterVisible(rows, ctx.principal, ctx.surface, ctx.now);
}

export interface FindOptions extends ComposeOptions {
  query?: string;
  category?: RecommendationRow['category'];
  insideCaa?: boolean;
  limit?: number;
}

/** The guide: filtered recommendation cards plus, when a time budget is given, a composed plan. */
export async function findRecommendations(ctx: ReadContext, opts: FindOptions = {}) {
  const deps = await recommendationDeps(ctx);
  let rows = await visibleRecommendations(ctx);
  if (opts.category) rows = rows.filter((r) => r.category === opts.category);
  if (opts.insideCaa !== undefined) rows = rows.filter((r) => r.interests.includes('inside-caa') === opts.insideCaa);
  if (opts.kids) rows = rows.filter((r) => r.kidFriendly !== false);
  if (opts.interests?.length) {
    const wanted = new Set(opts.interests.map((i) => i.toLowerCase()));
    rows = rows.filter((r) => r.interests.some((i) => wanted.has(i.toLowerCase())));
  }
  if (opts.query) {
    const q = opts.query.toLowerCase();
    rows = rows.filter((r) => `${r.title} ${r.what} ${r.interests.join(' ')} ${deps.places.get(r.placeId ?? '')?.name ?? ''}`.toLowerCase().includes(q));
  }
  const cards = await Promise.all(rows.map((r) => toRecommendationCard(r, ctx, deps)));
  const composed = opts.maxMinutes ? composeItinerary(cards, { maxMinutes: opts.maxMinutes, interests: opts.interests, kids: opts.kids }) : undefined;
  const items = cards.slice(0, opts.limit ?? 50);
  const sources = dedupeCitations(rows.slice(0, opts.limit ?? 50).map((r) => recommendationCitation(r, ctx)));
  return { items, plan: composed, sources };
}

export async function getRecommendation(ctx: ReadContext, slug: string) {
  const rows = await ctx.db.select().from(recommendations).where(eq(recommendations.slug, slug)).limit(1);
  const row = rows[0];
  if (!row || filterVisible([row], ctx.principal, ctx.surface, ctx.now).length === 0) return undefined;
  const deps = await recommendationDeps(ctx);
  const card = await toRecommendationCard(row, ctx, deps);
  const sources: Citation[] = [recommendationCitation(row, ctx)];
  if (card.why) {
    const memory = deps.memories.get(card.why.experienceId)!;
    sources.push(memoryCitation(memory, ctx));
  }
  return { card, sources: dedupeCitations(sources) };
}

// -------------------------------------------------------------------------------- memories

export function memoryCitation(row: AdventureMemoryRow, ctx: ReadContext): Citation {
  return toRecordCitation(row, { route: `${ROUTES.adventures}/${row.slug}`, title: `Our Adventures › ${row.title}`, recordRef: { type: 'adventure_memories', id: row.id }, now: ctx.now });
}

function dateLabel(row: AdventureMemoryRow) {
  if (row.dateExact) return textBlock(row.dateExact);
  return optionalText(row.dateApprox);
}

export function toAdventureCard(row: AdventureMemoryRow, ctx: ReadContext, placeMap: Map<string, PlaceRow>): AdventureCard {
  const place = row.placeId ? placeMap.get(row.placeId) : undefined;
  const route = `${ROUTES.adventures}/${row.slug}`;
  return {
    id: row.id,
    slug: row.slug,
    href: route,
    title: row.title,
    summary: textBlock(row.summary),
    ...(place ? { placeName: place.name } : {}),
    dateLabel: dateLabel(row),
    ...(row.season ? { season: row.season } : {}),
    ...(row.timeOfDay ? { timeOfDay: row.timeOfDay } : {}),
    tags: row.tags,
    placeholder: row.placeholder,
    visibility: row.visibility,
    provenance: toProvenanceView(row, { route, sources: ctx.sources, now: ctx.now }),
  };
}

export interface ListAdventuresOptions {
  tag?: string;
  season?: AdventureMemoryRow['season'];
  limit?: number;
}

export async function listAdventures(ctx: ReadContext, opts: ListAdventuresOptions = {}) {
  const [rows, placeMap] = await Promise.all([ctx.db.select().from(adventureMemories).orderBy(asc(adventureMemories.title)), visiblePlaces(ctx)]);
  const visible = filterVisible(rows, ctx.principal, ctx.surface, ctx.now).sort((a, b) => {
    // Dated memories first (newest first), then undated ones alphabetically; drafts last.
    const d = (b.dateExact ?? '').localeCompare(a.dateExact ?? '');
    if (d !== 0) return d;
    const p = Number(a.placeholder) - Number(b.placeholder);
    if (p !== 0) return p;
    return a.title.localeCompare(b.title);
  });
  const tags = [...new Set(visible.flatMap((r) => r.tags))].sort();
  const seasons = [...new Set(visible.map((r) => r.season).filter((s): s is NonNullable<typeof s> => !!s))];
  let filtered = visible;
  if (opts.tag) filtered = filtered.filter((r) => r.tags.includes(opts.tag!));
  if (opts.season) filtered = filtered.filter((r) => r.season === opts.season);
  const items = filtered.slice(0, opts.limit ?? 100).map((r) => toAdventureCard(r, ctx, placeMap));
  const sources = dedupeCitations(filtered.slice(0, opts.limit ?? 100).map((r) => memoryCitation(r, ctx)));
  return { items, tags, seasons, total: visible.length, sources };
}

export async function getAdventure(ctx: ReadContext, slug: string): Promise<{ detail: AdventureDetail; sources: Citation[] } | undefined> {
  const rows = await ctx.db.select().from(adventureMemories).where(eq(adventureMemories.slug, slug)).limit(1);
  const row = rows[0];
  if (!row || filterVisible([row], ctx.principal, ctx.surface, ctx.now).length === 0) return undefined;
  const deps = await recommendationDeps(ctx);
  const place = row.placeId ? deps.places.get(row.placeId) : undefined;
  const allRecs = await visibleRecommendations(ctx);
  const relatedRows = allRecs.filter((r) => r.experienceId === row.id || row.relatedRecommendationIds.includes(r.id));
  const related = await Promise.all(relatedRows.map((r) => toRecommendationCard(r, ctx, deps)));
  const card = toAdventureCard(row, ctx, deps.places);
  const detail: AdventureDetail = {
    ...card,
    memory: textBlocks(row.memory),
    saraMemory: optionalText(row.saraMemory),
    tylerMemory: optionalText(row.tylerMemory),
    ...(place ? { place: toPlaceView(place) } : {}),
    locationLabel: optionalText(row.locationLabel),
    durationMinutes: row.durationMinutes,
    accessibilityNotes: optionalText(row.accessibilityNotes),
    media: row.media.map((m) => ({ alt: m.alt, ...(m.caption ? { caption: m.caption } : {}), ...(m.src ? { src: m.src } : {}) })),
    related,
  };
  const sources = dedupeCitations([memoryCitation(row, ctx), ...relatedRows.map((r) => recommendationCitation(r, ctx))]);
  return { detail, sources };
}

// ------------------------------------------------------------------------------ itineraries

export async function toItineraryView(row: ItineraryTemplateRow, ctx: ReadContext, deps: RecommendationDeps, recById: Map<string, RecommendationRow>): Promise<ItineraryView> {
  const stops: ItineraryView['stops'] = [];
  for (const s of row.stops) {
    const rec = recById.get(s.recommendationId);
    if (!rec) continue; // not visible to this principal, or removed
    stops.push({ recommendation: await toRecommendationCard(rec, ctx, deps), ...(s.minutes ? { minutes: s.minutes } : {}), ...(s.note ? { note: s.note } : {}) });
  }
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    bucket: row.bucket,
    intro: optionalText(row.intro),
    minMinutes: row.minMinutes,
    maxMinutes: row.maxMinutes,
    interests: row.interests,
    stops,
    totalMinutes: totalMinutes(stops.map((s) => ({ minutes: s.minutes, durationMinutes: s.recommendation.durationMinutes }))),
    draft: row.draft,
    placeholder: row.placeholder,
    provenance: toProvenanceView(row, { route: `${ROUTES.share}#${row.slug}`, sources: ctx.sources, now: ctx.now }),
  };
}

export async function listItineraries(ctx: ReadContext, opts: { bucket?: ItineraryTemplateRow['bucket'] } = {}) {
  const [rows, deps, recs] = await Promise.all([ctx.db.select().from(itineraryTemplates).orderBy(asc(itineraryTemplates.title)), recommendationDeps(ctx), visibleRecommendations(ctx)]);
  const recById = new Map(recs.map((r) => [r.id, r]));
  const visible = filterVisible(rows, ctx.principal, ctx.surface, ctx.now).filter((r) => !opts.bucket || r.bucket === opts.bucket);
  const order = ['45-min', '2-3-h', 'friday-afternoon', 'saturday-morning', 'with-kids', 'architecture', 'food-drink', 'stay-inside-caa'];
  visible.sort((a, b) => order.indexOf(a.bucket) - order.indexOf(b.bucket));
  const itineraries = await Promise.all(visible.map((r) => toItineraryView(r, ctx, deps, recById)));
  const sources = dedupeCitations(
    visible.map((r) => toRecordCitation(r, { route: `${ROUTES.share}#${r.slug}`, title: `Share an Adventure › ${r.title}`, recordRef: { type: 'itinerary_templates', id: r.id }, now: ctx.now })),
  );
  return { itineraries, sources };
}

export { isValidAt };
