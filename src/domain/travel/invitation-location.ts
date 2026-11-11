import type { GuestId } from '@/contracts/ids';
import type { Db } from '@/db/client';
import { getGuest } from '@/domain/guests/repo';
import { getHousehold } from '@/domain/households/repo';
import type { LocationSuggestion } from './types';
import { coordinatesFromMailingAddress } from './geo';
import { nearestCommercialAirports } from './nearest-airports';
import { CHICAGO_AIRPORTS } from '@/providers/flights/types';

/** Maps a guest's household mailing address to a coarse city/region + nearest airport suggestion. */
export async function invitationLocationSuggestion(db: Db, guestId: GuestId): Promise<LocationSuggestion | null> {
  const guest = await getGuest(db, guestId);
  if (!guest) return null;
  const household = await getHousehold(db, guest.householdId);
  const addr = household?.mailingAddress;
  if (!addr) return null;
  const point = coordinatesFromMailingAddress(addr);
  const nearest = point ? nearestCommercialAirports(point, { limit: 1, exclude: CHICAGO_AIRPORTS })[0] : undefined;
  const city = addr.city?.trim();
  const region = addr.region?.trim();
  if (!city && !region && !nearest) return null;
  return {
    source: 'invitation',
    ...(city ? { city } : {}),
    ...(region ? { region } : {}),
    ...(nearest ? { airport: nearest.iata } : {}),
  };
}
