import { test, expect, type Page } from '@playwright/test';
import { WEDDING_DETAILS } from './helpers/wedding-details';

/**
 * Level 15 (level-03 review N15): the CSP and HSTS the ladder deferred.
 *
 * A CSP that breaks the app is worse than none, and a CSP asserted only as a string is a CSP
 * nobody has run. This spec loads real pages in a real browser and fails on any
 * `securitypolicyviolation` the browser reports — that event is the browser's own verdict, not our
 * reading of the policy. It runs against `next start`, because the production policy is the strict
 * one (no `'unsafe-eval'`, no `ws:`, plus `upgrade-insecure-requests` and HSTS) and `next dev`
 * serves the relaxed one.
 *
 * The routes are the public shell a visitor actually meets, chosen to cover the ways this app puts
 * things on a page: the prerendered tree (`/`, and `/our-story` with its images), and a form — the sign-in door, which is where `/gifts` and `/guests/ask-us` send
 * a signed-out reader. Everything about the wedding is behind that door, so the signed-in pages
 * (the concierge island among them) are loaded on the test server, by quality-sweep.spec.ts and
 * concierge.spec.ts; the strict production policy is asserted here on what this server can show.
 */
const ROUTES = ['/', '/our-story', '/privacy', '/terms', '/gifts', '/guests/ask-us'];

interface Violation {
  route: string;
  directive: string;
  blocked: string;
}

/** Collect the browser's own CSP verdicts plus any console error, for the life of the page. */
async function watch(page: Page, into: Violation[], route: string) {
  await page.addInitScript(() => {
    (window as unknown as { __csp: unknown[] }).__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { __csp: unknown[] }).__csp.push({
        directive: (e as SecurityPolicyViolationEvent).effectiveDirective,
        blocked: (e as SecurityPolicyViolationEvent).blockedURI,
      });
    });
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /Content Security Policy|Refused to/i.test(msg.text())) {
      into.push({ route, directive: 'console', blocked: msg.text().slice(0, 300) });
    }
  });
}

