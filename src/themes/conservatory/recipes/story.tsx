import { ROUTES } from '@/domain/routes';
import type { ContentRecipe, StoryProps } from '@/themes/content-types';
import { CONTENT_COPY } from '@/themes/shared/content';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { kit } from '../kit';

const { Shell, Section, content } = kit;
const { PageHead, StoryTimeline } = content;

/** Our Story on the sheet: one dashed stem down the left with a leaf per chapter; the next step hangs as a kraft tag. */
export const ConservatoryStoryPage: ContentRecipe<StoryProps> = ({ data, frame }) => (
  <Shell frame={frame} banner={<PreviewBanner lifecycle={frame.lifecycle} />}>
    <PageHead eyebrow={CONTENT_COPY.story.eyebrow} title={data.title} lede={CONTENT_COPY.story.lede} />
    <Section id="chapters">
      <div className="cv-section__text">
        <StoryTimeline sections={data.sections} />
      </div>
      <p className="cv-section__hang">
        <a className="cv-tag cv-tag--hang" href={ROUTES.adventures}>
          <span>{CONTENT_COPY.story.nextLink}</span>
        </a>
      </p>
    </Section>
  </Shell>
);
