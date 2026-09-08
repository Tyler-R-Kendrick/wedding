/**
 * The admin console's index. Every admin screen in the app appears here exactly once; the layout
 * nav, the console home page and the "you are here" markers all read this one list, so a screen
 * that ships without an entry is a screen nobody can find.
 *
 * `entitlement` is documentation, not authorization — every page re-checks server-side inside the
 * capability pipeline, and a link the reader cannot use is still worth showing so they know it exists.
 */
export interface AdminScreen {
  href: string;
  label: string;
  blurb: string;
  entitlement: string;
}

export interface AdminSection {
  id: string;
  label: string;
  screens: AdminScreen[];
}

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  {
    id: 'site',
    label: 'The site',
    screens: [
      { href: '/admin/lifecycle', label: 'Lifecycle', blurb: 'What state guests see, what the calendar suggests, and previewing another state.', entitlement: 'admin_lifecycle' },
      { href: '/admin/flags', label: 'Feature flags', blurb: 'Both halves of every gate, and the two legal switches that stay shut.', entitlement: 'admin_lifecycle' },
      { href: '/admin/content', label: 'Content', blurb: 'Records with provenance, freshness and verification.', entitlement: 'admin_content' },
      { href: '/admin/events', label: 'Events & RSVP window', blurb: 'Events, meal options, notices, and when RSVP opens.', entitlement: 'admin_content' },
    ],
  },
  {
    id: 'guests',
    label: 'Guests',
    screens: [
      { href: '/admin/guests', label: 'Guests', blurb: 'People, households they belong to, identity resets.', entitlement: 'admin_guest_ops' },
      { href: '/admin/households', label: 'Households', blurb: 'Household records and mailing addresses.', entitlement: 'admin_guest_ops' },
      { href: '/admin/invitations', label: 'Invitations', blurb: 'Issue, rotate and revoke invitation links.', entitlement: 'admin_guest_ops' },
      { href: '/admin/rsvp', label: 'RSVPs', blurb: 'Who has replied, overrides and exports.', entitlement: 'admin_guest_ops' },
      { href: '/admin/seating', label: 'Seating', blurb: 'Tables, assignments and publishing the chart.', entitlement: 'admin_guest_ops' },
    ],
  },
  {
    id: 'weekend',
    label: 'The weekend',
    screens: [
      { href: '/admin/travel', label: 'Travel & stay', blurb: 'Hotels, links and the room block.', entitlement: 'admin_content' },
      { href: '/admin/transport', label: 'Transport', blurb: 'Benefit entitlements and voucher codes.', entitlement: 'admin_guest_ops' },
      { href: '/admin/gifts', label: 'Gifts', blurb: 'Registry and gift links.', entitlement: 'admin_content' },
      { href: '/admin/reservations', label: 'Reservations', blurb: 'Venues guests can book through.', entitlement: 'admin_content' },
    ],
  },
  {
    id: 'media',
    label: 'Media & AI',
    screens: [
      { href: '/admin/media', label: 'Media', blurb: 'Moderation queue, imports and duplicates.', entitlement: 'admin_media' },
      { href: '/admin/ai', label: 'Media AI', blurb: 'Captions, indexing and what the model may touch.', entitlement: 'admin_ai' },
      { href: '/admin/concierge', label: 'Concierge', blurb: 'Answer traces, grounding failures, security alerts.', entitlement: 'admin_ai' },
      { href: '/admin/biometrics', label: 'Face matching', blurb: 'BIPA readiness, consent ledger, deletions.', entitlement: 'admin_ai' },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    screens: [
      { href: '/admin/audit', label: 'Audit trail', blurb: 'Every action anyone took, searchable, redacted.', entitlement: 'admin_audit' },
      { href: '/admin/jobs', label: 'Jobs', blurb: 'Queue depth, failures and retries.', entitlement: 'admin_integrations' },
      { href: '/admin/metrics', label: 'Metrics', blurb: 'What this deployment recorded, and whether it is recording.', entitlement: 'admin_integrations' },
      { href: '/admin/providers', label: 'Providers', blurb: 'Which adapter each integration resolved to, and what it can do.', entitlement: 'admin_integrations' },
    ],
  },
];

export const ADMIN_SCREENS: readonly AdminScreen[] = ADMIN_SECTIONS.flatMap((s) => s.screens);
