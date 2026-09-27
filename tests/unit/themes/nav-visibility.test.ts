import { describe, expect, it } from 'vitest';
import { pageForUrl, visibleIn } from '@wedding/sitemap';
import { LIFECYCLE_STATES } from '@/contracts/lifecycle';
import { destinationOf } from '@/domain/lifecycle/account';
import { navFor } from '@/domain/lifecycle/nav';
import { homeContent } from '@/themes/shared/home-content';
import { SEED_SITE } from '@/db/seed/seed';
import { toSiteFacts } from '@/domain/lifecycle/facts';

/**
 * The sitemap says when each page opens (`visibleFrom`); the navigation says what each lifecycle
 * state links to. They were two tables that drifted: Save the Date put The Wedding in the primary
 * nav while the sitemap opens it at Invitations Open. The sitemap owns the answer (changes cascade
 * down from stage 01), so every link the navigation offers must be visible in that state.
 */
describe('the navigation never links a page before the sitemap opens it', () => {
  it.each(LIFECYCLE_STATES)('%s', (state) => {
    const nav = navFor(state, { signedIn: true });
    const internal = [...nav.primary, ...nav.more, ...nav.sticky, ...(nav.member ?? [])].filter((i) => !i.external && i.href.startsWith('/'));
    for (const item of internal) {
      const path = item.href.split('#')[0]!;
      const page = pageForUrl(path);
      expect(page, `${state}: ${item.href} is not a sitemap page`).toBeDefined();
      expect(visibleIn(page!, state), `${state}: ${item.href} opens at ${page!.visibleFrom}`).toBe(true);
    }
  });
});

describe('Home never links a page before the sitemap opens it', () => {
  it.each(LIFECYCLE_STATES)('%s', (state) => {
    const home = homeContent(toSiteFacts({ ...SEED_SITE }), state);
    const links = [home.primary, home.secondary, ...home.sections.map((s) => s.link)].filter((l): l is NonNullable<typeof l> => !!l);
    for (const link of links) {
      const page = pageForUrl(destinationOf(link.href).split(/[?#]/)[0]!);
      if (!page) continue;
      expect(visibleIn(page, state), `${state}: Home links ${link.href}, which opens at ${page.visibleFrom}`).toBe(true);
    }
  });
});
