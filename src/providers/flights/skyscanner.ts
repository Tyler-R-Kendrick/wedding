import { z } from 'zod';
import type { LiveSnapshot, ProviderFailure } from '@/contracts/providers';
import { err, ok, type Result } from '@/contracts/result';
import { isAllowedRedirect } from '@/lib/redirects';
import { failure, missingConfig, okConfig, unconfiguredHealth, upHealth } from '../base';
import { assertFlightSearchRequest, flightsHandoff } from './deep-link';
import { callJson, CircuitBreaker, GUEST_MESSAGES, toCents, type FetchLike } from './http';
import type { FlightCabin, FlightResult, FlightSearchRequest, FlightSegment, FlightsProvider, TransferKind } from './types';

/**
 * Skyscanner Flights Live Prices (v3) shaped adapter: `create` a search session, then `poll`
 * until the status is complete, then normalise itineraries. Partner access is not confirmed
 * (brief: "re-verify at implementation time"), so the shapes below are guarded by zod and any
 * drift degrades to `malformed_response` -> deep-link rung, never a crash. Deep links returned by
 * the API are only kept when they pass the redirect allowlist.
 */
export const SKYSCANNER_BASE_URL = 'https://partners.api.skyscanner.net';
const CREATE_PATH = '/apiservices/v3/flights/live/search/create';
const POLL_PATH = '/apiservices/v3/flights/live/search/poll/';
const TTL_SECONDS = 15 * 60;

export interface SkyscannerOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  pollIntervalMs?: number;
  maxPolls?: number;
  market?: string;
  locale?: string;
  currency?: string;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

const CABIN: Record<FlightCabin, string> = {
  economy: 'CABIN_CLASS_ECONOMY',
  premium_economy: 'CABIN_CLASS_PREMIUM_ECONOMY',
  business: 'CABIN_CLASS_BUSINESS',
  first: 'CABIN_CLASS_FIRST',
};

const dateTime = z.object({
  year: z.number(),
  month: z.number(),
  day: z.number(),
  hour: z.number().optional(),
  minute: z.number().optional(),
  second: z.number().optional(),
});
const leg = z.object({
  originPlaceId: z.string(),
  destinationPlaceId: z.string(),
  departureDateTime: dateTime,
  arrivalDateTime: dateTime,
  durationInMinutes: z.number(),
  stopCount: z.number(),
  marketingCarrierIds: z.array(z.string()).optional(),
  segmentIds: z.array(z.string()).optional(),
});
const segment = z.object({
  originPlaceId: z.string(),
  destinationPlaceId: z.string(),
  departureDateTime: dateTime,
  arrivalDateTime: dateTime,
  marketingCarrierId: z.string().optional(),
  marketingFlightNumber: z.string().optional(),
});
const pricingOption = z.object({
  price: z.object({ amount: z.union([z.string(), z.number()]).optional(), unit: z.string().optional() }).optional(),
  items: z.array(z.object({ deepLink: z.string().optional(), agentId: z.string().optional() })).optional(),
  transferType: z.string().optional(),
});
const itinerary = z.object({ pricingOptions: z.array(pricingOption).optional(), legIds: z.array(z.string()) });
const results = z.object({
  itineraries: z.record(z.string(), itinerary).optional(),
  legs: z.record(z.string(), leg).optional(),
  segments: z.record(z.string(), segment).optional(),
  places: z.record(z.string(), z.object({ iata: z.string().optional(), name: z.string().optional() })).optional(),
  carriers: z.record(z.string(), z.object({ name: z.string(), iata: z.string().optional() })).optional(),
  agents: z.record(z.string(), z.object({ name: z.string() })).optional(),
});
const response = z.object({
  sessionToken: z.string(),
  status: z.string(),
  content: z.object({ results: results.optional() }).optional(),
});
export type SkyscannerResponse = z.infer<typeof response>;

const toIso = (d: z.infer<typeof dateTime>) =>
  new Date(Date.UTC(d.year, d.month - 1, d.day, d.hour ?? 0, d.minute ?? 0, d.second ?? 0)).toISOString();

