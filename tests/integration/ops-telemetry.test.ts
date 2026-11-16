import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminListSessions, adminSessionDetail, adminSiteErrors, adminSiteTraffic } from '@/capabilities/ops';
import type { AdminId, AuthIdentityId } from '@/contracts/ids';
import type { AdminPrincipal, Principal } from '@/contracts/principal';
import { getDb } from '@/db/client';
import { visitEvents, visitSessions } from '@/db/schema';
import { FX } from '@/db/seed/fixtures';
import { seedTelemetryFixtures, TELEMETRY_FIXTURE_SESSIONS } from '@/db/seed/telemetry-fixtures';
import { purgeTelemetry, recordServerError, recordTelemetry, type TelemetryEventInput } from '@/domain/ops';
import { getJobHandler, HOUSEKEEPING_JOB_TYPE, JobQueue } from '@/lib/jobs';
import { logger } from '@/lib/logger';
import { reportRequestError, resetServerErrorBudget, SERVER_ERRORS_PER_MINUTE } from '@/lib/telemetry';
import { expectErr, expectOk, run, seedSwarmE } from './helpers/swarm-e';

const admin = (entitlements: string[] = ['admin_integrations']): AdminPrincipal => ({
  kind: 'admin',
  authIdentityId: 'A' as AuthIdentityId,
  adminId: 'AD-TEL' as AdminId,
  roles: new Set(['owner']),
  entitlements: new Set(entitlements as never),
  authenticatedAt: new Date().toISOString(),
  sessionId: 'telemetry-session',
});

const ANON: Principal = { kind: 'anonymous' };
const guestA1 = { kind: 'guest', guestId: FX.guestA1 } as unknown as Principal;
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const WINDOWS_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0';

const HOUR = 3_600_000;
const now = new Date();
const ago = (hours: number) => new Date(now.getTime() - hours * HOUR);
const sid = (n: number) => `ops-telemetry-sess-${String(n).padStart(3, '0')}`;

const BOOM = { kind: 'error', path: '/guests/travel', name: 'TypeError', message: 'Cannot read properties of undefined', stack: 'TypeError: x\n    at TripPlanner (/_next/static/chunks/trip.js:12:345)' } as const;

async function visit(n: number, at: Date, who: Principal, userAgent: string, events: TelemetryEventInput[]) {
  await recordTelemetry(await getDb(), { sessionId: sid(n), principal: who, userAgent, events, now: at });
}

async function clear() {
  const db = await getDb();
  await db.delete(visitEvents);
  await db.delete(visitSessions);
}

/**
 * A small, known week:
 *   1  guest A1, phone Safari, 1h ago:     /guests, /guests/travel, an error, LCP 1000; back 20 minutes later on /rsvp
 *   2  anonymous, desktop Chrome, 2h ago:  /, /our-story, LCP 2000, CLS 0.1
 *   3  anonymous, desktop Firefox, 30h ago: /, the same error, LCP 3000
 *   4  guest A1, phone Safari, 100h ago:   /guests
 *   5  anonymous, desktop Chrome, 200h ago (the previous week): /, /our-story, a different error
 * plus two server errors (3h and 50h ago) and one from the previous week (250h ago).
 */
async function seedWeek() {
  await clear();
  await visit(1, ago(1), guestA1, IPHONE, [{ kind: 'view', path: '/guests' }, { kind: 'view', path: '/guests/travel' }, BOOM, { kind: 'vital', path: '/guests', name: 'LCP', value: 1000 }]);
  await visit(1, new Date(ago(1).getTime() + 20 * 60_000), guestA1, IPHONE, [{ kind: 'view', path: '/rsvp' }]);
  await visit(2, ago(2), ANON, WINDOWS_CHROME, [{ kind: 'view', path: '/' }, { kind: 'view', path: '/our-story' }, { kind: 'vital', path: '/', name: 'LCP', value: 2000 }, { kind: 'vital', path: '/', name: 'CLS', value: 0.1 }]);
  await visit(3, ago(30), ANON, FIREFOX, [{ kind: 'view', path: '/' }, { ...BOOM, path: '/' }, { kind: 'vital', path: '/', name: 'LCP', value: 3000 }]);
  await visit(4, ago(100), guestA1, IPHONE, [{ kind: 'view', path: '/guests' }]);
  await visit(5, ago(200), ANON, WINDOWS_CHROME, [{ kind: 'view', path: '/' }, { kind: 'view', path: '/our-story' }, { kind: 'error', path: '/our-story', name: 'RangeError', message: 'out of range' }]);
  const db = await getDb();
  const timedOut = { path: '/our-venue?debug=1', name: 'Error', message: 'upstream timed out', stack: 'Error: upstream timed out\n    at VenuePage (/srv/app/.next/server/venue.js:4:1)', root: '/srv/app' };
  await recordServerError(db, { ...timedOut, now: ago(3) });
  await recordServerError(db, { ...timedOut, now: ago(50) });
  await recordServerError(db, { ...timedOut, now: ago(250) });
}

