import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';

const PUBLIC_ADVENTURES = (JSON.parse(readFileSync('src/content/seed/adventures.json', 'utf8')) as { slug: string; visibility: string }[]).filter((a) => a.visibility === 'public').map((a) => a.slug);

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
  test('story → adventure → linked recommendation sends anonymous guests to sign-in', async ({ page }) => {
    await page.goto('/our-story#how-we-met');
    // The approved design titles the page with its editorial headline; the page is still "Our Story".
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('How we found our way to forever');
    await expect(page).toHaveTitle(/Our Story/);
    await expect(page.locator('main')).toContainText(/Allison and Jamie/);
    await expect(page.locator('#how-we-met')).toHaveAttribute('data-state', 'here');
    await expect(page.locator('#how-we-met .bd-stopcard__standin')).toHaveText('Stand-in photo');
    expect(await page.locator('main').innerText()).not.toContain(MARKER);
    await axe(page);

    await follow(page, 'Our Adventures');
    await expect(page).toHaveURL(/\/our-adventures$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // Only public memories are listed; the private drafts (the brief's, and photos that show someone
    // who has not agreed to be on the site yet) never render.
    await expect(page.locator('[data-adventure]')).toHaveCount(PUBLIC_ADVENTURES.length);
    await expect(page.getByText('Museum of Ice Cream')).toHaveCount(0);
    await expect(page.getByText('The Lion King at the Cadillac Palace')).toHaveCount(0);
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
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fguests%2Fthings-to-do%2Fstarved-rock-state-park/);
  });

  test('the story is a ride: the map jumps, the buttons step, a citation lands on its station', async ({ page }) => {
    await page.goto('/our-story');
    const ride = page.locator('.bd-ride');
    await expect(ride).toHaveAttribute('data-mode', 'ride');
    const map = page.getByRole('navigation', { name: /^Stations on the .+ Line$/ });
    // Every station is on the car card, in order, from the night they met to the last chapter. The
    // line's terminal — the Loop, with the wedding's date and address — is the invited guests': for
    // a signed-out reader the line ends at the last chapter, and no stop for it exists.
    const stations = map.getByRole('link');
    await expect(stations.first()).toHaveAccessibleName(/^How we met/);
    await expect(stations.last()).not.toHaveAccessibleName(/The Loop/);
    await expect(map.getByRole('link', { name: /The Loop/ })).toHaveCount(0);
    await expect(page.locator('#the-loop')).toHaveCount(0);
    await expect(ride.locator('time[datetime^="2027-07-17"]')).toHaveCount(0);
    await expect(ride).not.toContainText(/July 17|Chicago Athletic|Michigan Ave/);
    // The chapters are told by colour alone: no "Red Line" or "Blue Line" is printed anywhere on the ride.
    await expect(ride).not.toContainText(/(Red|Blue|Brown|Pink|Green|Orange|Gold) Line/);
    const bar = page.locator('.bd-ride__bar');

    // Tapping a station rides the train there; the URL follows so it can be shared.
    await map.getByRole('link', { name: /^Love$/ }).click();
    await expect(page).toHaveURL(/#love$/);
    await expect(map.getByRole('link', { name: /^Love$/ })).toHaveAttribute('aria-current', 'location');
    await expect(bar).toContainText('Next stopGreater together than alone');
    const words = await page.locator('#love .bd-stopcard__title').boundingBox();
    const picture = await page.locator('#love .bd-stopcard__carousel, #love .bd-stopcard__media').first().boundingBox();
    expect(words, 'the words are on the stage').not.toBeNull();
    if (words && picture) expect(words.x + words.width <= picture.x + 1 || words.y + words.height <= picture.y + 1, 'words lead the picture').toBe(true);
    await expect(page.locator('#love')).not.toHaveAttribute('aria-hidden', /.*/);
    await expect(page.locator('#greater-together')).toHaveAttribute('aria-hidden', 'true');
    // A link inside a stop that is off the stage cannot be tabbed to.
    for (const tabindex of await page.locator('.bd-ride__stop[aria-hidden="true"] a').evaluateAll((as) => as.map((a) => a.getAttribute('tabindex')))) expect(tabindex).toBe('-1');
    await expect(page.getByRole('heading', { name: 'Love', level: 3 })).toBeVisible();

    await page.getByRole('button', { name: /Next stop/ }).click();
    await expect(map.getByRole('link', { name: /Greater together than alone/ })).toHaveAttribute('aria-current', 'location');
    await page.getByRole('button', { name: /Back a stop/ }).click();
    await expect(map.getByRole('link', { name: /^Love$/ })).toHaveAttribute('aria-current', 'location');
    await expect(page.locator('.bd-ride__bar [aria-live="polite"]')).toHaveText(/This is Love\. Next stop, Greater together than alone\./);

    await page.goto('/our-story#love');
    await expect(map.getByRole('link', { name: /^Love$/ })).toHaveAttribute('aria-current', 'location');
    await expect(page.getByRole('heading', { name: 'Love', level: 3 })).toBeVisible();
    await axe(page);
  });

  test('legacy timeline citations still land on merged chapters', async ({ page }) => {
    await page.goto('/our-story#starved-rock');
    const map = page.getByRole('navigation', { name: /^Stations on the .+ Line$/ });
    await expect(map.getByRole('link', { name: /^Love$/ })).toHaveAttribute('aria-current', 'location');
    await expect(page.locator('#starved-rock')).toBeAttached();
    await expect(page.getByRole('heading', { name: 'Love', level: 3 })).toBeVisible();
  });

  test('the car card is one tab stop: arrow keys walk it, the focused station stays on screen, Enter rides', async ({ page }) => {
    await page.goto('/our-story#allison-and-jamies-wedding');
    const map = page.getByRole('navigation', { name: /^Stations on the .+ Line$/ });
    await expect(map.getByRole('link', { name: /^How we met/ })).toHaveAttribute('aria-current', 'location');
    // Exactly one station takes Tab: the one the train is at.
    await expect(map.locator('a[tabindex="0"]')).toHaveCount(1);
    await map.getByRole('link', { name: /^How we met/ }).focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
    const focused = map.getByRole('link', { name: /^Love$/ });
    await expect(focused).toBeFocused();
    // WCAG 2.4.11: the focused link is not hidden off the edge of the strip.
    const box = await focused.boundingBox();
    const vp = await map.locator('.bd-ride-map__viewport').boundingBox();
    expect(box && vp && box.x >= vp.x - 1 && box.x + box.width <= vp.x + vp.width + 1 && box.y >= vp.y - 1 && box.y + box.height <= vp.y + vp.height + 1, 'focused station is inside the car card').toBe(true);
    await page.keyboard.press('Home');
    await expect(map.getByRole('link', { name: /How we met/ })).toBeFocused();
    // End goes to the last station on the line, which for a signed-out reader is the last chapter
    // (the Loop, with the wedding's date and address, is drawn for invited guests only).
    const last = map.getByRole('link').last();
    await page.keyboard.press('End');
    await expect(last).toBeFocused();
    await expect(last).not.toHaveAccessibleName(/The Loop/);
    const fragment = ((await last.getAttribute('href')) ?? '').replace(/^[^#]*/, '');
    expect(fragment).toMatch(/^#[a-z0-9-]+$/);
    expect(fragment).not.toBe('#the-loop');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${fragment}$`));
    await expect(last).toHaveAttribute('aria-current', 'location');
  });

  test('"Read it as a list" lays the line flat, keeps your place, and the choice is remembered', async ({ page }) => {
    await page.goto('/our-story#love');
    await expect(page.locator('.bd-ride')).toHaveAttribute('data-mode', 'ride');
    await expect(page.getByRole('navigation', { name: /^Stations on the .+ Line$/ }).getByRole('link', { name: /^Love$/ })).toHaveAttribute('aria-current', 'location');
    await page.getByRole('button', { name: 'Read it as a list' }).click();
    await expect(page.locator('.bd-ride')).toHaveAttribute('data-mode', 'flat');
    await expect(page.locator('#love')).toBeInViewport();
    await expect(page.locator('#love')).toBeFocused();
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
      for (const id of ['how-we-met', 'allison-and-jamies-wedding', 'love', 'starved-rock']) await expect(page.locator(`#${id}`)).toBeVisible();
      // Laid flat, every stop is on the page at once — and the wedding's own stop is still not one of them.
      await expect(page.locator('#the-loop')).toHaveCount(0);
      await expect(page.locator('.bd-ride')).not.toContainText(/July 17|Chicago Athletic|Michigan Ave/);
      await expect(page.locator('.bd-ride__stop[aria-hidden]')).toHaveCount(0);
      // The stations list the intro promises is there in every mode.
      await expect(page.getByRole('navigation', { name: /^Stations on the .+ Line$/ }).getByRole('link', { name: /^Love$/ })).toBeVisible();
      await expect(page.locator('#love')).toBeInViewport();
      if (options.reducedMotion) await axe(page);
      await ctx.close();
    }
  });

  test('legacy things-to-do URLs require sign-in before the guide loads', async ({ page }) => {
    await page.goto('/share-an-adventure?minutes=45&interest=architecture');
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fguests%2Fthings-to-do/);
    // The question a guest was asking travels with them through the door.
    const next = new URL(page.url()).searchParams.get('next') ?? '';
    expect(next).toMatch(/^\/guests\/things-to-do\?/);
    expect(next).toContain('minutes=45');
    expect(next).toContain('interest=architecture');
    await page.goto('/guests/things-to-do/starved-rock-state-park');
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fguests%2Fthings-to-do%2Fstarved-rock-state-park$/);
    // `/things-to-do` was an alias once; it is not a page now.
    expect((await page.request.get('/things-to-do', { maxRedirects: 0 })).status()).toBe(404);
    expect((await page.request.get('/wedding-day', { maxRedirects: 0 })).status()).toBe(404);
  });

  test('our venue is behind sign-in: the building, its rooms and its old address say nothing to a signed-out reader', async ({ page, request }) => {
    // The page was "Explore CAA" at /explore-caa. That alias is gone, not redirected.
    expect((await request.get('/explore-caa', { maxRedirects: 0 })).status()).toBe(404);
    expect((await request.get('/explore-caa/white-city-ballroom', { maxRedirects: 0 })).status()).toBe(404);
    for (const path of ['/our-venue', '/our-venue/white-city-ballroom', '/our-venue/no-such-room']) {
      // Whatever the slug: a signed-out reader cannot tell a real room from an invented one.
      await page.goto(path);
      await expect(page, path).toHaveURL(new RegExp(`/sign-in\\?next=${encodeURIComponent(path)}$`));
      await expect(page.locator('[data-space], [data-key^="outlet."], [data-key="valet.entrance"], [id^="fact-"]'), path).toHaveCount(0);
      await expect(page.locator('body'), path).not.toContainText(/Chicago Athletic|Michigan Ave|71 E Madison|White City Ballroom|Built in 1893|July 17/);
    }
    await axe(page);
    // The outlets, their dates, the valet entrance and the rooms are asserted as a signed-in guest
    // in guest-portal.spec.ts, on the test server.
  });

  test('capabilities are reachable over HTTP and drafts stay hidden', async ({ request }) => {
    const res = await request.post('/api/capabilities/list_adventures', { data: { input: {} } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const slugs: string[] = body.data.items.map((i: { slug: string }) => i.slug);
    expect(slugs.length).toBeGreaterThan(0);
    for (const s of slugs) expect(PUBLIC_ADVENTURES).toContain(s);
    expect(slugs).not.toContain('museum-of-ice-cream');
    expect(body.sources.every((s: { url?: string }) => !s.url?.startsWith('/docs/'))).toBe(true);
    const hidden = await request.post('/api/capabilities/show_adventure', { data: { input: { slug: 'museum-of-ice-cream' } } });
    expect(hidden.status()).toBe(404);
    const admin = await request.post('/api/capabilities/save_content_record', { data: { input: { table: 'venue_facts', data: {} } } });
    expect(admin.status()).toBe(401);
    // Our story and our adventures are public. What the venue is, what to do around it and how a
    // weekend there might go are a guest's: signed out, each is refused and says nothing.
    for (const [name, input] of [
      ['get_venue_facts', {}],
      ['show_venue_room', { slug: 'white-city-ballroom' }],
      ['find_adventures', {}],
      ['list_itineraries', {}],
    ] as const) {
      const res = await request.post(`/api/capabilities/${name}`, { data: { input } });
      expect(res.status(), name).toBe(401);
      const refused = await res.json();
      expect(refused.error.code, name).toBe('unauthenticated');
      expect(refused.data, name).toBeUndefined();
      expect(JSON.stringify(refused), name).not.toMatch(/Chicago Athletic|Michigan|2027-07-17|White City/);
    }
    // The public story itself never names the venue or its address to a signed-out caller.
    const story = await request.post('/api/capabilities/get_story', { data: { input: {} } });
    expect(story.status()).toBe(200);
    expect(await story.text()).not.toMatch(/chicago\s+athletic|\b12\s+s(?:outh|\.)?\s+michigan\b|July 17, 2027|2027-07-17/i);
  });

  test('a combined adventure rotates photos with keyboard controls and passes axe', async ({ page }) => {
    await page.goto('/our-adventures/alinea-2026-02-13');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Alinea');
    const carousel = page.getByRole('region', { name: 'Photos from this adventure' });
    await expect(carousel).toBeVisible();
    await expect(carousel.getByText('Photo 1 of 3')).toBeVisible();
    await carousel.getByRole('button', { name: 'Next photo' }).click();
    await expect(carousel.getByText('Photo 2 of 3')).toBeVisible();
    await carousel.focus();
    await page.keyboard.press('ArrowRight');
    await expect(carousel.getByText('Photo 3 of 3')).toBeVisible();
    await axe(page);
    const legacy = await page.goto('/our-adventures/alinea-2026-02-13-b');
    expect(legacy?.url()).toMatch(/\/our-adventures\/alinea-2026-02-13$/);
  });
});
