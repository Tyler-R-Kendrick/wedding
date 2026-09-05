import type { ExternalHandoff } from '@/contracts/providers';
import type { FlightSearchRequest } from './types';

const yymmdd = (iso: string) => iso.replaceAll('-', '').slice(2);

/** Skyscanner search deep link (on the redirect allowlist). No API key, no tracking parameters. */
export function skyscannerFlightsUrl(req: FlightSearchRequest): string {
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
