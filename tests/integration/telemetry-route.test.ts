import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from '@/app/api/telemetry/route';
import type { AdminId, AuthIdentityId, GuestId, HouseholdId } from '@/contracts/ids';
import type { AdminPrincipal, GuestPrincipal } from '@/contracts/principal';
import { getDb } from '@/db/client';
import { visitEvents, visitSessions } from '@/db/schema';
import { anonymousResolver, setPrincipalResolver } from '@/lib/principal';
import { getProvider } from '@/providers/registry';

const guest: GuestPrincipal = {
  kind: 'guest',
  authIdentityId: 'A' as AuthIdentityId,
  guestId: 'G-TELEMETRY' as GuestId,
  householdId: 'H1' as HouseholdId,
  actsFor: ['G-TELEMETRY' as GuestId],
  entitlements: new Set(['rsvp_self']),
  authenticatedAt: new Date().toISOString(),
  sessionId: 's',
};
const admin: AdminPrincipal = {
  kind: 'admin',
  authIdentityId: 'A' as AuthIdentityId,
  adminId: 'AD-T' as AdminId,
  roles: new Set(['owner']),
  entitlements: new Set(['admin_integrations']),
  authenticatedAt: new Date().toISOString(),
  sessionId: 's',
};

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SAME_ORIGIN = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', 'user-agent': IPHONE };
const url = 'http://localhost:3000/api/telemetry';

let counter = 0;
const newSession = () => `route-test-session-${String(++counter).padStart(4, '0')}`;
const send = (body: unknown, headers: Record<string, string> = {}) => POST(new Request(url, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { ...SAME_ORIGIN, ...headers } }));

async function stored() {
  const db = await getDb();
  return { sessions: await db.select().from(visitSessions), events: await db.select().from(visitEvents) };
}

/** Every outcome looks the same from outside: 204, no body. */
async function expectSilent(res: Response) {
  expect(res.status).toBe(204);
  expect(await res.text()).toBe('');
  expect(res.headers.get('cache-control')).toBe('private, no-store');
}

beforeAll(() => {
  setPrincipalResolver({
    resolve: async (req) => {
      const who = req.headers.get('x-test-principal');
      return who === 'guest' ? guest : who === 'admin' ? admin : who === 'viewing' ? { ...guest, viewedBy: { adminId: admin.adminId, roles: admin.roles, readOnly: true } } : { kind: 'anonymous' };
    },
  });
});
afterAll(() => setPrincipalResolver(anonymousResolver));

beforeEach(async () => {
  const db = await getDb();
  await db.delete(visitEvents);
  await db.delete(visitSessions);
  await getProvider('rate-limit', { db }).reset('telemetry:ip:direct');
  await getProvider('rate-limit', { db }).reset('telemetry:events:direct');
});
afterEach(() => {
  delete process.env.TELEMETRY;
});

