import Link from 'next/link';
import { curatedGuideSections } from '@/domain/adventures/curated-guide';
import type { RecommendationCard } from '@/domain/content/views';
import { RecommendationCardView, Section } from '@/app/(public)/_recipes/kit';

export function CuratedChicagoSections({ items }: { items: RecommendationCard[] }) {
  const sections = curatedGuideSections(items);
  if (!sections.length) return null;
  return (
    <Section id="curated" number="01" title="Our Chicago picks">
      <p className="wp-prose">Places Sara gathered for you — food, parks, museums, architecture, and experiences around the wedding venue.</p>
      {sections.map((section) => (
        <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`}>
          <h3 id={`${section.id}-title`}>{section.title}</h3>
          <ul className="wp-grid">
            {section.picks.map((pick) => (
              <li key={pick.id}>
                <RecommendationCardView card={pick} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="wp-muted">
        <Link className="link-block" href="#exploring-tips">Getting around, safety, and final tips →</Link>
      </p>
    </Section>
  );
}