function transferKind(stops: number, transferType: string | undefined): TransferKind {
  if (stops === 0) return 'nonstop';
  if (transferType === 'TRANSFER_TYPE_SELF_TRANSFER') return 'self_transfer';
  return 'protected';
}

/** Pure normaliser (unit-tested with fixtures): itineraries -> FlightResult[], cheapest first. */
export function normalizeSkyscannerResults(body: SkyscannerResponse, req: FlightSearchRequest, pricedAt: string): FlightResult[] {
  const r = body.content?.results;
  if (!r?.itineraries) return [];
  const places = r.places ?? {};
  const carriers = r.carriers ?? {};
  const legs = r.legs ?? {};
  const segments = r.segments ?? {};
  const agents = r.agents ?? {};
  const iata = (placeId: string) => places[placeId]?.iata ?? placeId;
  const carrierName = (id: string | undefined) => (id ? carriers[id]?.name ?? id : 'Unknown carrier');
  const out: FlightResult[] = [];
  for (const [id, it] of Object.entries(r.itineraries)) {
    const first = it.legIds[0] ? legs[it.legIds[0]] : undefined;
    if (!first) continue;
    const stops = first.stopCount;
    if (req.nonstopOnly && stops > 0) continue;
    const options = (it.pricingOptions ?? [])
      .map((po) => {
        const unit = po.price?.unit === 'PRICE_UNIT_CENTI' ? 'centi' : po.price?.unit === 'PRICE_UNIT_MILLI' ? 'milli' : 'whole';
        return { po, cents: toCents(po.price?.amount, unit) };
      })
      .filter((o): o is { po: z.infer<typeof pricingOption>; cents: number } => o.cents !== undefined)
      .sort((a, b) => a.cents - b.cents);
    const cheapest = options[0];
    const deepLink = cheapest?.po.items?.find((i) => i.deepLink && isAllowedRedirect(i.deepLink))?.deepLink;
    const agentId = cheapest?.po.items?.[0]?.agentId;
    const segs: FlightSegment[] = [];
    for (const legId of it.legIds) {
      for (const segId of legs[legId]?.segmentIds ?? []) {
        const s = segments[segId];
        if (!s) continue;
        segs.push({
          carrier: carrierName(s.marketingCarrierId),
          carrierCode: s.marketingCarrierId ? carriers[s.marketingCarrierId]?.iata : undefined,
          flightNumber: s.marketingFlightNumber,
          origin: iata(s.originPlaceId),
          destination: iata(s.destinationPlaceId),
          departAt: toIso(s.departureDateTime),
          arriveAt: toIso(s.arrivalDateTime),
        });
      }
    }
    const marketing = first.marketingCarrierIds?.[0];
    out.push({
      id: `skyscanner-${id}`,
      carrier: carrierName(marketing),
      carrierCode: marketing ? carriers[marketing]?.iata : undefined,
      origin: iata(first.originPlaceId),
      destination: iata(first.destinationPlaceId),
      departAt: toIso(first.departureDateTime),
      arriveAt: toIso(first.arrivalDateTime),
      durationMinutes: first.durationInMinutes,
      stops,
      transfer: transferKind(stops, cheapest?.po.transferType),
      ...(segs.length ? { segments: segs } : {}),
      ...(cheapest ? { priceCents: cheapest.cents, currency: 'USD', pricedAt } : {}),
      ...(deepLink ? { bookingUrl: deepLink, bookingProvider: agentId ? agents[agentId]?.name ?? 'skyscanner' : 'skyscanner' } : {}),
    });
  }
  return out.sort((a, b) => (a.priceCents ?? Number.MAX_SAFE_INTEGER) - (b.priceCents ?? Number.MAX_SAFE_INTEGER) || a.durationMinutes - b.durationMinutes);
}

export class SkyscannerFlights implements FlightsProvider {
  readonly kind = 'flights' as const;
  readonly name = 'skyscanner';
  readonly mode: 'live' | 'unavailable';
  readonly capabilities: Record<string, boolean>;
  private readonly breaker = new CircuitBreaker();
  private readonly baseUrl: string;

