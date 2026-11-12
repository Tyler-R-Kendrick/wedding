import 'server-only';
import { findAdventures } from '@/capabilities/find_adventures';
import { listItineraries } from '@/capabilities/list_itineraries';
import { listMyEvents } from '@/capabilities/rsvp';
import { getMyTrip, getMyTripProfile } from '@/capabilities/travel';
import type { Principal } from '@/contracts/principal';
import { withoutPlaceholders } from '@/domain/content/text';
import type { ItineraryView, RecommendationCard } from '@/domain/content/views';
import { placePhoto } from '@/domain/media/place-photos';
import { VENUE_SPACES } from '@/domain/seating/plans';
import { VENUE } from '@/domain/travel/facts';
import type { TripItem } from '@/domain/travel/types';
import { withPriceGuesses, type Day, type Part, type PlaceFacts, type PlannerItinerary, type PlannerPlace, type TripItemInput, type WeddingEventInput } from '@/domain/trip-planner';
import { profileOf, type TripPrefs, type TripProfile } from '@/domain/trip-planner/profile';
import type { MyEvents } from '@/capabilities/rsvp/list_my_events';
import type { TripHotel } from '@/components/trip/openui';
import type { PlannerSaved } from '@/components/trip/TripPlanner';
import { runAsUi } from './_shared/server';

/**
 * What the planner on Your Trip starts from, as plain props for the client: the couple's places,
 * the guest's saved weekend and bookings, and the wedding's events. Read through the same
 * capabilities the rest of the site uses; a read that fails leaves its part empty rather than
 * failing the page, because the room block above it must always render.
 */
export type PlannerData = {
  places: PlannerPlace[];
  saved: PlannerSaved[];
  bookings: TripItemInput[];
  events: WeddingEventInput[];
  hotel: TripHotel | null;
  /** The couple's own itineraries this guest may see, the planner's first answer when one fits. */
  itineraries: PlannerItinerary[];
  /** Whether the weekend can be saved as the guest's trip items (a signed-in guest, not a preview). */
  persist: boolean;
  /**
   * Who the planner plans for: the guest's party as their invitation and RSVP have it, with what
   * they set for themselves. Someone who is not a guest (an administrator looking in) gets the
   * plain profile of one adult.
   */
  profile: TripProfile;
  /** What the guest saved for themselves, and when, so a later save can tell if another device changed it. */
  prefs: { value: TripPrefs | null; updatedAt: string | null };
};

const DAYS: readonly Day[] = ['fri', 'sat', 'sun'];
const PARTS: readonly Part[] = ['morning', 'afternoon', 'evening'];
const text = (block: { text: string; placeholder: boolean } | undefined) => (block && !block.placeholder && block.text.trim() ? block.text.trim() : undefined);

/**
 * What the couple's record says a guest weighs before going: the card's own facts, plus its cost
 * and access notes once they are settled text. `undefined` when the record holds none.
 */
function plannerFacts(card: RecommendationCard): PlaceFacts | undefined {
  const cost = text(card.cost);
  const access = text(card.accessibility);
  const facts: PlaceFacts = { ...card.facts, ...(cost ? { cost } : {}), ...(access ? { access } : {}) };
  return Object.keys(facts).length ? facts : undefined;
}

