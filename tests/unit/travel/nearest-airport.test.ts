import { describe, expect, it } from 'vitest';
import { coordinatesFromMailingAddress, haversineKm } from '@/domain/travel/geo';
import { defaultChicagoDestination, nearestCommercialAirports } from '@/domain/travel/nearest-airports';
import { estimateHotelRooms, partyCountsFromMembers } from '@/domain/travel/party';
import type { GuestRow } from '@/db/schema/guests';

describe('travel geo + nearest airports', () => {
  it('resolves US ZIP centroids from bundled data', () => {
    const point = coordinatesFromMailingAddress({ postalCode: '90210', country: 'US' });
    expect(point).toMatchObject({ lat: expect.any(Number), lon: expect.any(Number) });
    expect(point!.lat).toBeGreaterThan(33);
    expect(point!.lat).toBeLessThan(35);
  });

  it('returns nothing when postal data is missing', () => {
    expect(coordinatesFromMailingAddress({ city: 'Chicago', region: 'IL' })).toBeNull();
  });

  it('finds LAX among nearest airports near Westchester', () => {
    const point = coordinatesFromMailingAddress({ postalCode: '90045', country: 'US' })!;
    const nearest = nearestCommercialAirports(point, { limit: 3, exclude: ['ORD', 'MDW'] });
    expect(nearest.map((n) => n.iata)).toContain('LAX');
    expect(nearest[0]!.iata).toBe('LAX');
  });

  it('defaults Chicago destination to ORD unless MDW is much closer', () => {
    const la = coordinatesFromMailingAddress({ postalCode: '90045', country: 'US' })!;
    expect(defaultChicagoDestination(la)).toBe('ORD');
    expect(defaultChicagoDestination({ lat: 41.78, lon: -87.74 })).toBe('MDW');
  });

  it('haversine is symmetric and zero at identical points', () => {
    const a = { lat: 10, lon: 20 };
    expect(haversineKm(a, a)).toBe(0);
    expect(haversineKm(a, { lat: 11, lon: 21 })).toBeGreaterThan(0);
  });
});

describe('party counts for travel prefill', () => {
  const member = (over: Partial<GuestRow>): GuestRow =>
    ({
      id: 'g1',
      householdId: 'h1',
      firstName: 'A',
      lastName: 'B',
      email: null,
      phone: null,
      kind: 'adult',
      isMinor: false,
      isNamed: true,
      plusOneOfGuestId: null,
      managedByGuestId: null,
      mergedIntoGuestId: null,
      alternateNames: [],
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    }) as GuestRow;

  it('counts adults and children separately', () => {
    const counts = partyCountsFromMembers([
      member({ id: '1' }),
      member({ id: '2', kind: 'plus_one' }),
      member({ id: '3', kind: 'child', isMinor: true }),
    ]);
    expect(counts).toEqual({ adults: 2, children: 1 });
    expect(estimateHotelRooms(counts.adults)).toBe(1);
    expect(estimateHotelRooms(4)).toBe(2);
  });
});
