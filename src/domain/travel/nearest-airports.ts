import commercial from './data/commercial-airports.json';
import { CHICAGO_AIRPORTS } from '@/providers/flights/types';
import { haversineKm, type LatLon } from './geo';

export type CommercialAirport = { iata: string; name: string; lat: number; lon: number; country: string; municipality?: string };

const AIRPORT_LIST = (commercial as { airports: CommercialAirport[] }).airports;

const CHICAGO: Record<(typeof CHICAGO_AIRPORTS)[number], LatLon> = {
  ORD: { lat: 41.9786, lon: -87.9048 },
  MDW: { lat: 41.7868, lon: -87.7524 },
};

export function listCommercialAirports(): readonly CommercialAirport[] {
  return AIRPORT_LIST;
}

export function airportByIata(code: string): CommercialAirport | undefined {
  const u = code.trim().toUpperCase();
  return AIRPORT_LIST.find((a) => a.iata === u);
}

export type NearestAirportHit = { iata: string; name: string; distanceKm: number; municipality?: string };

/**
 * Returns up to `limit` scheduled commercial airports nearest to `point`, sorted by distance.
 * Excludes Chicago destination airports when searching for an origin.
 */
export function nearestCommercialAirports(point: LatLon, opts: { limit?: number; exclude?: readonly string[] } = {}): NearestAirportHit[] {
  const limit = opts.limit ?? 3;
  const exclude = new Set((opts.exclude ?? []).map((c) => c.toUpperCase()));
  const hits: NearestAirportHit[] = [];
  for (const a of AIRPORT_LIST) {
    if (exclude.has(a.iata)) continue;
    hits.push({
      iata: a.iata,
      name: a.name,
      distanceKm: haversineKm(point, { lat: a.lat, lon: a.lon }),
      municipality: a.municipality,
    });
  }
  hits.sort((x, y) => x.distanceKm - y.distanceKm || x.iata.localeCompare(y.iata));
  return hits.slice(0, limit);
}

/** Default Chicago arrival airport: ORD unless the guest is materially closer to MDW. */
export function defaultChicagoDestination(point: LatLon | null): (typeof CHICAGO_AIRPORTS)[number] {
  if (!point) return 'ORD';
  const dOrd = haversineKm(point, CHICAGO.ORD);
  const dMdw = haversineKm(point, CHICAGO.MDW);
  return dMdw + 15 < dOrd ? 'MDW' : 'ORD';
}

export function formatAirportSuggestion(hit: NearestAirportHit): string {
  const place = hit.municipality ? ` — ${hit.municipality}` : '';
  return `${hit.iata}${place}`;
}
