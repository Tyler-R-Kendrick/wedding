import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DELETE, GET, POST } from '@/app/api/feedback/route';
import { POST as PULSE } from '@/app/api/pulse/route';
import { GET as SESSION } from '@/app/api/session/route';
import type { AdminId, AuthIdentityId, GuestId, HouseholdId } from '@/contracts/ids';
import type { Principal } from '@/contracts/principal';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { jobs } from '@/db/schema';
import { REPORTER_PASS_COOKIE } from '@/lib/feedback/constants';
import { FEEDBACK_DELIVER_JOB } from '@/lib/feedback/deliver';
import { mintReporterPass, reporterPassSecret } from '@/lib/feedback/pass';
import { runDueJobs } from '@/lib/jobs';
import '@/lib/jobs/register-all';
import { anonymousResolver, setPrincipalResolver } from '@/lib/principal';
import { MockIssueTracker } from '@/providers/issue-tracker';
import { resetProviders, setProviderOverride } from '@/providers/registry';

/**
 * The problem reporter, end to end against the real route handlers: who may reach it, what a
 * report becomes, and what happens when the tracker is down.
 */
const URL = 'http://localhost:3000/api/feedback';
const session = { authIdentityId: 'A' as AuthIdentityId, entitlements: new Set<never>(), authenticatedAt: new Date().toISOString(), sessionId: 's' };
const PRINCIPALS: Record<string, Principal> = {
  owner: { kind: 'admin', adminId: 'ADMIN_OWNER_1' as AdminId, roles: new Set(['owner']), ...session },
  planner: { kind: 'admin', adminId: 'ADMIN_PLANNER' as AdminId, roles: new Set(['planner']), ...session },
  guest: { kind: 'guest', guestId: 'G1' as GuestId, householdId: 'H1' as HouseholdId, actsFor: [], ...session },
  'owner-as-guest': { kind: 'guest', guestId: 'G1' as GuestId, householdId: 'H1' as HouseholdId, actsFor: [], ...session, viewedBy: { adminId: 'ADMIN_OWNER_2' as AdminId, roles: new Set(['owner']), readOnly: true } },
};
const SAME_SITE = { 'sec-fetch-site': 'same-origin' };
const as = (who: string) => ({ 'x-test-principal': who });
const passCookie = (adminId = 'ADMIN_OWNER_1') => ({ cookie: `${REPORTER_PASS_COOKIE}=${mintReporterPass(reporterPassSecret()!, adminId)}` });
const jsonPost = (body: unknown, headers: Record<string, string>) => POST(new Request(URL, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', accept: 'application/json', ...SAME_SITE, ...headers } }));
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4]);

let tracker: MockIssueTracker;

beforeAll(() => {
  setPrincipalResolver({ resolve: async (req) => PRINCIPALS[req.headers.get('x-test-principal') ?? ''] ?? { kind: 'anonymous' } });
});
beforeEach(() => {
  tracker = new MockIssueTracker();
  setProviderOverride('issue-tracker', tracker);
});
afterAll(() => {
  setPrincipalResolver(anonymousResolver);
  resetProviders();
});

