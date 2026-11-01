import { describe, expect, it } from 'vitest';
import { curatedGuideSections, CURATED_GUIDE_SECTIONS } from '@/domain/adventures/curated-guide';
import type { RecommendationCard } from '@/domain/content/views';

function card(slug: string, overrides: Partial<RecommendationCard> = {}): RecommendationCard {
  return {
    id: slug,
    slug,
    href: `/share-an-adventure/${slug}`,
    title: slug,
    category: 'food-drink',
    what: { text: slug, placeholder: false, provenance: { sources: [] } },
    draft: false,
    placeholder: false,
    handoffs: {},
    ...overrides,
  } as RecommendationCard;
}

describe('curatedGuideSections', () => {
  it('groups Sara picks and drops drafts', () => {
    const items = CURATED_GUIDE_SECTIONS.flatMap((s) => s.slugs).map((slug) => card(slug));
    items.push(card('caa-explore', { draft: true }));
    const sections = curatedGuideSections(items);
    expect(sections.find((s) => s.id === 'explore-venue')).toBeUndefined();
    expect(sections.find((s) => s.id === 'food-and-drinks')?.picks.map((p) => p.slug)).toEqual(
      expect.arrayContaining(['alinea', 'chicago-classics']),
    );
  });
});
