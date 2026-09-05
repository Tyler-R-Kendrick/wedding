import type { FindAdventuresData } from '@/capabilities/find_adventures';
import type { ItinerariesData } from '@/capabilities/list_itineraries';
import type { AdventuresPageData } from '@/capabilities/list_adventures';
import type { StoryChapter } from '@/db/schema/content';
import { formatMinutes } from '@/domain/adventures/itineraries';
import { humanize } from '@/domain/content/format';
import type { AdventureDetail, HandoffView, RecommendationCard, RecommendationSummary } from '@/domain/content/views';
import { ROUTES } from '@/domain/routes';
import type { ChipItem, StopItem } from '@/themes/content-types';

/*
 * Theme-agnostic helpers for the content recipes: copy, filter models, handoff attributes.
 * Nothing here knows a class name; both themes compose these into their own markup.
 */

/** Guest-facing copy shared by both themes (from the placeholder recipes, the content brief's voice). */
export const CONTENT_COPY = {
  story: { eyebrow: 'Our Story', lede: 'How we met, what this is, and where it is going. Short on purpose; the long version lives in Our Adventures.', next: 'Keep going', nextLink: 'Wander through our adventures' },
  adventures: {
    eyebrow: 'Our Adventures',
    title: 'The places that shaped us',
    lede: 'A growing archive of the experiences and memories behind this wedding. Some are still being written.',
    filter: 'Filter adventures',
    empty: 'Nothing matches that filter yet. More adventures are being written.',
    borrow: 'Borrow a few for your weekend on',
  },
  adventureDetail: {
    memory: 'The memory',
    share: 'Make it yours',
    shareLede: 'If you have the time, here is how to go there yourself. Open "Why we’re sharing this" on any card for the memory behind it.',
    notWritten: 'this memory has not been written yet.',
    back: 'All adventures',
  },
  guide: {
    eyebrow: 'Share an Adventure',
    title: 'Borrow a few of ours',
    lede: 'Every card has the practical part first: what, where, how long, and how to get there. Open the memory behind it if you want to know why it matters to us.',
    time: 'Pick your time',
    filter: 'Itineraries by time and interest',
    plan: 'Plan around the time you have',
    minutes: 'How much time do you have?',
    mood: 'What are you in the mood for?',
    kids: 'We have kids with us',
    suggest: 'Suggest a plan',
    nothing: 'Nothing fits that combination yet. Try more time or a different mood.',
    draftNote: 'Everything here is a draft until we have curated it.',
    all: 'All the places',
    hours: 'Hours, menus, and reservation links for the hotel’s own places live on',
    hoursTail: ', each with the day we last checked it.',
    back: 'All recommendations and itineraries',
  },
  exploreCaa: {
    eyebrow: 'Explore CAA',
    building: 'The building',
    spaces: 'The spaces',
    lookFor: 'Look for this',
    lookForLede: 'A self-guided list for the hour before things start. The rooms have their own lists on their pages.',
    outlets: 'Eat and drink without leaving',
    outletsLede: 'These are the hotel’s own places as listed on its website. Hours and menus change, so each link shows the day we last checked it; confirm with the official page before you plan around it.',
    gettingHere: 'Getting here, parking, accessibility',
    directions: 'Directions are on',
    wholeBuilding: 'Explore the whole building',
    roomLookFor: 'Look for this',
    roomFeatures: 'What is in the room',
    roomCapacity: 'Capacity (from the venue kit)',
  },
  wedding: { eyebrow: 'The Wedding', title: 'The Wedding', dress: 'What to wear', rooms: 'About the rooms', roomsLink: 'Explore the building and its four spaces' },
  ask: {
    eyebrow: 'Ask Us',
    title: 'Questions, answered',
    lede: 'The essentials first. Anything we have not decided yet says so, instead of guessing.',
    search: 'Search the site',
    searchLabel: 'What are you looking for?',
    searchHint: 'valet, kids, Cindy’s, dress code',
    searchButton: 'Search',
    none: 'We don’t have that information yet. The questions below cover the basics;',
    noneTail: 'for anything else.',
    reach: 'reach us',
    faq: 'Frequently asked',
    concierge: 'Ask a question',
    conciergeNote: 'The concierge is on its way. It will answer only from what this site knows, with a source for every fact, and it will say when it does not know.',
  },
  flags: { draft: 'Draft — not yet curated', placeholder: 'Details to come' },
  why: { summary: 'Why we’re sharing this', read: 'Read the memory' },
} as const;

