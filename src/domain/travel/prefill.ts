import type { GuestId } from '@/contracts/ids';
import type { Db } from '@/db/client';
import type { TravelProfile } from './types';
import { getGuest, listHouseholdMembers } from '@/domain/guests/repo';
import { getHousehold } from '@/domain/households/repo';
import { coordinatesFromMailingAddress } from './geo';
import { defaultChicagoDestination, nearestCommercialAirports, type NearestAirportHit } from './nearest-airports';
import { estimateHotelRooms, partyCountsFromMembers } from './party';
import { CHICAGO_AIRPORTS } from '@/providers/flights/types';

/** Hotel block nights and recommended flight dates around the wedding (Sat 2027-07-17). */
export const TRAVEL_BLOCK_CHECK_IN = '2027-07-16';
export const TRAVEL_BLOCK_CHECK_OUT = '2027-07-18';
export const TRAVEL_FLIGHT_DEPART = '2027-07-16';
export const TRAVEL_FLIGHT_RETURN = '2027-07-18';

export type TravelSearchFormDefaults = {
  flight: Partial<Record<'origin' | 'destination' | 'departDate' | 'returnDate' | 'adults' | 'children' | 'cabin' | 'nonstopOnly', string>>;
  hotel: Partial<Record<'checkIn' | 'checkOut' | 'adults' | 'children' | 'rooms', string>>;
  originSuggestions: NearestAirportHit[];
};

const emptyDefaults = (): TravelSearchFormDefaults => ({ flight: {}, hotel: {}, originSuggestions: [] });

function fromProfile(profile: TravelProfile): TravelSearchFormDefaults {
  return {
    flight: {
      origin: profile.preferredAirport ?? '',
      adults: String(profile.adults),
      children: String(profile.children),
      cabin: profile.cabin,
      nonstopOnly: profile.nonstopPreferred ? 'on' : '',
      departDate: profile.arriveEarliest ?? '',
      returnDate: profile.departLatest ?? '',
      destination: 'ORD',
    },
    hotel: { adults: String(profile.adults), children: String(profile.children) },
    originSuggestions: profile.preferredAirport
      ? [{ iata: profile.preferredAirport, name: profile.preferredAirport, distanceKm: 0 }]
      : [],
  };
}

/**
 * Builds editable defaults for the Travel & Stay search forms from the guest's household.
 * Never fabricates address or counts: missing data leaves fields blank (except fixed wedding dates).
 */
export async function buildTravelSearchDefaults(db: Db, guestId: GuestId, profile: TravelProfile | null): Promise<TravelSearchFormDefaults> {
  if (profile) return fromProfile(profile);

  const guest = await getGuest(db, guestId);
  if (!guest) return emptyDefaults();
  const household = await getHousehold(db, guest.householdId);
  if (!household) return emptyDefaults();

  const members = await listHouseholdMembers(db, household.id);
  const { adults, children } = partyCountsFromMembers(members);
  const point = coordinatesFromMailingAddress(household.mailingAddress);
  const nearest = point ? nearestCommercialAirports(point, { limit: 3, exclude: CHICAGO_AIRPORTS }) : [];
  const destination = defaultChicagoDestination(point);

  const flight: TravelSearchFormDefaults['flight'] = {
    destination,
    departDate: TRAVEL_FLIGHT_DEPART,
    returnDate: TRAVEL_FLIGHT_RETURN,
  };
  const hotel: TravelSearchFormDefaults['hotel'] = {
    checkIn: TRAVEL_BLOCK_CHECK_IN,
    checkOut: TRAVEL_BLOCK_CHECK_OUT,
  };

  if (nearest[0]) flight.origin = nearest[0].iata;
  if (adults > 0) {
    flight.adults = String(adults);
    hotel.adults = String(adults);
    hotel.rooms = String(estimateHotelRooms(adults));
  }
  if (children > 0) {
    flight.children = String(children);
    hotel.children = String(children);
  }

  return { flight, hotel, originSuggestions: nearest };
}
