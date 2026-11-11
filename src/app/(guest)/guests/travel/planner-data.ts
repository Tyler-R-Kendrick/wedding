import 'server-only';
import { findAdventures } from '@/capabilities/find_adventures';
import { listMyEvents } from '@/capabilities/rsvp';
import { getMyTrip } from '@/capabilities/travel';
import type { Principal } from '@/contracts/principal';
import type { RecommendationCard } from '@/domain/content/views';
import { placePhoto } from '@/domain/media/place-photos';
import { VENUE } from '@/domain/travel/facts';
import type { Day, Part, PlannerPlace, TripItemInput, WeddingEventInput } from '@/domain/trip-planner';
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
  /** Whether the weekend can be saved as the guest's trip items (a signed-in guest, not a preview). */
  persist: boolean;
};

const DAYS: readonly Day[] = ['fri', 'sat', 'sun'];
const PARTS: readonly Part[] = ['morning', 'afternoon', 'evening'];
const text = (block: { text: string; placeholder: boolean } | undefined) => (block && !block.placeholder && block.text.trim() ? block.text.trim() : undefined);

/** One of our recommendations as the planner reads it. Drafts and unfinished ones are not offered. */
export function toPlannerPlace(card: RecommendationCard): PlannerPlace | null {
  const what = text(card.what);
  if (card.draft || card.placeholder || !what) return null;
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

export async function loadPlanner(principal: Principal): Promise<PlannerData> {
  const isGuest = principal.kind === 'guest';
  const [all, trip, myEvents] = await Promise.all([
    runAsUi(findAdventures, {}),
    isGuest ? runAsUi(getMyTrip, {}) : Promise.resolve(null),
    isGuest ? runAsUi(listMyEvents, {}) : Promise.resolve(null),
  ]);
  const cards = all.ok ? all.value.data.items : [];
  const places = cards.map(toPlannerPlace).filter((p): p is PlannerPlace => !!p);
  // The hotel on the map is the place our own records put the wedding venue at.
  const venue = cards.find((c) => c.place?.insideVenue && c.place.coordinates)?.place?.coordinates;
  const items = trip?.ok ? trip.value.data.items : [];
  const saved: PlannerSaved[] = items.flatMap((i) => {
    const d = i.details;
    if (i.provider !== 'planner' || i.status === 'cancelled' || !d.placeId || !d.day || !d.part) return [];
    if (!DAYS.includes(d.day) || !PARTS.includes(d.part)) return [];
    return [{ id: d.placeId, day: d.day, part: d.part, name: i.title, itemId: i.id }];
  });
  const bookings: TripItemInput[] = items
    .filter((i) => i.provider !== 'planner' && i.status !== 'cancelled' && (i.kind === 'flight' || i.kind === 'hotel'))
    .map((i) => ({ id: i.id, kind: i.kind, status: i.status, title: i.title, startAt: i.startAt, endAt: i.endAt, provider: i.provider }));
  const events: WeddingEventInput[] = myEvents?.ok
    ? myEvents.value.data.events.map((e) => ({ id: e.id, name: e.name, dateIso: e.dateIso, startsAt: e.startsAt, endsAt: e.endsAt, description: e.description }))
    : [];
  return {
    places,
    saved,
    bookings,
    events,
    hotel: venue ? { name: VENUE.name, lat: venue.lat, lng: venue.lng } : null,
    persist: isGuest && !principal.viewedBy?.readOnly,
  };
}
