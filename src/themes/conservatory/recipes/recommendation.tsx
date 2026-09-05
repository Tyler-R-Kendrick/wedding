import { ROUTES } from '@/domain/routes';
import type { ContentRecipe, RecommendationProps } from '@/themes/content-types';
import { CONTENT_COPY } from '@/themes/shared/content';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { kit } from '../kit';

const { Shell, Section, content } = kit;
const { PageHead, RecommendationCard, BackLink } = content;

/** One recommendation: the practical card mounted at the top of the sheet, the way back as a hanging tag. */
export const ConservatoryRecommendationPage: ContentRecipe<RecommendationProps> = ({ card, frame }) => (
  <Shell frame={frame} banner={<PreviewBanner lifecycle={frame.lifecycle} />}>
    <PageHead eyebrow={CONTENT_COPY.guide.eyebrow} title={card.title} />
    <Section id="card">
      <div className="cv-section__text">
        <RecommendationCard card={card} headingLevel={2} />
      </div>
      <div className="cv-section__hang">
        <BackLink href={ROUTES.share}>{CONTENT_COPY.guide.back}</BackLink>
      </div>
    </Section>
  </Shell>
);
