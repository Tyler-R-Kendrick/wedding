import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { VIEW_ROLE_COOKIE, VIEW_ROLES, viewRoleLabel, type ViewRoleKey } from '../../src/domain/identity/view-role';
import { guestPortalRedirectFor } from '../../src/domain/lifecycle/guest-portal';
import { crawlUrl, inventory, routesForPersona, type CrawlPersonaKind, type InventoryRow } from '../../src/lib/site-inventory';
import { REDIRECTS } from '../../src/lib/site-redirects';
import { cap, seedFixtures, signInAdminViaApi } from '../security/helpers';
import { BASE_URL, contextAs, type PrincipalName } from './helpers/principal';

/**
 * Site audit. Each persona opens the HTML routes `routesForPersona` names:
 * signed out, guest A1, an administrator, and each view-role. View-role uses a
 * real administrator session (the injector would skip the resolver the cookie
 * lives in) and `admin_set_view_role`, the same mint the integration suite uses.
 * Phone and desktop are the review viewports.
 *
 * Anonymous work is GET only, plus that one POST. Redirects are asserted at 308
 * before the browser follows them. Probes are the inventory rows that name a
 * status and are not HTML.
 *
 * The warm-up in scripts/test-server-specs.mjs reads this file as text. Every
 * path the crawl requests is quoted below so a named run compiles it first.
 * tests/unit/site-inventory.test.ts fails when a new crawl path is missing here.
 *
 * '/'
 * '/admin'
 * '/admin/ai'
 * '/admin/audit'
 * '/admin/concierge'
 * '/admin/content'
 * '/admin/content/story_sections'
 * '/admin/content/story_sections/01SEED00000000000000000200'
 * '/admin/content/story_sections/new'
 * '/admin/events'
 * '/admin/flags'
 * '/admin/gifts'
 * '/admin/guests'
 * '/admin/households'
 * '/admin/invitations'
 * '/admin/jobs'
 * '/admin/lifecycle'
 * '/admin/media'
 * '/admin/media/duplicates'
 * '/admin/media/import'
 * '/admin/media/metrics'
 * '/admin/metrics'
 * '/admin/providers'
 * '/admin/reservations'
 * '/admin/rsvp'
 * '/admin/seating'
 * '/admin/sitemap'
 * '/admin/transport'
 * '/admin/travel'
 * '/api/health'
 * '/api/session'
 * '/ask-us'
 * '/claim/passkey'
 * '/claim/verify'
 * '/claim/welcome'
 * '/credits'
 * '/explore-caa'
 * '/faq'
 * '/gifts'
 * '/guests'
 * '/guests/ask-us'
 * '/guests/things-to-do'
 * '/guests/things-to-do/starved-rock-state-park'
 * '/guests/travel'
 * '/i/example'
 * '/invite/example'
 * '/media/mine'
 * '/media/search'
 * '/media/upload'
 * '/our-adventures'
 * '/our-adventures/starved-rock'
 * '/our-story'
 * '/our-venue'
 * '/our-venue/white-city-ballroom'
 * '/photos'
 * '/photos/guest-uploads'
 * '/privacy'
 * '/registry'
 * '/rsvp'
 * '/rsvp/attending'
 * '/s/fixtureslug01'
 * '/share-an-adventure'
 * '/share-an-adventure/starved-rock-state-park'
 * '/sign-in'
 * '/sign-in/admin'
 * '/sign-in/pending'
 * '/sign-in/phone'
 * '/sign-out'
 * '/sitemap.xml'
 * '/step-up'
 * '/t/botanical-deco'
 * '/t/botanical-deco/preview/RSVP_OPEN'
 * '/terms'
 * '/the-wedding'
 * '/things-to-do'
 * '/transportation'
 * '/travel'
 * '/trip'
 * '/wedding-day'
 * '/your-weekend'
 */

const ANON_MS = 480_000;
const GUEST_MS = 480_000;
const ADMIN_MS = 900_000;
const VIEW_ROLE_MS = 1_500_000;

test.describe.configure({ mode: 'serial', timeout: VIEW_ROLE_MS });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'tablet', 'phone and desktop are the review viewports');
});

/** Dev overlay and the default favicon probe. Neither is a page we ship. */
function ignoredNoise(text: string): boolean {
  return text.includes('NEXTJS-PORTAL') || text.includes('favicon.ico');
}