/** One of our recommendations as the planner reads it. Drafts and unfinished ones are not offered. */
export function toPlannerPlace(card: RecommendationCard): PlannerPlace | null {
  const what = text(card.what);
  if (card.draft || card.placeholder || !what) return null;
  const facts = plannerFacts(card);
  const why = text(card.why?.text);
  const address = text(card.place?.address);
  const at = card.place?.coordinates;
  // A licensed photograph of this place, if the ledger has one (keyed by the recommendation's slug).
  // None is the honest default: no generic stand-in. The credit rides along for CC BY / BY-SA.
  const photo = placePhoto(card.slug);
  return {
    id: card.slug,
    slug: card.slug,
    name: card.title,
    category: card.category,
    interests: card.interests,
    what,
    ...(why ? { why } : {}),
    ...(card.durationMinutes ? { minutes: card.durationMinutes } : {}),
    ...(typeof card.kidFriendly === 'boolean' ? { kidFriendly: card.kidFriendly } : {}),
    ...(facts ? { facts } : {}),
    ...(address ? { address } : {}),
    ...(at ? { lat: at.lat, lng: at.lng } : {}),
    href: card.href,
    ...(photo
      ? {
          image: {
            src: photo.src,
            alt: photo.alt,
            ...(photo.credit && photo.creditUrl && photo.licenseUrl
              ? { credit: { text: photo.credit, href: photo.creditUrl, license: { name: photo.license, href: photo.licenseUrl } } }
              : {}),
          },
        }
      : {}),
  };
}

/**
 * One of the couple's itineraries as the planner reads it. A draft is one the couple have not
 * curated yet (list_itineraries says so), so, like a draft place, it is not offered. A stop the
 * planner cannot offer (a draft or unfinished place) is left out; a TODO sentence in the intro is
 * dropped and the settled ones kept. An itinerary left with neither stops nor words is not offered.
 */
export function toPlannerItinerary(view: ItineraryView, placeIds: ReadonlySet<string>): PlannerItinerary | null {
  if (view.draft) return null;
  const intro = view.intro ? withoutPlaceholders([view.intro.text]).join(' ').trim() : '';
  const stops = view.stops
    .filter((s) => placeIds.has(s.recommendation.slug))
    .map((s) => ({ placeId: s.recommendation.slug, ...(s.minutes ? { minutes: s.minutes } : {}) }));
  if (!stops.length && !intro) return null;
  return {
    slug: view.slug,
    title: view.title,
    intro,
    bucket: view.bucket,
    ...(view.minMinutes !== null ? { minMinutes: view.minMinutes } : {}),
    ...(view.maxMinutes !== null ? { maxMinutes: view.maxMinutes } : {}),
    interests: view.interests,
    stops,
  };
}

/** Settled sentences only: a sentence that still carries the authoring marker is a note to the couple, not a fact. */
const settled = (v: string | null | undefined): string | null => withoutPlaceholders([v]).join(' ').trim() || null;

/**
 * One of the wedding's events as the planner reads it, from the guest's invitation. Times, room,
 * dress code and access note are the couple's own fields and flow through as they set them.
 *
 * The description is the one free-text field `list_my_events` has already scrubbed of the marker
 * (`toEventView` keeps the hint's words so an assistant can say what is still to come), which leaves
 * a hint such as "what happens, and what to expect." looking like a fact. So it is offered only
 * once the couple have marked the event's details as confirmed; while `placeholder` is set it is
 * not shown, on the page or in the calendar file.
 */
export function toWeddingEvent(e: MyEvents['events'][number]): WeddingEventInput {
  const room = e.venueSpaceRef ? (VENUE_SPACES.find((s) => s.ref === e.venueSpaceRef)?.name ?? e.venueSpaceRef.replace(/-/g, ' ')) : null;
  const description = e.placeholder ? null : settled(e.description);
  const dressCode = settled(e.dressCode);
  const accessibilityNote = settled(e.accessibilityNote);
  return {
    id: e.id,
    name: e.name,
    dateIso: e.dateIso,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    ...(description ? { description } : {}),
    ...(room ? { room } : {}),
    // The wedding is at the hotel (our venue); the room, once it is chosen, comes first.
    location: [room, VENUE.name, VENUE.address].filter(Boolean).join(', '),
    ...(dressCode ? { dressCode } : {}),
    ...(accessibilityNote ? { accessibilityNote } : {}),
    ...(e.placeholder ? { unconfirmed: true } : {}),
  };
}

