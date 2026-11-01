import { z } from 'zod';
import type { LiveSnapshot, ProviderFailure } from '@/contracts/providers';
import { err, ok, type Result } from '@/contracts/result';
import { isAllowedRedirect } from '@/lib/redirects';
import { failure, missingConfig, okConfig, unconfiguredHealth, upHealth } from '../base';
import { callJson, CircuitBreaker, GUEST_MESSAGES, type FetchLike } from '../flights/http';
import { assertHotelSearchRequest, bookingComUrl, hotelsHandoff, venueHotelHandoff, partnerHotelHandoffs, VENUE_SEARCH_CENTER } from './deep-link';
import type { HotelResult, HotelSearchRequest, HotelsProvider } from './types';

/**
 * SerpApi Google Hotels (`engine=google_hotels`). Returns real Google Hotels rates for a stay.
 * Free plan: 100 searches/month — cache snapshots server-side (see `snapshot-cache.ts`).
 * Sign up: https://serpapi.com/users/sign_up — key on the dashboard.
 */
export const SERPAPI_BASE_URL = 'https://serpapi.com/search.json';
const TTL_SECONDS = 45 * 60;

export interface SerpApiGoogleHotelsOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  now?: () => Date;
}

const rate = z.object({
  extracted_lowest: z.number().optional(),
  extracted_before_taxes_fees: z.number().optional(),
});
const property = z.object({
  type: z.string().optional(),
  name: z.string().optional(),
  link: z.string().optional(),
  gps_coordinates: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
  rate_per_night: rate.optional(),
  total_rate: rate.optional(),
});
const response = z.object({
  properties: z.array(property).optional(),
  error: z.string().optional(),
});

function haversineKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function walkMinutes(distanceKm: number): number {
  return Math.max(1, Math.round((distanceKm / 4.8) * 60));
}

function pickBookingUrl(propertyLink: string | undefined, fallback: string): string {
  if (propertyLink && isAllowedRedirect(propertyLink)) return propertyLink;
  return fallback;
}

export class SerpApiGoogleHotels implements HotelsProvider {
  readonly kind = 'hotels' as const;
  readonly name = 'serpapi-google-hotels';
  readonly mode: 'live' | 'unavailable';
  readonly capabilities: Record<string, boolean>;
  private readonly breaker = new CircuitBreaker();
  private readonly baseUrl: string;

  constructor(private readonly options: SerpApiGoogleHotelsOptions = {}) {
    this.mode = options.apiKey ? 'live' : 'unavailable';
    this.capabilities = { search: !!options.apiKey, deepLink: true, book: false };
    this.baseUrl = options.baseUrl ?? SERPAPI_BASE_URL;
  }

  validateConfig() {
    return this.options.apiKey ? okConfig() : missingConfig(['SERPAPI_API_KEY']);
  }

  async health() {
    return this.options.apiKey ? upHealth('credentials present; search not probed') : unconfiguredHealth('SERPAPI_API_KEY missing');
  }

  deepLink(req: HotelSearchRequest) {
    return hotelsHandoff(req);
  }

  venueHandoff() {
    return venueHotelHandoff();
  }

  extraHandoffs(req: HotelSearchRequest) {
    return partnerHotelHandoffs(req);
  }

  async search(req: HotelSearchRequest): Promise<Result<LiveSnapshot<HotelResult[]>, ProviderFailure>> {
    if (!this.options.apiKey) return err(failure(this.name, 'unconfigured', GUEST_MESSAGES.unconfigured));
    try {
      assertHotelSearchRequest(req);
    } catch (cause) {
      return err(failure(this.name, 'bad_request', GUEST_MESSAGES.bad_request, { raw: cause }));
    }
    const params = new URLSearchParams({
      engine: 'google_hotels',
      q: 'Chicago Athletic Association Hotel, Chicago IL',
      check_in_date: req.checkIn,
      check_out_date: req.checkOut,
      adults: String(req.adults),
      children: String(req.children ?? 0),
      currency: 'USD',
      gl: 'us',
      hl: 'en',
      api_key: this.options.apiKey,
    });
    const url = `${this.baseUrl}?${params.toString()}`;
    const res = await callJson(
      {
        provider: this.name,
        url,
        init: { method: 'GET', headers: { accept: 'application/json' } },
        timeoutMs: this.options.timeoutMs,
        fetchImpl: this.options.fetchImpl,
        breaker: this.breaker,
      },
      (json) => response.parse(json),
    );
    if (!res.ok) return res;
    if (res.value.error) {
      return err(failure(this.name, 'server', res.value.error, { raw: res.value }));
    }
    const pricedAt = (this.options.now ?? (() => new Date()))().toISOString();
    const nights = Math.max(1, Math.round((Date.parse(req.checkOut) - Date.parse(req.checkIn)) / 86_400_000));
    const fallbackUrl = bookingComUrl(req);
    const center = { latitude: VENUE_SEARCH_CENTER.latitude, longitude: VENUE_SEARCH_CENTER.longitude };
    const data: HotelResult[] = (res.value.properties ?? [])
      .filter((p) => p.name)
      .map((p, i) => {
        const totalUsd =
          p.total_rate?.extracted_lowest ??
          p.total_rate?.extracted_before_taxes_fees ??
          (p.rate_per_night?.extracted_lowest !== undefined ? p.rate_per_night.extracted_lowest * nights : undefined);
        const nightlyUsd =
          p.rate_per_night?.extracted_lowest ??
          (totalUsd !== undefined ? Math.round(totalUsd / nights) : undefined);
        const coords = p.gps_coordinates;
        const walkMinutesToVenue = coords ? walkMinutes(haversineKm(coords, center)) : undefined;
        const totalCents = totalUsd !== undefined ? Math.round(totalUsd * 100) : undefined;
        const nightlyCents = nightlyUsd !== undefined ? Math.round(nightlyUsd * 100) : undefined;
        const isVenue = /chicago athletic association/i.test(p.name ?? '');
        return {
          id: `serpapi-${i}-${(p.name ?? 'hotel').slice(0, 24).replace(/\s+/g, '-')}`,
          name: p.name!,
          ...(walkMinutesToVenue !== undefined ? { walkMinutesToVenue } : {}),
          ...(totalCents !== undefined ? { totalCents, currency: 'USD', pricedAt } : {}),
          ...(nightlyCents !== undefined ? { nightlyCents } : {}),
          bookingUrl: pickBookingUrl(p.link, fallbackUrl),
          ...(isVenue ? { isVenue: true } : {}),
        };
      });
    data.sort((a, b) => (a.totalCents ?? Number.MAX_SAFE_INTEGER) - (b.totalCents ?? Number.MAX_SAFE_INTEGER));
    if (!data.length) {
      return err(failure(this.name, 'not_found', 'No hotel rates matched those dates. Try the partner links below.', { raw: res.value }));
    }
    return ok({ provider: this.name, retrievedAt: pricedAt, ttlSeconds: TTL_SECONDS, data });
  }
}
