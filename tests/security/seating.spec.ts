import { expect, test } from '@playwright/test';
import { BASE_URL, callCapability, contextAs, IDS, key, stabilize } from '../e2e/helpers/principal';

/** Seating publication boundary over HTTP. Runs once (desktop project). */
test.describe.configure({ mode: 'serial' });
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'API-level security suite runs once');
});

const TABLE_NAME = 'Security Draft Table';
let tableId = '';

test.beforeAll(async ({ request }) => {
  await callCapability(request, 'admin_unpublish_seating', 'admin', {}, { idempotencyKey: key() });
  const overview = await callCapability(request, 'admin_seating_overview', 'admin', {});
  expect(overview.status).toBe(200);
  const plans = overview.body.data!.floorPlans as Array<{ id: string; venueSpaceRef: string }>;
  const existing = (overview.body.data!.tables as Array<{ id: string; name: string }>).find((t) => t.name === TABLE_NAME);
  const saved = await callCapability(request, 'admin_upsert_table', 'admin', { id: existing?.id, name: TABLE_NAME, capacity: 4, floorPlanId: plans.find((p) => p.venueSpaceRef === 'stagg-court')!.id, anchorId: 't3' }, { idempotencyKey: key() });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  tableId = saved.body.data!.id as string;
  const seated = await callCapability(request, 'admin_assign_seats', 'admin', { changes: [{ guestId: IDS.C1, tableId, seatNumber: 2 }] }, { idempotencyKey: key() });
  expect(seated.status, JSON.stringify(seated.body)).toBe(200);
});

test.afterAll(async ({ request }) => {
  await callCapability(request, 'admin_unpublish_seating', 'admin', {}, { idempotencyKey: key() });
});

test('before publication: not_found everywhere, and no draft table id or name in any JSON or HTML response', async ({ request, browser }) => {
  expect((await callCapability(request, 'get_my_table', 'C1', {})).status).toBe(404);
  expect((await callCapability(request, 'show_my_table_on_floorplan', 'C1', {})).status).toBe(404);
  const responses = await Promise.all(['get_my_itinerary', 'get_my_rsvp', 'list_my_events', 'get_my_table', 'show_my_table_on_floorplan'].map((n) => callCapability(request, n, 'C1', {})));
  const all = JSON.stringify(responses.map((r) => r.body));
  expect(all).not.toContain(tableId);
  expect(all).not.toContain(TABLE_NAME);
  expect(all).not.toContain('seatNumber');
  const itinerary = responses[0]!.body;
  expect(itinerary.data!.seating).toEqual({ published: false, table: null });
  expect(stabilize(itinerary)).toMatchSnapshot('c1-itinerary-before-publish.json');

  const ctx = await contextAs(browser, 'C1');
  const page = await ctx.newPage();
  await page.goto(`${BASE_URL}/your-weekend`);
  const html = await page.content();
  expect(html).toContain('Your table will appear here once seating is published.');
  expect(html).not.toContain(tableId);
  expect(html).not.toContain(TABLE_NAME);
  await ctx.close();
});

test('after publication: the seated guest sees their table; other households, other guests, anonymous and wrong secrets do not', async ({ request, browser }) => {
  const pub = await callCapability(request, 'admin_publish_seating', 'admin', { note: 'security spec' }, { idempotencyKey: key() });
  expect(pub.status, JSON.stringify(pub.body)).toBe(200);

  const mine = await callCapability(request, 'get_my_table', 'C1', {});
  expect(mine.status).toBe(200);
  expect(mine.body.data!.table).toMatchObject({ id: tableId, name: TABLE_NAME, seatNumber: 2 });
  const nav = await callCapability(request, 'show_my_table_on_floorplan', 'C1', {});
  expect(nav.body.data).toMatchObject({ route: '/your-weekend', highlight: 'table-t3' });

  expect((await callCapability(request, 'get_my_table', 'B1', { guestId: IDS.C1 })).status).toBe(403);
  expect((await callCapability(request, 'get_my_table', 'A2', { guestId: IDS.A1 })).status).toBe(403);
  expect((await callCapability(request, 'get_my_table', null, {})).status).toBe(401);
  expect((await callCapability(request, 'get_my_table', 'C1', {}, { secret: 'wrong-secret-0123456789' })).status).toBe(401);
  const other = await callCapability(request, 'get_my_table', 'B2', {});
  expect(other.status).toBe(404);
  expect(JSON.stringify(other.body)).not.toContain(TABLE_NAME);
  const b1 = await callCapability(request, 'get_my_itinerary', 'B1', {});
  expect(JSON.stringify(b1.body)).not.toContain(tableId);

  const ctx = await contextAs(browser, 'C1');
  const page = await ctx.newPage();
  await page.goto(`${BASE_URL}/your-weekend`);
  await expect(page.getByRole('heading', { name: 'Your table' })).toBeVisible();
  await expect(page.locator('#main')).toContainText(TABLE_NAME);
  await expect(page.locator('#table-t3')).toHaveCount(1);
  await ctx.close();

  // Draft edits after publication stay invisible.
  const moved = await callCapability(request, 'admin_assign_seats', 'admin', { changes: [{ guestId: IDS.C1, tableId, seatNumber: 3 }] }, { idempotencyKey: key() });
  expect(moved.status).toBe(200);
  expect((await callCapability(request, 'get_my_table', 'C1', {})).body.data!.table).toMatchObject({ seatNumber: 2 });
});

test('admin seating mutations refuse guests and anonymous callers', async ({ request }) => {
  for (const [name, input] of [
    ['admin_seating_overview', {}],
    ['admin_upsert_table', { name: 'x', capacity: 2 }],
    ['admin_assign_seats', { changes: [{ guestId: IDS.C1, tableId: null }] }],
    ['admin_import_seating_csv', { csv: 'a,1,b' }],
    ['admin_publish_seating', {}],
    ['admin_unpublish_seating', {}],
  ] as const) {
    expect((await callCapability(request, name, 'C1', input, { idempotencyKey: key() })).status, name).toBe(403);
    expect((await callCapability(request, name, null, input)).status, name).toBe(401);
  }
});
