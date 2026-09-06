import adventuresJson from './seed/adventures.json';
import faqJson from './seed/faq.json';
import itinerariesJson from './seed/itineraries.json';
import operationalFieldsJson from './seed/operational-fields.json';
import placesJson from './seed/places.json';
import recommendationsJson from './seed/recommendations.json';
import storyJson from './seed/story.json';
import venueFactsJson from './seed/venue-facts.json';
import venueSpacesJson from './seed/venue-spaces.json';
import { contentSeedSchema, type ContentSeed } from './schemas';

export * from './schemas';
export * from './sources';

/**
 * Validates every seed file against the zod schemas and checks cross references
 * (place slugs, experience slugs, recommendation slugs, operational keys). Throws with a
 * readable message so a bad edit fails the seed, the tests, and the build.
 */
export function loadContentSeed(): ContentSeed {
  const parsed = contentSeedSchema.safeParse({
    story: storyJson,
    places: placesJson,
    adventures: adventuresJson,
    recommendations: recommendationsJson,
    itineraries: itinerariesJson,
    venueSpaces: venueSpacesJson,
    venueFacts: venueFactsJson,
    operationalFields: operationalFieldsJson,
    faq: faqJson,
  });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`content seed is invalid:\n  ${issues}`);
  }
  const seed = parsed.data;
  const problems = crossReferenceProblems(seed);
  if (problems.length) throw new Error(`content seed has broken references:\n  ${problems.join('\n  ')}`);
  return seed;
}

/** Referential checks that zod cannot express across files. Exported for tests. */
export function crossReferenceProblems(seed: ContentSeed): string[] {
  const problems: string[] = [];
  const unique = (label: string, values: string[]) => {
    const seen = new Set<string>();
    for (const v of values) {
      if (seen.has(v)) problems.push(`${label}: duplicate "${v}"`);
      seen.add(v);
    }
    return seen;
  };
  const placeSlugs = unique('places.slug', seed.places.map((p) => p.slug));
  const adventureSlugs = unique('adventures.slug', seed.adventures.map((a) => a.slug));
  const recommendationSlugs = unique('recommendations.slug', seed.recommendations.map((r) => r.slug));
  const operationalKeys = unique('operationalFields.key', seed.operationalFields.map((o) => o.key));
  unique('story.slug', seed.story.map((s) => s.slug));
  unique('itineraries.slug', seed.itineraries.map((i) => i.slug));
  unique('venueSpaces.slug', seed.venueSpaces.map((v) => v.slug));
  unique('venueFacts.slug', seed.venueFacts.map((v) => v.slug));
  unique('faq.slug', seed.faq.map((f) => f.slug));

  for (const a of seed.adventures) {
    if (a.placeSlug && !placeSlugs.has(a.placeSlug)) problems.push(`adventures.${a.slug}.placeSlug: unknown place "${a.placeSlug}"`);
    for (const r of a.relatedRecommendationSlugs) if (!recommendationSlugs.has(r)) problems.push(`adventures.${a.slug}.relatedRecommendationSlugs: unknown recommendation "${r}"`);
  }
  for (const r of seed.recommendations) {
    if (r.placeSlug && !placeSlugs.has(r.placeSlug)) problems.push(`recommendations.${r.slug}.placeSlug: unknown place "${r.placeSlug}"`);
    if (r.experienceSlug && !adventureSlugs.has(r.experienceSlug)) problems.push(`recommendations.${r.slug}.experienceSlug: unknown adventure "${r.experienceSlug}"`);
    if (r.operationalKey && !operationalKeys.has(r.operationalKey)) problems.push(`recommendations.${r.slug}.operationalKey: unknown operational field "${r.operationalKey}"`);
    if (r.whyWeShareThis && !r.experienceSlug) problems.push(`recommendations.${r.slug}: whyWeShareThis needs an experienceSlug (the memory it links to)`);
  }
  for (const i of seed.itineraries) {
    for (const s of i.stops) if (!recommendationSlugs.has(s.recommendationSlug)) problems.push(`itineraries.${i.slug}.stops: unknown recommendation "${s.recommendationSlug}"`);
    if (i.minMinutes && i.maxMinutes && i.minMinutes > i.maxMinutes) problems.push(`itineraries.${i.slug}: minMinutes > maxMinutes`);
  }
  return problems;
}