export const MINUTE_OPTIONS = [45, 120, 180, 300] as const;
export const INTEREST_OPTIONS = ['architecture', 'walk', 'food', 'drink', 'outdoors', 'inside-caa'] as const;

const CHAPTER_LABEL: Record<StoryChapter, string> = {
  met: 'Meeting',
  connection: 'Connection',
  relationship: 'Together',
  love: 'Love',
  future: 'Ahead',
  engagement: 'Engagement',
  marriage: 'Marriage',
};

export function chapterLabel(chapter: StoryChapter): string {
  return CHAPTER_LABEL[chapter] ?? humanize(chapter);
}

export function adventureChips(data: AdventuresPageData, active: { tag?: string; season?: string }): ChipItem[] {
  return [
    { href: ROUTES.adventures, label: 'All', active: !active.tag && !active.season },
    ...data.tags.map((t) => ({ href: `${ROUTES.adventures}?tag=${t}`, label: humanize(t), active: active.tag === t })),
    ...data.seasons.map((s) => ({ href: `${ROUTES.adventures}?season=${s}`, label: humanize(s), active: active.season === s })),
  ];
}

export function itineraryChips(data: ItinerariesData, activeBucket?: string): ChipItem[] {
  return [{ href: ROUTES.share, label: 'All', active: !activeBucket }, ...data.buckets.map((b) => ({ href: `${ROUTES.share}?bucket=${b}`, label: humanize(b), active: activeBucket === b }))];
}

export function groupByCategory(items: FindAdventuresData['items']): [string, RecommendationCard[]][] {
  const by = new Map<string, RecommendationCard[]>();
  for (const r of items) by.set(r.category, [...(by.get(r.category) ?? []), r]);
  return [...by.entries()];
}

export function handoffList(handoffs: RecommendationCard['handoffs']): HandoffView[] {
  return [handoffs.directions, handoffs.booking, handoffs.official].filter((h): h is HandoffView => !!h);
}

/** Anchor attributes for an explicit external handoff (new tab, no referrer, marked external). */
export function handoffAttrs(h: HandoffView): { href: string; target?: '_blank'; rel: string } {
  return { href: h.url, target: h.opensNewTab ? '_blank' : undefined, rel: 'noopener noreferrer external' };
}

export const OFFICIAL_LINK_ATTRS = { rel: 'noopener noreferrer external', target: '_blank' } as const;

/** Compact stop line text pieces: place · minutes · note. */
export function stopMeta(stop: StopItem): string[] {
  const r: RecommendationSummary = stop.recommendation;
  const minutes = stop.minutes ?? r.durationMinutes;
  return [r.placeName, minutes ? formatMinutes(minutes) : undefined, stop.note].filter((x): x is string => !!x);
}

export function planTitle(plan: { minutes: number; kids: boolean; interest?: string }): string {
  return `A ${formatMinutes(plan.minutes)} plan${plan.interest ? ` for ${humanize(plan.interest).toLowerCase()}` : ''}${plan.kids ? ', with kids' : ''}`;
}

/** The facts under an adventure title (Where / When / Season / How long / Motifs). */
export function adventureFacts(data: AdventureDetail): { label: string; value: string | { block: AdventureDetail['summary'] } }[] {
  const out: { label: string; value: string | { block: AdventureDetail['summary'] } }[] = [];
  if (data.place) out.push({ label: 'Where', value: [data.place.name, data.place.city, data.place.region].filter(Boolean).join(', ') });
  if (data.locationLabel) out.push({ label: 'Where', value: { block: data.locationLabel } });
  if (data.dateLabel) out.push({ label: 'When', value: { block: data.dateLabel } });
  if (data.season) out.push({ label: 'Season', value: humanize(data.season) });
  if (data.durationMinutes) out.push({ label: 'How long', value: formatMinutes(data.durationMinutes) });
  if (data.tags.length) out.push({ label: 'Motifs', value: data.tags.map(humanize).join(', ') });
  return out;
}

export function labelForRoute(route: string): string {
  const base = route.split('#')[0] ?? route;
  const known: Record<string, string> = {
    [ROUTES.wedding]: 'The Wedding',
    [ROUTES.exploreCaa]: 'Explore CAA',
    [ROUTES.photos]: 'Photos & Video',
    [ROUTES.travel]: 'Travel & Stay',
    [ROUTES.gifts]: 'Gifts',
    '/rsvp': 'RSVP',
  };
  return known[base] ?? 'the page';
}
