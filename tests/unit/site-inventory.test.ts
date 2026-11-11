import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { crawlUrl, CRAWL_EXAMPLES, inventory, inventoryMarkdown, publicSitemapPaths, routesForPersona, type CrawlPersonaKind } from '@/lib/site-inventory';
import { REDIRECTS } from '@/lib/site-redirects';

const PERSONAS: CrawlPersonaKind[] = ['anonymous', 'guest', 'admin', 'view-role'];

describe('site inventory', () => {
  it('docs/sitemap.md is generated from the inventory', () => {
    expect(readFileSync('docs/sitemap.md', 'utf8')).toBe(inventoryMarkdown());
  });

  it('the crawler spec quotes every path a named run must warm', () => {
    const spec = readFileSync('tests/e2e/site-crawler.spec.ts', 'utf8');
    const paths = new Set<string>();
    for (const kind of PERSONAS) for (const row of routesForPersona(kind)) paths.add(crawlUrl(row));
    for (const row of inventory()) if (row.probe != null && row.examples[0]) paths.add(row.examples[0]);
    const missing = [...paths].filter((path) => !spec.includes(`'${path}'`));
    expect(missing, 'quote each path in tests/e2e/site-crawler.spec.ts so the test server warms it').toEqual([]);
  });

  it('names the guest portal, its legacy aliases, and the sign-in doors', () => {
    const byUrl = (url: string) => inventory().find((row) => row.url === url && row.method === 'GET');
    for (const url of ['/guests', '/guests/travel', '/guests/ask-us', '/guests/things-to-do/[slug]']) {
      expect(byUrl(url)?.audience, url).toBe('guest');
      expect(byUrl(url)?.crawl, url).toBe(true);
    }
    expect(byUrl('/guests/things-to-do/[slug]')?.crawlExample).toBe(CRAWL_EXAMPLES.guestRecommendation);
    expect(byUrl('/guests/things-to-do/[slug]')?.examples).toContain('/guests/things-to-do/starved-rock-state-park');
    // The pages folded into the portal are redirects now, not pages: one row each, from site-redirects.ts.
    const moved: Record<string, string> = { '/your-weekend': '/guests', '/the-wedding': '/guests', '/travel': '/guests/travel', '/ask-us': '/guests/ask-us', '/guests/things-to-do': '/guests/travel#plan', '/share-an-adventure': '/guests/travel#plan', '/share-an-adventure/:slug': '/guests/things-to-do/:slug' };
    for (const [source, destination] of Object.entries(moved)) {
      expect(inventory().filter((row) => row.url === source), source).toHaveLength(1);
      expect(byUrl(source)?.kind, source).toBe('redirect');
      expect(byUrl(source)?.expected, source).toContain(`308 to ${destination}.`);
      expect(byUrl(source)?.expected, source).toContain('asked to sign in');
    }
    expect(byUrl('/share-an-adventure/:slug')?.examples).toEqual(['/share-an-adventure/starved-rock-state-park']);
    expect(inventory().filter((row) => row.kind === 'redirect').map((row) => row.url)).toEqual(REDIRECTS.map((r) => r.source));
    expect('recommendation' in CRAWL_EXAMPLES).toBe(false);
    for (const row of inventory()) {
      if (row.kind !== 'page') continue;
      for (const gone of ['/your-weekend', '/the-wedding', '/travel', '/ask-us', '/share-an-adventure', '/explore-caa']) {
        expect(row.url === gone || row.url.startsWith(`${gone}/`), `${row.url} is still listed as a page`).toBe(false);
        for (const example of row.examples) expect(example === gone || example.startsWith(`${gone}/`), `${row.url}: ${example}`).toBe(false);
      }
    }
    expect(byUrl('/sign-in/pending')?.audience).toBe('gate');
    expect(byUrl('/sign-in/pending')?.crawlExample).toBe('/sign-in/pending');
    // Text sign-in is a tab of /sign-in (`?method=text`), never a page of its own.
    expect(byUrl('/sign-in/phone')).toBeUndefined();
    expect(publicSitemapPaths().some((path) => path === '/guests' || path.startsWith('/guests/'))).toBe(false);
    expect(byUrl('/api/auth/social/[provider]/start')?.crawl).toBe(false);
    expect(byUrl('/api/auth/social/[provider]/callback')?.expected).toContain('/sign-in/pending');
  });

  it('says every page about the wedding asks for a session', () => {
    const byUrl = (url: string) => inventory().find((row) => row.url === url && row.method === 'GET' && row.kind === 'page');
    const door: Record<string, string> = {
      '/guests': '/sign-in?next=/guests',
      '/guests/travel': '/sign-in?next=/guests/travel',
      '/guests/ask-us': '/sign-in?next=/guests/ask-us',
      '/our-venue': '/sign-in?next=/our-venue',
      '/our-venue/[slug]': '/sign-in?next=/our-venue/<slug>',
      '/transportation': '/sign-in?next=/transportation',
      '/gifts': '/sign-in?next=/gifts',
      '/photos': '/sign-in?next=/photos',
      '/photos/[collection]': '/sign-in?next=/photos/<collection>',
    };
    for (const [url, signIn] of Object.entries(door)) {
      expect(byUrl(url)?.audience, url).toBe('guest');
      expect(byUrl(url)?.expected, url).toContain(`Signed out: redirect to ${signIn}`);
    }
    expect(byUrl('/our-venue/[slug]')?.crawlExample).toBe('/our-venue/white-city-ballroom');
    // The ride page is only for a guest who has a ride benefit.
    expect(byUrl('/transportation')?.expected).toContain('A guest with no ride benefit is redirected to /guests/travel#getting-around');
    // Home is public, says nothing about the wedding, and is not where a signed-in guest stays.
    expect(byUrl('/')?.audience).toBe('public');
    expect(byUrl('/')?.expected).toContain('no date, venue or city');
    expect(byUrl('/')?.expected).toContain('A signed-in guest is sent to /guests');
    // No guest page is opened by the signed-out crawler persona; every one is opened by the guest persona.
    const guestPages = inventory().filter((row) => row.kind === 'page' && row.audience === 'guest');
    expect(guestPages.length).toBeGreaterThan(15);
    const anonymousRoutes = routesForPersona('anonymous');
    const guestRoutes = routesForPersona('guest');
    for (const row of guestPages) {
      expect(anonymousRoutes, row.url).not.toContain(row);
      expect(guestRoutes, row.url).toContain(row);
    }
  });

  it('lists only the pages about the couple in /sitemap.xml', () => {
    const paths = publicSitemapPaths();
    const fixed = ['/', '/credits', '/our-adventures', '/our-story', '/privacy', '/terms'];
    expect(paths.filter((path) => !path.startsWith('/our-adventures/'))).toEqual(fixed);
    const adventures = paths.filter((path) => path.startsWith('/our-adventures/'));
    expect(adventures.length).toBeGreaterThan(0);
    expect(adventures).toContain(CRAWL_EXAMPLES.adventure);
    for (const path of adventures) expect(path).toMatch(/^\/our-adventures\/[a-z0-9-]+$/);
    // Nothing that says when or where the wedding is, no door, no alias, no placeholder.
    for (const path of paths) {
      expect(path, path).not.toMatch(/^\/(our-venue|guests|rsvp|transportation|trip|gifts|photos|media|sign-in|claim|invite|i|s|admin|api|t)(\/|$)/);
      expect(path, path).not.toMatch(/^\/(the-wedding|your-weekend|travel|ask-us|share-an-adventure|explore-caa|faq|registry)(\/|$)/);
      expect(path, path).not.toContain('example');
    }
    // Exactly the sitemap's public pages: an audience change in stages/01-sitemap moves a page in or out here.
    const publicPages = inventory().filter((row) => row.kind === 'page' && row.audience === 'public' && row.url !== CRAWL_EXAMPLES.sitemapXml);
    expect(publicPages.map((row) => row.url)).toEqual(['/', '/our-story', '/our-adventures', '/our-adventures/[slug]', '/credits', '/privacy', '/terms']);
  });
});
