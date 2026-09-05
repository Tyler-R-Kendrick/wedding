import type { ExternalHandoff } from '@/contracts/providers';
import type { HotelSearchRequest } from './types';

export const VENUE_HOTEL_URL = 'https://www.chicagoathletichotel.com/';

/**
 * Search centre for live hotel adapters: the Loop around the venue (12 S Michigan Ave).
 * Approximate, used only as a radius origin, never shown to guests.
 */
export const VENUE_SEARCH_CENTER = { latitude: 41.8817, longitude: -87.6245, radiusKm: 2 } as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Dates and counts are validated by capability schemas first; this guards the URL builders themselves. */
export function assertHotelSearchRequest(req: HotelSearchRequest): void {
  if (!DATE.test(req.checkIn) || !DATE.test(req.checkOut)) throw new RangeError('hotels: dates must be YYYY-MM-DD');
  if (req.checkOut <= req.checkIn) throw new RangeError('hotels: checkOut must be after checkIn');
  if (!Number.isInteger(req.adults) || req.adults < 1 || req.adults > 9) throw new RangeError('hotels: adults must be 1-9');
  if (req.children !== undefined && (!Number.isInteger(req.children) || req.children < 0 || req.children > 9)) throw new RangeError('hotels: children must be 0-9');
  if (req.rooms !== undefined && (!Number.isInteger(req.rooms) || req.rooms < 1 || req.rooms > 9)) throw new RangeError('hotels: rooms must be 1-9');
}

export function bookingComUrl(req: HotelSearchRequest): string {
  assertHotelSearchRequest(req);
  const params = new URLSearchParams({
    ss: req.area ?? 'Chicago Loop, Chicago, Illinois',
    checkin: req.checkIn,
    checkout: req.checkOut,
    group_adults: String(req.adults),
    group_children: String(req.children ?? 0),
    no_rooms: String(req.rooms ?? 1),
  });
  return `https://www.booking.com/searchresults.html?${params.toString()}`;
}

/**
 * Hyatt search deep link. With a property code (admin-configured; the CAA's code is
 * `TODO(Tyler & Sara)` until the planner confirms it) the link opens that hotel's rooms;
 * without one it opens a Chicago search for the dates.
 */
export function hyattSearchUrl(req: HotelSearchRequest, opts: { propertyCode?: string } = {}): string {
  assertHotelSearchRequest(req);
  const params = new URLSearchParams({ checkinDate: req.checkIn, checkoutDate: req.checkOut, rooms: String(req.rooms ?? 1), adults: String(req.adults), kids: String(req.children ?? 0) });
  if (opts.propertyCode) {
    if (!/^[a-z0-9]{3,12}$/i.test(opts.propertyCode)) throw new RangeError('hotels: hyatt property code must be alphanumeric');
    return `https://www.hyatt.com/shop/rooms/${opts.propertyCode.toLowerCase()}?${params.toString()}`;
  }
  return `https://www.hyatt.com/search/${encodeURIComponent('Chicago, IL')}?${params.toString()}`;
}

export function hotelsHandoff(req: HotelSearchRequest): ExternalHandoff {
  return {
    provider: 'booking.com',
    label: 'Continue on Booking.com',
    url: bookingComUrl(req),
    opensNewTab: true,
    disclosure: 'You will leave our site to compare and book hotels with Booking.com. We never see your payment details.',
  };
}

export function hyattHandoff(req: HotelSearchRequest, opts: { propertyCode?: string } = {}): ExternalHandoff {
  return {
    provider: 'hyatt',
    label: 'Continue on Hyatt',
    url: hyattSearchUrl(req, opts),
    opensNewTab: true,
    disclosure: 'You will leave our site to check rates and book with Hyatt. We never see your payment details.',
  };
}

export function venueHotelHandoff(): ExternalHandoff {
  return {
    provider: 'chicagoathletichotel.com',
    label: 'Visit the Chicago Athletic Association Hotel',
    url: VENUE_HOTEL_URL,
    opensNewTab: true,
    disclosure: 'Opens the hotel website in a new tab. TODO(Tyler & Sara): add the courtesy room-block link from the planner.',
  };
}