test.describe('security headers', () => {
  // Five real page loads with a networkidle wait each, across three device projects.
  test.setTimeout(90_000);

  test('every public route loads with no CSP violation the browser reports', async ({ page }) => {
    const violations: Violation[] = [];
    for (const route of ROUTES) {
      await watch(page, violations, route);
      const response = await page.goto(route);
      expect(response?.status(), `${route} did not load`).toBeLessThan(400);
      // Give hydration and any deferred chunk a chance to be blocked before we look.
      await page.waitForLoadState('networkidle', { timeout: 15_000 });
      const reported = await page.evaluate(() => (window as unknown as { __csp: Violation[] }).__csp ?? []);
      for (const v of reported) violations.push({ ...v, route });
      // The page really rendered — a CSP that blanks a page can still report no violation.
      await expect(page.locator('body')).not.toBeEmpty();
    }
    expect(violations, violations.map((v) => `${v.route}: ${v.directive} blocked ${v.blocked}`).join('\n')).toEqual([]);
  });

  test('the policy is present on the prerendered theme tree, not only on the rewritten URL', async ({ request }) => {
    // `/` is rewritten to `/t/<theme>` for a reader with no session, but `/t/<theme>` is also a
    // real, prerendered, directly reachable URL, and the proxy sees neither. This is the case that
    // decided where these headers live: set in the proxy, this assertion would fail.
    for (const url of ['/', '/t/botanical-deco', '/api/health']) {
      const res = await request.get(url);
      const csp = res.headers()['content-security-policy'];
      expect(csp, `${url} has no CSP`).toBeTruthy();
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("form-action 'self'");
      expect(res.headers()['x-content-type-options']).toBe('nosniff');
      expect(res.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
    }
  });

  test('the production policy carries HSTS and no unsafe-eval', async ({ request }) => {
    const res = await request.get('/');
    const csp = res.headers()['content-security-policy'] ?? '';
    const hsts = res.headers()['strict-transport-security'];
    // PW_WEB_SERVER_COMMAND=npm run start is how CI runs this suite; a dev server serves the
    // relaxed policy, so assert the production shape only when we are actually on one.
    // No conditional skip: this spec is registered in PRODUCTION_SPECS, so it always runs against
    // `next start`. Run against a dev server it fails loudly, which is the right answer — the
    // relaxed dev policy is not the thing being asserted.
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain('upgrade-insecure-requests');
    expect(csp).toContain("connect-src 'self'");
    expect(hsts).toBe('max-age=63072000; includeSubDomains');
    // `preload` is deliberately absent: the preload list is effectively one-way.
    expect(hsts).not.toContain('preload');
  });

  /**
   * The site policy must not reach the routes that hand back user-uploaded bytes. Those set
   * `Content-Security-Policy: sandbox`, which is strictly stronger for a document this site did not
   * write, and the first version of the header rule was a blanket `/(.*)` that replaced it — the
   * media journey caught it, receiving the site policy where it asserts `sandbox`.
   *
   * The inversion was twofold, which is why this is pinned here rather than left to that journey:
   * `img-src`/`media-src` in security-headers.ts are permissive ON THE GROUNDS that served objects
   * carry their own sandbox. Losing the sandbox silently removed the control the looser directive
   * was traded against.
   */
  test('the site policy does not reach routes that serve user-uploaded bytes', async ({ request }) => {
    const res = await request.get('/');
    const sitePolicy = res.headers()['content-security-policy'] ?? '';
    expect(sitePolicy, 'the site policy is present on a page').toContain("default-src 'self'");

    // An unauthenticated request is enough: the header rule is matched by path, before any handler
    // decides whether the caller may read the object, so the status does not matter here.
    const object = await request.get('/api/dev/storage/quarantine/whatever/original');
    const objectPolicy = object.headers()['content-security-policy'];
    expect(objectPolicy ?? '', 'a storage route must never carry the site policy').not.toContain("default-src 'self'");
    expect(objectPolicy ?? '', 'nor its script-src').not.toContain('unsafe-inline');
  });

  /**
   * Level 16, cache isolation: the header half.
   *
   * `src/proxy.ts` marks every personalized route `private, no-store`, and the reason is not
   * politeness: without it a shared cache may serve one household's dashboard to another.
   * `next dev` replaces that header with `no-cache, must-revalidate`, so this can only be asserted
   * against `next start`, which is why it is here and not in `quality-sweep.spec.ts`, where the
   * identities live.
   *
   * Anonymous is enough: the proxy sets the header by path, before any handler decides who the
   * caller is, so the status of the personalized routes below does not matter.
   */
  test('personalized URLs forbid a shared cache from keeping them', async ({ request }) => {
    // `/gifts` shows Zelle and mailing details to invited guests (ADR-0013).
    // `/guests`, `/guests/travel` and `/our-venue` carry the date, the venue and the room block.
    // Redirects are not followed: a signed-out request to most of these is sent to sign in, and it
    // is this path's own answer, the one the proxy marked, that a cache would be keeping.
    const PERSONALIZED = ['/guests', '/guests/travel', '/our-venue', '/rsvp', '/trip', '/transportation', '/media/mine', '/gifts'];
    for (const path of PERSONALIZED) {
      const res = await request.get(path, { maxRedirects: 0 });
      const cc = res.headers()['cache-control'] ?? '';
      expect(cc, `${path} may be stored by a shared cache`).toContain('no-store');
      expect(cc, `${path} is not marked private`).toContain('private');
      // A validator invites a conditional request, and a conditional request is how a shared cache
      // revalidates one identity's copy for another. No personalized route may carry one.
      expect(res.headers()['etag'], `${path} carries an ETag`).toBeUndefined();
    }
  });

  /**
   * The public pages have two renders at one address (src/themes/routes.ts). A request with no
   * session is answered from a prerendered copy that a shared cache may keep, and that copy is the
   * signed-out page: nothing in it says when or where the wedding is. A request that carries a
   * session, even one that turns out to be nobody's, is rendered for its reader and may not be
   * kept by anyone. The cookie alone decides, before any page code runs, so the cached copy is
   * never a page that was rendered for somebody.
   */
  test('a public page is cacheable for a reader with no session, and never for one with a session', async ({ request }) => {
    for (const path of ['/', '/our-story', '/our-adventures', '/our-adventures/starved-rock', '/privacy', '/terms', '/credits']) {
      const anonymous = await request.get(path);
      expect(anonymous.status(), path).toBe(200);
      const cached = anonymous.headers()['cache-control'] ?? '';
      expect(cached, `${path} is not kept by a shared cache`).toMatch(/s-maxage=[1-9]\d*, stale-while-revalidate=[1-9]/);
      expect(cached, path).not.toMatch(/private|no-store/);
      // The whole response, markup and the data React ships with it.
      expect(await anonymous.text(), `${path}: the cached copy says when or where the wedding is`).not.toMatch(WEDDING_DETAILS);

      for (const cookie of ['__Secure-wedding.session_token=nobody', 'theme=v2.botanical-deco; wedding.session_token=nobody', 'view-role=guest.1.x']) {
        const theirs = await request.get(path, { headers: { cookie }, maxRedirects: 0 });
        const cc = theirs.headers()['cache-control'] ?? '';
        expect(cc, `${path} with ${cookie} may be stored`).toContain('no-store');
        expect(cc, `${path} with ${cookie} is not marked private`).toContain('private');
      }
    }
    // A filtered list is a request's own too: the prerendered copy is the whole list.
    expect((await request.get('/our-adventures?season=summer')).headers()['cache-control']).toContain('no-store');
  });
});
