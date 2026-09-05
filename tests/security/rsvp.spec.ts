import { expect, test } from '@playwright/test';
import { BASE_URL, callCapability, contextAs, IDS, key, principalHeaders, stabilize } from '../e2e/helpers/principal';

/**
 * RSVP authorization over HTTP (the only door a browser or agent has). Runs once (desktop project):
 * every call goes through POST /api/capabilities with the test principal injector.
 */
test.describe.configure({ mode: 'serial' });
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'API-level security suite runs once');
});

test.beforeAll(async ({ request }) => {
  const open = await callCapability(request, 'admin_set_rsvp_window', 'admin', { mode: 'open', deadlineAt: null }, { idempotencyKey: key() });
  expect(open.status, JSON.stringify(open.body)).toBe(200);
});

test('unauthenticated and wrong-secret callers get 401 and see no household data; pages show the guests-only state', async ({ request }) => {
  expect((await callCapability(request, 'get_my_rsvp', null, {})).status).toBe(401);
  expect((await callCapability(request, 'get_my_itinerary', null, {})).status).toBe(401);
  const wrong = await callCapability(request, 'get_my_rsvp', 'A1', {}, { secret: 'not-the-secret-0123456789' });
  expect(wrong.status).toBe(401);
  for (const path of ['/rsvp', '/your-weekend']) {
    const res = await request.get(`${BASE_URL}${path}`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('is for invited guests');
    expect(html).not.toContain('Testhouse');
    expect(res.headers()['cache-control']).toMatch(/no-store/);
  }
});

test('a household manager sees only their household; another household is never present (JSON + HTML)', async ({ request, browser }) => {
  const a1 = await callCapability(request, 'get_my_rsvp', 'A1', {});
  expect(a1.status).toBe(200);
  const json = JSON.stringify(a1.body);
  expect(json).toContain(IDS.A1);
  expect(json).toContain(IDS.A3);
  expect(json).not.toContain(IDS.B1);
  expect(json).not.toContain('Fixture');
  expect(json).not.toContain(IDS.C1);

  const b2 = await callCapability(request, 'get_my_rsvp', 'B2', {});
  expect(b2.status).toBe(200);
  expect(JSON.stringify(b2.body)).not.toContain(IDS.B1); // a non-manager sees only themselves
  expect(stabilize(b2.body)).toMatchSnapshot('b2-get_my_rsvp.json');

  const ctx = await contextAs(browser, 'B2');
  const page = await ctx.newPage();
  await page.goto(`${BASE_URL}/rsvp`);
  const html = await page.content();
  expect(html).toContain('Eve');
  expect(html).not.toContain('Testhouse');
  expect(html).not.toContain('Dev Fixture');
  await ctx.close();
});

test('injecting another household or an uninvited event into a draft is forbidden; non-managers cannot answer for others', async ({ request }) => {
  const injected = await callCapability(request, 'draft_rsvp', 'A1', { responses: [{ guestId: IDS.B1, eventId: IDS.ceremony, status: 'accepted' }] });
  expect(injected.status).toBe(403);
  expect(JSON.stringify(injected.body)).not.toContain('Fixture');
  const spouse = await callCapability(request, 'draft_rsvp', 'A2', { responses: [{ guestId: IDS.A1, eventId: IDS.ceremony, status: 'declined' }] });
  expect(spouse.status).toBe(403);
  const uninvited = await callCapability(request, 'draft_rsvp', 'B1', { responses: [{ guestId: IDS.B2, eventId: IDS.ceremony, status: 'accepted' }] });
  expect(uninvited.status).toBe(403);
  const needs = await callCapability(request, 'draft_rsvp', 'A2', { responses: [{ guestId: IDS.A2, eventId: IDS.ceremony, status: 'accepted' }], needs: [{ guestId: IDS.A1, dietary: 'x' }] });
  expect(needs.status).toBe(403);
});

test('draft -> submit needs the token and a key; replay is idempotent; a changed payload conflicts; tokens are single-use', async ({ request }) => {
  const input = { responses: [{ guestId: IDS.A1, eventId: IDS.ceremony, status: 'accepted' }, { guestId: IDS.A2, eventId: IDS.reception, status: 'accepted', mealOptionId: IDS.mealFish }] };
  const draft = await callCapability(request, 'draft_rsvp', 'A1', input);
  expect(draft.status, JSON.stringify(draft.body)).toBe(200);
  const token = draft.body.confirmation!.token;
  const submission = draft.body.data!.submission;

  expect((await callCapability(request, 'submit_rsvp', 'A1', submission, { idempotencyKey: key() })).status).toBe(409); // no token
  expect((await callCapability(request, 'submit_rsvp', 'A1', submission, { confirmationToken: token })).status).toBe(422); // no key
  const tampered = { ...(submission as object), needs: [{ guestId: IDS.A1, dietary: 'injected', accessibility: null }] };
  expect((await callCapability(request, 'submit_rsvp', 'A1', tampered, { idempotencyKey: key(), confirmationToken: token })).status).toBe(409);
  // B1 cannot redeem A1's token even with A1's exact payload.
  expect((await callCapability(request, 'submit_rsvp', 'B1', submission, { idempotencyKey: key(), confirmationToken: token })).status).toBe(409);

  const k = key();
  const first = await callCapability(request, 'submit_rsvp', 'A1', submission, { idempotencyKey: k, confirmationToken: token });
  expect(first.status, JSON.stringify(first.body)).toBe(200);
  const replay = await callCapability(request, 'submit_rsvp', 'A1', submission, { idempotencyKey: k, confirmationToken: token });
  expect(replay.status).toBe(200);
  expect(replay.body.data!.submittedAt).toBe(first.body.data!.submittedAt);
  const draft2 = await callCapability(request, 'draft_rsvp', 'A1', { responses: input.responses.slice(0, 1) });
  expect(draft2.status).toBe(200);
  const conflict = await callCapability(request, 'submit_rsvp', 'A1', draft2.body.data!.submission, { idempotencyKey: k, confirmationToken: draft2.body.confirmation!.token });
  expect(conflict.status).toBe(409);
  expect(conflict.body.error!.code).toBe('conflict');
  const used = await callCapability(request, 'submit_rsvp', 'A1', submission, { idempotencyKey: key(), confirmationToken: token });
  expect(used.status).toBe(409);
  expect(used.body.error!.details).toMatchObject({ reason: 'used' });

  // Guest B still sees nothing of household A after A submitted.
  const b1 = await callCapability(request, 'get_my_rsvp', 'B1', {});
  expect(JSON.stringify(b1.body)).not.toContain('Testhouse');
  expect(JSON.stringify(b1.body)).not.toContain(IDS.A1);
});

test('admin-only capabilities refuse guests, and admin surfaces never leak needs unless explicitly exported', async ({ request }) => {
  for (const name of ['admin_rsvp_overview', 'admin_export_rsvp', 'admin_list_events']) {
    expect((await callCapability(request, name, 'A1', {})).status, name).toBe(403);
    expect((await callCapability(request, name, null, {})).status, name).toBe(401);
  }
  expect((await callCapability(request, 'admin_export_needs', 'A1', { includeNeeds: true })).status).toBe(403);
  expect((await callCapability(request, 'admin_override_rsvp', 'A1', { guestId: IDS.A2, eventId: IDS.reception, status: 'declined', reason: 'nope' }, { idempotencyKey: key() })).status).toBe(403);
  const overview = await callCapability(request, 'admin_rsvp_overview', 'admin', {});
  expect(overview.status).toBe(200);
  expect(JSON.stringify(overview.body)).not.toContain('dietary');
  const html = await (await request.get(`${BASE_URL}/admin/rsvp`, { headers: principalHeaders('A1') })).text();
  expect(html).toContain('Administrator sign-in required');
  expect(html).not.toContain('Testhouse');
});
