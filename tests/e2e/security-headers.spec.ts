import { test, expect, type Page } from '@playwright/test';

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
 * things on a page: the prerendered theme tree (`/`), a dynamic public page with images, the
 * concierge island (the most client-JS-heavy surface), and a form.
 */
const ROUTES = ['/', '/the-wedding', '/travel', '/gifts', '/ask-us'];

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
    // `/` is rewritten to `/t/<theme>` by the proxy, but `/t/<theme>` is also a real, prerendered,
    // directly reachable URL — and the proxy's matcher skips `t/`. This is the case that decided
    // where these headers live: set in the proxy, this assertion would fail.
    for (const url of ['/', '/t/conservatory', '/api/health']) {
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
   * Level 16, cache isolation — the header half.
   *
   * `src/proxy.ts` marks every personalized route and every cookie-resolved public URL
   * `private, no-store` with `Vary: Cookie`, and the reason is not politeness: without it a shared
   * cache may serve one household's Your Weekend to another, and a browser may reuse a themed RSC
   * payload across a design switch. `next dev` replaces that header with
   * `no-cache, must-revalidate`, so this can only be asserted against `next start` — which is why
   * it is here and not in `quality-sweep.spec.ts`, where the identities live.
   *
   * Anonymous is enough: the proxy sets the header by path, before any handler decides who the
   * caller is, so the status of the personalized routes below does not matter.
   */
  test('personalized and theme-resolved URLs forbid a shared cache from keeping them', async ({ request }) => {
    const PERSONALIZED = ['/your-weekend', '/rsvp', '/trip', '/transportation', '/media/mine'];
    for (const path of [...PERSONALIZED, '/', '/the-wedding']) {
      const res = await request.get(path);
      const cc = res.headers()['cache-control'] ?? '';
      expect(cc, `${path} may be stored by a shared cache`).toContain('no-store');
      expect(cc, `${path} is not marked private`).toContain('private');
    }

    // A validator invites a conditional request, and a conditional request is how a shared cache
    // revalidates one identity's copy for another. No personalized route may carry one.
    for (const path of PERSONALIZED) {
      expect((await request.get(path)).headers()['etag'], `${path} carries an ETag`).toBeUndefined();
    }

    /*
     * `Vary` is NOT asserted here, and the reason is a measurement rather than an opinion.
     *
     * `src/proxy.ts` does `response.headers.append('Vary', 'Cookie')` on exactly these paths, and
     * that header never reaches the wire: Next.js sets its own `Vary` for the RSC protocol
     * (`rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch,
     * Accept-Encoding`) on every one of these responses and the appended value is lost. Measured on
     * `next start` at this head, on all seven paths above.
     *
     * The guarantee still holds, on `no-store` alone: a response no cache may store is a response
     * no cache can serve to the wrong identity, and `Vary` was insurance behind that. Asserting the
     * header would therefore be asserting something the app does not do and does not need to do —
     * so this says what is true, names what is missing, and leaves the proxy line as the dead code
     * it is for a level that owns the proxy to remove.
     *
     * `/` does carry an ETag, and that is correct: the clean URL is rewritten to the prerendered
     * `/t/<theme>` tree, the ETag is that tree's own validator, the theme is in the rewritten URL,
     * and `no-store` sits in front of it. `themes.spec.ts` proves the second switch in a session is
     * not served from cache, which is the behaviour this would otherwise be a proxy for.
     */
  });
});