beforeAll(async () => {
  await seedSwarmE();
});
afterEach(() => {
  delete process.env.TELEMETRY;
});

describe('entitlements', () => {
  it('every telemetry capability requires admin_integrations and is website-only', async () => {
    const without = admin(['admin_audit', 'admin_content', 'admin_guest_ops']);
    expect(expectErr(await run(adminSiteTraffic, without, {})).code).toBe('forbidden');
    expect(expectErr(await run(adminListSessions, without, {})).code).toBe('forbidden');
    expect(expectErr(await run(adminSessionDetail, without, { sessionId: sid(1) })).code).toBe('forbidden');
    expect(expectErr(await run(adminSiteErrors, without, {})).code).toBe('forbidden');
    for (const cap of [adminSiteTraffic, adminListSessions, adminSessionDetail, adminSiteErrors]) {
      expect(cap).toMatchObject({ kind: 'read', auth: 'admin', requires: ['admin_integrations'], exposure: { ui: true, ai: false, webmcp: false } });
      expect(cap.annotations).toMatchObject({ readOnlyHint: true, consequentialHint: false });
    }
    expect([adminSiteTraffic.name, adminListSessions.name, adminSessionDetail.name, adminSiteErrors.name]).toEqual(['admin_site_traffic', 'admin_list_sessions', 'admin_session_detail', 'admin_site_errors']);
  });

  it('a guest cannot read any of it', async () => {
    const guest = { kind: 'guest', guestId: FX.guestA1, householdId: FX.householdA, actsFor: [FX.guestA1], entitlements: new Set(['rsvp_self']), authIdentityId: 'A', authenticatedAt: new Date().toISOString(), sessionId: 's' } as unknown as Principal;
    expect(expectErr(await run(adminSiteTraffic, guest, {})).code).toBe('forbidden');
    expect(expectErr(await run(adminListSessions, guest, {})).code).toBe('forbidden');
    expect(expectErr(await run(adminSessionDetail, guest, { sessionId: sid(1) })).code).toBe('forbidden');
    expect(expectErr(await run(adminSiteErrors, guest, {})).code).toBe('forbidden');
  });
});

