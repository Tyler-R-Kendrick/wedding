import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking, blocking.map((v) => `${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`).join('\n')).toEqual([]);
}

const MARKER = 'TODO(Tyler & Sara)';

/**
 * Follow a site link. On a phone both kits keep the full list in the Menu sheet and leave only the
 * wordmark and the sheet trigger in the Site landmark, so fall back to the sheet when it is not there.
 */
async function follow(page: Page, name: string) {
  const inNav = page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name });
  if (await inNav.isVisible().catch(() => false)) {
    await inNav.click();
    return;
  }
  await page.getByRole('button', { name: /^Menu$/ }).locator('visible=true').first().click();
  const sheet = page.getByRole('dialog').locator('visible=true').first();
  await expect(sheet).toBeVisible();
  await sheet.getByRole('link', { name }).click();
}

test.describe('explore journey', () => {
  test('story → adventure → linked recommendation → directions handoff', async ({ page }) => {
    await page.goto('/our-story');
    // The approved design titles the page with its editorial headline; the page is still "Our Story".
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('How we found our way to forever');
    await expect(page).toHaveTitle(/Our Story/);
    await expect(page.getByText('We met at Allison and Jamie’s wedding.')).toBeVisible();
    expect(await page.locator('[data-placeholder="true"]').count()).toBeGreaterThan(0);
    expect(await page.locator('main').innerText()).not.toContain(MARKER);
    await axe(page);

    await follow(page, 'Our Adventures');
    await expect(page).toHaveURL(/\/our-adventures$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // Only the public memory is listed; the private drafts never render.
    await expect(page.locator('[data-adventure]')).toHaveCount(1);
    await expect(page.getByText('Museum of Ice Cream')).toHaveCount(0);
    await axe(page);

    await page.getByRole('link', { name: 'Starved Rock', exact: true }).click();
    await expect(page).toHaveURL(/\/our-adventures\/starved-rock$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Starved Rock');
    // the lede is the page head's own summary line, whichever kit rendered it
    await expect(page.locator('main header').first()).toContainText('Where we first said');
    await expect(page.getByRole('heading', { name: 'Sara remembers' })).toBeVisible();
    expect(await page.locator('main').innerText()).not.toContain(MARKER);
    await axe(page);

    const related = page.locator('[data-recommendation="starved-rock-state-park"]');
    await expect(related).toBeVisible();
    await related.locator('summary').filter({ hasText: /Why we.re sharing this/ }).click();
    await expect(related.getByRole('link', { name: /Read the memory/ })).toBeVisible();
    await related.getByRole('link', { name: 'Starved Rock State Park', exact: true }).click();
    await expect(page).toHaveURL(/\/share-an-adventure\/starved-rock-state-park$/);

    const directions = page.getByRole('link', { name: 'Open directions in Google Maps' });
    await expect(directions).toBeVisible();
    await expect(directions).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps\/dir\//);
    await expect(directions).toHaveAttribute('rel', /noopener/);
    await expect(directions).toHaveAttribute('target', '_blank');
    await expect(page.getByText('You will leave our site for Google Maps')).toBeVisible();
    await expect(page.getByText('Draft — not yet curated')).toBeVisible();
    await axe(page);
  });

  test('the story is a ride: the map jumps, the buttons step, a citation lands on its station', async ({ page }) => {
    await page.goto('/our-story');
    const ride = page.locator('.bd-ride');
    await expect(ride).toHaveAttribute('data-mode', 'ride');
    const map = page.getByRole('navigation', { name: /^Stations on the .+ Line$/ });
    // Every station is on the car card, in order, from the night they met to the Loop.
    const stations = map.getByRole('link');
    await expect(stations.first()).toHaveAccessibleName(/^How we met/);
    await expect(stations.last()).toHaveAccessibleName(/The Loop/);
    // The chapters are told by colour alone: no "Red Line" or "Blue Line" is printed anywhere on the ride.
    await expect(ride).not.toContainText(/(Red|Blue|Brown|Pink|Green|Orange|Gold) Line/);
    const bar = page.locator('.bd-ride__bar');

    // Tapping a station rides the train there; the URL follows so it can be shared.
    await map.getByRole('link', { name: /^Starved Rock/ }).click();
    await expect(page).toHaveURL(/#starved-rock$/);
    await expect(map.getByRole('link', { name: /^Starved Rock/ })).toHaveAttribute('aria-current', 'location');
    await expect(bar).toContainText('Next stopGreater together than alone');
    // The moment's words come before its picture, in the page and on screen.
    const words = await page.locator('#starved-rock .bd-stopcard__title').boundingBox();
    const picture = await page.locator('#starved-rock .bd-stopcard__media').boundingBox();
    expect(words && picture && (words.x + words.width <= picture.x + 1 || words.y + words.height <= picture.y + 1), 'words lead the picture').toBe(true);
    // Only the station at the platform is exposed; the scenery is hidden from assistive technology
    // and out of the tab order, but its words stay in the page for find-in-page.
    await expect(page.locator('#starved-rock')).not.toHaveAttribute('aria-hidden', /.*/);
    await expect(page.locator('#love')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#the-loop a').first()).toHaveAttribute('tabindex', '-1');
    await expect(page.getByRole('heading', { name: 'Starved Rock', level: 3 })).toBeVisible();

    // The two buttons step one station at a time, for anyone who would rather press than scroll.
    await page.getByRole('button', { name: /Next stop/ }).click();
    await expect(map.getByRole('link', { name: /Greater together than alone/ })).toHaveAttribute('aria-current', 'location');
    await page.getByRole('button', { name: /Back a stop/ }).click();
    await expect(map.getByRole('link', { name: /^Starved Rock/ })).toHaveAttribute('aria-current', 'location');
    // Arriving is announced once the train has settled.
    await expect(page.locator('.bd-ride__bar [aria-live="polite"]')).toHaveText(/This is Starved Rock\. Next stop, Greater together than alone\./);

    // An assistant's citation (/our-story#love) lands on that transfer, not on the first stop.
    await page.goto('/our-story#love');
    await expect(map.getByRole('link', { name: /^Love$/ })).toHaveAttribute('aria-current', 'location');
    await expect(page.getByRole('heading', { name: 'Love', level: 3 })).toBeVisible();
    await axe(page);
  });

  test('the car card is one tab stop: arrow keys walk it, the focused station stays on screen, Enter rides', async ({ page }) => {
    await page.goto('/our-story#allison-and-jamies-wedding');
    const map = page.getByRole('navigation', { name: /^Stations on the .+ Line$/ });
    await expect(map.getByRole('link', { name: /Allison and Jamie/ })).toHaveAttribute('aria-current', 'location');
    // Exactly one station takes Tab: the one the train is at.
    await expect(map.locator('a[tabindex="0"]')).toHaveCount(1);
    await map.getByRole('link', { name: /Allison and Jamie/ }).focus();
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowDown');
    const focused = map.getByRole('link', { name: /^Starved Rock/ });
    await expect(focused).toBeFocused();
    // WCAG 2.4.11: the focused link is not hidden off the edge of the strip.
    const box = await focused.boundingBox();
    const vp = await map.locator('.bd-ride-map__viewport').boundingBox();
    expect(box && vp && box.x >= vp.x - 1 && box.x + box.width <= vp.x + vp.width + 1 && box.y >= vp.y - 1 && box.y + box.height <= vp.y + vp.height + 1, 'focused station is inside the car card').toBe(true);
    await page.keyboard.press('Home');
    await expect(map.getByRole('link', { name: /How we met/ })).toBeFocused();
    await page.keyboard.press('End');
    await expect(map.getByRole('link', { name: /The Loop/ })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#the-loop$/);
    await expect(map.getByRole('link', { name: /The Loop/ })).toHaveAttribute('aria-current', 'location');
  });

  test('"Read it as a list" lays the line flat, keeps your place, and the choice is remembered', async ({ page }) => {
    await page.goto('/our-story#starved-rock');
    await expect(page.locator('.bd-ride')).toHaveAttribute('data-mode', 'ride');
    await expect(page.getByRole('navigation', { name: /^Stations on the .+ Line$/ }).getByRole('link', { name: /^Starved Rock/ })).toHaveAttribute('aria-current', 'location');
    await page.getByRole('button', { name: 'Read it as a list' }).click();
    await expect(page.locator('.bd-ride')).toHaveAttribute('data-mode', 'flat');
    // The list opens where the ride was, and focus goes with the guest.
    await expect(page.locator('#starved-rock')).toBeInViewport();
    await expect(page.locator('#starved-rock')).toBeFocused();
    await expect(page.getByRole('button', { name: 'Ride the line instead' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.bd-ride [aria-hidden="true"].bd-ride__stop')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.bd-ride')).toHaveAttribute('data-mode', 'flat');
    await page.getByRole('button', { name: 'Ride the line instead' }).click();
    await expect(page.locator('.bd-ride')).toHaveAttribute('data-mode', 'ride');
    await axe(page);
  });

  test('reduced motion and no script lay the same line flat, every stop readable', async ({ browser }, testInfo) => {
    for (const options of [{ reducedMotion: 'reduce' as const }, { javaScriptEnabled: false }]) {
      const ctx = await browser.newContext({ baseURL: testInfo.project.use.baseURL, ...options });
      const page = await ctx.newPage();
      await page.goto('/our-story#love');
      await expect(page.locator('.bd-ride')).toHaveAttribute('data-mode', 'flat');
      for (const id of ['how-we-met', 'allison-and-jamies-wedding', 'love', 'starved-rock', 'the-loop']) await expect(page.locator(`#${id}`)).toBeVisible();
      await expect(page.locator('.bd-ride [inert], .bd-ride__stop[aria-hidden]')).toHaveCount(0);
      // The stations list the intro promises is there in every mode.
      await expect(page.getByRole('navigation', { name: /^Stations on the .+ Line$/ }).getByRole('link', { name: /Starved Rock/ })).toBeVisible();
      await expect(page.locator('#love')).toBeInViewport();
      if (options.reducedMotion) await axe(page);
      await ctx.close();
    }
  });

  test('share an adventure composes a plan for the time available', async ({ page }) => {
    await page.goto('/share-an-adventure');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('[data-itinerary]')).toHaveCount(8);
    await page.getByLabel('How much time do you have?').selectOption('45');
    await page.getByLabel('What are you in the mood for?').selectOption('architecture');
    await page.getByRole('button', { name: 'Suggest a plan' }).click();
    await expect(page).toHaveURL(/minutes=45/);
    const plan = page.locator('#plan-result');
    await expect(plan).toBeVisible();
    await expect(plan.getByRole('link', { name: 'Walk the building' })).toBeVisible();
    await axe(page);
  });

  test('explore CAA lists current outlets with dates and never the closed ones', async ({ page }) => {
    await page.goto('/explore-caa');
    // The approved page is "Explore CAA + Chicago"; the building's own name leads the venue section.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Explore CAA + Chicago');
    await expect(page.getByRole('heading', { name: 'Chicago Athletic Association', level: 2 })).toBeVisible();
    await expect(page.locator('#fact-built-1893')).toContainText('Built in 1893');
    await expect(page.locator('[data-key="outlet.cindys"]')).toBeVisible();
    await expect(page.locator('[data-key="outlet.cindys"] [data-freshness]')).toContainText('September 5, 2026');
    await expect(page.locator('[data-key="outlet.milk-room"]')).toHaveCount(0);
    await expect(page.locator('[data-key="outlet.cherry-circle-room"]')).toHaveCount(0);
    await expect(page.locator('[data-key="valet.entrance"]')).toContainText('71 E Madison');
    await expect(page.locator('[data-space]')).toHaveCount(4);
    expect(await page.locator('main').innerText()).not.toContain(MARKER);
    expect(await page.locator('[data-placeholder="true"]').count()).toBeGreaterThan(0);
    await axe(page);

    await page.getByRole('link', { name: 'White City Ballroom' }).click();
    await expect(page).toHaveURL(/\/explore-caa\/white-city-ballroom$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('White City Ballroom');
    // Was `toContainText('Kit figure')`, which pinned the caption to
    // "Kit figure - verify with the planner before publishing as fact." — an instruction addressed
    // to the couple, printed under the capacities a guest is reading. Changed deliberately, to the
    // guarantee behind it: the numbers are marked as the venue's own and not yet confirmed, and the
    // caption is not somebody's task. The third test in the repository to pin that string; the
    // other two are in tests/integration/{content,weekend}.test.ts. "Kit" itself went later: it is
    // the planner's word for the venue's wedding packet, and a guest read it as jargon.
    const caption = page.locator('table caption');
    await expect(caption).toContainText(/venue.s own figures/i);
    await expect(caption).not.toContainText(/\bkit\b/i);
    await expect(caption).toContainText(/not confirmed/i);
    await expect(caption).not.toContainText(/\bverify\b|before publishing/i);
    await axe(page);
  });

  test('the wedding shows the date and venue as facts and times/rooms only as placeholders', async ({ page }) => {
    await page.goto('/the-wedding');
    const head = page.locator('main header').first();
    await expect(head.locator('time[datetime="2027-07-17"]')).toHaveText('Saturday, July 17, 2027');
    await expect(head).toContainText('12 S Michigan Ave');
    const placeholders = page.locator('[data-placeholder="true"]');
    expect(await placeholders.count()).toBeGreaterThanOrEqual(7);
    expect(await page.locator('main').innerText()).not.toContain(MARKER);
    await expect(page.getByRole('link', { name: 'Open directions in Google Maps' })).toHaveAttribute('href', /maps\/dir/);
    await axe(page);
  });

  test('ask us has the FAQ, a working static search, and an empty concierge slot', async ({ page }) => {
    await page.goto('/ask-us');
    await expect(page.getByRole('heading', { name: 'When and where is the wedding?' })).toBeVisible();
    await expect(page.locator('#concierge-slot[data-slot="concierge"]')).toBeVisible();
    await page.getByLabel('What are you looking for?').fill('valet');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/q=valet/);
    await expect(page.locator('#search-results').getByRole('link', { name: 'Valet entrance' })).toBeVisible();
    await axe(page);
  });

  test('capabilities are reachable over HTTP and drafts stay hidden', async ({ request }) => {
    const res = await request.post('/api/capabilities/list_adventures', { data: { input: {} } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.items.map((i: { slug: string }) => i.slug)).toEqual(['starved-rock']);
    expect(body.sources.every((s: { url?: string }) => !s.url?.startsWith('/docs/'))).toBe(true);
    const hidden = await request.post('/api/capabilities/show_adventure', { data: { input: { slug: 'museum-of-ice-cream' } } });
    expect(hidden.status()).toBe(404);
    const admin = await request.post('/api/capabilities/save_content_record', { data: { input: { table: 'venue_facts', data: {} } } });
    expect(admin.status()).toBe(401);
  });
});
