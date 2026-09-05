import type { ExternalHandoff, LiveSnapshot, ProviderDescriptor, ProviderFailure } from '@/contracts/providers';
import type { Result } from '@/contracts/result';

export const CHICAGO_AIRPORTS = ['ORD', 'MDW'] as const;
export type ChicagoAirport = (typeof CHICAGO_AIRPORTS)[number];

export interface FlightSearchRequest {
  /** IATA code of the guest's origin airport. */
  origin: string;
  destination?: ChicagoAirport;
  /** YYYY-MM-DD */
  departDate: string;
  returnDate?: string;
  adults: number;
  children?: number;
}

export interface FlightResult {
  id: string;
  carrier: string;
  origin: string;
  destination: string;
  departAt: string;
  arriveAt: string;
  durationMinutes: number;
  stops: number;
  priceCents?: number;
  currency?: string;
  /** Deep link for this specific itinerary, when the provider offers one. */
  bookingUrl?: string;
}

export interface FlightsProvider extends ProviderDescriptor {
  kind: 'flights';
  search(request: FlightSearchRequest): Promise<Result<LiveSnapshot<FlightResult[]>, ProviderFailure>>;
  /** Always available: hands the guest to a search site with the request pre-filled. */
  deepLink(request: FlightSearchRequest): ExternalHandoff;
}
