import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { crawlUrl, CRAWL_EXAMPLES, inventory, inventoryMarkdown, publicSitemapPaths, routesForPersona, type CrawlPersonaKind } from '@/lib/site-inventory';

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

  it('names the guest portal, its legacy aliases, and the social sign-in door', () => {
    const byUrl = (url: string) => inventory().find((row) => row.url === url && row.method === 'GET');
    for (const url of ['/guests', '/guests/travel', '/guests/things-to-do', '/guests/ask-us', '/guests/things-to-do/[slug]']) {
      expect(byUrl(url)?.audience, url).toBe('guest');
      expect(byUrl(url)?.crawl, url).toBe(true);
    }
    expect(byUrl('/guests/things-to-do/[slug]')?.crawlExample).toBe(CRAWL_EXAMPLES.guestRecommendation);
    expect(byUrl('/guests/things-to-do/[slug]')?.examples).toContain('/guests/things-to-do/starved-rock-state-park');
    expect(byUrl('/travel')?.expected).toContain('/guests/travel');
    expect(byUrl('/ask-us')?.expected).toContain('/guests/ask-us');
    expect(byUrl('/share-an-adventure')?.expected).toContain('/guests/things-to-do');
    expect(byUrl('/sign-in/pending')?.audience).toBe('gate');
    expect(byUrl('/sign-in/pending')?.crawlExample).toBe('/sign-in/pending');
    expect(publicSitemapPaths().some((path) => path === '/guests' || path.startsWith('/guests/'))).toBe(false);
    expect(byUrl('/api/auth/social/[provider]/start')?.crawl).toBe(false);
    expect(byUrl('/api/auth/social/[provider]/callback')?.expected).toContain('/sign-in/pending');
  });
});
