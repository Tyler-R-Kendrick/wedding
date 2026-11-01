import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { crawlUrl, inventory, inventoryMarkdown, routesForPersona, type CrawlPersonaKind } from '@/lib/site-inventory';

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
});
