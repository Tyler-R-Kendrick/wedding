import type { AnyCapability } from '@/contracts/capability';
import { registerRsvpJobs } from '@/domain/rsvp/email';
import { installTestPrincipalResolver } from '@/domain/testing/testPrincipal';
import { adminEventCapabilities } from '@/capabilities/events/admin_events';
import { adminSeatingCapabilities } from '@/capabilities/seating/admin_seating';
import { getMyTable } from '@/capabilities/seating/get_my_table';
import { showMyTableOnFloorplan } from '@/capabilities/seating/show_my_table_on_floorplan';
import { getMyItinerary } from '@/capabilities/weekend/get_my_itinerary';
import { adminRsvpCapabilities } from './admin_rsvp';
import { draftRsvp } from './draft_rsvp';
import { getMyRsvp } from './get_my_rsvp';
import { listMyEvents } from './list_my_events';
import { submitRsvp } from './submit_rsvp';

// Server-only module: wires the job handler and the test-only principal injector when the capability registry loads.
registerRsvpJobs();
installTestPrincipalResolver();

/** Swarm E: events, RSVP, Your Weekend, seating — one list for src/capabilities/index.ts. */
export const rsvpSwarmCapabilities: readonly AnyCapability[] = [
  listMyEvents,
  getMyRsvp,
  draftRsvp,
  submitRsvp,
  getMyItinerary,
  getMyTable,
  showMyTableOnFloorplan,
  ...adminEventCapabilities,
  ...adminRsvpCapabilities,
  ...adminSeatingCapabilities,
];

export { listMyEvents, getMyRsvp, draftRsvp, submitRsvp, getMyItinerary, getMyTable, showMyTableOnFloorplan };
export { adminListEvents, adminUpsertEvent, adminSetMealOptions, adminSetEventEntitlements, adminSetRsvpWindow, adminUpsertNotice } from '@/capabilities/events/admin_events';
export { adminRsvpOverview, adminExportRsvp, adminExportNeeds, adminOverrideRsvp, overviewToCsv, needsToCsv } from './admin_rsvp';
export { adminSeatingOverview, adminUpsertTable, adminDeleteTable, adminAssignSeats, adminImportSeatingCsv, adminPublishSeating, adminUnpublishSeating } from '@/capabilities/seating/admin_seating';
export type { MyRsvp } from './get_my_rsvp';
export type { MyEvents } from './list_my_events';
export type { DraftRsvpOutput } from './draft_rsvp';
export type { SubmitRsvpOutput, SubmitRsvpInput } from './schemas';
export type { MyItinerary } from '@/capabilities/weekend/get_my_itinerary';
export type { MyTable } from '@/capabilities/seating/get_my_table';
export type { AdminEventsView } from '@/capabilities/events/admin_events';
export type { AdminRsvpOverview } from './admin_rsvp';
export type { AdminSeatingOverview } from '@/capabilities/seating/admin_seating';
