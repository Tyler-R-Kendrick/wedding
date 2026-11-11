import Link from 'next/link';
import type { RecommendationCard } from '@/domain/content/views';
import { ROUTES } from '@/domain/routes';
import { PageIntro, RecommendationCardView, Shell } from './kit';

export function RecommendationPage({ card }: { card: RecommendationCard }) {
  return (
    <Shell current={ROUTES.guestTravel}>
      <PageIntro eyebrow="Your Trip" title={card.title} />
      <RecommendationCardView card={card} headingLevel={2} />
      <p className="wp-prose">
        <Link className="link-block" href={`${ROUTES.guestTravel}#plan`}>← Back to Your Trip</Link>
      </p>
    </Shell>
  );
}
