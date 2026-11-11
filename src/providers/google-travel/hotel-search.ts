import { dateTuple } from './json-utils';
import { extractHotelEntities, extractHotelLeadTokens, extractHotelMapMarkers, type GoogleHotelMarker } from './hotel-markers';
import { postGoogleTravelRpc } from './rpc-post';

const VENUE = { lat: 41.8817, lon: -87.6245 };
const MAX_PRICED_HOTELS = 10;
const ENTITY_CONCURRENCY = 3;

export interface GoogleHotelSearchParams {
  query: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  currency?: string;
}

export interface GoogleHotelSearchHit {
  name: string;
  totalUsd?: number;
  priceDisplay: string | null;
  walkMinutesToVenue?: number;
  bookingUrl: string | null;
  isVenue?: boolean;
}

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function walkMinutes(km: number): number {
  return Math.max(1, Math.round((km / 4.8) * 60));
}

function mergeMarkersAndEntities(markers: GoogleHotelMarker[], entities: ReturnType<typeof extractHotelEntities>): GoogleHotelSearchHit[] {
  const byName = new Map<string, GoogleHotelSearchHit>();
  for (const m of markers) {
    if (m.sponsored) continue;
    byName.set(m.name.toLowerCase(), {
      name: m.name,
      totalUsd: m.totalUsd,
      priceDisplay: m.priceDisplay,
      walkMinutesToVenue: walkMinutes(haversineKm({ lat: m.latitude, lon: m.longitude }, VENUE)),
      bookingUrl: m.bookingUrl,
      isVenue: /chicago athletic association/i.test(m.name),
    });
  }
  for (const e of entities) {
    const key = e.name.toLowerCase();
    const existing = byName.get(key);
    if (existing) {
      if (e.totalUsd !== undefined) {
        existing.totalUsd = e.totalUsd;
        existing.priceDisplay = e.priceDisplay;
      }
      if (/chicago athletic association/i.test(e.name)) existing.isVenue = true;
    } else {
      byName.set(key, {
        name: e.name,
        totalUsd: e.totalUsd,
        priceDisplay: e.priceDisplay,
        isVenue: /chicago athletic association/i.test(e.name),
        bookingUrl: null,
      });
    }
  }
  return [...byName.values()].sort((a, b) => (a.totalUsd ?? Number.MAX_SAFE_INTEGER) - (b.totalUsd ?? Number.MAX_SAFE_INTEGER));
}

async function priceEntityStay(
  query: string,
  entityToken: string,
  params: GoogleHotelSearchParams,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number },
) {
  const checkIn = dateTuple(params.checkIn);
  const checkOut = dateTuple(params.checkOut);
  const currency = (params.currency ?? 'USD').toUpperCase();
  return postGoogleTravelRpc(
    'AtySUc',
    [
      query,
      [
        1,
        null,
        [
          [null, [[null, null, null, null, null, null, query]]],
          [null, [checkIn, checkOut, params.adults], null, null, null, [2]],
        ],
        null,
        [[null, null, null, null, null, null, currency]],
      ],
      [null, null, null, null, null, entityToken, 13],
      null,
      1,
    ],
    '/travel/search',
    opts,
  );
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}

/**
 * Keyless Google Travel Hotels search (MQghPc bootstrap + AtySUc stay-priced entities).
 * MIT-adapted from google-travel-website-api hotel operations.
 */
export async function searchGoogleTravelHotels(
  params: GoogleHotelSearchParams,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<GoogleHotelSearchHit[]> {
  const query = params.query;
  const bootstrap = await postGoogleTravelRpc('MQghPc', [query, null, null, null, null, null, null, null, [], 0], '/travel/search', opts);
  const bootstrapMarkers = extractHotelMapMarkers(bootstrap.decoded);
  const leads = extractHotelLeadTokens(bootstrap.decoded);
  const orderedLeads = [
    ...leads.filter((l) => /chicago athletic association/i.test(l.name)),
    ...leads.filter((l) => !/chicago athletic association/i.test(l.name)),
  ].slice(0, MAX_PRICED_HOTELS);

  const entityPayloads = await mapPool(orderedLeads, ENTITY_CONCURRENCY, async (lead) => {
    try {
      return await priceEntityStay(query, lead.entityToken, params, opts);
    } catch {
      return null;
    }
  });

  const entityDecoded = entityPayloads.flatMap((cap) => (cap ? cap.decoded : []));
  const markers = extractHotelMapMarkers([...entityDecoded, ...bootstrap.decoded]);
  const entities = extractHotelEntities([...entityDecoded, ...bootstrap.decoded]);
  const merged = mergeMarkersAndEntities(markers.length ? markers : bootstrapMarkers, entities);
  return merged.filter((h) => h.totalUsd !== undefined || h.priceDisplay);
}
