import { like, or } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { visitEvents, visitSessions, type VisitDevice, type VisitPrincipalKind } from '@/db/schema';
import { cleanEvent, type TelemetryEventInput } from '@/domain/ops/telemetry';
import { env } from '@/lib/env';
import { FX } from './fixtures';

/**
 * TEST-ONLY telemetry sample, so the admin traffic, sessions and errors screens have something to
 * draw on the test server (`SEED_TEST_FIXTURES=1`, the same switch as the fixture households).
 * Nothing here was measured: every session id starts `fixture-visit-` and every error message
 * starts `Synthetic fixture:`. It is spread over the seven days before `now`, built from a fixed
 * sequence (no randomness), and replaced on each run, so it stays "the last week" however long the
 * server has been up. Never runs in production.
 */

export const TELEMETRY_FIXTURE_SESSION_PREFIX = 'fixture-visit-';
export const TELEMETRY_FIXTURE_MESSAGE_PREFIX = 'Synthetic fixture:';
export const TELEMETRY_FIXTURE_SESSIONS = 40;

const HOUR = 3_600_000;
const MINUTE = 60_000;

const PUBLIC_PAGES = ['/', '/our-story', '/our-adventures', '/our-adventures/starved-rock', '/sign-in', '/privacy'] as const;
const GUEST_PAGES = ['/guests', '/guests/travel', '/rsvp', '/rsvp/attending', '/our-venue', '/our-venue/white-city-ballroom', '/guests/ask-us', '/gifts', '/photos', '/guests/things-to-do/starved-rock-state-park'] as const;
// An administrator previewing the guest pages; the console's own pages are never recorded as views (beacon.ts).
const ADMIN_PAGES = ['/', '/guests', '/rsvp', '/our-venue'] as const;
const GUESTS = [FX.guestA1, FX.guestB1, FX.guestC1, FX.guestA2, FX.guestB2] as const;
const DEVICES: readonly VisitDevice[] = ['phone', 'phone', 'desktop', 'phone', 'tablet', 'desktop', 'phone'];
const BROWSERS = ['Safari', 'Chrome', 'Chrome', 'Safari', 'Firefox', 'Safari', 'Edge', 'Chrome', 'Other'] as const;

const CLIENT_ERRORS = [
  {
    name: 'TypeError',
    message: `${TELEMETRY_FIXTURE_MESSAGE_PREFIX} cannot read properties of undefined (reading 'label')`,
    stack: "TypeError: synthetic\n    at TripPlanner (/_next/static/chunks/fixture-trip.js:12:345)\n    at renderWithHooks (/_next/static/chunks/fixture-react.js:1:2222)",
    path: '/guests/travel',
    // Signed-in guests' sessions.
    sessions: [2, 9, 11, 20, 27, 36] as readonly number[],
  },
  {
    name: 'ChunkLoadError',
    message: `${TELEMETRY_FIXTURE_MESSAGE_PREFIX} loading a script chunk failed`,
    stack: 'ChunkLoadError: synthetic\n    at loadChunk (/_next/static/chunks/fixture-runtime.js:1:999)',
    path: '/our-adventures',
    // Anonymous sessions.
    sessions: [5, 16, 34] as readonly number[],
  },
] as const;

const SERVER_ERROR = {
  name: 'Error',
  message: `${TELEMETRY_FIXTURE_MESSAGE_PREFIX} upstream timed out while rendering`,
  stack: 'Error: synthetic\n    at VenuePage (/.next/server/app/fixture-venue.js:40:12)\n    at async renderToResponse (/.next/server/fixture-render.js:8:1)',
  path: '/our-venue',
  /** Hours before `now`. */
  hoursAgo: [3, 30, 77, 121] as readonly number[],
} as const;

type EventRow = typeof visitEvents.$inferInsert;
type SessionRow = typeof visitSessions.$inferInsert;

export const telemetryFixtureSessionId = (index: number): string => `${TELEMETRY_FIXTURE_SESSION_PREFIX}${String(index + 1).padStart(4, '0')}`;

