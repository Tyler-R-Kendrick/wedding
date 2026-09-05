import { MockReservations } from './mock';
import type { ReservationsProvider } from './types';

export * from './types';
export { MockReservations, reservationDeepLink } from './mock';

export function createReservationsProvider(): ReservationsProvider {
  return new MockReservations();
}
