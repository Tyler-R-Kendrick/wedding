import type { ExternalHandoff } from '@/contracts/providers';
import type { FlightSearchRequest } from './types';

const IATA = /^[A-Za-z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const yymmdd = (iso: string) => iso.replaceAll('-', '').slice(2);

/**
 * Only well-formed codes and dates ever reach the URL path: anything else is a programming error
 * (capability input schemas validate first), so this throws rather than emitting a malformed link.
 */
export function assertFlightSearchRequest(req: FlightSearchRequest): void {
  if (!IATA.test(req.origin)) throw new RangeError('flights: origin must be a 3-letter IATA code');
  if (req.destination !== undefined && !IATA.test(req.destination)) throw new RangeError('flights: destination must be a 3-letter IATA code');
  if (!DATE.test(req.departDate)) throw new RangeError('flights: departDate must be YYYY-MM-DD');
  if (req.returnDate !== undefined && !DATE.test(req.returnDate)) throw new RangeError('flights: returnDate must be YYYY-MM-DD');
  if (!Number.isInteger(req.adults) || req.adults < 1 || req.adults > 9) throw new RangeError('flights: adults must be 1-9');
  if (req.children !== undefined && (!Number.isInteger(req.children) || req.children < 0 || req.children > 9)) throw new RangeError('flights: children must be 0-9');
}

/** Skyscanner search deep link (on the redirect allowlist). No API key, no tracking parameters. */
export function skyscannerFlightsUrl(req: FlightSearchRequest): string {
  assertFlightSearchRequest(req);
  const from = req.origin.toLowerCase();
  const to = (req.destination ?? 'ORD').toLowerCase();
  const path = req.returnDate ? `${from}/${to}/${yymmdd(req.departDate)}/${yymmdd(req.returnDate)}/` : `${from}/${to}/${yymmdd(req.departDate)}/`;
  const params = new URLSearchParams({ adults: String(req.adults), adultsv2: String(req.adults), cabinclass: 'economy', rtn: req.returnDate ? '1' : '0' });
  if (req.children) params.set('children', String(req.children));
  return `https://www.skyscanner.com/transport/flights/${path}?${params.toString()}`;
}

export function flightsHandoff(req: FlightSearchRequest): ExternalHandoff {
  return {
    provider: 'skyscanner',
    label: 'Continue on Skyscanner',
    url: skyscannerFlightsUrl(req),
    opensNewTab: true,
    disclosure: 'You will leave our site to compare and book flights with Skyscanner. We never see your payment details.',
  };
}
