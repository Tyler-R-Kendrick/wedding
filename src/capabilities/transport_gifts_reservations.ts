import type { AnyCapability } from '@/contracts/capability';
import { installDevPrincipalResolver } from '@/domain/external/dev-principals';
import { installDbManualCodeSource } from '@/domain/transport/manual-codes';
import { env } from '@/lib/env';
import { adminListExternalActions } from './admin_external_actions';
import { adminGiftCapabilities } from './admin_gifts';
import { adminReservationCapabilities } from './admin_reservations';
import { adminTransportCapabilities } from './admin_transport';
import { claimMyTransportationBenefit } from './claim_my_transportation_benefit';
import { draftMyTransportationClaim } from './draft_my_transportation_claim';
import { getMyTransportationOptions } from './get_my_transportation_options';
import { getReservationOptions } from './get_reservation_options';
import { listGiftLinksCapability } from './list_gift_links';
import { openGiftLink } from './open_gift_link';
import { openReservationLink } from './open_reservation_link';
import { prepareReservation } from './prepare_reservation';

/**
 * Level 09: ride benefits, gifts, reservations, external action records. Registered from
 * src/capabilities/index.ts with one line. Loading this module also installs the seams the
 * level needs at boot: the DB-backed manual code source and (development only) the cookie
 * principal resolver used by e2e until the identity swarm's resolver lands.
 */
installDbManualCodeSource();
installDevPrincipalResolver({ enabled: env.DEV_TEST_PRINCIPALS, isProduction: env.isProduction });

export const transportGiftsReservationsCapabilities: readonly AnyCapability[] = [
  getMyTransportationOptions,
  draftMyTransportationClaim,
  claimMyTransportationBenefit,
  listGiftLinksCapability,
  openGiftLink,
  getReservationOptions,
  prepareReservation,
  openReservationLink,
  ...adminTransportCapabilities,
  ...adminGiftCapabilities,
  ...adminReservationCapabilities,
  adminListExternalActions,
];

export {
  getMyTransportationOptions,
  draftMyTransportationClaim,
  claimMyTransportationBenefit,
  listGiftLinksCapability,
  openGiftLink,
  getReservationOptions,
  prepareReservation,
  openReservationLink,
  adminListExternalActions,
};
