import Link from 'next/link';
import type { RecommendationCard } from '@/domain/content/views';
import { ROUTES } from '@/domain/routes';
import { PageIntro, RecommendationCardView, Shell } from './kit';

export function RecommendationPage({ card }: { card: RecommendationCard }) {
  return (
    <Shell current={ROUTES.share}>
      <PageIntro eyebrow="Share an Adventure" title={card.title} />
      <RecommendationCardView card={card} headingLevel={2} />
      <p className="wp-prose">
        <Link href={ROUTES.share}>← All recommendations and itineraries</Link>
      </p>
    </Shell>
  );
}