describe('POST /api/telemetry', () => {
  it('stores a session and its events, and nothing that could place the visitor', async () => {
    const sessionId = newSession();
    await expectSilent(
      await send(
        {
          sessionId,
          events: [
            { kind: 'view', path: '/our-story?utm_source=mail#top', at: Date.now() - 1500 },
            { kind: 'vital', path: '/our-story', name: 'LCP', value: 1820.4 },
            { kind: 'error', path: '/i/SECRETINVITETOKEN', name: 'TypeError', message: 'No guest ada.testhouse@example.test', stack: 'TypeError: x\n    at a (https://kendrick.wedding/_next/a.js?v=1:1:2)' },
          ],
        },
        { 'x-forwarded-for': '203.0.113.9', 'x-real-ip': '203.0.113.9', referer: 'https://mail.example/inbox' },
      ),
    );
    const { sessions, events } = await stored();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ id: sessionId, principalKind: 'anonymous', guestId: null, device: 'phone', browser: 'Safari', entryPath: '/our-story', exitPath: '/our-story', pageviews: 1, errors: 1 });
    expect(events.map((e) => e.kind).sort()).toEqual(['error', 'view', 'vital']);
    expect(events.every((e) => e.sessionId === sessionId && e.source === 'client')).toBe(true);
    const error = events.find((e) => e.kind === 'error')!;
    expect(error).toMatchObject({ path: '/i/[token]', name: 'TypeError', message: 'No guest [email]', stack: 'at a (/_next/a.js:1:2)' });
    expect(error.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(events.find((e) => e.kind === 'vital')).toMatchObject({ name: 'LCP', value: 1820.4, path: '/our-story' });
    // No address, no User-Agent, no referrer, no query string, no token, no email: anywhere.
    const everything = JSON.stringify({ sessions, events });
    for (const leaked of ['203.0.113.9', 'Mozilla', 'iPhone OS', 'mail.example', 'utm_source', 'SECRETINVITETOKEN', 'example.test', 'kendrick.wedding']) expect(everything, leaked).not.toContain(leaked);
  });

  it('moves a session along: counters, last page, and who it is once the visitor signs in', async () => {
    const sessionId = newSession();
    await send({ sessionId, events: [{ kind: 'view', path: '/' }, { kind: 'view', path: '/sign-in' }] });
    expect((await stored()).sessions[0]).toMatchObject({ principalKind: 'anonymous', guestId: null, entryPath: '/', exitPath: '/sign-in', pageviews: 2, errors: 0 });

    await send({ sessionId, events: [{ kind: 'view', path: '/guests' }, { kind: 'error', path: '/guests', message: 'boom' }] }, { 'x-test-principal': 'guest' });
    const signedIn = (await stored()).sessions[0]!;
    expect(signedIn).toMatchObject({ principalKind: 'guest', guestId: 'G-TELEMETRY', entryPath: '/', exitPath: '/guests', pageviews: 3, errors: 1 });
    expect(signedIn.lastSeenAt.getTime()).toBeGreaterThanOrEqual(signedIn.startedAt.getTime());

    // Signing out in the same tab does not un-name the session; a batch with no view keeps the exit page.
    await send({ sessionId, events: [{ kind: 'vital', path: '/', name: 'CLS', value: 0.02 }] });
    expect((await stored()).sessions[0]).toMatchObject({ principalKind: 'guest', guestId: 'G-TELEMETRY', exitPath: '/guests', pageviews: 3 });
    expect((await stored()).sessions).toHaveLength(1);
  });

  it('records an administrator as an administrator, including one browsing as a guest', async () => {
    const a = newSession();
    const b = newSession();
    await send({ sessionId: a, events: [{ kind: 'view', path: '/admin' }] }, { 'x-test-principal': 'admin' });
    await send({ sessionId: b, events: [{ kind: 'view', path: '/guests' }] }, { 'x-test-principal': 'viewing' });
    const { sessions } = await stored();
    expect(sessions.find((s) => s.id === a)).toMatchObject({ principalKind: 'admin', guestId: null });
    expect(sessions.find((s) => s.id === b)).toMatchObject({ principalKind: 'admin', guestId: null });
  });

  it.each([
    ['Sec-GPC', { 'sec-gpc': '1' }],
    ['DNT', { dnt: '1' }],
  ])('honours %s: no session, no views or vitals, but an error is still kept, tied to nothing', async (_name, header) => {
    await expectSilent(
      await send(
        {
          sessionId: newSession(),
          events: [
            { kind: 'view', path: '/our-story' },
            { kind: 'vital', path: '/our-story', name: 'LCP', value: 900 },
            { kind: 'error', path: '/our-story', name: 'RangeError', message: 'out of range' },
          ],
        },
        { ...header, 'x-test-principal': 'guest' },
      ),
    );
    const { sessions, events } = await stored();
    expect(sessions).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'error', sessionId: null, path: '/our-story', message: 'out of range' });
  });

  it('keeps a sessionless batch’s errors and drops its views', async () => {
    await send({ events: [{ kind: 'view', path: '/' }, { kind: 'error', path: '/', message: 'no session' }] });
    const { sessions, events } = await stored();
    expect(sessions).toEqual([]);
    expect(events.map((e) => e.kind)).toEqual(['error']);
  });

  it('refuses a body over 16 KB without storing any of it', async () => {
    const sessionId = newSession();
    const events = Array.from({ length: 20 }, () => ({ kind: 'error', path: '/', message: 'x'.repeat(1000) }));
    const body = JSON.stringify({ sessionId, events });
    expect(body.length).toBeGreaterThan(16 * 1024);
    await expectSilent(await send(body));
    // A lying Content-Length gets no further: the stream is cut at the cap.
    await expectSilent(await send(body, { 'content-length': '10' }));
    expect(await stored()).toEqual({ sessions: [], events: [] });
  });

  it('refuses another origin, and a form, without saying so', async () => {
    const batch = { sessionId: newSession(), events: [{ kind: 'view', path: '/' }] };
    await expectSilent(await send(batch, { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }));
    await expectSilent(await send(batch, { 'sec-fetch-site': 'same-site', origin: 'https://other.kendrick.example' }));
    await expectSilent(await send(batch, { 'content-type': 'text/plain' }));
    await expectSilent(await send(batch, { 'content-type': 'application/x-www-form-urlencoded' }));
    expect(await stored()).toEqual({ sessions: [], events: [] });
    // What a browser's sendBeacon(Blob{type: application/json}) sends from the site itself is accepted.
    await expectSilent(await send(batch, { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }));
    expect((await stored()).sessions).toHaveLength(1);
  });

  it('is a no-op under TELEMETRY=off', async () => {
    process.env.TELEMETRY = 'off';
    await expectSilent(await send({ sessionId: newSession(), events: [{ kind: 'view', path: '/' }, { kind: 'error', path: '/', message: 'x' }] }));
    // Not even the body is read, so a malformed one answers the same.
    await expectSilent(await send('{not json'));
    expect(await stored()).toEqual({ sessions: [], events: [] });
    delete process.env.TELEMETRY;
    await send({ sessionId: newSession(), events: [{ kind: 'view', path: '/' }] });
    expect((await stored()).sessions).toHaveLength(1);
  });

  it('answers a malformed batch the same way and stores nothing', async () => {
    for (const body of ['{not json', '', '[]', JSON.stringify({ events: [] }), JSON.stringify({ sessionId: 'short', events: [{ kind: 'view', path: '/' }] }), JSON.stringify({ sessionId: newSession(), events: [{ kind: 'click', path: '/' }] }), JSON.stringify({ sessionId: newSession(), events: [{ kind: 'view' }] })]) {
      await expectSilent(await send(body));
    }
    expect(await stored()).toEqual({ sessions: [], events: [] });
  });

  it('keeps at most twenty events of one batch', async () => {
    const sessionId = newSession();
    await send({ sessionId, events: Array.from({ length: 30 }, (_, i) => ({ kind: 'view', path: `/page-${i}` })) });
    const { sessions, events } = await stored();
    expect(events).toHaveLength(20);
    expect(sessions[0]).toMatchObject({ pageviews: 20, entryPath: '/page-0', exitPath: '/page-19' });
  });

  it('is rate limited per client, silently', async () => {
    const db = await getDb();
    const limiter = getProvider('rate-limit', { db });
    for (let i = 0; i < 300; i++) await limiter.consume('telemetry:ip:direct', 'telemetry');
    await expectSilent(await send({ sessionId: newSession(), events: [{ kind: 'view', path: '/' }] }));
    expect(await stored()).toEqual({ sessions: [], events: [] });
  });

  it('budgets events as well as requests, so batching buys nothing', async () => {
    const db = await getDb();
    const limiter = getProvider('rate-limit', { db });
    // Leave room for ten events: a batch of twenty is refused whole, a batch of five is kept.
    await limiter.consume('telemetry:events:direct', 'telemetryEvents', 1190);
    await expectSilent(await send({ sessionId: newSession(), events: Array.from({ length: 20 }, () => ({ kind: 'view', path: '/' })) }));
    expect(await stored()).toEqual({ sessions: [], events: [] });
    await expectSilent(await send({ sessionId: newSession(), events: Array.from({ length: 5 }, (_, i) => ({ kind: 'view', path: `/p-${i}` })) }));
    expect((await stored()).events).toHaveLength(5);
  });

  it('answers GET with 405', async () => {
    const res = await GET();
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });
});
