import { z } from 'zod';
import type { LiveSnapshot, ProviderFailure } from '@/contracts/providers';
import { err, ok, type Result } from '@/contracts/result';
import { failure, missingConfig, okConfig, unconfiguredHealth, upHealth } from '../base';
import { DUFFEL_API_VERSION, DUFFEL_BASE_URL } from '../flights/duffel-links';
import { callJson, CircuitBreaker, GUEST_MESSAGES, toCents, type FetchLike } from '../flights/http';
import { assertHotelSearchRequest, bookingComUrl, hotelsHandoff, venueHotelHandoff, VENUE_SEARCH_CENTER } from './deep-link';
import type { HotelResult, HotelSearchRequest, HotelsProvider } from './types';

/**
 * Duffel Stays seam (`POST /stays/search`). Same rules as the other live adapters: zod-guarded
 * shapes, timeouts, breaker, snapshots with TTL, no payment here. Booking runs on the Duffel
 * Links hosted page when that is configured, otherwise the Booking.com deep link.
 */
const SEARCH_PATH = '/stays/search';
const TTL_SECONDS = 10 * 60;

export interface DuffelStaysOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  now?: () => Date;
}

const result = z.object({
  id: z.string(),
  accommodation: z.object({
    name: z.string(),
    location: z.object({ address: z.object({ line_one: z.string().optional(), city_name: z.string().optional(), postal_code: z.string().optional() }).optional() }).optional(),
  }),
  cheapest_rate_total_amount: z.union([z.string(), z.number()]).optional(),
  cheapest_rate_currency: z.string().optional(),
});
const response = z.object({ data: z.object({ results: z.array(result).optional() }) });

export class DuffelStaysHotels implements HotelsProvider {
  readonly kind = 'hotels' as const;
  readonly name = 'duffel-stays';
  readonly mode: 'live' | 'unavailable';
  readonly capabilities: Record<string, boolean>;
  private readonly breaker = new CircuitBreaker();
  private readonly baseUrl: string;

  constructor(private readonly options: DuffelStaysOptions = {}) {
    this.mode = options.apiKey ? 'live' : 'unavailable';
    this.capabilities = { search: !!options.apiKey, deepLink: true, book: false };
    this.baseUrl = (options.baseUrl ?? DUFFEL_BASE_URL).replace(/\/+$/, '');
  }

  validateConfig() {
    return this.options.apiKey ? okConfig() : missingConfig(['DUFFEL_API_KEY']);
  }

  async health() {
    return this.options.apiKey ? upHealth('credentials present; search not probed') : unconfiguredHealth('DUFFEL_API_KEY missing');
  }

  deepLink(req: HotelSearchRequest) {
    return hotelsHandoff(req);
  }

  venueHandoff() {
    return venueHotelHandoff();
  }

  async search(req: HotelSearchRequest): Promise<Result<LiveSnapshot<HotelResult[]>, ProviderFailure>> {
    if (!this.options.apiKey) return err(failure(this.name, 'unconfigured', GUEST_MESSAGES.unconfigured));
    try {
      assertHotelSearchRequest(req);
    } catch (cause) {
      return err(failure(this.name, 'bad_request', GUEST_MESSAGES.bad_request, { raw: cause }));
    }
    const guests = [...Array.from({ length: req.adults }, () => ({ type: 'adult' })), ...Array.from({ length: req.children ?? 0 }, () => ({ type: 'child', age: 10 }))];
    const body = {
      data: {
        rooms: req.rooms ?? 1,
        guests,
        check_in_date: req.checkIn,
        check_out_date: req.checkOut,
        location: { radius: VENUE_SEARCH_CENTER.radiusKm, geographic_coordinates: { latitude: VENUE_SEARCH_CENTER.latitude, longitude: VENUE_SEARCH_CENTER.longitude } },
      },
    };
    const res = await callJson(
      {
        provider: this.name,
        url: `${this.baseUrl}${SEARCH_PATH}`,
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${this.options.apiKey}`, 'duffel-version': DUFFEL_API_VERSION },
          body: JSON.stringify(body),
        },
        timeoutMs: this.options.timeoutMs,
        fetchImpl: this.options.fetchImpl,
        breaker: this.breaker,
      },
      (json) => response.parse(json),
    );
    if (!res.ok) return res;
    const pricedAt = (this.options.now ?? (() => new Date()))().toISOString();
    const nights = Math.max(1, Math.round((Date.parse(req.checkOut) - Date.parse(req.checkIn)) / 86_400_000));
    const searchUrl = bookingComUrl(req);
    const data: HotelResult[] = (res.value.data.results ?? []).map((r) => {
      const total = toCents(r.cheapest_rate_total_amount);
      const addr = r.accommodation.location?.address;
      return {
        id: `duffel-stays-${r.id}`,
        name: r.accommodation.name,
        address: addr ? [addr.line_one, addr.city_name, addr.postal_code].filter(Boolean).join(', ') : undefined,
        ...(total !== undefined ? { totalCents: total, nightlyCents: Math.round(total / nights), currency: r.cheapest_rate_currency ?? 'USD', pricedAt } : {}),
        bookingUrl: searchUrl,
      };
    });
    data.sort((a, b) => (a.totalCents ?? Number.MAX_SAFE_INTEGER) - (b.totalCents ?? Number.MAX_SAFE_INTEGER));
    return ok({ provider: this.name, retrievedAt: pricedAt, ttlSeconds: TTL_SECONDS, data });
  }
}