describe('who may reach the reporter', () => {
  it('answers 404 to everyone who is not one of the couple, on every method', async () => {
    for (const who of ['', 'guest', 'planner']) {
      expect((await GET(new Request(URL, { headers: as(who) }))).status, `GET as ${who || 'nobody'}`).toBe(404);
      expect((await jsonPost({ message: 'x' }, as(who))).status, `POST as ${who || 'nobody'}`).toBe(404);
    }
    expect(tracker.issues).toHaveLength(0);
  });

  it('lets an owner in by their session, and gives that browser the pass', async () => {
    const res = await GET(new Request(URL, { headers: as('owner') }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('set-cookie')).toMatch(/^wedding\.reporter=v1\.ADMIN_OWNER_1\.\d+\.[\w-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
    expect(await res.text()).toContain('<h1>Report a problem</h1>');
  });

  it('lets an owner in by the pass alone, with sign-in answering nobody', async () => {
    // No x-test-principal: the resolver says anonymous, as it would with the database down.
    const res = await jsonPost({ message: 'Sign-in is down and so is everything behind it.' }, passCookie());
    expect(res.status).toBe(201);
    expect(tracker.issues[0]!.body).toContain('owner `ADMIN_OWNER_1`');
  });

  it('lets an owner in while they browse as a guest', async () => {
    expect((await jsonPost({ message: 'Seen as a guest.' }, as('owner-as-guest'))).status).toBe(201);
    expect(tracker.issues[0]!.body).toContain('ADMIN_OWNER_2');
  });

  it('refuses a forged or expired pass', async () => {
    const forged = { cookie: `${REPORTER_PASS_COOKIE}=${mintReporterPass('some-other-secret-entirely', 'ADMIN_OWNER_1')}` };
    const expired = { cookie: `${REPORTER_PASS_COOKIE}=${mintReporterPass(reporterPassSecret()!, 'ADMIN_OWNER_1', Date.now() - 31 * 86_400_000)}` };
    expect((await jsonPost({ message: 'x' }, forged)).status).toBe(404);
    expect((await jsonPost({ message: 'x' }, expired)).status).toBe(404);
  });

  it('refuses a request another site’s page made, pass or no pass', async () => {
    const res = await POST(new Request(URL, { method: 'POST', body: JSON.stringify({ message: 'x' }), headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site', ...passCookie() } }));
    expect(res.status).toBe(404);
    expect(tracker.issues).toHaveLength(0);
  });

  it('forgets a device on DELETE', async () => {
    const res = await DELETE(new Request(URL, { method: 'DELETE', headers: SAME_SITE }));
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toBe('wedding.reporter=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  });
});

describe('filing a report', () => {
  const diagnostics = {
    session: 'abcdef0123456789',
    build: 'a1b2c3d',
    path: '/rsvp?t=secret-invitation-token',
    title: 'RSVP',
    viewport: '390x844@3',
    userAgent: 'Mozilla/5.0',
    language: 'en-US',
    timeZone: 'America/Chicago',
    online: true,
    startedAt: Date.now() - 30_000,
    capturedAt: Date.now(),
    errors: [{ t: Date.now(), source: 'boundary', message: 'failed for jane@example.com', digest: '99887766' }],
    breadcrumbs: [{ t: Date.now(), kind: 'http', text: 'POST /api/capabilities/submit_rsvp 500 812ms request 01HZX4K9M2N8P7Q6R5S4T3V2W1' }],
  };

  it('becomes an issue with the page, the build and what led up to it, scrubbed', async () => {
    const res = await jsonPost({ kind: 'bug', message: 'Submitting the RSVP shows an error.', path: '/rsvp?t=secret-invitation-token', title: 'RSVP', diagnostics }, passCookie());
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; ref: string; filed: string; issue: { key: string; url: string } };
    expect(body).toMatchObject({ ok: true, filed: 'tracker', issue: { key: 'MOCK-1' } });
    expect(body.ref).toMatch(/^FB-[0-9A-Z]{6}$/);
    const issue = tracker.issues[0]!;
    expect(issue.title).toBe('Bug: Submitting the RSVP shows an error.');
    expect(issue.body).toContain(body.ref);
    expect(issue.body).toContain('digest 99887766');
    expect(issue.body).toContain('POST /api/capabilities/submit_rsvp 500');
    // The server scrubs again: no token from the address, no address from the error text.
    expect(issue.body).not.toMatch(/secret-invitation-token|jane@example\.com/);
  });

  it('takes a screenshot from the widget’s multipart form', async () => {
    const form = new FormData();
    form.set('message', 'The header overlaps the menu.');
    form.set('kind', 'content');
    form.set('diagnostics', JSON.stringify(diagnostics));
    form.set('screenshot', new Blob([PNG], { type: 'image/png' }), 'screenshot');
    const res = await POST(new Request(URL, { method: 'POST', body: form, headers: { accept: 'application/json', 'sec-fetch-dest': 'empty', ...SAME_SITE, ...passCookie() } }));
    expect(res.status).toBe(201);
    expect(tracker.issues[0]!.attachments?.[0]).toMatchObject({ contentType: 'image/png' });
    expect(tracker.issues[0]!.title).toBe('Content: The header overlaps the menu.');
  });

  it('leaves out a "screenshot" that is not a picture, and says so', async () => {
    const form = new FormData();
    form.set('message', 'With a strange attachment.');
    form.set('screenshot', new Blob(['<svg onload="alert(1)"/>'], { type: 'image/png' }), 'x.png');
    const res = await POST(new Request(URL, { method: 'POST', body: form, headers: { accept: 'application/json', 'sec-fetch-dest': 'empty', ...SAME_SITE, ...passCookie() } }));
    expect(((await res.json()) as { message: string }).message).toContain('was not a picture');
    expect(tracker.issues[0]!.attachments).toBeUndefined();
  });

  it('answers the plain form with a page, not JSON', async () => {
    const form = new FormData();
    form.set('message', 'Nothing on the site responds to taps.');
    form.set('path', '/guests');
    form.set('digest', '12345678');
    const res = await POST(new Request(URL, { method: 'POST', body: form, headers: { accept: 'text/html,application/xhtml+xml', 'sec-fetch-dest': 'document', ...SAME_SITE, ...passCookie() } }));
    expect(res.status).toBe(201);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('<h1>Report sent</h1>');
    expect(html).toContain('Filed as MOCK-1.');
    expect(html).toContain('href="/guests"');
    expect(tracker.issues[0]!.body).toContain('Error reference on the page: 12345678');
    expect(tracker.issues[0]!.body).toContain('Sent from the plain form');
  });

  it('shows the plain form again, with what was typed, when the message is empty', async () => {
    const form = new FormData();
    form.set('message', '   ');
    const res = await POST(new Request(URL, { method: 'POST', body: form, headers: { accept: 'text/html', 'sec-fetch-dest': 'document', ...SAME_SITE, ...passCookie() } }));
    expect(res.status).toBe(422);
    expect(await res.text()).toContain('Say what happened before sending.');
  });

  it('refuses what it cannot read without filing anything', async () => {
    expect((await jsonPost({}, passCookie())).status).toBe(422);
    expect((await POST(new Request(URL, { method: 'POST', body: '{not json', headers: { 'content-type': 'application/json', ...SAME_SITE, ...passCookie() } }))).status).toBe(400);
    expect((await POST(new Request(URL, { method: 'POST', body: 'x', headers: { 'content-type': 'text/plain', ...SAME_SITE, ...passCookie() } }))).status).toBe(415);
    expect(tracker.issues).toHaveLength(0);
  });

  it('stops a stuck key: a thirteenth report in ten minutes waits', async () => {
    const who = passCookie('ADMIN_BURST_01');
    const statuses: number[] = [];
    for (let i = 0; i < 13; i++) statuses.push((await jsonPost({ message: `report ${i}` }, who)).status);
    expect(statuses.slice(0, 12).every((s) => s === 201)).toBe(true);
    expect(statuses[12]).toBe(429);
  });
});

describe('when the tracker is down', () => {
  it('keeps the report in the queue, and the cron files it', async () => {
    tracker.failNext = 1;
    const res = await jsonPost({ message: 'Filed while the tracker was unreachable.' }, passCookie('ADMIN_QUEUE_01'));
    expect(res.status).toBe(202);
    const body = (await res.json()) as { filed: string; ref: string; message: string };
    expect(body.filed).toBe('queue');
    expect(body.message).toContain('will be filed in the next few minutes');
    expect(tracker.issues).toHaveLength(0);

    const db = await getDb();
    const waiting = await db.select().from(jobs).where(eq(jobs.type, FEEDBACK_DELIVER_JOB));
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ status: 'queued', dedupeKey: `feedback:${body.ref}` });
    const run = await runDueJobs(db, { types: [FEEDBACK_DELIVER_JOB] });
    expect(run.succeeded).toBe(1);
    expect(tracker.issues).toHaveLength(1);
    expect(tracker.issues[0]!.body).toContain(body.ref);
  });
});

describe('/api/session', () => {
  it('tells an owner the reporter is theirs and hands over the pass', async () => {
    const res = await SESSION(new Request('http://localhost:3000/api/session', { headers: as('owner') }));
    expect(((await res.json()) as { reporter: boolean }).reporter).toBe(true);
    expect(res.headers.get('set-cookie')).toMatch(/^wedding\.reporter=v1\.ADMIN_OWNER_1\./);
  });

  it('tells nobody else, and sets no cookie', async () => {
    for (const who of ['', 'guest', 'planner']) {
      const res = await SESSION(new Request('http://localhost:3000/api/session', { headers: as(who) }));
      expect(((await res.json()) as { reporter: boolean }).reporter, who).toBe(false);
      expect(res.headers.get('set-cookie'), who).toBeNull();
    }
  });
});

describe('/api/pulse', () => {
  const pulse = (body: unknown, headers: Record<string, string> = SAME_SITE) => PULSE(new Request('http://localhost:3000/api/pulse', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } }));

  it('answers 204 to anything: a report, rubbish, another site', async () => {
    expect((await pulse({ v: 1, type: 'error', diagnostics: { session: 'abcdef0123456789', errors: [{ t: 1, source: 'error', message: 'boom' }], breadcrumbs: [] } })).status).toBe(204);
    expect((await pulse('{not json')).status).toBe(204);
    expect((await pulse({ type: 'something-else' })).status).toBe(204);
    expect((await pulse({ type: 'error' }, { 'sec-fetch-site': 'cross-site' })).status).toBe(204);
    expect((await pulse('x'.repeat(100_000))).status).toBe(204);
  });
});
