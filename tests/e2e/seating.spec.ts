import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { callCapability, contextAs, IDS, key } from './helpers/principal';

/**
 * Seating reveal: the couple publishes, and the guest's table (with its floor plan) becomes theirs
 * to see.
 *
 * Where a guest sees it changed. "Your Weekend" printed a table section in every lifecycle state,
 * with "Your table will appear here once seating is published." standing in until then. The
 * dashboard at `/guests` shows only what a guest can use now: the table is a card (`#table`) once
 * seating is published and the guest is seated, and the plan for the state lists it
 * (`TASKS_BY_STATE` in src/domain/lifecycle/guest-actions.ts: wedding week and the day). Before
 * publication there is no card and no sentence about one.
 *
 * So this asserts three things, none of which depends on which state the shared test server has
 * published:
 *   1. before publication, and again after unpublishing, the dashboard carries no table card and
 *      never the table's name;
 *   2. publication is what reveals the table to the guest's own reads (`get_my_itinerary`, which
 *      the dashboard is planned from, and `get_my_table`);
 *   3. the markup a guest gets under "Your table" (`TableCard`: table, seat, room, the floor plan
 *      with their table marked in words as well as colour) renders and is axe-clean. The console's
 *      "Preview what a guest sees" renders that same component for a named guest in any state; when
 *      the published state is one whose dashboard lists the table, the card itself is asserted too.
 */
test.describe.configure({ mode: 'serial' });
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'tablet', 'phone + desktop are the review viewports');
});

const TABLE_NAME = 'E2E Table';
/** The states whose dashboard lists the table card. */
const TABLE_STATES = ['WEDDING_WEEK', 'WEDDING_DAY'];

async function axeClean(builder: AxeBuilder) {
  const results = await builder.withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking, blocking.map((v) => `${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`).join('\n')).toEqual([]);
}

