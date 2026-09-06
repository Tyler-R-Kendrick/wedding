import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AdventureDetailPage } from '@/app/(public)/_recipes/AdventureDetailPage';
import { ExploreCaaPage } from '@/app/(public)/_recipes/ExploreCaaPage';
import { StoryPage } from '@/app/(public)/_recipes/StoryPage';
import { WeddingPage } from '@/app/(public)/_recipes/WeddingPage';
import { PLACEHOLDER_MARKER } from '@/content/schemas';
import type { AdventureDetailData } from '@/capabilities/show_adventure';
import type { ExploreCaaPageData } from '@/capabilities/get_venue_facts';
import type { StoryPageData } from '@/capabilities/get_story';
import type { ProvenanceViewData, TextBlockView } from '@/domain/content/views';
import { weddingEventSkeleton } from '@/domain/venue/wedding-events';
import type { WeddingPageData } from '@/domain/venue/wedding-page';

const prov = (over: Partial<ProvenanceViewData> = {}): ProvenanceViewData => ({
  sourceId: 'src', sourceType: 'authored', sourceTitle: "Tyler's brief", url: '/our-story#x', verifiedAt: '2026-09-04T00:00:00.000Z', trustClass: 'TRUSTED_WEDDING',
  contentVersion: 1, editedBy: 'seed', freshness: 'fresh', policy: 'durable', external: false, ...over,
});
const fact = (text: string): TextBlockView => ({ text, placeholder: false });
const todo = (hint: string): TextBlockView => ({ text: `${PLACEHOLDER_MARKER}: ${hint}`, placeholder: true });

/** Every text node that carries a placeholder hint must live inside a marked placeholder block. */
function assertPlaceholdersMarked(container: HTMLElement, hints: string[], expectedBlocks: number) {
  expect(container.textContent).not.toContain(PLACEHOLDER_MARKER);
  const blocks = container.querySelectorAll('[data-placeholder="true"]');
  expect(blocks.length).toBe(expectedBlocks);
  for (const b of blocks) {
    expect(b.getAttribute('role')).toBe('note');
    // The stamp names who is writing, and it is *visible*: a gap must read as editorial, not broken.
    // No aria-label / aria-hidden pair — the visible text is the accessible name (review SF-1).
    const stamp = b.querySelector('.placeholder__label');
    expect(stamp, 'placeholder block has no visible stamp').not.toBeNull();
    expect(stamp!.textContent).toMatch(/Sara \+ Tyler are still writing this/i);
    expect(stamp!.getAttribute('aria-hidden')).toBeNull();
    expect(b.getAttribute('aria-label')).toBeNull();
  }
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const hint of hints) {
      if (node.textContent?.includes(hint)) expect((node.parentElement as HTMLElement).closest('[data-placeholder="true"]'), `"${hint}" rendered outside a placeholder block`).not.toBeNull();
    }
  }
}

