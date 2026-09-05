import type { ExternalHandoff, LiveSnapshot, ProviderDescriptor, ProviderFailure } from '@/contracts/providers';
import type { Result } from '@/contracts/result';

export interface HotelSearchRequest {
  /** YYYY-MM-DD */
  checkIn: string;
  checkOut: string;
  adults: number;
  children?: number;
  rooms?: number;
  /** Free-text area; defaults to the venue neighbourhood. */
  area?: string;
}

export interface HotelResult {
  id: string;
  name: string;
  address?: string;
  /** Walking minutes to the venue when known. */
  walkMinutesToVenue?: number;
  nightlyCents?: number;
  totalCents?: number;
  currency?: string;
  /** When this rate was observed. Guests are told to refresh before booking. */
  pricedAt?: string;
  bookingUrl?: string;
  /** True for the venue hotel itself (room block guidance comes from the planner). */
  isVenue?: boolean;
}

export interface HotelsProvider extends ProviderDescriptor {
  kind: 'hotels';
  search(request: HotelSearchRequest): Promise<Result<LiveSnapshot<HotelResult[]>, ProviderFailure>>;
  deepLink(request: HotelSearchRequest): ExternalHandoff;
  /** Handoff to the venue hotel's official site. Group-block links are admin-configured, never hard-coded. */
  venueHandoff(): ExternalHandoff;
}