test('the table appears only after the couple publishes seating, and disappears when unpublished', async ({ browser, request }) => {
  await callCapability(request, 'admin_unpublish_seating', 'admin', {}, { idempotencyKey: key() });
  const overview = await callCapability(request, 'admin_seating_overview', 'admin', {});
  const plans = overview.body.data!.floorPlans as Array<{ id: string; venueSpaceRef: string; name: string }>;
  const existing = (overview.body.data!.tables as Array<{ id: string; name: string }>).find((t) => t.name === TABLE_NAME);
  const plan = plans.find((p) => p.venueSpaceRef === 'white-city-ballroom')!;
  const saved = await callCapability(request, 'admin_upsert_table', 'admin', { id: existing?.id, name: TABLE_NAME, capacity: 8, floorPlanId: plan.id, anchorId: 't2' }, { idempotencyKey: key() });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  const tableId = saved.body.data!.id as string;
  expect((await callCapability(request, 'admin_assign_seats', 'admin', { changes: [{ guestId: IDS.A1, tableId, seatNumber: 4 }] }, { idempotencyKey: key() })).status).toBe(200);

  const ctx = await contextAs(browser, 'A1');
  const page = await ctx.newPage();
  const dash = page.locator('#main .dash');

  /** The dashboard rendered (so "no table on it" is a statement about the dashboard, not about a gate). */
  const dashboardWithoutTable = async (when: string) => {
    await expect(page, when).toHaveURL(/\/guests\/?$/);
    await expect(page.getByRole('heading', { level: 1 }), when).toHaveText('Welcome, Ada');
    await expect(dash, when).toHaveAttribute('data-lifecycle', /^[A-Z_]+$/);
    await expect(page.locator('#table'), when).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Your table' }), when).toHaveCount(0);
    await expect(page.locator('#main .fp'), when).toHaveCount(0);
    const html = await page.content();
    expect(html, when).not.toContain(TABLE_NAME);
    expect(html, when).not.toContain(tableId);
  };

  // 1. Before publication: a draft seat is on file, and the guest's page shows none of it.
  await page.goto('/guests');
  await dashboardWithoutTable('before publication');
  const before = await callCapability(request, 'get_my_itinerary', 'A1', {});
  expect(before.status).toBe(200);
  expect(before.body.data!.seating).toMatchObject({ published: false, table: null, state: 'not_published' });
  expect((await callCapability(request, 'get_my_table', 'A1', {})).status).toBe(404);

  // 2. Publication reveals it to the guest's own reads.
  expect((await callCapability(request, 'admin_publish_seating', 'admin', { note: 'e2e' }, { idempotencyKey: key() })).status).toBe(200);
  const after = await callCapability(request, 'get_my_itinerary', 'A1', {});
  expect(after.status).toBe(200);
  expect(after.body.data!.seating).toMatchObject({ published: true, state: 'seated', table: { table: { id: tableId, name: TABLE_NAME, seatNumber: 4, anchorId: 't2' }, floorPlan: { name: plan.name } } });
  const mine = await callCapability(request, 'get_my_table', 'A1', {});
  expect(mine.status).toBe(200);
  expect(mine.body.data!.table).toMatchObject({ id: tableId, name: TABLE_NAME, seatNumber: 4 });
  // The deep link the concierge and agents are given leads to the dashboard, at the guest's table.
  const nav = await callCapability(request, 'show_my_table_on_floorplan', 'A1', {});
  expect(nav.body.data).toMatchObject({ route: '/guests', highlight: 'table-t2', tableName: TABLE_NAME });

  // 3a. On the dashboard, in the states that list the table.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome, Ada');
  const state = (await dash.getAttribute('data-lifecycle')) ?? '';
  if (TABLE_STATES.includes(state)) {
    const card = page.locator('#table');
    await expect(card.getByRole('heading', { name: 'Your table' })).toBeVisible();
    await expect(card).toContainText(`${TABLE_NAME}, seat 4 in the ${plan.name}`);
    await expect(card.getByRole('img', { name: /floor plan: your table is E2E Table, seat 4/ })).toBeVisible();
    await expect(page.locator('#table-t2 text').first()).toHaveText('2');
    await expect(page.locator('#table-t2')).toContainText('You');
    await expect(card).toContainText('Schematic layout');
  }
  // Whatever the state, the dashboard a seated guest gets is axe-clean.
  await axeClean(new AxeBuilder({ page }));

  // 3b. The guest's own "Your table" markup, as the console previews it for this guest.
  const adminCtx = await contextAs(browser, 'admin');
  const admin = await adminCtx.newPage();
  await admin.goto(`/admin/seating?preview=${IDS.A1}`);
  const preview = admin.locator('#preview');
  await expect(preview).toContainText('would see:');
  await expect(preview).toContainText(`${TABLE_NAME}, seat 4 in the ${plan.name}`);
  const figure = preview.getByRole('img', { name: /floor plan: your table is E2E Table, seat 4/ });
  await expect(figure).toBeVisible();
  // The guest's table is marked in words, not by colour alone, and the plan says it is a schematic.
  await expect(figure.locator('.fp__table--mine')).toHaveCount(1);
  await expect(figure.locator('.fp__table--mine text').first()).toHaveText('2');
  await expect(figure.locator('.fp__table--mine')).toContainText('You');
  await expect(preview.locator('.fp__caption')).toContainText(`Your table: ${TABLE_NAME}, seat 4.`);
  await expect(preview).toContainText('Schematic layout');
  await axeClean(new AxeBuilder({ page: admin }).include('#preview'));
  await adminCtx.close();

  // 1 again. Unpublishing takes it away from the guest at once.
  expect((await callCapability(request, 'admin_unpublish_seating', 'admin', {}, { idempotencyKey: key() })).status).toBe(200);
  await page.reload();
  await dashboardWithoutTable('after unpublishing');
  expect((await callCapability(request, 'get_my_table', 'A1', {})).status).toBe(404);
  expect((await callCapability(request, 'get_my_itinerary', 'A1', {})).body.data!.seating).toMatchObject({ published: false, table: null, state: 'not_published' });
  await ctx.close();
});
