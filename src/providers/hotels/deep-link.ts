import type { ExternalHandoff } from '@/contracts/providers';
import type { HotelSearchRequest } from './types';

export const VENUE_HOTEL_URL = 'https://www.chicagoathletichotel.com/';

export function bookingComUrl(req: HotelSearchRequest): string {
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

export function hotelsHandoff(req: HotelSearchRequest): ExternalHandoff {
  return {
    provider: 'booking.com',
    label: 'Continue on Booking.com',
    url: bookingComUrl(req),
    opensNewTab: true,
    disclosure: 'You will leave our site to compare and book hotels with Booking.com. We never see your payment details.',
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
