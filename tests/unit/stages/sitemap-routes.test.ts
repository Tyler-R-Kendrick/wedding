import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { INTERNAL_ROUTES, LIFECYCLE_STATES as SITEMAP_STATES, PAGES, navLabel, navPages, validateSitemap } from '@wedding/sitemap';
import { LIFECYCLE_STATES } from '@/contracts/lifecycle';
import { navFor } from '@/domain/lifecycle/nav';

/*
 * Stage 5 of the pipeline (stages/README.md) is this app, and the sitemap is stage 1. This is where
 * a change at the top of the pipeline reaches the bottom: add a page to the sitemap and this fails
 * until src/app serves it; add a route to src/app and this fails until the sitemap names it. The
 * sitemap is the one list every stage reads, so it may not drift from the app it describes.
 */

const APP = path.resolve(__dirname, '../../../src/app');

/** Every route src/app serves, as a pattern: route groups dropped, dynamic segments kept. */
function appRoutes(dir = APP, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = path.join(dir, entry);
    if (!statSync(abs).isDirectory()) {
      if (entry === 'page.tsx') out.push(prefix || '/');
      continue;
    }
    if (entry === 'api' || entry.startsWith('_')) continue;
    const segment = /^\(.*\)$/.test(entry) ? '' : `/${entry}`;
    out.push(...appRoutes(abs, `${prefix}${segment}`));
  }
  return out;
}

/** `/` has no page of its own: the proxy rewrites it onto the statically rendered theme tree. */
const served = (route: string, routes: string[]) => routes.includes(route) || (route === '/' && routes.includes('/t/[theme]'));

describe('the real app serves the sitemap (pipeline stage 1 → stage 5)', () => {
  const routes = appRoutes();

  it('the sitemap is valid', () => {
    expect(validateSitemap()).toEqual([]);
  });

  it('every sitemap page is a route the app serves', () => {
    const missing = PAGES.filter((p) => !served(p.path, routes)).map((p) => `${p.id} ${p.path}`);
    expect(missing, 'in the sitemap, not in src/app').toEqual([]);
  });

  it('every route the app serves is in the sitemap', () => {
    const known = new Set<string>([...PAGES.map((p) => p.path), ...INTERNAL_ROUTES]);
    expect(routes.filter((r) => !known.has(r)), 'in src/app, not in the sitemap').toEqual([]);
  });

  it('lifecycle states match the app contract', () => {
    expect([...SITEMAP_STATES]).toEqual([...LIFECYCLE_STATES]);
  });

  it('the navigation reads its labels from the sitemap', () => {
    const labels = new Set(navPages().map(navLabel));
    for (const state of LIFECYCLE_STATES) {
      const nav = navFor(state);
      for (const item of [...nav.primary, ...nav.more, ...(nav.member ?? [])]) {
        if (item.external || item.label === 'Today') continue; // state-specific relabels live in nav.ts
        expect(labels, `${state}: ${item.label}`).toContain(item.label);
      }
    }
  });
});
