import { ROUTES } from '@/domain/routes';
import type { ContentRecipe, StoryProps } from '@/themes/content-types';
import { CONTENT_COPY } from '@/themes/shared/content';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { TimelineStops } from '@/themes/shared/timeline';
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
    {data.timeline.length ? (
      <Section id="along-the-way" labelledBy="along-the-way-title">
        <SectionHeading level={2} id="along-the-way-title" title="Along the way" />
        <TimelineStops sections={data.sections} moments={data.timeline} classes={{ title: 'gh-h gh-h--3', meta: 'gh-meta', prose: 'gh-prose' }} />
      </Section>
    ) : null}
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
