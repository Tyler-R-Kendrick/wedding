import type { SitemapPage, SitemapSection } from './types';

/**
 * THE sitemap. Source of truth for every stage of the pipeline (stages/README.md).
 *
 * Jobs, audiences and lifecycle visibility come from PRODUCT.md "Surfaces"; navigation labels are
 * the ones the real app shows (`src/domain/lifecycle/nav.ts` reads them from here). Editing a row
 * cascades: stage 2 redraws, stage 3 re-links, stage 4 re-dresses, and the real app's route test
 * (`tests/unit/stages/sitemap-routes.test.ts`) fails until `src/app` serves the path.
 */
export const SECTIONS: SitemapSection[] = [
  { id: 'public', title: 'Public', audience: 'public', blurb: 'Anyone with the link: the story, the place, the plan.' },
  { id: 'guest', title: 'Guests', audience: 'guest', blurb: 'An invited household, signed in: their weekend, their RSVP, their trip, the registry and the photos. Reached only from the account menu.' },
  { id: 'gate', title: 'Doors', audience: 'gate', blurb: 'How a guest gets from an invitation link to a session.' },
  { id: 'admin', title: 'Admin', audience: 'admin', blurb: 'Sara, Tyler and the planner run the site from here.' },
];

export const PAGES: SitemapPage[] = [
  // ── Public ────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'home', path: '/', title: 'Home', parent: null, audience: 'public', mode: ['inform', 'act'], visibleFrom: 'TEASER', inNav: true,
    job: 'Names, date and place, the one action that matters in the current state, and a way into the story.',
    primaryAction: { label: 'RSVP', to: 'rsvp' },
    notes: ['The primary action changes with the lifecycle state (save the date → open your invitation → RSVP → today).'],
  },
  {
    id: 'story', path: '/our-story', title: 'Our Story', parent: null, audience: 'public', mode: ['celebrate'], visibleFrom: 'TEASER', inNav: true,
    job: 'How we met, how it grew, the engagement, and what marriage means to us — told in chapters.',
    primaryAction: { label: 'Our Adventures', to: 'adventures' },
  },
  {
    id: 'adventures', path: '/our-adventures', title: 'Our Adventures', parent: null, audience: 'public', mode: ['celebrate'], visibleFrom: 'TEASER', inNav: true,
    job: 'An atlas of places we have been, each with "Sara remembers / Tyler remembers".',
    primaryAction: { label: 'Share an Adventure', to: 'share' },
  },
  {
    id: 'adventure', path: '/our-adventures/[slug]', example: '/our-adventures/example', title: 'An adventure', parent: 'adventures', audience: 'public', mode: ['celebrate'], visibleFrom: 'TEASER',
    job: 'One place: where, when, photos, and both of our memories of it.',
    primaryAction: { label: 'Back to the atlas', to: 'adventures' },
  },
  {
    id: 'share', path: '/share-an-adventure', title: 'Share an Adventure', parent: null, audience: 'public', mode: ['inform', 'celebrate'], visibleFrom: 'SAVE_THE_DATE', inNav: true,
    job: 'Places we recommend around Chicago: a practical layer and a memory layer, itineraries by duration and mode.',
  },
  {
    id: 'share-item', path: '/share-an-adventure/[slug]', example: '/share-an-adventure/example', title: 'A recommendation', parent: 'share', audience: 'public', mode: ['inform'], visibleFrom: 'SAVE_THE_DATE',
    job: 'One recommendation: what it is, how to get there from the venue, why we love it.',
    primaryAction: { label: 'All recommendations', to: 'share' },
  },
  {
    id: 'wedding', path: '/the-wedding', title: 'The Wedding', parent: null, audience: 'public', mode: ['inform'], visibleFrom: 'INVITATIONS_OPEN', inNav: true,
    job: 'Ceremony, cocktail hour and reception: rooms, times, dress code and accessibility.',
    primaryAction: { label: 'RSVP', to: 'rsvp' },
  },
  {
    id: 'caa', path: '/our-venue', title: 'Our Venue', parent: null, audience: 'public', mode: ['celebrate', 'inform'], visibleFrom: 'TEASER', inNav: true,
    job: 'A docent for the building: spaces, history with sources, things to look for, and where your table is.',
  },
  {
    id: 'caa-space', path: '/our-venue/[slug]', example: '/our-venue/example', title: 'A space in the building', parent: 'caa', audience: 'public', mode: ['celebrate', 'inform'], visibleFrom: 'TEASER',
    job: 'One room or feature of the building, its history and what to look for.',
    primaryAction: { label: 'Back to the building', to: 'caa' },
  },
  {
    id: 'travel', path: '/travel', title: 'Travel & Stay', parent: null, audience: 'public', mode: ['inform', 'act'], visibleFrom: 'SAVE_THE_DATE', inNav: true,
    job: 'Airports, the room block, other hotels, the neighbourhood and what the weather will be like.',
    primaryAction: { label: 'Plan your trip', to: 'trip' },
  },
  {
    id: 'ask', path: '/ask-us', title: 'Ask Us', parent: null, audience: 'public', mode: ['inform'], visibleFrom: 'TEASER', inNav: true,
    job: 'A concierge that answers questions about the weekend from what we have published, with citations.',
  },
  {
    id: 'credits', path: '/credits', title: 'Photo credits', parent: null, audience: 'public', mode: ['inform'], visibleFrom: 'TEASER',
    job: 'Who made every image on the site, and under what licence.',
  },

  // ── Guests ────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'weekend', path: '/your-weekend', title: 'Your Weekend', parent: null, audience: 'guest', mode: ['act'], visibleFrom: 'INVITATIONS_OPEN', inNav: true,
    job: 'Your household\'s hub: invitation, RSVP status, your table, ride benefits and preferences.',
    primaryAction: { label: 'RSVP', to: 'rsvp' },
  },
  {
    id: 'rsvp', path: '/rsvp', title: 'RSVP', parent: 'weekend', audience: 'guest', mode: ['act'], visibleFrom: 'RSVP_OPEN', inNav: true,
    job: 'Reply for the household in parts — attendance, a guest, meals, needs — each finished on its own.',
    primaryAction: { label: 'Who is coming', to: 'rsvp-step' },
    notes: ['Keyboard-complete. Every part opens and saves independently; none depends on another being done first.'],
  },
  {
    id: 'rsvp-step', path: '/rsvp/[step]', example: '/rsvp/attending', title: 'An RSVP part', parent: 'rsvp', audience: 'guest', mode: ['act'], visibleFrom: 'RSVP_OPEN',
    job: 'One part of the reply: who is coming, bringing a guest, meals, or dietary and access needs.',
    primaryAction: { label: 'Back to your RSVP', to: 'rsvp' },
  },
  {
    id: 'transport', path: '/transportation', title: 'Transportation', parent: 'weekend', audience: 'guest', mode: ['inform', 'act'], visibleFrom: 'INVITATIONS_OPEN', inNav: true,
    job: 'Valet, transit, rides and your ride voucher, parking and accessibility.',
  },
  {
    id: 'trip', path: '/trip', title: 'Your trip', parent: 'weekend', audience: 'guest', mode: ['act'], visibleFrom: 'INVITATIONS_OPEN',
    job: 'Your flights and hotel, kept in one place so we can help if plans change.',
  },
  {
    id: 'gifts', path: '/gifts', title: 'Gifts', parent: null, audience: 'guest', mode: ['act'], visibleFrom: 'RSVP_OPEN', inNav: true,
    job: '"Help us with our next adventures": registry links and person-to-person funds.',
  },
  {
    id: 'photos', path: '/photos', title: 'Photos & Video', parent: null, audience: 'guest', mode: ['celebrate'], visibleFrom: 'TEASER', inNav: true,
    job: 'Engagement photos, guest uploads and the professional galleries, each by its rights.',
    primaryAction: { label: 'Add your photos', to: 'media-upload' },
  },
  {
    id: 'photo-collection', path: '/photos/[collection]', example: '/photos/example', title: 'A collection', parent: 'photos', audience: 'guest', mode: ['celebrate'], visibleFrom: 'TEASER',
    job: 'One gallery, with credits and a way to download what its rights allow.',
    primaryAction: { label: 'All collections', to: 'photos' },
  },
  {
    id: 'media-upload', path: '/media/upload', title: 'Add photos', parent: 'photos', audience: 'guest', mode: ['act'], visibleFrom: 'WEDDING_DAY',
    job: 'Upload photos and videos from the weekend; say who may see them.',
  },
  {
    id: 'media-mine', path: '/media/mine', title: 'Your uploads', parent: 'photos', audience: 'guest', mode: ['act'], visibleFrom: 'WEDDING_DAY',
    job: 'What you have uploaded, its visibility, and a way to take anything down.',
  },
  {
    id: 'media-search', path: '/media/search', title: 'Find photos', parent: 'photos', audience: 'guest', mode: ['celebrate'], visibleFrom: 'POST_WEDDING',
    job: 'Search the weekend\'s photos by moment, place or people you are allowed to see.',
  },

  // ── Doors ─────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'sign-in', path: '/sign-in', title: 'Sign in', parent: null, audience: 'gate', mode: ['gate'], visibleFrom: 'TEASER',
    job: 'The one way into a session, for guests and the couple alike.',
  },
  {
    id: 'sign-in-admin', path: '/sign-in/admin', title: 'Sign in (admin)', parent: 'sign-in', audience: 'gate', mode: ['gate'], visibleFrom: null,
    job: 'The couple and the planner sign in to run the site.',
  },
  {
    id: 'sign-out', path: '/sign-out', title: 'Sign out', parent: 'sign-in', audience: 'gate', mode: ['gate'], visibleFrom: 'TEASER',
    job: 'End the session on this device.',
  },
  {
    id: 'step-up', path: '/step-up', title: 'Confirm it is you', parent: 'sign-in', audience: 'gate', mode: ['gate'], visibleFrom: 'INVITATIONS_OPEN',
    job: 'Re-verify before a sensitive change, like payment details or who is in the household.',
  },
  {
    id: 'invitation', path: '/i/[token]', example: '/i/example', title: 'Your invitation', parent: null, audience: 'gate', mode: ['gate'], visibleFrom: 'INVITATIONS_OPEN',
    job: 'Preview of the household an invitation link belongs to, and an offer to claim it. Never a session by itself.',
    primaryAction: { label: 'Claim your invitation', to: 'claim-verify' },
  },
  {
    id: 'invite', path: '/invite/[token]', example: '/invite/example', title: 'Invitation (long link)', parent: 'invitation', audience: 'gate', mode: ['gate'], visibleFrom: 'INVITATIONS_OPEN',
    job: 'The long form of an invitation link; lands on the same preview.',
  },
  {
    id: 'claim-verify', path: '/claim/verify', title: 'Verify your email', parent: 'invitation', audience: 'gate', mode: ['gate'], visibleFrom: 'INVITATIONS_OPEN',
    job: 'A one-time code by email binds this person to the invitation.',
    primaryAction: { label: 'Continue', to: 'claim-welcome' },
  },
  {
    id: 'claim-welcome', path: '/claim/welcome', title: 'Welcome', parent: 'invitation', audience: 'gate', mode: ['gate'], visibleFrom: 'INVITATIONS_OPEN',
    job: 'You are in: what you can do now, and an optional passkey for next time.',
    primaryAction: { label: 'Go to your weekend', to: 'weekend' },
  },
  {
    id: 'claim-passkey', path: '/claim/passkey', title: 'Add a passkey', parent: 'invitation', audience: 'gate', mode: ['gate'], visibleFrom: 'INVITATIONS_OPEN',
    job: 'Save a passkey so the next sign-in is one tap. Optional.',
    primaryAction: { label: 'Go to your weekend', to: 'weekend' },
  },

  // ── Admin ─────────────────────────────────────────────────────────────────────────────────────
  { id: 'admin', path: '/admin', title: 'Admin', parent: null, audience: 'admin', mode: ['admin'], visibleFrom: null, job: 'What needs attention today, and a way into every tool.' },
  { id: 'admin-lifecycle', path: '/admin/lifecycle', title: 'Lifecycle', parent: 'admin', audience: 'admin', mode: ['admin'], visibleFrom: null, job: 'Move the site between states, preview any state, see what the calendar suggests.' },
  { id: 'admin-content', path: '/admin/content', title: 'Content', parent: 'admin', audience: 'admin', mode: ['admin'], visibleFrom: null, job: 'Every editable table, with provenance and freshness.' },
  { id: 'admin-content-table', path: '/admin/content/[table]', example: '/admin/content/example', title: 'Content table', parent: 'admin-content', audience: 'admin', mode: ['admin'], visibleFrom: null, job: 'Rows of one content table.' },
  { id: 'admin-content-new', path: '/admin/content/[table]/new', example: '/admin/content/example/new', title: 'New row', parent: 'admin-content-table', audience: 'admin', mode: ['admin'], visibleFrom: null, job: 'Add a row, with its source.' },
  { id: 'admin-content-row', path: '/admin/content/[table]/[id]', example: '/admin/content/example/row', title: 'Edit row', parent: 'admin-content-table', audience: 'admin', mode: ['admin'], visibleFrom: null, job: 'Edit one row and its source.' },
  { id: 'admin-guests', path: '/admin/guests', title: 'Guests', parent: 'admin', audience: 'admin', mode: ['admin'], visibleFrom: null, job: 'Everyone invited, by person.' },
  { id: 'admin-households', path: '/admin/households', title: 'Households', parent: 'admin', audience: 'admin', mode: ['admin'], visibleFrom: null, job: 'Who is invited together, and who may answer for whom.' },
  { id: 'admin-invitations', path: '/admin/invitations', title: 'Invitations', parent: 'admin', audience: 'admin', mode: ['admin'], visibleFrom: null, job: 'Issue, resend and revoke invitation links.' },
  { id: 'admin-rsvp', path: '/admin/rsvp', title: 'RSVPs', parent: 'admin', audience: 'admin', mode: ['admin'], visibleFrom: null, job: 'Replies by event, meal counts and needs.' },
  { id: 'admin-events', path: '/admin/events', title: 'Events', parent: 'admin', audience: 'admin', mode: ['admin'], visibleFrom: null, job: 'The weekend\'s events, rooms and times.' },
  { id: 'admin-seating', path: '/admin/seating', title: 'Seating', parent: 'admin', audience: 'admin', mode: ['admin'], visibleFrom: null, job: 'Tables and who sits where.' },
  { id: 'admin-travel', path: '/admin/travel', title: 'Travel', parent: 'admin', audience: 'admin', mode: ['admin'], visibleFrom: null, job: 'Hotels, the room block and guest trips.' },
  { id: 'admin-reservations', path: '/admin/reservations', title: 'Reservations', parent: 'admin', audience: 'admin', mode: ['admin'], visibleFrom: null, job: 'Bookings made through the site.' },
  { id: 'admin-transport', path: '/admin/transport', title: 'Transport', parent: 'admin', audience: 'admin', mode: ['admin'], visibleFrom: null, job: 'Ride benefits, vouchers and shuttles.' },
  { id: 'admin-gifts', path: '/admin/gifts', title: 'Gifts', parent: 'admin', audience: 'admin', mode: ['admin'], visibleFrom: null, job: 'Registry and fund links, each checked against the redirect allowlist.' },
  { id: 'admin-media', path: '/admin/media', title: 'Media', parent: 'admin', audience: 'admin', mode: ['admin'], visibleFrom: null, job: 'Moderate uploads and manage galleries.' },
  { id: 'admin-media-import', path: '/admin/media/import', title: 'Import media', parent: 'admin-media', audience: 'admin', mode: ['admin'], visibleFrom: null, job: 'Bring in a professional gallery with its rights.' },
  { id: 'admin-media-duplicates', path: '/admin/media/duplicates', title: 'Duplicates', parent: 'admin-media', audience: 'admin', mode: ['admin'], visibleFrom: null, job: 'Near-duplicate uploads to merge or drop.' },
  { id: 'admin-media-metrics', path: '/admin/media/metrics', title: 'Media metrics', parent: 'admin-media', audience: 'admin', mode: ['admin'], visibleFrom: null, job: 'Upload volume, processing and storage.' },
  { id: 'admin-concierge', path: '/admin/concierge', title: 'Concierge', parent: 'admin', audience: 'admin', mode: ['admin'], visibleFrom: null, job: 'What guests asked, what the concierge answered, and what it could not.' },
  { id: 'admin-ai', path: '/admin/ai', title: 'AI', parent: 'admin', audience: 'admin', mode: ['admin'], visibleFrom: null, job: 'Models, grounding sources and evaluation results.' },
  { id: 'admin-flags', path: '/admin/flags', title: 'Flags', parent: 'admin', audience: 'admin', mode: ['admin'], visibleFrom: null, job: 'Features switched on and off.' },
  { id: 'admin-providers', path: '/admin/providers', title: 'Providers', parent: 'admin', audience: 'admin', mode: ['admin'], visibleFrom: null, job: 'Which external service backs each feature, and whether it is healthy.' },
  { id: 'admin-jobs', path: '/admin/jobs', title: 'Jobs', parent: 'admin', audience: 'admin', mode: ['admin'], visibleFrom: null, job: 'Background work: queued, running, failed.' },
  { id: 'admin-metrics', path: '/admin/metrics', title: 'Metrics', parent: 'admin', audience: 'admin', mode: ['admin'], visibleFrom: null, job: 'Visits, replies and the numbers that matter this week.' },
  { id: 'admin-audit', path: '/admin/audit', title: 'Audit log', parent: 'admin', audience: 'admin', mode: ['admin'], visibleFrom: null, job: 'Who changed what, and when.' },
];

/**
 * Routes the real app serves that are not pages in the site's sense: the statically rendered theme
 * tree the proxy rewrites clean URLs onto (ADR-0009 §4). Listed so the route test can tell an
 * intentional omission from a forgotten one.
 */
export const INTERNAL_ROUTES = ['/t/[theme]', '/t/[theme]/preview/[token]'] as const;
