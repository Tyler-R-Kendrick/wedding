import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { page, visibleIn, type PageId } from '@wedding/sitemap';
import { LIFECYCLE_STATES, type LifecycleState } from '@/contracts/lifecycle';

/**
 * Pages a guest cannot use yet are closed to a typed address, not only missing from the navigation
 * (`requireOpenNow`). When each opens is the sitemap's `visibleFrom`; this pins the days Sara and
 * Tyler asked for, and that every such page still asks.
 */
const OPENS: Record<string, { id: PageId; from: LifecycleState; file: string }> = {
  gifts: { id: 'gifts', from: 'RSVP_OPEN', file: 'src/app/(public)/gifts/page.tsx' },
  photos: { id: 'photos', from: 'WEDDING_DAY', file: 'src/app/(public)/photos/page.tsx' },
  collection: { id: 'photo-collection', from: 'WEDDING_DAY', file: 'src/app/(public)/photos/[collection]/page.tsx' },
  upload: { id: 'media-upload', from: 'WEDDING_DAY', file: 'src/app/(guest)/media/upload/page.tsx' },
  mine: { id: 'media-mine', from: 'WEDDING_DAY', file: 'src/app/(guest)/media/mine/page.tsx' },
  search: { id: 'media-search', from: 'POST_WEDDING', file: 'src/app/(guest)/media/search/page.tsx' },
};

describe('pages that open later in the timeline', () => {
  for (const [name, { id, from, file }] of Object.entries(OPENS)) {
    it(`${name} is closed before ${from} and open from then on`, () => {
      const at = LIFECYCLE_STATES.indexOf(from);
      for (const [i, state] of LIFECYCLE_STATES.entries()) expect(visibleIn(page(id), state), state).toBe(i >= at);
    });

    it(`${name} checks the day itself, so a typed address is turned away like a missing link`, () => {
      expect(readFileSync(file, 'utf8')).toContain(`await requireOpenNow(principal, '${id}')`);
    });
  }

  it('nothing here is open while the save-the-dates are out', () => {
    for (const { id } of Object.values(OPENS)) for (const state of ['TEASER', 'SAVE_THE_DATE', 'INVITATIONS_OPEN'] as const) expect(visibleIn(page(id), state), `${id} in ${state}`).toBe(false);
  });
});
