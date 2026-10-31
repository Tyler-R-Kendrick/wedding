import type { RecommendationCard } from '@/domain/content/views';

/** Sara’s Oct 12 curated Chicago picks — shown to signed-in guests instead of draft hotel itineraries. */
export const CURATED_GUIDE_SECTIONS = [
  {
    id: 'explore-venue',
    title: 'Explore the venue',
    slugs: ['caa-explore'],
  },
  {
    id: 'see-the-sights',
    title: 'See the sights',
    slugs: ['chicago-citypass', 'architecture-river-cruise', 'architecture-walking-tours', 'millennium-park-walk', 'chicago-riverwalk'],
  },
  {
    id: 'food-and-drinks',
    title: 'Food & drinks',
    slugs: ['alinea', 'esme', 'the-aviary', 'michael-jordans-steakhouse', 'chicago-classics'],
  },
  {
    id: 'parks',
    title: 'Parks',
    slugs: ['grant-park', 'maggie-daley-park', 'lincoln-park-zoo', 'chicago-botanic-garden'],
  },
  {
    id: 'museums',
    title: 'Museums',
    slugs: ['art-institute', 'shedd-aquarium', 'griffin-msi', 'museum-of-ice-cream'],
  },
] as const;

export function curatedGuideSections(items: readonly RecommendationCard[]) {
  const bySlug = new Map(items.map((item) => [item.slug, item]));
  return CURATED_GUIDE_SECTIONS.map((section) => ({
    ...section,
    picks: section.slugs.map((slug) => bySlug.get(slug)).filter((item): item is RecommendationCard => !!item && !item.draft && !item.placeholder),
  })).filter((section) => section.picks.length > 0);
}
