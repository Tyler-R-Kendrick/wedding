import type { ExternalHandoff, LiveSnapshot, ProviderDescriptor, ProviderFailure } from '@/contracts/providers';
import type { Result } from '@/contracts/result';

export const CHICAGO_AIRPORTS = ['ORD', 'MDW'] as const;
export type ChicagoAirport = (typeof CHICAGO_AIRPORTS)[number];

export const FLIGHT_CABINS = ['economy', 'premium_economy', 'business', 'first'] as const;
export type FlightCabin = (typeof FLIGHT_CABINS)[number];

export interface FlightSearchRequest {
  /** IATA code of the guest's origin airport. */
  origin: string;
  destination?: ChicagoAirport;
  /** YYYY-MM-DD */
  departDate: string;
  returnDate?: string;
  adults: number;
  children?: number;
  cabin?: FlightCabin;
  /** Only itineraries with zero stops. */
  nonstopOnly?: boolean;
}

/**
 * How connections are protected. "protected" means one ticket with one carrier responsible
 * for a missed connection; "self_transfer" means separate tickets where the guest carries the
 * risk. Guests must see this label next to every price.
 */
export type TransferKind = 'nonstop' | 'protected' | 'self_transfer';

export interface FlightSegment {
  carrier: string;
  carrierCode?: string;
  flightNumber?: string;
  origin: string;
  destination: string;
  departAt: string;
  arriveAt: string;
}

export interface FlightResult {
  id: string;
  carrier: string;
  carrierCode?: string;
  origin: string;
  destination: string;
  departAt: string;
  arriveAt: string;
  durationMinutes: number;
  stops: number;
  transfer: TransferKind;
  segments?: FlightSegment[];
  priceCents?: number;
  currency?: string;
  /** When this price was observed. Guests are told to refresh before booking. */
  pricedAt?: string;
  /** Deep link for this specific itinerary, when the provider offers one (allowlisted). */
  bookingUrl?: string;
  /** Who fulfils `bookingUrl` (an OTA or the airline), when known. */
  bookingProvider?: string;
}

/** Request for a hosted booking flow (Duffel Links). The reference ties the session to a trip item. */
export interface HostedSessionRequest {
  /** Our itinerary item id; comes back on the provider's order/webhook so the trip bridge can match it. */
  reference: string;
  successUrl: string;
  failureUrl: string;
  abandonUrl: string;
  /** Optional prefill hints. */
  origin?: string;
  destination?: string;
  departDate?: string;
  returnDate?: string;
  adults?: number;
}

/** A provider-side booking event (order created/changed) after signature verification. */
export interface ProviderBookingEvent {
  id: string;
  type: string;
  createdAt: string;
  /** The hosted-session reference we issued (our itinerary item id), when the provider echoes it. */
  reference?: string;
  orderId: string;
  bookingReference?: string;
  slices: Array<{ origin?: string; destination?: string; departAt?: string; arriveAt?: string; carrier?: string; flightNumber?: string }>;
}

/** Signed inbound webhooks. Only adapters with a configured secret expose this; verification never throws. */
export interface ProviderWebhook {
  verify(rawBody: string, signatureHeader: string | null | undefined, now?: number): Result<void, ProviderFailure>;
  parse(body: unknown): Result<ProviderBookingEvent, ProviderFailure>;
}

export interface FlightsProvider extends ProviderDescriptor {
  kind: 'flights';
  search(request: FlightSearchRequest): Promise<Result<LiveSnapshot<FlightResult[]>, ProviderFailure>>;
  /** Always available: hands the guest to a search site with the request pre-filled. */
  deepLink(request: FlightSearchRequest): ExternalHandoff;
  /** Hosted checkout (Duffel Links). Absent when the adapter cannot create sessions. Never takes payment on our site. */
  createHostedSession?(request: HostedSessionRequest): Promise<Result<ExternalHandoff, ProviderFailure>>;
  /** Present when the adapter can verify provider webhooks (the trusted path to "confirmed"). */
  webhook?: ProviderWebhook;
}
