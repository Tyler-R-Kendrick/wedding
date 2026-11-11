import type { HouseholdRow } from '@/db/schema/guests';
import usCentroids from './data/us-postal-centroids.json';

export type LatLon = { lat: number; lon: number };

const US = usCentroids as { zips: Record<string, { lat: number; lon: number; region?: string }> };

/** Normalizes a postal code for centroid lookup (US ZIP5 only today). */
export function normalizeUsPostalCode(raw: string | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 5) return null;
  return digits.slice(0, 5);
}

function countryIsUs(country: string | undefined): boolean {
  if (!country) return true;
  const c = country.trim().toLowerCase();
  return c === 'us' || c === 'usa' || c === 'united states' || c === 'united states of america';
}

/**
 * Resolves a coarse point for nearest-airport search. Uses bundled US ZIP centroids (GeoNames);
 * no outbound geocoding calls.
 */
export function coordinatesFromMailingAddress(address: HouseholdRow['mailingAddress']): LatLon | null {
  if (!address) return null;
  if (countryIsUs(address.country)) {
    const zip = normalizeUsPostalCode(address.postalCode);
    if (zip) {
      const hit = US.zips[zip];
      if (hit) return { lat: hit.lat, lon: hit.lon };
    }
  }
  return null;
}

/** Great-circle distance in kilometres (WGS84 sphere). */
export function haversineKm(a: LatLon, b: LatLon): number {
  const r = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}
