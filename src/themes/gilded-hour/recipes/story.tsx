import { ROUTES } from '@/domain/routes';
import type { ContentRecipe, StoryProps } from '@/themes/content-types';
import { CONTENT_COPY } from '@/themes/shared/content';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { kit } from '../kit';

const { Shell, Section, SectionHeading, Button, content } = kit;
const { PageHead, StoryTimeline } = content;

/** Our Story on the axis: a title plaque, then every chapter as a numbered act on one gold spine. */
export const GildedStoryPage: ContentRecipe<StoryProps> = ({ data, frame }) => (
  <Shell frame={frame} banner={<PreviewBanner lifecycle={frame.lifecycle} />}>
    <PageHead eyebrow={CONTENT_COPY.story.eyebrow} title={data.title} lede={CONTENT_COPY.story.lede} />
    <Section id="chapters">
      <StoryTimeline sections={data.sections} />
    </Section>
    <Section id="next" ground="alt" labelledBy="next-title">
      <SectionHeading level={2} id="next-title" title={CONTENT_COPY.story.next} />
      <p className="gh-section__action">
        <Button variant="secondary" href={ROUTES.adventures}>
          {CONTENT_COPY.story.nextLink}
        </Button>
      </p>
    </Section>
  </Shell>
);
