import { describe, expect, it } from 'vitest';
import { pageForUrl, visibleIn } from '@wedding/sitemap';
import { LIFECYCLE_STATES } from '@/contracts/lifecycle';
import { navFor } from '@/domain/lifecycle/nav';

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
