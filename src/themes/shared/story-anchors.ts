/** Legacy /our-story fragment ids merged into a chapter stop (seed + citations). */
export const STORY_LEGACY_ANCHORS: Record<string, string> = {
  'allison-and-jamies-wedding': 'how-we-met',
  'museum-of-ice-cream': 'the-connection',
  'richardson-farm': 'the-connection',
  'michael-jordans-steakhouse': 'the-connection',
  'food-tastings': 'the-connection',
  'gardening-together': 'the-connection',
  'madison-waterfront': 'love',
  'starved-rock': 'love',
};

const LEGACY_BY_SECTION = Object.entries(STORY_LEGACY_ANCHORS).reduce<Record<string, string[]>>((acc, [legacy, section]) => {
  (acc[section] ??= []).push(legacy);
  return acc;
}, {});

export function resolveStoryHash(hashOrSlug: string): string {
  const slug = hashOrSlug.replace(/^#/, '');
  return STORY_LEGACY_ANCHORS[slug] ?? slug;
}

export function legacyAnchorsForSection(sectionSlug: string): readonly string[] {
  return LEGACY_BY_SECTION[sectionSlug] ?? [];
}
