import type { HotelRecommendation, TravelLink } from '@/domain/travel';
import { assertAllowedRedirect } from '@/lib/redirects';

/*
 * Shared by the page (a server component, for its one-click Show/Hide and Up/Down) and the flows
 * (client components). Both save through a capability that replaces the whole record, so a one-click
 * change has to send the record back as it is, with only the changed field different.
 */

/** A hotel as `admin_save_hotel` takes it, with `patch` applied. Keeps `verifiedAt`: hiding a hotel is not re-checking it. */
export function hotelInput(h: HotelRecommendation, patch: Partial<Pick<HotelRecommendation, 'active' | 'sortOrder'>> = {}) {
  return {
    id: h.id,
    name: h.name,
    address: h.address,
    isVenue: h.isVenue,
    sortOrder: h.sortOrder,
    reasons: h.reasons,
    priceBand: h.priceBand,
    walkMinutesToVenue: h.walkMinutesToVenue,
    websiteUrl: h.websiteUrl,
    bookingUrl: h.bookingUrl,
    block: h.block,
    placeholder: h.placeholder,
    active: h.active,
    sourceId: h.sourceId,
    verifiedAt: h.verifiedAt,
    ...patch,
  };
}

/** A partner link as `admin_save_travel_link` takes it, with `patch` applied. */
export function linkInput(l: TravelLink, patch: Partial<Pick<TravelLink, 'active' | 'sortOrder'>> = {}) {
  return { id: l.id, category: l.category, provider: l.provider, label: l.label, url: l.url, note: l.note, sortOrder: l.sortOrder, active: l.active, ...patch };
}

/**
 * The two saves that swap a row with its neighbour. Rows that share a sort number (every row starts
 * at 100) are nudged one apart, so the swap always changes the order guests see.
 */
export function swapOrder<T extends { sortOrder: number }>(row: T, other: T, before: boolean, input: (r: T, patch: { sortOrder: number }) => unknown, capability: string) {
  const mine = other.sortOrder === row.sortOrder ? Math.max(0, other.sortOrder + (before ? -1 : 1)) : other.sortOrder;
  return [
    { capability, input: input(row, { sortOrder: mine }) },
    { capability, input: input(other, { sortOrder: row.sortOrder }) },
  ];
}

/**
 * The same trusted-partner check the save runs, done on the step where the link was typed so the fix
 * is said there. The save checks again; this only saves a round trip.
 */
export function checkLink(raw: string, allowedHosts: string[]): { ok: true; url: string; host: string } | { ok: false; message: string } {
  const r = assertAllowedRedirect(raw.trim());
  if (r.ok) return { ok: true, url: r.value.toString(), host: r.value.hostname.replace(/^www\./, '') };
  if (r.error.code === 'forbidden' && /trusted partners/.test(r.error.message)) {
    return { ok: false, message: `This site only links to trusted partners, and that address is not one of them. It can point at: ${allowedHosts.join(', ')}.` };
  }
  return { ok: false, message: r.error.message };
}

/** The partner-link categories in words. Shared with the page, which is a server component. */
export const LINK_CATEGORIES = [
  { value: 'airline', label: 'Airline', description: 'Flights on one airline.' },
  { value: 'ota', label: 'Booking site', description: 'A site that compares flights or hotels, such as Skyscanner or Booking.com.' },
  { value: 'hotel', label: 'Hotel', description: 'A hotel’s own booking page.' },
  { value: 'transit', label: 'Getting around', description: 'Trains, the L, airport transfers.' },
  { value: 'other', label: 'Something else', description: '' },
];
export const categoryLabel = (c: string) => LINK_CATEGORIES.find((x) => x.value === c)?.label ?? c;