  constructor(private readonly options: SkyscannerOptions = {}) {
    this.mode = options.apiKey ? 'live' : 'unavailable';
    this.capabilities = { search: !!options.apiKey, deepLink: true, book: false, hostedSession: false };
    this.baseUrl = (options.baseUrl ?? SKYSCANNER_BASE_URL).replace(/\/+$/, '');
  }

  validateConfig() {
    return this.options.apiKey ? okConfig() : missingConfig(['SKYSCANNER_API_KEY']);
  }

  async health() {
    return this.options.apiKey ? upHealth('credentials present; live search not probed') : unconfiguredHealth('SKYSCANNER_API_KEY missing');
  }

  deepLink(req: FlightSearchRequest) {
    return flightsHandoff(req);
  }

  private call(path: string, body: unknown): Promise<Result<SkyscannerResponse, ProviderFailure>> {
    return callJson(
      {
        provider: this.name,
        url: `${this.baseUrl}${path}`,
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': this.options.apiKey ?? '' },
          body: JSON.stringify(body),
        },
        timeoutMs: this.options.timeoutMs,
        fetchImpl: this.options.fetchImpl,
        breaker: this.breaker,
        sleep: this.options.sleep,
      },
      (json) => response.parse(json),
    );
  }

  async search(req: FlightSearchRequest): Promise<Result<LiveSnapshot<FlightResult[]>, ProviderFailure>> {
    if (!this.options.apiKey) return err(failure(this.name, 'unconfigured', GUEST_MESSAGES.unconfigured));
    try {
      assertFlightSearchRequest(req);
    } catch (cause) {
      return err(failure(this.name, 'bad_request', GUEST_MESSAGES.bad_request, { raw: cause }));
    }
    const [y1, m1, d1] = req.departDate.split('-').map(Number);
    type QueryLeg = { originPlaceId: { iata: string }; destinationPlaceId: { iata: string }; date: { year: number; month: number; day: number } };
    const legs: QueryLeg[] = [{ originPlaceId: { iata: req.origin.toUpperCase() }, destinationPlaceId: { iata: req.destination ?? 'ORD' }, date: { year: y1!, month: m1!, day: d1! } }];
    if (req.returnDate) {
      const [y2, m2, d2] = req.returnDate.split('-').map(Number);
      legs.push({ originPlaceId: { iata: req.destination ?? 'ORD' }, destinationPlaceId: { iata: req.origin.toUpperCase() }, date: { year: y2!, month: m2!, day: d2! } });
    }
    // The API wants ages; we only hold counts. Ages are not shown to guests, and results say "refresh before booking".
    const childrenAges = Array.from({ length: req.children ?? 0 }, () => 10);
    const query = {
      query: {
        market: this.options.market ?? 'US',
        locale: this.options.locale ?? 'en-US',
        currency: this.options.currency ?? 'USD',
        queryLegs: legs,
        adults: req.adults,
        childrenAges,
        cabinClass: CABIN[req.cabin ?? 'economy'],
        nearbyAirports: false,
      },
    };
    let res = await this.call(CREATE_PATH, query);
    const maxPolls = this.options.maxPolls ?? 6;
    const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    for (let polls = 0; res.ok && res.value.status !== 'RESULT_STATUS_COMPLETE' && polls < maxPolls; polls++) {
      if (res.value.status === 'RESULT_STATUS_FAILED') return err(failure(this.name, 'server', GUEST_MESSAGES.server, { raw: res.value.status }));
      await sleep(this.options.pollIntervalMs ?? 1_000);
      res = await this.call(`${POLL_PATH}${encodeURIComponent(res.value.sessionToken)}`, {});
    }
    if (!res.ok) return res;
    const now = (this.options.now ?? (() => new Date()))().toISOString();
    return ok({ provider: this.name, retrievedAt: now, ttlSeconds: TTL_SECONDS, data: normalizeSkyscannerResults(res.value, req, now) });
  }
}
