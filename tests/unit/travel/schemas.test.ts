import { describe, expect, it } from 'vitest';
import { flightSearchInput, hotelRecommendationInput, hotelSearchInput, travelLinkInput, travelProfileInput, travelSearchInput, tripItemInput } from '@/domain/travel/types';
import { skyscannerFlightsUrl, assertFlightSearchRequest } from '@/providers/flights';

describe('travel profile schema', () => {
  it('normalises airport codes and enforces ordered date windows', () => {
    const p = travelProfileInput.parse({ preferredAirport: ' lax ', alternateAirports: ['sna', 'BUR'], arriveEarliest: '2027-07-15', arriveLatest: '2027-07-16' });
    expect(p).toMatchObject({ preferredAirport: 'LAX', alternateAirports: ['SNA', 'BUR'], adults: 1, children: 0, cabin: 'economy', nonstopPreferred: false });
    const bad = travelProfileInput.safeParse({ arriveEarliest: '2027-07-16', arriveLatest: '2027-07-15' });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]!.path).toEqual(['arriveLatest']);
    expect(travelProfileInput.safeParse({ departEarliest: '2027-07-15', arriveLatest: '2027-07-16' }).success).toBe(false);
    expect(travelProfileInput.safeParse({ preferredAirport: 'LAXX' }).success).toBe(false);
    expect(travelProfileInput.safeParse({ arriveEarliest: '2027-02-30' }).success).toBe(false);
    expect(travelProfileInput.safeParse({ homeCity: 'x'.repeat(81) }).success).toBe(false);
  });
});

describe('search schemas', () => {
  it('reject Chicago as the origin, reversed dates, and unknown airports', () => {
    expect(flightSearchInput.safeParse({ kind: 'flights', origin: 'ORD', departDate: '2027-07-15' }).success).toBe(false);
    expect(flightSearchInput.safeParse({ kind: 'flights', origin: 'LAX', departDate: '2027-07-15', returnDate: '2027-07-14' }).success).toBe(false);
    expect(flightSearchInput.safeParse({ kind: 'flights', origin: 'LAX', destination: 'JFK', departDate: '2027-07-15' }).success).toBe(false);
    const ok = travelSearchInput.parse({ kind: 'flights', origin: 'lax', departDate: '2027-07-15' });
    expect(ok).toMatchObject({ kind: 'flights', origin: 'LAX', destination: 'ORD', adults: 1, cabin: 'economy', nonstopOnly: false });
    expect(hotelSearchInput.safeParse({ kind: 'hotels', checkIn: '2027-07-16', checkOut: '2027-07-16' }).success).toBe(false);
    expect(hotelSearchInput.parse({ kind: 'hotels', checkIn: '2027-07-16', checkOut: '2027-07-18' })).toMatchObject({ adults: 2, rooms: 1 });
  });

  it('flight deep links carry cabin and nonstop filters and still refuse bad input', () => {
    const req = { origin: 'LAX', departDate: '2027-07-15', adults: 1, cabin: 'premium_economy' as const, nonstopOnly: true };
    const url = skyscannerFlightsUrl(req);
    expect(url).toContain('cabinclass=premiumeconomy');
    expect(url).toContain('stops=');
    expect(() => assertFlightSearchRequest({ ...req, cabin: 'coach' as never })).toThrow(RangeError);
  });
});

describe('trip item and admin schemas', () => {
  it('bound guest text and validate time zones', () => {
    expect(tripItemInput.parse({ kind: 'flight', title: 'UA 123', startAt: '2027-07-16T10:00' })).toMatchObject({ timezone: 'America/Chicago', details: {} });
    expect(tripItemInput.safeParse({ kind: 'flight', title: 'x', startAt: '2027-07-16T10:00', timezone: 'Mars/Olympus' }).success).toBe(false);
    expect(tripItemInput.safeParse({ kind: 'flight', title: 'x', startAt: '2027-07-16T10:00', details: { note: 'n'.repeat(501) } }).success).toBe(false);
    expect(tripItemInput.safeParse({ kind: 'flight', title: 'x', startAt: '2027-07-16T10:00', details: { extra: 1 } }).success).toBe(false);
  });

  it('accept only https partner URLs', () => {
    expect(travelLinkInput.safeParse({ category: 'airline', provider: 'United', label: 'United', url: 'http://www.united.com' }).success).toBe(false);
    expect(travelLinkInput.safeParse({ category: 'airline', provider: 'United', label: 'United', url: 'javascript:alert(1)' }).success).toBe(false);
    expect(travelLinkInput.safeParse({ category: 'ota', provider: 'Skyscanner', label: 'Search', url: 'https://www.skyscanner.com/' }).success).toBe(true);
    const hotel = hotelRecommendationInput.parse({ name: 'X', block: { url: 'https://www.hyatt.com/x', cutoff: '2027-06-17' } });
    expect(hotel.block).toMatchObject({ url: 'https://www.hyatt.com/x', cutoff: '2027-06-17', placeholder: true, code: null });
  });
});
