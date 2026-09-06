import type { AnyCapability } from '@/contracts/capability';
import { installDbManualCodeSource } from '@/domain/transport/manual-codes';
/*
 * Swarm G shipped a second principal resolver here — a `wedding-dev-principal` cookie behind
 * `DEV_TEST_PRINCIPALS`, installed as an import side effect of this production barrel. Its own doc
 * comment called it a stand-in "until the identity swarm's Better Auth resolver is wired", and that
 * resolver is wired as of level 06, so it is deleted rather than carried.
 *
 * Two reasons beyond it being redundant. Level 07 deliberately moved the identity injector OUT of a
 * capability barrel because installing a resolver as an import side effect makes the wrap order
 * against the real one depend on module load timing; re-introducing that here would undo it. And a
 * cookie-named principal is a far worse shape than a header plus a >=16-char secret gated on
 * NODE_ENV=test: cookies travel automatically. The three specs that used it now use identity's
 * injector, which expresses everything they needed (`entitlements` for `noclaim`,
 * `authenticatedAt` for `stale`).
 */
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
