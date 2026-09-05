'use server';

import { searchTravelOptions } from '@/capabilities/travel';
import type { TravelSearchOutcome } from '@/domain/travel';
import { field, runAsUi, toFormError, type FormError } from './_shared/server';

export type SearchFormState =
  | { status: 'idle'; values: Record<string, string> }
  | { status: 'ok'; outcome: TravelSearchOutcome; values: Record<string, string> }
  | { status: 'error'; error: FormError; values: Record<string, string> };

const FLIGHT_FIELDS = ['origin', 'destination', 'departDate', 'returnDate', 'adults', 'children', 'cabin', 'nonstopOnly'] as const;
const HOTEL_FIELDS = ['checkIn', 'checkOut', 'adults', 'children', 'rooms'] as const;

/** Runs only when the guest presses Search: the page itself never calls a live partner. */
export async function searchAction(_prev: SearchFormState, fd: FormData): Promise<SearchFormState> {
  const kind = field.str(fd, 'kind') === 'hotels' ? 'hotels' : 'flights';
  const values = field.values(fd, kind === 'hotels' ? HOTEL_FIELDS : FLIGHT_FIELDS);
  const input =
    kind === 'hotels'
      ? { kind, checkIn: field.str(fd, 'checkIn'), checkOut: field.str(fd, 'checkOut'), adults: field.int(fd, 'adults'), children: field.int(fd, 'children'), rooms: field.int(fd, 'rooms') }
      : {
          kind,
          origin: field.str(fd, 'origin'),
          destination: field.str(fd, 'destination'),
          departDate: field.str(fd, 'departDate'),
          returnDate: field.str(fd, 'returnDate'),
          adults: field.int(fd, 'adults'),
          children: field.int(fd, 'children'),
          cabin: field.str(fd, 'cabin'),
          nonstopOnly: field.bool(fd, 'nonstopOnly'),
        };
  const r = await runAsUi(searchTravelOptions, input);
  return r.ok ? { status: 'ok', outcome: r.value.data, values } : { status: 'error', error: toFormError(r.error), values };
}