describe('typed placeholders never render as facts', () => {
  it('Our Story marks placeholder paragraphs and leaves facts plain', () => {
    const data: StoryPageData = {
      route: '/our-story',
      title: 'Our Story',
      sections: [
        { id: '1', slug: 'how-we-met', chapter: 'met', title: 'How we met', paragraphs: [fact("We met at Allison and Jamie's wedding."), todo('who noticed whom first')], media: [], placeholder: true, provenance: prov() },
        { id: '2', slug: 'the-proposal', chapter: 'engagement', title: 'The proposal', paragraphs: [todo('the engagement story')], media: [], placeholder: true, provenance: prov() },
      ],
    };
    const { container } = render(<StoryPage data={data} />);
    assertPlaceholdersMarked(container, ['who noticed whom first', 'the engagement story'], 2);
    const factNode = Array.from(container.querySelectorAll('p')).find((p) => p.textContent?.includes("Allison and Jamie's wedding"))!;
    expect(factNode.closest('[data-placeholder]')).toBeNull();
    expect(container.querySelector('h1')?.textContent).toBe('Our Story');
  });

  it('The Wedding renders times, rooms, and dress code only inside placeholder blocks', () => {
    const provenance = prov();
    const events = weddingEventSkeleton(provenance, '2027-07-17');
    const data: WeddingPageData = {
      route: '/the-wedding', coupleDisplayName: 'Sara + Tyler', dateIso: '2027-07-17', venueName: 'Chicago Athletic Association Hotel', venueAddress: '12 S Michigan Ave, Chicago, IL 60603', venueUrl: null,
      directions: { provider: 'google-maps', label: 'Open directions in Google Maps', url: 'https://www.google.com/maps/dir/?api=1&destination=x', disclosure: 'You will leave our site.', opensNewTab: true },
      events, dressCode: events[0]!.dressCode, roomsNote: todo('which room hosts what'), provenance, sources: [],
    };
    const { container } = render(<WeddingPage data={data} />);
    // 1 dress code + per event (time + room + placeholder what-happens) + rooms note
    const perEvent = events.reduce((n, e) => n + 2 + e.whatHappens.filter((w) => w.placeholder).length, 0);
    assertPlaceholdersMarked(container, ['ceremony time', 'which room', 'dress code', 'which room hosts what'], 1 + perEvent + 1);
    expect(container.textContent).toContain('Saturday, July 17, 2027');
    expect(container.querySelector('a[href^="https://www.google.com/maps/dir/"]')?.getAttribute('rel')).toContain('noopener');
    // Facts stay plain: the contracted coverage is not a placeholder.
    expect(container.textContent).toContain('filmed and edited by Oakhouse Visuals');
  });

  it('an adventure with placeholder memory marks Sara/Tyler remembers and the memory body', () => {
    const data: AdventureDetailData = {
      id: 'a', slug: 'starved-rock', href: '/our-adventures/starved-rock', title: 'Starved Rock', summary: fact('Where we first said "I love you."'), placeName: 'Starved Rock State Park',
      tags: ['adventure'], placeholder: true, visibility: 'public', provenance: prov(),
      memory: [todo('which trail, what day')], saraMemory: todo('what Sara recalls'), tylerMemory: todo('what Tyler recalls'),
      place: { id: 'p', slug: 'starved-rock-state-park', name: 'Starved Rock State Park', kind: 'park', city: 'Utica', region: 'IL', insideVenue: false, placeholder: false },
      durationMinutes: null, media: [],
      related: [
        {
          id: 'r', slug: 'starved-rock-state-park', href: '/share-an-adventure/starved-rock-state-park', title: 'Starved Rock State Park', category: 'day-trip', interests: ['outdoors'], what: fact('A state park.'),
          durationMinutes: 300, kidFriendly: null, draft: true, placeholder: false,
          handoffs: { directions: { provider: 'google-maps', label: 'Open directions in Google Maps', url: 'https://www.google.com/maps/dir/?api=1', disclosure: 'You will leave our site.', opensNewTab: true } },
          why: { experienceId: 'a', experienceSlug: 'starved-rock', experienceHref: '/our-adventures/starved-rock', experienceTitle: 'Starved Rock', text: fact("It's where we first said I love you.") },
          provenance: prov({ sourceType: 'official-web', trustClass: 'EXTERNAL_DATA', external: true, url: 'https://dnr.illinois.gov/parks/park.starvedrock.html', sourceTitle: 'Illinois DNR' }),
        },
      ],
    };
    const { container } = render(<AdventureDetailPage data={data} />);
    assertPlaceholdersMarked(container, ['which trail, what day', 'what Sara recalls', 'what Tyler recalls'], 3);
    expect(container.querySelector('#sara-remembers')?.textContent).toBe('Sara remembers');
    expect(container.querySelector('details.wp-why summary')?.textContent).toMatch(/Why we.re sharing this/);
    expect(container.querySelector('.wp-badge--draft')?.textContent).toMatch(/Draft/);
  });

  it('Explore CAA shows freshness with a date, flags expired records, and marks the rooms placeholder', () => {
    const op = (key: string, over: Partial<ExploreCaaPageData['outlets'][number]> = {}): ExploreCaaPageData['outlets'][number] => ({
      id: key, key, kind: 'outlet', label: key, value: null, url: 'https://www.chicagoathletichotel.com/restaurants/x/', placeholder: false, expired: false,
      provenance: prov({ sourceType: 'official-web', trustClass: 'EXTERNAL_DATA', external: true, url: 'https://www.chicagoathletichotel.com/restaurants/x/', verifiedAt: '2026-09-05T13:30:00.000Z', policy: 'operational', freshness: 'fresh' }),
      ...over,
    });
    const data: ExploreCaaPageData = {
      route: '/explore-caa', venueName: 'Chicago Athletic Association Hotel',
      history: [{ id: 'h', slug: 'built-1893', category: 'history', statement: 'Built in 1893 for the private Chicago Athletic Association.', provenance: prov() }],
      lookForThis: [{ id: 'l', slug: 'look-brick', category: 'look-for-this', statement: 'Patterned brick.', provenance: prov() }],
      spaces: [{ id: 's', slug: 'the-tank', href: '/explore-caa/the-tank', name: 'The Tank', character: 'The former pool.', features: ['pool tile'], capacities: { ceremony: 175, dinnerDance: 130, reception: 225, note: 'Kit figure — verify with the planner.' }, lookForThis: ['tile'], provenance: prov({ sourceType: 'venue-document', external: true, trustClass: 'EXTERNAL_DATA' }) }],
      outlets: [op('Cindy’s'), op('Milk Room', { expired: true, url: null, provenance: prov({ sourceType: 'venue-document', trustClass: 'EXTERNAL_DATA', external: true, freshness: 'expired', validUntil: '2025-02-28T23:59:59.000Z', policy: 'venue-document' }) })],
      gettingHere: [op('valet.entrance', { kind: 'valet', label: 'Valet entrance', value: '71 E Madison', provenance: prov({ sourceType: 'official-web', trustClass: 'EXTERNAL_DATA', external: true, freshness: 'aging', url: 'https://www.chicagoathletichotel.com/about/faq/', policy: 'operational' }) })],
      roomsNotConfirmed: todo('which room hosts the ceremony'),
    };
    const { container } = render(<ExploreCaaPage data={data} />);
    assertPlaceholdersMarked(container, ['which room hosts the ceremony'], 1);
    expect(container.querySelector('[data-key="Cindy’s"] [data-freshness="fresh"]')?.textContent).toContain('September 5, 2026');
    expect(container.querySelector('[data-key="Milk Room"]')?.getAttribute('data-expired')).toBe('true');
    expect(container.querySelector('[data-key="Milk Room"] [data-freshness="expired"]')?.textContent).toMatch(/No longer current/);
    expect(container.querySelector('[data-key="Milk Room"] a[href^="https://"]')).toBeNull();
    const valet = container.querySelector('[data-key="valet.entrance"]')!;
    expect(valet.textContent).toContain('71 E Madison');
    expect(valet.textContent).toMatch(/Last checked/);
    expect(valet.querySelector('a[href="https://www.chicagoathletichotel.com/about/faq/"]')).not.toBeNull();
    expect(container.textContent).toContain('Kit figure');
  });
});