describe('admin_site_traffic', () => {
  beforeAll(seedWeek);

  it('rolls the week up, with the week before it for comparison', async () => {
    const d = expectOk(await run(adminSiteTraffic, admin(), {}, { now })).data;
    expect(d.windowHours).toBe(168);
    expect(d.since).toBe(ago(168).toISOString());
    expect(d.recording).toBe(true);
    expect(d.totals).toEqual({
      sessions: 4,
      pageviews: 7,
      signedInSessions: 2,
      guests: 1,
      // Two from browsers, two from the server.
      errors: 4,
      erroredSessions: 2,
      // Durations are 1200, 0, 0 and 0 seconds.
      medianDurationSeconds: 0,
    });
    expect(d.previous).toEqual({ sessions: 1, pageviews: 2, errors: 2 });
    expect(d.topPages).toEqual([
      { path: '/', views: 2, sessions: 2, errors: 1 },
      { path: '/guests', views: 2, sessions: 2, errors: 0 },
      { path: '/guests/travel', views: 1, sessions: 1, errors: 1 },
      { path: '/our-story', views: 1, sessions: 1, errors: 0 },
      { path: '/rsvp', views: 1, sessions: 1, errors: 0 },
    ]);
    expect(d.devices).toEqual([{ device: 'desktop', sessions: 2 }, { device: 'phone', sessions: 2 }]);
    expect(d.browsers).toEqual([{ browser: 'Safari', sessions: 2 }, { browser: 'Chrome', sessions: 1 }, { browser: 'Firefox', sessions: 1 }]);
    // LCP samples 1000, 2000, 3000: the 75th percentile is 2500. CLS has one sample. INP has none and is absent.
    expect(d.vitals).toEqual([{ name: 'LCP', p75: 2500, samples: 3 }, { name: 'CLS', p75: 0.1, samples: 1 }]);
  });

  it('gives a daily series with no gaps whose buckets add up to the totals', async () => {
    const d = expectOk(await run(adminSiteTraffic, admin(), { windowHours: 168 }, { now })).data;
    // Seven days back from now touches eight America/Chicago days (seven when now is exactly midnight there).
    expect([7, 8]).toContain(d.series.length);
    for (let i = 1; i < d.series.length; i++) {
      const gap = (Date.parse(d.series[i]!.at) - Date.parse(d.series[i - 1]!.at)) / HOUR;
      // A day is 24 hours, or 23 or 25 across a daylight-saving change.
      expect([23, 24, 25]).toContain(gap);
    }
    for (const b of d.series) {
      expect(new Date(b.at).toISOString()).toBe(b.at);
      // Midnight in Chicago is 05:00 or 06:00 UTC.
      expect(['T05:00:00.000Z', 'T06:00:00.000Z']).toContain(b.at.slice(10));
    }
    expect(Date.parse(d.series[0]!.at)).toBeLessThanOrEqual(Date.parse(d.since));
    expect(Date.parse(d.series.at(-1)!.at)).toBeLessThanOrEqual(now.getTime());
    expect(d.series.some((b) => b.sessions === 0 && b.pageviews === 0 && b.errors === 0)).toBe(true);
    const sum = (key: 'sessions' | 'pageviews' | 'errors') => d.series.reduce((t, b) => t + b[key], 0);
    expect(sum('sessions')).toBe(d.totals.sessions);
    expect(sum('pageviews')).toBe(d.totals.pageviews);
    expect(sum('errors')).toBe(d.totals.errors);
    // The newest bucket holds today's visits.
    expect(d.series.slice(-2).reduce((t, b) => t + b.sessions, 0)).toBeGreaterThanOrEqual(2);
  });

  it('gives an hourly series, one bucket per hour, for a window of 48 hours or less', async () => {
    const d = expectOk(await run(adminSiteTraffic, admin(), { windowHours: 24 }, { now })).data;
    expect([24, 25]).toContain(d.series.length);
    for (let i = 1; i < d.series.length; i++) expect(Date.parse(d.series[i]!.at) - Date.parse(d.series[i - 1]!.at)).toBe(HOUR);
    for (const b of d.series) expect(b.at.slice(13)).toBe(':00:00.000Z');
    expect(d.totals).toMatchObject({ sessions: 2, pageviews: 5, errors: 2, erroredSessions: 1, signedInSessions: 1, guests: 1 });
    expect(d.series.reduce((t, b) => t + b.sessions, 0)).toBe(2);
    expect(d.series.reduce((t, b) => t + b.pageviews, 0)).toBe(5);
    // Session 1 began an hour ago and session 2 two hours ago: they land in different buckets.
    expect(d.series.filter((b) => b.sessions > 0)).toHaveLength(2);
    // The day before held session 3 and its error; the older server error was 50 hours ago, outside it.
    expect(d.previous).toEqual({ sessions: 1, pageviews: 1, errors: 1 });

    const two = expectOk(await run(adminSiteTraffic, admin(), { windowHours: 48 }, { now })).data;
    expect([48, 49]).toContain(two.series.length);
    const three = expectOk(await run(adminSiteTraffic, admin(), { windowHours: 49 }, { now })).data;
    expect(three.series.length).toBeLessThanOrEqual(4);
  });

  it('caps the page list at fifteen, most viewed first', async () => {
    const db = await getDb();
    const events = Array.from({ length: 20 }, (_, i) => Array.from({ length: i + 1 }, () => ({ kind: 'view' as const, path: `/page-${String(i).padStart(2, '0')}` }))).flat();
    for (let i = 0; i < events.length; i += 20) await recordTelemetry(db, { sessionId: sid(900), principal: ANON, userAgent: null, events: events.slice(i, i + 20), now: ago(5) });
    const d = expectOk(await run(adminSiteTraffic, admin(), {}, { now })).data;
    expect(d.topPages).toHaveLength(15);
    expect(d.topPages[0]).toEqual({ path: '/page-19', views: 20, sessions: 1, errors: 0 });
    expect(d.topPages.map((p) => p.views)).toEqual([...d.topPages.map((p) => p.views)].sort((a, b) => b - a));
    await db.delete(visitEvents).where(eq(visitEvents.sessionId, sid(900)));
    await db.delete(visitSessions).where(eq(visitSessions.id, sid(900)));
  });

  it('says when nothing is being recorded, and answers an empty window with zeroes', async () => {
    process.env.TELEMETRY = 'off';
    expect(expectOk(await run(adminSiteTraffic, admin(), {}, { now })).data.recording).toBe(false);
    delete process.env.TELEMETRY;
    const empty = expectOk(await run(adminSiteTraffic, admin(), { windowHours: 1 }, { now: ago(5000) })).data;
    expect(empty.totals).toEqual({ sessions: 0, pageviews: 0, signedInSessions: 0, guests: 0, errors: 0, erroredSessions: 0, medianDurationSeconds: null });
    expect(empty.series).toHaveLength(2);
    expect(empty.series.every((b) => b.sessions + b.pageviews + b.errors === 0)).toBe(true);
    expect(empty).toMatchObject({ topPages: [], devices: [], browsers: [], vitals: [] });
  });

  it('refuses a window outside 1 to 720 hours', async () => {
    expect(expectErr(await run(adminSiteTraffic, admin(), { windowHours: 0 })).code).toBe('validation');
    expect(expectErr(await run(adminSiteTraffic, admin(), { windowHours: 721 })).code).toBe('validation');
  });
});

