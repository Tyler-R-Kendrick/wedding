import { ROUTES } from '@/domain/routes';
import type { ContentRecipe, RecommendationProps } from '@/themes/content-types';
import { CONTENT_COPY } from '@/themes/shared/content';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { kit } from '../kit';

const { Shell, Section, Prose, content } = kit;
const { PageHead, RecommendationCard, BackLink } = content;

/** One recommendation: the practical card at full width on the axis under its title plaque. */
export const GildedRecommendationPage: ContentRecipe<RecommendationProps> = ({ card, frame }) => (
  <Shell frame={frame} banner={<PreviewBanner lifecycle={frame.lifecycle} />}>
    <PageHead eyebrow={CONTENT_COPY.guide.eyebrow} title={card.title} />
    <Section id="card">
      <RecommendationCard card={card} headingLevel={2} />
      <Prose>
        <BackLink href={ROUTES.share}>{CONTENT_COPY.guide.back}</BackLink>
      </Prose>
    </Section>
  </Shell>
);
