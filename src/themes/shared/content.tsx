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
  story: { eyebrow: 'Our Story', lede: 'From a friend’s wedding to our own, these are the moments that brought us here.', next: 'Keep going', nextLink: 'Wander through our adventures' },
  adventures: {
    eyebrow: 'Our Adventures',
    title: 'The places that shaped us',
    lede: 'A growing archive of the experiences and memories behind this wedding. Some are still being written.',
    filter: 'Filter adventures',
    empty: 'Nothing matches that filter yet. More adventures are being written.',
    borrow: 'Borrow a few for your weekend on',
    atlas: {
      eyebrow: 'The atlas',
      title: 'Everywhere it has taken us',
      pinned: (pinned: number, total: number) =>
        pinned === 0 ? 'No adventures are pinned yet. The map fills in as we add them.' : `${pinned} of ${total} ${total === 1 ? 'adventure is' : 'adventures are'} on the map so far. It opens on Chicago around the venue; zoom out, or choose the globe, for everywhere else. Choose a pin to read about it, or find it in the list below.`,
      keyPin: 'An adventure, numbered as in the list',
      keyCluster: 'Several close together: choose it to zoom in',
      keyVenue: 'Where we are getting married',
      open: 'Read the whole adventure',
      close: 'Back to the whole map',
      counts: (photos: number, paragraphs: number) =>
        photos || paragraphs
          ? [paragraphs ? `${paragraphs} ${paragraphs === 1 ? 'journal page' : 'journal pages'}` : '', photos ? `${photos} ${photos === 1 ? 'photograph' : 'photographs'}` : ''].filter(Boolean).join(' · ')
          : 'Photographs and journal pages are still to come.',
      venueEyebrow: 'Where it all leads',
      venueMore: 'See our venue',
    },
  },
  adventureDetail: {
    memory: 'The memory',
    share: 'Make it yours',
    shareLede: 'If you have the time, here is how to go there yourself. Open "Why we’re sharing this" on any card for the memory behind it.',
    notWritten: 'this memory has not been written yet.',
    back: 'All adventures',
  },
  guide: {
    eyebrow: 'Explore Chicago',
    title: 'Things to Do in Chicago',
    lede: 'We’re so excited to share one of our favorite cities with you! We’ve gathered places that are special to us and things we love doing together, from great food and beautiful parks to architecture and unique experiences.',
    jump: 'On this page',
    time: 'Pick your time',
    filter: 'Itineraries by time and interest',
    plan: 'Plan around the time you have',
    minutes: 'How much time do you have?',
    mood: 'What are you in the mood for?',
    kids: 'We have kids with us',
    suggest: 'Suggest a plan',
    nothing: 'Nothing fits that combination yet. Try more time or a different mood.',
    draftNote: 'Places without a listed visit length use a 45-minute planning estimate. Travel and waiting time are not included; check hours and reservations before heading out.',
    all: 'All the places',
    hours: 'Hours, menus, and reservation links for the hotel’s own places live on',
    hoursTail: ', each with the day we last checked it.',
    back: 'All recommendations and itineraries',
  },
  ourVenue: {
    eyebrow: 'Our Venue',
    building: 'The building',
    spaces: 'The spaces',
    lookFor: 'Look for this',
    lookForLede: 'A self-guided list for the hour before things start. The rooms have their own lists on their pages.',
    outlets: 'Eat and drink without leaving',
    outletsLede: 'These are the hotel’s own places as listed on its website. Hours and menus change, so each link shows the day we last checked it; confirm with the official page before you plan around it.',
    gettingHere: 'Getting here, parking, accessibility',
    directions: 'Directions are on',
    wholeBuilding: 'Back to our venue',
    roomLookFor: 'Look for this',
    roomFeatures: 'What is in the room',
    roomCapacity: 'Capacity, in the venue’s own figures',
  },
  wedding: {
    welcome: "We can’t wait to celebrate with you! The people in our lives have helped shape who we are, and sharing this special day with you means so much to us. We hope it’s a day filled with love, peace, and happiness.",
    together: 'Our ceremony, cocktail hour, and reception will all take place at the Chicago Athletic Association, so you can settle in and enjoy the celebration from beginning to end. We’ll continue adding details as our plans come together.',
    unplugged: 'We invite you to be fully present with us during our ceremony by putting away your phones and cameras. We’d love for you to share this special moment with us, distraction-free, while our photographer captures the memories.',
    eyebrow: 'The Wedding', title: 'The Wedding', dress: 'What to wear', rooms: 'About the rooms', roomsLink: 'Our venue and its four spaces' },
  ask: {
    eyebrow: 'Ask Us',
    title: 'Questions, answered',
    lede: 'We’re so excited to celebrate with you! Here are a few helpful details as you plan for our wedding. We’ll update this page as the day gets closer.',
    search: 'Search the site',
    searchLabel: 'What are you looking for?',
    searchHint: 'valet, kids, Cindy’s, dress code',
    searchButton: 'Search',
    none: 'We don’t have that information yet. The questions below cover the basics;',
    noneTail: 'for anything else.',
    reach: 'reach us',
    faq: 'Frequently asked',
    concierge: 'Ask a question',
    // Shown only when AI_CONCIERGE is off. The live invitation copy lives with the island itself
    // (src/components/concierge/ConciergeSlot.tsx), which is what a guest reads when it is on.
    conciergeNote: 'The concierge is not switched on right now. The search above and the questions below cover the essentials.',
    /** Conservatory's kraft tag on the concierge card: descriptive when live, 'Soon' when off. */
    conciergeTag: 'In your own words',
    conciergeTagOff: 'Soon',
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

/**
 * Three recommendation categories share their wording with an itinerary title ("Food and drink",
 * "With kids", "Stay inside the CAA"), so a category heading carries its count. That makes every
 * heading on the page unique and tells a guest how much is in the group before they scroll into it.
 */
export function categoryHeading(category: string, count: number): string {
  return `${humanize(category)} · ${count} ${count === 1 ? 'place' : 'places'}`;
}

/** The in-page jump list for the guide: the long page's only way to reach a group without scrolling. */
export function guideJumpItems(groups: [string, RecommendationCard[]][]): ChipItem[] {
  return [
    { href: '#itineraries', label: CONTENT_COPY.guide.time },
    { href: '#plan', label: CONTENT_COPY.guide.plan },
    ...groups.map(([category, items]) => ({ href: `#category-${category}`, label: categoryHeading(category, items.length) })),
  ];
}

export function handoffList(handoffs: RecommendationCard['handoffs']): HandoffView[] {
  return [handoffs.directions, handoffs.booking, handoffs.official].filter((h): h is HandoffView => !!h);
}

/** Anchor attributes for an explicit external handoff (new tab, no referrer, marked external). */
export function handoffAttrs(h: HandoffView): { href: string; target?: '_blank'; rel: string } {
  return { href: h.url, target: h.opensNewTab ? '_blank' : undefined, rel: 'noopener noreferrer external' };
}

export const OFFICIAL_LINK_ATTRS = { rel: 'noopener noreferrer external', target: '_blank' } as const;

/** Display name for a handoff provider slug ("google-maps" -> "Google Maps"), never the slug itself. */
const PROVIDER_NAMES: Record<string, string> = {
  'google-maps': 'Google Maps',
  'apple-maps': 'Apple Maps',
  'official-site': 'the official site',
  opentable: 'OpenTable',
  resy: 'Resy',
  tock: 'Tock',
  uber: 'Uber',
  lyft: 'Lyft',
};

export function providerLabel(provider: string): string {
  return PROVIDER_NAMES[provider] ?? humanize(provider);
}

/**
 * Where a bare URL goes, named for a guest: the registrable host without `www.`. Used when a link
 * has no provider of its own, so "opens in a new site" never has to stand alone.
 */
export function destinationLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'the official page';
  }
}

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
    [ROUTES.ourVenue]: 'Our Venue',
    [ROUTES.photos]: 'Photos & Video',
    [ROUTES.travel]: 'Travel & Stay',
    [ROUTES.gifts]: 'Gifts',
    '/rsvp': 'RSVP',
  };
  return known[base] ?? 'the page';
}
