import type { Gathered } from '@/domain/admin-assistant';

/** Plain records in the shapes the capabilities return, small enough to read. */
const day = (n: number) => new Date(Date.UTC(2026, 10, 9 + n, 6)).toISOString();

export const TRAFFIC: NonNullable<Gathered['traffic']> = {
  windowHours: 168,
  since: day(0),
  recording: true,
  totals: { sessions: 41, pageviews: 153, signedInSessions: 9, guests: 6, errors: 5, erroredSessions: 4, medianDurationSeconds: 130 },
  previous: { sessions: 30, pageviews: 100, errors: 10 },
  series: [0, 1, 2, 3, 4, 5, 6].map((n) => ({ at: day(n), sessions: 4 + n, pageviews: 12 + n * 3, errors: n % 3 })),
  topPages: [
    { path: '/guests/travel', views: 40, sessions: 22, errors: 3 },
    { path: '/rsvp', views: 31, sessions: 19, errors: 0 },
  ],
  devices: [
    { device: 'phone', sessions: 30 },
    { device: 'desktop', sessions: 11 },
  ],
  browsers: [{ browser: 'Safari', sessions: 25 }],
  vitals: [
    { name: 'LCP', p75: 2100, samples: 20 },
    { name: 'CLS', p75: 0.3, samples: 20 },
    { name: 'INP', p75: 320, samples: 12 },
  ],
};

export const SESSIONS: NonNullable<Gathered['sessions']> = {
  total: 2,
  sessions: [
    { id: 'sess_aaaaaaaaaaaaaaaa', startedAt: day(6), lastSeenAt: day(6), durationSeconds: 95, who: { kind: 'guest', guestId: 'g1', name: 'Ada Testhouse' }, device: 'phone', browser: 'Safari', entryPath: '/guests', exitPath: '/rsvp', pageviews: 4, errors: 1 },
    { id: 'sess_bbbbbbbbbbbbbbbb', startedAt: day(5), lastSeenAt: day(5), durationSeconds: 20, who: { kind: 'anonymous' }, device: 'desktop', browser: 'Chrome', entryPath: '/', exitPath: '/', pageviews: 1, errors: 0 },
  ],
};

export const SESSION: NonNullable<Gathered['session']> = {
  session: SESSIONS.sessions[0]!,
  events: [
    { at: day(6), kind: 'view', path: '/guests' },
    { at: day(6), kind: 'vital', path: '/guests', name: 'LCP', value: 1800 },
    { at: day(6), kind: 'error', path: '/rsvp', name: 'TypeError', message: 'x is undefined' },
  ],
};

export const ERRORS: NonNullable<Gathered['errors']> = {
  windowHours: 168,
  total: 5,
  groups: [
    { fingerprint: 'f1', message: 'x is undefined', name: 'TypeError', source: 'client', count: 4, sessions: 3, firstAt: day(1), lastAt: day(6), paths: ['/rsvp'], sample: { path: '/rsvp', stack: 'at a (b.js:1:1)', sessionId: 'sess_aaaaaaaaaaaaaaaa' } },
    { fingerprint: 'f2', message: 'render failed', name: null, source: 'server', count: 1, sessions: 0, firstAt: day(2), lastAt: day(2), paths: ['/our-venue'], sample: { path: '/our-venue' } },
  ],
};

export const LIFECYCLE: NonNullable<Gathered['lifecycle']> = { state: 'TEASER', suggested: 'RSVP_OPEN', behindSchedule: true, publishedAt: day(0), states: ['TEASER', 'SAVE_THE_DATE', 'INVITATIONS_OPEN', 'RSVP_OPEN', 'RSVP_CLOSED', 'WEDDING_WEEK', 'WEDDING_DAY', 'POST_WEDDING', 'ARCHIVE'] };

export const JOBS: NonNullable<Gathered['jobs']> = {
  byStatus: { queued: 2, dead: 1 },
  dueNow: 2,
  oldestDueAgeSeconds: 40,
  attention: [{ id: '01HZZZZZZZZZZZZZZZZZZZZZZZ', type: 'email.send', status: 'dead', attempts: 5, maxAttempts: 5, lastError: 'mailbox unavailable', updatedAt: day(5) }],
  byType: [{ type: 'email.send', total: 3, queued: 2, running: 0, succeeded: 0, dead: 1 }],
};

export const RSVP: NonNullable<Gathered['rsvp']> = {
  window: { open: true, deadlineAt: null },
  events: [{ id: 'e1', name: 'Ceremony', invited: 3, accepted: 1, declined: 1, pending: 1, plusOnes: 0 }],
  rows: [
    { guestId: 'g1', displayName: 'Ada Testhouse', householdName: 'Testhouse', eventId: 'e1', eventName: 'Ceremony', status: 'accepted', updatedAt: day(3) },
    { guestId: 'g2', displayName: 'Ben Testhouse', householdName: 'Testhouse', eventId: 'e1', eventName: 'Ceremony', status: 'declined', updatedAt: day(3) },
    { guestId: 'g3', displayName: 'Fin Solo', householdName: 'Solo', eventId: 'e1', eventName: 'Ceremony', status: null, updatedAt: null },
  ],
};

export const METRICS: NonNullable<Gathered['metrics']> = {
  windowHours: 24,
  recording: true,
  totalPoints: 30,
  series: [
    { name: 'capability.duration_ms', kind: 'histogram', points: 20, sum: 900, max: 400, p50: 30, p95: 210, lastAt: day(6) },
    { name: 'auth.sign_in', kind: 'counter', points: 10, sum: 10, max: 1, p50: null, p95: null, lastAt: day(6) },
  ],
  audit: { total: 50, byOutcome: { success: 46, denied: 3, failed: 1 }, topActions: [{ action: 'capability.invoked', count: 46 }] },
};

export const AUDIT: NonNullable<Gathered['audit']> = {
  rows: [
    { id: 'a1', at: day(6), actor: { kind: 'admin', ref: 'x' }, action: 'lifecycle.published', targetType: 'site', targetId: 'lifecycle', outcome: 'success' },
    { id: 'a2', at: day(5), actor: { kind: 'guest', ref: 'y' }, action: 'capability.denied', targetType: 'capability', targetId: 'admin_list_guests', outcome: 'denied' },
  ],
  window: { total: 50, byOutcome: { success: 46, denied: 3, failed: 1 } },
};

export const GUESTS: NonNullable<Gathered['guests']> = [{ id: 'g1', displayName: 'Ada Testhouse', householdName: 'Testhouse', email: 'ada@example.test', kind: 'adult', isMinor: false, claimed: true, claimedAt: day(2) }];

export const EVERYTHING: Gathered = { now: day(6), traffic: TRAFFIC, sessions: SESSIONS, session: SESSION, errors: ERRORS, lifecycle: LIFECYCLE, jobs: JOBS, rsvp: RSVP, metrics: METRICS, audit: AUDIT, guests: GUESTS };

export const SCREENS = [
  { href: '/admin/travel', label: 'Travel & stay', blurb: 'Hotels, links, the room block.', words: 'hotel room block flights' },
  { href: '/admin/seating', label: 'Seating', blurb: 'Tables, assignments, publishing the chart.', words: 'tables chart seats' },
];
