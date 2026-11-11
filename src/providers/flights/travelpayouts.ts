import { z } from 'zod';
import type { LiveSnapshot, ProviderFailure } from '@/contracts/providers';
import { err, ok, type Result } from '@/contracts/result';
import { isAllowedRedirect } from '@/lib/redirects';
import { failure, missingConfig, okConfig, unconfiguredHealth, upHealth } from '../base';
import { assertFlightSearchRequest, flightsHandoff, partnerFlightHandoffs } from './deep-link';
import { callJson, CircuitBreaker, GUEST_MESSAGES, toCents, type FetchLike } from './http';
import type { FlightResult, FlightSearchRequest, FlightsProvider, TransferKind } from './types';

/**
 * Travelpayouts / Aviasales Data API (`/aviasales/v3/prices_for_dates`). Returns real fares from
 * Aviasales search cache (typically refreshed within 48 hours), not fabricated fixtures. Booking
 * links are affiliate deep links when `TRAVELPAYOUTS_MARKER` is set. Free tier: register at
 * https://www.travelpayouts.com/ — token in Profile → API token (600 req/min on this method).
 */
export const TRAVELPAYOUTS_API_BASE = 'https://api.travelpayouts.com';
const PRICES_PATH = '/aviasales/v3/prices_for_dates';
const TTL_SECONDS = 30 * 60;

export interface TravelpayoutsOptions {
  token?: string;
  /** Partner marker for Aviasales affiliate links (Profile → Tools → your project marker). */
  marker?: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  market?: string;
  currency?: string;
  now?: () => Date;
}

const row = z.object({
  origin: z.string().optional(),
  destination: z.string().optional(),
  origin_airport: z.string().optional(),
  destination_airport: z.string().optional(),
  price: z.union([z.number(), z.string()]).optional(),
  airline: z.string().optional(),
  flight_number: z.union([z.string(), z.number()]).optional(),
  departure_at: z.string().optional(),
  return_at: z.string().optional(),
  transfers: z.number().optional(),
  return_transfers: z.number().optional(),
  duration: z.number().optional(),
  duration_to: z.number().optional(),
  duration_back: z.number().optional(),
  link: z.string().optional(),
  expires_at: z.string().optional(),
});
const envelope = z.object({
  success: z.boolean(),
  data: z.array(row).optional(),
  error: z.string().nullable().optional(),
});

export type TravelpayoutsEnvelope = z.infer<typeof envelope>;

function transferKind(outboundStops: number): TransferKind {
  return outboundStops === 0 ? 'nonstop' : 'protected';
}