/** The sample as rows, without touching a database: a pure function of `now`. */
export function buildTelemetryFixtures(now: Date): { sessions: SessionRow[]; events: EventRow[] } {
  const sessions: SessionRow[] = [];
  const events: EventRow[] = [];
  const event = (sessionId: string | null, at: Date, source: 'client' | 'server', e: TelemetryEventInput) => {
    const row = cleanEvent(e, { now: at, source, sessionId });
    if (row) events.push(row);
    return row;
  };

  for (let i = 0; i < TELEMETRY_FIXTURE_SESSIONS; i++) {
    const id = telemetryFixtureSessionId(i);
    // Newest first: half an hour ago, then one roughly every four hours back to just inside a week.
    const startedAt = new Date(now.getTime() - 30 * MINUTE - i * 4.1 * HOUR);
    const who: { kind: VisitPrincipalKind; guestId: string | null } =
      i % 13 === 6 ? { kind: 'admin', guestId: null } : i % 9 < 4 ? { kind: 'guest', guestId: GUESTS[i % GUESTS.length]! } : { kind: 'anonymous', guestId: null };
    const pages = who.kind === 'admin' ? ADMIN_PAGES : who.kind === 'guest' ? GUEST_PAGES : PUBLIC_PAGES;
    const viewCount = 2 + ((i * 7) % 5);
    const paths: string[] = [];
    let at = startedAt;
    for (let v = 0; v < viewCount; v++) {
      const path = pages[(i + v * 3) % pages.length]!;
      paths.push(path);
      event(id, at, 'client', { kind: 'view', path });
      at = new Date(at.getTime() + (40 + ((i + v) % 7) * 35) * 1000);
    }
    if (i % 3 === 0) {
      event(id, at, 'client', { kind: 'vital', path: paths[0]!, name: 'LCP', value: 1200 + ((i * 331) % 2600) });
      event(id, at, 'client', { kind: 'vital', path: paths[0]!, name: 'CLS', value: ((i * 17) % 20) / 100 });
      event(id, at, 'client', { kind: 'vital', path: paths[0]!, name: 'INP', value: 80 + ((i * 53) % 320) });
    }
    let errors = 0;
    for (const fault of CLIENT_ERRORS) {
      if (!fault.sessions.includes(i)) continue;
      event(id, at, 'client', { kind: 'error', path: fault.path, name: fault.name, message: fault.message, stack: fault.stack });
      errors += 1;
    }
    sessions.push({
      id,
      startedAt,
      lastSeenAt: at,
      principalKind: who.kind,
      guestId: who.guestId,
      device: DEVICES[i % DEVICES.length]!,
      browser: BROWSERS[i % BROWSERS.length]!,
      entryPath: paths[0]!,
      exitPath: paths.at(-1)!,
      pageviews: viewCount,
      errors,
    });
  }
  for (const hoursAgo of SERVER_ERROR.hoursAgo) {
    event(null, new Date(now.getTime() - hoursAgo * HOUR), 'server', { kind: 'error', path: SERVER_ERROR.path, name: SERVER_ERROR.name, message: SERVER_ERROR.message, stack: SERVER_ERROR.stack });
  }
  return { sessions, events };
}

/** Idempotent: removes the previous sample (and only the sample) and writes a fresh one relative to `now`. */
export async function seedTelemetryFixtures(db: Db, now: Date = new Date()): Promise<{ sessions: number; events: number }> {
  if (env.isProduction) return { sessions: 0, events: 0 };
  const { sessions, events } = buildTelemetryFixtures(now);
  await db.delete(visitEvents).where(or(like(visitEvents.sessionId, `${TELEMETRY_FIXTURE_SESSION_PREFIX}%`), like(visitEvents.message, `${TELEMETRY_FIXTURE_MESSAGE_PREFIX}%`)));
  await db.delete(visitSessions).where(like(visitSessions.id, `${TELEMETRY_FIXTURE_SESSION_PREFIX}%`));
  await db.insert(visitSessions).values(sessions);
  for (let i = 0; i < events.length; i += 100) await db.insert(visitEvents).values(events.slice(i, i + 100));
  return { sessions: sessions.length, events: events.length };
}
