import type { AdminIconName } from '@/components/admin/shell/icons';

/**
 * The admin console's index. Every admin screen in the app appears here exactly once; the rail, the
 * command palette, the breadcrumb and the "you are here" markers all read this one list, so a screen
 * that ships without an entry is a screen nobody can find.
 *
 * `entitlement` is documentation, not authorization — every page re-checks server-side inside the
 * capability pipeline, and a link the reader cannot use is still worth showing so they know it exists.
 *
 * `blurb` is what the command palette searches and shows; the rail shows the label alone. `words`
 * are other things a person types when they mean this screen.
 */
export interface AdminScreen {
  href: string;
  label: string;
  blurb: string;
  entitlement: string;
  icon: AdminIconName;
  words?: string;
}

export interface AdminSection {
  id: string;
  /** Empty for the lead group (Overview, Assistant), which needs no heading. */
  label: string;
  screens: AdminScreen[];
}

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  {
    id: 'home',
    label: '',
    screens: [
      { href: '/admin', label: 'Overview', blurb: 'What needs you today, and how the site is doing.', entitlement: 'any administrator', icon: 'overview', words: 'home dashboard today attention' },
      { href: '/admin/assistant', label: 'Assistant', blurb: 'Ask about guests, replies, visits and errors; plan and make changes.', entitlement: 'any administrator', icon: 'ask', words: 'ask chat ai question plan change' },
    ],
  },
  {
    id: 'guests',
    label: 'Guests',
    screens: [
      { href: '/admin/guests', label: 'Guests', blurb: 'People, their households, sign-in resets.', entitlement: 'admin_guest_ops', icon: 'guests', words: 'people person list import add' },
      { href: '/admin/households', label: 'Households', blurb: 'Who is invited together, and mailing addresses.', entitlement: 'admin_guest_ops', icon: 'household', words: 'family address' },
      { href: '/admin/invitations', label: 'Invitations', blurb: 'Issue, rotate and revoke invitation links.', entitlement: 'admin_guest_ops', icon: 'invitation', words: 'invite link send' },
      { href: '/admin/rsvp', label: 'RSVPs', blurb: 'Who has replied, meals, overrides, exports.', entitlement: 'admin_guest_ops', icon: 'rsvp', words: 'replies coming meal headcount export' },
      { href: '/admin/seating', label: 'Seating', blurb: 'Tables, assignments, publishing the chart.', entitlement: 'admin_guest_ops', icon: 'seating', words: 'tables chart seats' },
    ],
  },
  {
    id: 'weekend',
    label: 'Weekend',
    screens: [
      { href: '/admin/events', label: 'Events', blurb: 'Events, meal options, notices, the RSVP window.', entitlement: 'admin_content', icon: 'events', words: 'schedule ceremony reception meals notices rsvp window' },
      { href: '/admin/travel', label: 'Travel & stay', blurb: 'Hotels, links, the room block.', entitlement: 'admin_content', icon: 'travel', words: 'hotel room block flights' },
      { href: '/admin/transport', label: 'Transport', blurb: 'Ride benefits and voucher codes.', entitlement: 'admin_guest_ops', icon: 'transport', words: 'rides uber vouchers shuttle' },
      { href: '/admin/gifts', label: 'Gifts', blurb: 'Registry and gift links.', entitlement: 'admin_content', icon: 'gifts', words: 'registry funds' },
      { href: '/admin/reservations', label: 'Reservations', blurb: 'Venues guests can book through.', entitlement: 'admin_content', icon: 'reservations', words: 'restaurants booking dinner' },
    ],
  },
  {
    id: 'site',
    label: 'Site',
    screens: [
      { href: '/admin/lifecycle', label: 'Lifecycle', blurb: 'The state guests see, the calendar, previews.', entitlement: 'admin_lifecycle', icon: 'lifecycle', words: 'publish state preview teaser rsvp open' },
      { href: '/admin/content', label: 'Content', blurb: 'Records with provenance and freshness.', entitlement: 'admin_content', icon: 'content', words: 'copy story faq venue verify stale' },
      { href: '/admin/flags', label: 'Flags', blurb: 'Feature gates, and the legal switches that stay shut.', entitlement: 'admin_lifecycle', icon: 'flags', words: 'feature toggle switch' },
      { href: '/admin/sitemap', label: 'Sitemap', blurb: 'Every endpoint the app serves.', entitlement: 'any administrator', icon: 'sitemap', words: 'routes pages endpoints' },
    ],
  },
  {
    id: 'media',
    label: 'Media',
    screens: [
      { href: '/admin/media', label: 'Media', blurb: 'Moderation queue, imports, duplicates.', entitlement: 'admin_media', icon: 'media', words: 'photos video uploads moderate' },
      { href: '/admin/ai', label: 'Search index', blurb: 'Captions, indexing, what the model may touch.', entitlement: 'admin_ai', icon: 'index', words: 'media ai captions embeddings' },
      { href: '/admin/concierge', label: 'Concierge', blurb: 'Answer traces, grounding failures, alerts.', entitlement: 'admin_ai', icon: 'concierge', words: 'questions answers ask us traces' },
    ],
  },
  {
    id: 'insight',
    label: 'Insight',
    screens: [
      { href: '/admin/sessions', label: 'Sessions', blurb: 'Who visited, the pages they opened, where they left.', entitlement: 'admin_integrations', icon: 'sessions', words: 'visits traffic pageviews analytics users' },
      { href: '/admin/errors', label: 'Errors', blurb: 'What broke for visitors, grouped, with the page it broke on.', entitlement: 'admin_integrations', icon: 'errors', words: 'bugs exceptions crashes failures' },
      { href: '/admin/metrics', label: 'Metrics', blurb: 'Counters and timings this deployment recorded.', entitlement: 'admin_integrations', icon: 'metrics', words: 'telemetry latency timings counters' },
      { href: '/admin/audit', label: 'Audit trail', blurb: 'Every action anyone took, searchable, redacted.', entitlement: 'admin_audit', icon: 'audit', words: 'log history who changed' },
      { href: '/admin/jobs', label: 'Jobs', blurb: 'Queue depth, failures, retries.', entitlement: 'admin_integrations', icon: 'jobs', words: 'queue background retry dead' },
      { href: '/admin/providers', label: 'Providers', blurb: 'Which adapter backs each integration.', entitlement: 'admin_integrations', icon: 'providers', words: 'integrations email storage adapters health' },
    ],
  },
];