export function aviasalesBookingUrl(link: string | undefined, marker: string | undefined): string | undefined {
  if (!link) return undefined;
  const path = link.startsWith('http') ? link : `https://www.aviasales.com${link.startsWith('/') ? link : `/${link}`}`;
  try {
    const url = new URL(path);
    if (marker) url.searchParams.set('marker', marker);
    return isAllowedRedirect(url.toString()) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Pure normaliser (fixture-tested): Aviasales rows → FlightResult[], cheapest first. */
export function normalizeTravelpayoutsRows(
  rows: z.infer<typeof row>[],
  req: FlightSearchRequest,
  pricedAt: string,
  marker: string | undefined,
): FlightResult[] {
  const out: FlightResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const stops = r.transfers ?? 0;
    if (req.nonstopOnly && stops > 0) continue;
    const origin = (r.origin_airport ?? r.origin ?? req.origin).toUpperCase();
    const destination = (r.destination_airport ?? r.destination ?? req.destination ?? 'ORD').toUpperCase();
    const cents = toCents(r.price, 'whole');
    const durationMinutes = r.duration_to ?? r.duration ?? 0;
    const departAt = r.departure_at ? new Date(r.departure_at).toISOString() : undefined;
    const arriveAt =
      departAt && durationMinutes
        ? new Date(Date.parse(departAt) + durationMinutes * 60_000).toISOString()
        : r.return_at
          ? new Date(r.return_at).toISOString()
          : undefined;
    if (!departAt || !arriveAt) continue;
    const bookingUrl = aviasalesBookingUrl(r.link, marker);
    out.push({
      id: `travelpayouts-${i}-${origin}-${destination}-${stops}`,
      carrier: r.airline ?? 'Airline',
      carrierCode: r.airline,
      origin,
      destination,
      departAt,
      arriveAt,
      durationMinutes,
      stops,
      transfer: transferKind(stops),
      ...(cents !== undefined ? { priceCents: cents, currency: 'USD', pricedAt: r.expires_at ?? pricedAt } : {}),
      ...(bookingUrl ? { bookingUrl, bookingProvider: 'aviasales' } : {}),
    });
  }
  return out.sort(
    (a, b) => (a.priceCents ?? Number.MAX_SAFE_INTEGER) - (b.priceCents ?? Number.MAX_SAFE_INTEGER) || a.durationMinutes - b.durationMinutes,
  );
}

export class TravelpayoutsFlights implements FlightsProvider {
  readonly kind = 'flights' as const;
  readonly name = 'travelpayouts';
  readonly mode: 'live' | 'unavailable';
  readonly capabilities: Record<string, boolean>;
  private readonly breaker = new CircuitBreaker();
  private readonly baseUrl: string;

  constructor(private readonly options: TravelpayoutsOptions = {}) {
    this.mode = options.token ? 'live' : 'unavailable';
    this.capabilities = { search: !!options.token, deepLink: true, book: false, hostedSession: false };
    this.baseUrl = (options.baseUrl ?? TRAVELPAYOUTS_API_BASE).replace(/\/+$/, '');
  }

  validateConfig() {
    return this.options.token ? okConfig() : missingConfig(['TRAVELPAYOUTS_TOKEN']);
  }

  async health() {
    return this.options.token ? upHealth('credentials present; live search not probed') : unconfiguredHealth('TRAVELPAYOUTS_TOKEN missing');
  }

  deepLink(req: FlightSearchRequest) {
    return flightsHandoff(req);
  }

  extraHandoffs(req: FlightSearchRequest) {
    return partnerFlightHandoffs(req);
  }

  async search(req: FlightSearchRequest): Promise<Result<LiveSnapshot<FlightResult[]>, ProviderFailure>> {
    if (!this.options.token) return err(failure(this.name, 'unconfigured', GUEST_MESSAGES.unconfigured));
    try {
      assertFlightSearchRequest(req);
    } catch (cause) {
      return err(failure(this.name, 'bad_request', GUEST_MESSAGES.bad_request, { raw: cause }));
    }
    const params = new URLSearchParams({
      origin: req.origin.toUpperCase(),
      destination: (req.destination ?? 'ORD').toUpperCase(),
      departure_at: req.departDate,
      currency: this.options.currency ?? 'usd',
      market: this.options.market ?? 'us',
      sorting: 'price',
      direct: String(!!req.nonstopOnly),
      limit: '30',
      page: '1',
      one_way: req.returnDate ? 'false' : 'true',
      token: this.options.token,
    });
    if (req.returnDate) params.set('return_at', req.returnDate);
    const url = `${this.baseUrl}${PRICES_PATH}?${params.toString()}`;
    const res = await callJson(
      {
        provider: this.name,
        url,
        init: {
          method: 'GET',
          headers: { accept: 'application/json', 'accept-encoding': 'gzip, deflate' },
        },
        timeoutMs: this.options.timeoutMs,
        fetchImpl: this.options.fetchImpl,
        breaker: this.breaker,
      },
      (json) => envelope.parse(json),
    );
    if (!res.ok) return res;
    if (!res.value.success) {
      return err(failure(this.name, 'server', res.value.error ?? GUEST_MESSAGES.server, { raw: res.value }));
    }
    const pricedAt = (this.options.now ?? (() => new Date()))().toISOString();
    const data = normalizeTravelpayoutsRows(res.value.data ?? [], req, pricedAt, this.options.marker);
    if (!data.length) {
      return err(failure(this.name, 'not_found', 'No cached fares matched those dates yet. Try the partner link for a live search.', { raw: res.value }));
    }
    return ok({ provider: this.name, retrievedAt: pricedAt, ttlSeconds: TTL_SECONDS, data });
  }
}