describe('admin_list_sessions and admin_session_detail', () => {
  beforeAll(seedWeek);

  it('lists the window’s sessions newest first, naming the guest', async () => {
    const d = expectOk(await run(adminListSessions, admin(), {}, { now })).data;
    expect(d.total).toBe(4);
    expect(d.sessions.map((s) => s.id)).toEqual([sid(1), sid(2), sid(3), sid(4)]);
    expect(d.sessions[0]).toEqual({
      id: sid(1),
      startedAt: ago(1).toISOString(),
      lastSeenAt: new Date(ago(1).getTime() + 20 * 60_000).toISOString(),
      durationSeconds: 1200,
      who: { kind: 'guest', guestId: FX.guestA1, name: 'Ada Testhouse' },
      device: 'phone',
      browser: 'Safari',
      entryPath: '/guests',
      exitPath: '/rsvp',
      pageviews: 3,
      errors: 1,
    });
    expect(d.sessions[1]).toMatchObject({ who: { kind: 'anonymous' }, device: 'desktop', browser: 'Chrome', entryPath: '/', exitPath: '/our-story', pageviews: 2, errors: 0, durationSeconds: 0 });
    expect(d.sessions[1]!.who).toEqual({ kind: 'anonymous' });
  });

  it('filters by guest, by errors and by page, and counts every match beyond the limit', async () => {
    const list = async (input: Record<string, unknown>) => expectOk(await run(adminListSessions, admin(), input, { now })).data;
    expect((await list({ guestId: FX.guestA1 })).sessions.map((s) => s.id)).toEqual([sid(1), sid(4)]);
    expect((await list({ guestId: 'nobody' })).total).toBe(0);
    expect((await list({ withErrors: true })).sessions.map((s) => s.id)).toEqual([sid(1), sid(3)]);
    expect((await list({ withErrors: false })).total).toBe(4);
    expect((await list({ path: '/' })).sessions.map((s) => s.id)).toEqual([sid(2), sid(3)]);
    expect((await list({ path: '/guests?from=email' })).sessions.map((s) => s.id)).toEqual([sid(1), sid(4)]);
    expect((await list({ path: '/', withErrors: true })).sessions.map((s) => s.id)).toEqual([sid(3)]);
    expect((await list({ windowHours: 24 })).sessions.map((s) => s.id)).toEqual([sid(1), sid(2)]);
    expect((await list({ windowHours: 720 })).total).toBe(5);
    const limited = await list({ limit: 2 });
    expect(limited.total).toBe(4);
    expect(limited.sessions.map((s) => s.id)).toEqual([sid(1), sid(2)]);
    expect(expectErr(await run(adminListSessions, admin(), { limit: 101 })).code).toBe('validation');
  });

  it('shows one session’s events oldest first', async () => {
    const d = expectOk(await run(adminSessionDetail, admin(), { sessionId: sid(1) })).data;
    expect(d.session).toMatchObject({ id: sid(1), who: { kind: 'guest', guestId: FX.guestA1, name: 'Ada Testhouse' }, pageviews: 3, errors: 1 });
    expect(d.events.map((e) => [e.kind, e.path])).toEqual([['view', '/guests'], ['view', '/guests/travel'], ['error', '/guests/travel'], ['vital', '/guests'], ['view', '/rsvp']]);
    expect(d.events[0]).toEqual({ at: ago(1).toISOString(), kind: 'view', path: '/guests' });
    expect(d.events[2]).toEqual({ at: ago(1).toISOString(), kind: 'error', path: '/guests/travel', name: 'TypeError', message: 'Cannot read properties of undefined' });
    expect(d.events[3]).toEqual({ at: ago(1).toISOString(), kind: 'vital', path: '/guests', name: 'LCP', value: 1000 });
    const times = d.events.map((e) => Date.parse(e.at));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('caps a session’s events at 500', async () => {
    const db = await getDb();
    for (let i = 0; i < 26; i++) await recordTelemetry(db, { sessionId: sid(901), principal: ANON, userAgent: null, events: Array.from({ length: 20 }, (_, j) => ({ kind: 'view' as const, path: `/p-${i}-${j}` })), now: ago(4) });
    const d = expectOk(await run(adminSessionDetail, admin(), { sessionId: sid(901) })).data;
    expect(d.session.pageviews).toBe(520);
    expect(d.events).toHaveLength(500);
    await db.delete(visitEvents).where(eq(visitEvents.sessionId, sid(901)));
    await db.delete(visitSessions).where(eq(visitSessions.id, sid(901)));
  });

  it('answers not_found for a session that does not exist, and validation for a malformed id', async () => {
    expect(expectErr(await run(adminSessionDetail, admin(), { sessionId: 'no-such-session-anywhere' })).code).toBe('not_found');
    expect(expectErr(await run(adminSessionDetail, admin(), { sessionId: 'short' })).code).toBe('validation');
    expect(expectErr(await run(adminSessionDetail, admin(), {})).code).toBe('validation');
  });
});

describe('admin_site_errors', () => {
  beforeAll(seedWeek);

  it('groups one fault into one row, most frequent first', async () => {
    const d = expectOk(await run(adminSiteErrors, admin(), {}, { now })).data;
    expect(d.windowHours).toBe(168);
    expect(d.total).toBe(4);
    expect(d.groups).toHaveLength(2);
    // Two each: the tie goes to the one seen most recently.
    const [client, server] = d.groups;
    expect(client).toEqual({
      fingerprint: expect.stringMatching(/^[0-9a-f]{16}$/),
      message: 'Cannot read properties of undefined',
      name: 'TypeError',
      source: 'client',
      count: 2,
      sessions: 2,
      firstAt: ago(30).toISOString(),
      lastAt: ago(1).toISOString(),
      paths: ['/', '/guests/travel'],
      sample: { path: '/guests/travel', stack: 'at TripPlanner (/_next/static/chunks/trip.js:12:345)', sessionId: sid(1) },
    });
    expect(server).toEqual({
      fingerprint: expect.stringMatching(/^[0-9a-f]{16}$/),
      message: 'upstream timed out',
      name: 'Error',
      source: 'server',
      count: 2,
      // A server error belongs to no session.
      sessions: 0,
      firstAt: ago(50).toISOString(),
      lastAt: ago(3).toISOString(),
      // The query string never reached the table.
      paths: ['/our-venue'],
      // The server's working directory is not part of a frame.
      sample: { path: '/our-venue', stack: 'at VenuePage (/.next/server/venue.js:4:1)' },
    });
    expect(client!.fingerprint).not.toBe(server!.fingerprint);
  });

  it('respects the window and the limit, and counts every error beyond the limit', async () => {
    const wide = expectOk(await run(adminSiteErrors, admin(), { windowHours: 720 }, { now })).data;
    expect(wide.total).toBe(6);
    expect(wide.groups.map((g) => [g.message, g.count])).toEqual([['upstream timed out', 3], ['Cannot read properties of undefined', 2], ['out of range', 1]]);
    const one = expectOk(await run(adminSiteErrors, admin(), { windowHours: 720, limit: 1 }, { now })).data;
    expect(one.total).toBe(6);
    expect(one.groups).toHaveLength(1);
    expect(one.groups[0]!.message).toBe('upstream timed out');
    const day = expectOk(await run(adminSiteErrors, admin(), { windowHours: 2 }, { now })).data;
    expect(day).toMatchObject({ windowHours: 2, total: 1 });
    expect(day.groups[0]).toMatchObject({ count: 1, sessions: 1, paths: ['/guests/travel'] });
    expect(expectOk(await run(adminSiteErrors, admin(), { windowHours: 1 }, { now: ago(5000) })).data).toEqual({ windowHours: 1, total: 0, groups: [] });
    expect(expectErr(await run(adminSiteErrors, admin(), { limit: 51 })).code).toBe('validation');
  });

  it('names at most five pages for one fault', async () => {
    const db = await getDb();
    for (let i = 0; i < 8; i++) await recordServerError(db, { path: `/many/page-${i}`, name: 'Error', message: 'everywhere at once', now: ago(6) });
    const d = expectOk(await run(adminSiteErrors, admin(), {}, { now })).data;
    const group = d.groups.find((g) => g.message === 'everywhere at once')!;
    expect(group.count).toBe(8);
    expect(group.paths).toHaveLength(5);
    expect(group.sample.stack).toBeUndefined();
    expect(d.groups[0]).toBe(group);
    await db.delete(visitEvents).where(eq(visitEvents.message, 'everywhere at once'));
  });
});

describe('server errors', () => {
  beforeEach(async () => {
    await clear();
    resetServerErrorBudget();
  });

  it('records what Next reports: the pathname, the name, the message and the top frames, and nothing else', async () => {
    const error = new TypeError('guest ada.testhouse@example.test has no table');
    await reportRequestError(error, { path: '/guests/travel?code=123456&next=/rsvp', method: 'GET' }, { routePath: '/(guest)/guests/travel', routeType: 'render' });
    const rows = await (await getDb()).select().from(visitEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'error', source: 'server', sessionId: null, path: '/guests/travel', name: 'TypeError', message: 'guest [email] has no table' });
    expect(rows[0]!.stack).toBeTruthy();
    expect(rows[0]!.stack).not.toContain(process.cwd());
    expect(JSON.stringify(rows)).not.toContain('123456');
  });

  it('skips Next’s own control-flow errors, and everything under TELEMETRY=off', async () => {
    await reportRequestError(Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/sign-in;307;' }), { path: '/guests', method: 'GET' });
    await reportRequestError(Object.assign(new Error('NEXT_HTTP_ERROR_FALLBACK;404'), { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' }), { path: '/nope', method: 'GET' });
    process.env.TELEMETRY = 'off';
    await reportRequestError(new Error('while off'), { path: '/', method: 'GET' });
    delete process.env.TELEMETRY;
    expect(await (await getDb()).select().from(visitEvents)).toEqual([]);
  });

  it('records a thrown value that is not an Error, and falls back to the route when there is no address', async () => {
    await reportRequestError('a bare string', undefined, { routePath: '/(public)/our-story', routeType: 'render' });
    const rows = await (await getDb()).select().from(visitEvents);
    expect(rows[0]).toMatchObject({ message: 'a bare string', name: null, stack: null, path: '/(public)/our-story' });
  });

  it('writes at most thirty a minute from one process', async () => {
    for (let i = 0; i < SERVER_ERRORS_PER_MINUTE + 10; i++) await reportRequestError(new Error('looping'), { path: '/', method: 'GET' });
    expect(await (await getDb()).select().from(visitEvents)).toHaveLength(SERVER_ERRORS_PER_MINUTE);
  });

  it('never throws, whatever it is handed', async () => {
    resetServerErrorBudget();
    await expect(reportRequestError(null, null as never)).resolves.toBeUndefined();
    await expect(reportRequestError({ digest: 7, message: { nested: true } }, { path: 42 as never })).resolves.toBeUndefined();
  });
});

describe('retention', () => {
  beforeEach(clear);

  it('purges events from before the cutoff and sessions last seen before it', async () => {
    await visit(10, ago(100 * 24), ANON, IPHONE, [{ kind: 'view', path: '/' }]);
    await visit(11, ago(100 * 24), ANON, IPHONE, [{ kind: 'view', path: '/' }]);
    // Session 11 came back yesterday: its old event goes, the session stays.
    await visit(11, ago(24), ANON, IPHONE, [{ kind: 'view', path: '/our-story' }]);
    await visit(12, ago(1), ANON, IPHONE, [{ kind: 'view', path: '/' }]);
    const db = await getDb();
    await recordServerError(db, { path: '/', message: 'old', now: ago(100 * 24) });
    expect(await purgeTelemetry(db, ago(90 * 24))).toEqual({ sessions: 1, events: 3 });
    expect((await db.select().from(visitSessions)).map((s) => s.id).sort()).toEqual([sid(11), sid(12)]);
    expect((await db.select().from(visitEvents)).map((e) => e.path).sort()).toEqual(['/', '/our-story']);
    expect(await purgeTelemetry(db, ago(90 * 24))).toEqual({ sessions: 0, events: 0 });
  });

  it('runs inside the housekeeping job, after TELEMETRY_RETENTION_DAYS (90)', async () => {
    await visit(20, ago(91 * 24), ANON, IPHONE, [{ kind: 'view', path: '/' }]);
    await visit(21, ago(89 * 24), ANON, IPHONE, [{ kind: 'view', path: '/' }]);
    const db = await getDb();
    const job = await new JobQueue(db).enqueue({ type: HOUSEKEEPING_JOB_TYPE });
    await getJobHandler(HOUSEKEEPING_JOB_TYPE)!({}, job, { logger, principal: { kind: 'system', component: 'test' }, requestId: 'req-housekeeping-telemetry', now, db });
    expect((await db.select().from(visitSessions)).map((s) => s.id)).toEqual([sid(21)]);
    expect(await db.select().from(visitEvents)).toHaveLength(1);
  });
});

describe('the test server’s sample', () => {
  beforeEach(clear);

  it('is idempotent, leaves real rows alone, and gives every screen something to draw', async () => {
    const db = await getDb();
    await visit(30, ago(2), guestA1, IPHONE, [{ kind: 'view', path: '/guests' }, BOOM]);
    const first = await seedTelemetryFixtures(db, now);
    expect(first.sessions).toBe(TELEMETRY_FIXTURE_SESSIONS);
    const again = await seedTelemetryFixtures(db, now);
    expect(again).toEqual(first);
    expect(await db.select().from(visitSessions)).toHaveLength(TELEMETRY_FIXTURE_SESSIONS + 1);
    expect(await db.select().from(visitEvents)).toHaveLength(first.events + 2);

    const traffic = expectOk(await run(adminSiteTraffic, admin(), {}, { now })).data;
    expect(traffic.totals.sessions).toBe(TELEMETRY_FIXTURE_SESSIONS + 1);
    expect(traffic.totals.pageviews).toBeGreaterThan(130);
    expect(traffic.totals.guests).toBeGreaterThanOrEqual(3);
    expect(traffic.vitals.map((v) => v.name)).toEqual(['LCP', 'CLS', 'INP']);
    expect(traffic.series.filter((b) => b.sessions > 0).length).toBeGreaterThanOrEqual(7);
    expect(traffic.devices.map((d) => d.device).sort()).toEqual(['desktop', 'phone', 'tablet']);

    const errors = expectOk(await run(adminSiteErrors, admin(), {}, { now })).data;
    const synthetic = errors.groups.filter((g) => g.message.startsWith('Synthetic fixture:'));
    expect(synthetic).toHaveLength(3);
    expect(synthetic.filter((g) => g.source === 'server')).toHaveLength(1);

    const sessions = expectOk(await run(adminListSessions, admin(), { limit: 100 }, { now })).data;
    expect(sessions.sessions.some((s) => s.who.name === 'Ada Testhouse')).toBe(true);
    expect(sessions.sessions.some((s) => s.who.kind === 'admin')).toBe(true);
  });
});