function watch(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    if (!ignoredNoise(error.message)) errors.push(`pageerror: ${error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    const url = message.location().url;
    if (ignoredNoise(text) || ignoredNoise(url)) return;
    errors.push(`console: ${text} @ ${url}`);
  });
  return errors;
}

async function axeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking, blocking.map((v) => `${label}: ${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`).join('\n')).toEqual([]);
}

function linkPath(href: string): string | null {
  if (!href.startsWith('/') || href.startsWith('//')) return null;
  const bare = href.split('#')[0] ?? '';
  if (!bare) return null;
  try {
    const url = new URL(bare, 'http://localhost');
    if (url.pathname.startsWith('/_next/')) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

/**
 * A missing route is a 404 for the visitor who can see the link. Guest-only pages, such as the
 * Chicago recommendations, answer 404 to a signed-out GET on purpose, so the probe uses this
 * page's request context and carries that visitor's session. Redirects are not followed. A gate
 * or a redirect is not a dead link. A request that throws is tried once more; only status 404 fails.
 */
async function assertNoDeadLinks(page: Page, seen: Map<string, string[]>) {
  const req = page.request;
  const dead: string[] = [];
  for (const [path, from] of seen) {
    let status = 0;
    try {
      status = (await req.get(path, { maxRedirects: 0 })).status();
    } catch {
      try {
        status = (await req.get(path, { maxRedirects: 0 })).status();
      } catch {
        continue;
      }
    }
    if (status === 404) dead.push(`${path} (linked from ${[...new Set(from)].join(', ')})`);
  }
  expect(dead, 'dead internal links').toEqual([]);
}

function remember(seen: Map<string, string[]>, href: string, from: string) {
  const path = linkPath(href);
  if (!path) return;
  const list = seen.get(path);
  if (list) list.push(from);
  else seen.set(path, [from]);
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Where a permanent alias finishes in the browser. The 308 itself is checked before the browser
 * follows it. A public destination stays on that page. A guest-only destination (Ask Us, gifts)
 * sends a signed-out visitor on to sign-in, with `next` set to the page they asked for.
 * A signed-in guest is moved one step further, onto the guest portal, when the destination has one.
 */
function redirectLanded(destination: string, kind: CrawlPersonaKind): RegExp {
  const portal = kind === 'guest' || kind === 'view-role' ? guestPortalRedirectFor(destination) : null;
  if (portal) return new RegExp(`${escapeRegExp(portal)}(?:$|[?#])`);
  const atDestination = `${escapeRegExp(destination)}(?:$|[?#])`;
  const guestOnly =
    kind === 'anonymous' &&
    inventory().some((candidate) => candidate.kind === 'page' && candidate.audience === 'guest' && (candidate.url === destination || candidate.examples.includes(destination)));
  const atSignIn = guestOnly ? `|\\/sign-in\\?next=${escapeRegExp(encodeURIComponent(destination))}(?:$|&)` : '';
  return new RegExp(`(?:${atDestination}${atSignIn})`);
}

/** Signed-in guests and view-role previews are guest principals, so legacy URLs canonicalize onto `/guests/*`. */
function portalLanding(url: string, kind: CrawlPersonaKind): string | null {
  if (kind !== 'guest' && kind !== 'view-role') return null;
  return guestPortalRedirectFor(url);
}

async function assertDocument(page: Page, row: InventoryRow, kind: CrawlPersonaKind, role?: ViewRoleKey) {
  const url = crawlUrl(row);
  const response = await page.goto(url);
  expect(response, `${kind} ${url} did not answer`).toBeTruthy();
  expect(response!.status(), `${kind} ${url}`).toBeLessThan(400);
  await expect(page.getByRole('heading', { level: 1 }).first(), `${kind} ${url} has no heading`).not.toHaveText('');

  // Legacy travel, things-to-do and Ask Us URLs move a guest principal onto `/guests/*`.
  // An administrator is not moved. A signed-out reader of a portal URL is sent to sign-in;
  // the anonymous walk does not open those URLs (they are audience guest).
  const portal = portalLanding(url, kind);
  if (portal) await expect(page, `${kind} ${url} should land on the guest portal`).toHaveURL(new RegExp(`${escapeRegExp(portal)}(?:$|[?#])`));
  if (kind === 'admin') {
    const moved = guestPortalRedirectFor(url);
    if (moved) await expect(page, `${url} moved an administrator onto the guest portal`).not.toHaveURL(new RegExp(`${escapeRegExp(moved)}(?:$|[?#])`));
  }

  if (row.kind === 'redirect') {
    const rule = REDIRECTS.find((r) => r.source === row.url);
    if (rule && !rule.source.includes(':')) await expect(page, url).toHaveURL(redirectLanded(rule.destination, kind));
  }
  if (url === '/i/example') await expect(page).toHaveURL(/\/invite\/example(?:$|[?#])/);

  const guestSurface = row.audience === 'guest' || portal !== null;
  if (guestSurface && (kind === 'guest' || kind === 'view-role')) {
    await expect(page, `${kind} ${url} bounced to the sign-in door`).not.toHaveURL(/\/sign-in(?:$|\?)/);
  }
  if (kind === 'guest' && guestSurface) {
    await expect(page.locator('body'), `${url} showed the guests-only gate to A1`).not.toContainText('is for invited guests');
  }
  if (kind === 'admin' && row.audience === 'admin') {
    const heading = page.getByRole('heading', { level: 1 }).first();
    await expect(heading, url).not.toContainText('Administrator sign-in required');
    await expect(heading, url).not.toContainText('Not part of your access');
  }
  if (kind === 'admin' && (url === '/guests' || url === '/guests/ask-us' || url === '/ask-us')) {
    await expect(page.locator('body'), `${url} should show the guests-only gate to an administrator`).toContainText('is for invited guests');
  }
  if (kind === 'view-role' && role && row.kind === 'page' && (row.audience === 'public' || row.audience === 'guest')) {
    await expect(page.getByRole('status').filter({ hasText: 'View as:' }), `${role} ${url}`).toContainText(viewRoleLabel(role), { timeout: 15_000 });
    if ((role === 'guest' || role === 'household_manager') && guestSurface) {
      await expect(page.locator('body'), `${role} ${url}`).not.toContainText('is for invited guests');
    }
  }
}

async function walk(page: Page, kind: CrawlPersonaKind, role?: ViewRoleKey) {
  page.setDefaultNavigationTimeout(60_000);
  // The fixture sign-in pass submits itself. Letting that finish replaces the persona: a signed-out
  // crawl becomes a guest, and a view-role session is no longer the administrator who minted it.
  // Opening the page is the audit; completing the sign-in is the pass spec's job.
  await page.addInitScript(() => {
    HTMLFormElement.prototype.requestSubmit = function () {};
  });
  const errors = watch(page);
  const seen = new Map<string, string[]>();
  for (const row of routesForPersona(kind)) {
    const url = crawlUrl(row);
    const mark = errors.length;
    await assertDocument(page, row, kind, role);
    const hrefs = await page.locator('a[href]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? ''));
    for (const href of hrefs) remember(seen, href, url);
    await axeClean(page, `${kind}${role ? `:${role}` : ''} ${url}`);
    const fresh = errors.slice(mark);
    expect(fresh, `${kind}${role ? `:${role}` : ''} ${url}\n${fresh.join('\n')}`).toEqual([]);
  }
  await assertNoDeadLinks(page, seen);
}

test('a signed-out visitor can open every public, gate and alias route', async ({ browser, request }) => {
  test.setTimeout(ANON_MS);
  for (const row of inventory()) {
    if (row.probe == null || !row.examples[0]) continue;
    const res = await request.get(row.examples[0], { maxRedirects: 0 });
    expect(res.status(), `${row.method} ${row.examples[0]}`).toBe(row.probe);
  }
  const xml = await (await request.get('/sitemap.xml')).text();
  expect(xml).toContain('<urlset');
  expect(xml).toContain('/our-story');
  expect(xml).not.toContain('/admin');
  expect(xml).not.toContain('/your-weekend');
  expect(xml).not.toContain('/sign-in');
  expect(xml).not.toContain('/guests');

  for (const rule of REDIRECTS) {
    const source = rule.source.replace(':slug', 'white-city-ballroom');
    const destination = rule.destination.replace(':slug', 'white-city-ballroom');
    const res = await request.get(source, { maxRedirects: 0 });
    expect(res.status(), source).toBe(308);
    const location = res.headers().location ?? '';
    expect(location.endsWith(destination) || location.includes(`${destination}?`) || location.includes(`${destination}#`), `${source} -> ${location}`).toBe(true);
  }

  const ctx = await contextAs(browser, null);
  const page = await ctx.newPage();
  await walk(page, 'anonymous');
  await ctx.close();
});

test('guest A1 can open every guest route', async ({ browser }) => {
  test.setTimeout(GUEST_MS);
  const ctx = await contextAs(browser, 'A1' satisfies PrincipalName);
  const page = await ctx.newPage();
  await walk(page, 'guest');
  await ctx.close();
});

test('an administrator can open every console route', async ({ browser }) => {
  test.setTimeout(ADMIN_MS);
  const ctx = await contextAs(browser, 'admin');
  const page = await ctx.newPage();
  await walk(page, 'admin');
  await expect(page.locator('body')).toContainText('Sitemap');
  await ctx.close();
});

test('each view-role preview opens the guest site read-only', async ({ browser, request }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'view-role crawl is desktop review viewport only');
  test.setTimeout(VIEW_ROLE_MS);
  const device = testInfo.project.use;
  const ctx = await browser.newContext({
    baseURL: BASE_URL,
    viewport: device.viewport,
    userAgent: device.userAgent,
    deviceScaleFactor: device.deviceScaleFactor,
    isMobile: device.isMobile,
    hasTouch: device.hasTouch,
  });
  const page = await ctx.newPage();
  const fixtures = await seedFixtures(request);
  const session = await signInAdminViaApi(request, page, fixtures.emails.admin!);

  for (const role of VIEW_ROLES) {
    const minted = await cap(request, 'admin_set_view_role', { role }, { cookie: session });
    expect(minted.status(), role).toBe(200);
    const body = (await minted.json()) as { ok?: boolean; data?: { token?: string; label?: string } };
    expect(body.ok, JSON.stringify(body)).toBe(true);
    expect(body.data?.token, role).toBeTruthy();
    await ctx.addCookies([{ name: VIEW_ROLE_COOKIE, value: body.data!.token!, url: BASE_URL, httpOnly: true, sameSite: 'Lax' }]);
    await walk(page, 'view-role', role);
  }
  await ctx.close();
});