export const ADMIN_SCREENS: readonly AdminScreen[] = ADMIN_SECTIONS.flatMap((s) => s.screens);

/** The screen a path belongs to: the longest `href` that is the path or a parent of it. */
export function screenFor(pathname: string): { section: AdminSection; screen: AdminScreen } | null {
  let best: { section: AdminSection; screen: AdminScreen } | null = null;
  for (const section of ADMIN_SECTIONS) {
    for (const screen of section.screens) {
      const here = pathname === screen.href || (screen.href !== '/admin' && pathname.startsWith(`${screen.href}/`));
      if (here && (!best || screen.href.length > best.screen.href.length)) best = { section, screen };
    }
  }
  return best;
}

/**
 * Sub-navigation within a family of screens.
 *
 * `ADMIN_SECTIONS` above is the index of every screen; these are the strips a person uses while
 * working inside one family, and they exist here rather than in `components/media` and
 * `components/mediaai` because they are console navigation, not media widgets. The two components
 * they replace (`AdminMediaNav`, `AdminAiNav`) each rendered a row of filled buttons in a different
 * stylesheet from the console around them.
 */
export const MEDIA_SUBNAV = [
  { href: '/admin/media', label: 'Queue' },
  { href: '/admin/media/duplicates', label: 'Duplicates' },
  { href: '/admin/media/import', label: 'Import professional media' },
  { href: '/admin/media/metrics', label: 'Storage and cost' },
] as const;

export const INTELLIGENCE_SUBNAV = [
  { href: '/admin/ai', label: 'Search index' },
  { href: '/admin/concierge', label: 'Concierge' },
] as const;