/** The guest's plans as the planner shows them: their trip items that the planner itself saved. */
function savedOf(items: readonly TripItem[]): PlannerSaved[] {
  // One card per place: a place saved twice over (before saves were keyed on the place) shows once.
  const seen = new Set<string>();
  return items.flatMap((i) => {
    const d = i.details;
    if (i.provider !== 'planner' || i.status === 'cancelled' || !d.day || !d.part) return [];
    if (!DAYS.includes(d.day) || !PARTS.includes(d.part)) return [];
    // A plan for a day before or after the weekend keeps that day's own date.
    const date = typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : undefined;
    // The guest's own plan ("Dinner with family"): no place of ours behind it, keyed by its own item.
    if (!d.placeId) return [{ id: `own:${i.id}`, day: d.day, part: d.part, ...(date ? { date } : {}), name: i.title, itemId: i.id, own: true }];
    if (seen.has(d.placeId)) return [];
    seen.add(d.placeId);
    return [{ id: d.placeId, day: d.day, part: d.part, ...(date ? { date } : {}), name: i.title, itemId: i.id }];
  });
}

/** The guest's plans as they are saved right now, for a page that has been open a while. Null when they cannot be read. */
export async function loadPlannerSaved(): Promise<PlannerSaved[] | null> {
  const trip = await runAsUi(getMyTrip, {});
  return trip.ok ? savedOf(trip.value.data.items) : null;
}

export async function loadPlanner(principal: Principal): Promise<PlannerData> {
  const isGuest = principal.kind === 'guest';
  // Read beside the others, not after them.
  const itinerariesRead = runAsUi(listItineraries, {});
  const [all, trip, myEvents, mine] = await Promise.all([
    runAsUi(findAdventures, {}),
    isGuest ? runAsUi(getMyTrip, {}) : Promise.resolve(null),
    isGuest ? runAsUi(listMyEvents, {}) : Promise.resolve(null),
    isGuest ? runAsUi(getMyTripProfile, {}) : Promise.resolve(null),
  ]);
  const plans = await itinerariesRead;
  const cards = all.ok ? all.value.data.items : [];
  // A place to eat with no checked price gets our guess at one, where it says enough to guess from.
  const places = withPriceGuesses(cards.map(toPlannerPlace).filter((p): p is PlannerPlace => !!p));
  // The hotel on the map is the place our own records put the wedding venue at.
  // (The seed marks the hotel itself as the `venue` place; places inside it carry `insideVenue`.)
  const venue = cards.find((c) => (c.place?.insideVenue || c.place?.kind === 'venue') && c.place.coordinates)?.place?.coordinates;
  const items = trip?.ok ? trip.value.data.items : [];
  const saved = savedOf(items);
  const bookings: TripItemInput[] = items
    .filter((i) => i.provider !== 'planner' && i.status !== 'cancelled' && (i.kind === 'flight' || i.kind === 'hotel'))
    .map((i) => ({ id: i.id, kind: i.kind, status: i.status, title: i.title, startAt: i.startAt, endAt: i.endAt, provider: i.provider, providerRef: i.providerRef, hotelName: i.details.hotelName ?? null }));
  const events: WeddingEventInput[] = myEvents?.ok ? myEvents.value.data.events.map(toWeddingEvent) : [];
  return {
    places,
    saved,
    bookings,
    events,
    hotel: venue ? { name: VENUE.name, lat: venue.lat, lng: venue.lng } : null,
    itineraries: plans.ok ? plans.value.data.itineraries.flatMap((v) => toPlannerItinerary(v, new Set(places.map((p) => p.id))) ?? []) : [],
    persist: isGuest && !principal.viewedBy?.readOnly,
    // A read that fails leaves the plain profile: the planner still answers, only less personally.
    profile: mine?.ok ? mine.value.data.profile : profileOf(null, null),
    prefs: mine?.ok ? { value: mine.value.data.prefs, updatedAt: mine.value.data.updatedAt } : { value: null, updatedAt: null },
  };
}
