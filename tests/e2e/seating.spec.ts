import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { BASE_URL, callCapability, contextAs, IDS, key } from './helpers/principal';

/** Seating reveal: admin publishes, the guest's Your Weekend shows the table on the floor plan. */
test.describe.configure({ mode: 'serial' });
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'tablet', 'phone + desktop are the review viewports');
});

const TABLE_NAME = 'E2E Table';

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
  await page.goto(`${BASE_URL}/your-weekend`);
  await expect(page.locator('#main')).toContainText('Your table will appear here once seating is published.');
  expect(await page.content()).not.toContain(TABLE_NAME);

  expect((await callCapability(request, 'admin_publish_seating', 'admin', { note: 'e2e' }, { idempotencyKey: key() })).status).toBe(200);
  await page.reload();
  await expect(page.locator('#main')).toContainText(`${TABLE_NAME}, seat 4 in the ${plan.name}`);
  const figure = page.getByRole('img', { name: /floor plan: your table is E2E Table, seat 4/ });
  await expect(figure).toBeVisible();
  await expect(page.locator('#table-t2 text').first()).toHaveText('2');
  await expect(page.locator('#table-t2')).toContainText('You');
  await expect(page.locator('#main')).toContainText('Schematic layout');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking, blocking.map((v) => `${v.id}: ${v.help}`).join('\n')).toEqual([]);

  expect((await callCapability(request, 'admin_unpublish_seating', 'admin', {}, { idempotencyKey: key() })).status).toBe(200);
  await page.reload();
  await expect(page.locator('#main')).toContainText('Your table will appear here once seating is published.');
  await ctx.close();
});
