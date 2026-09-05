import { Text as Block } from '@/components/provenance';
import { formatDateWithWeekday } from '@/domain/content/format';
import { ROUTES } from '@/domain/routes';
import type { ContentRecipe, WeddingProps } from '@/themes/content-types';
import { CONTENT_COPY } from '@/themes/shared/content';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { kit } from '../kit';

const { Shell, Section, SectionHeading, Prose, Link, content } = kit;
const { PageHead, Handoffs, Programme, Provenance } = content;

/**
 * The Wedding: the date and the venue are facts on the title plaque; every time and room is a marked
 * placeholder. Dress code is act 01, the order of the day follows as numbered acts on the spine.
 */
export const GildedWeddingPage: ContentRecipe<WeddingProps> = ({ data, frame }) => (
  <Shell frame={frame} banner={<PreviewBanner lifecycle={frame.lifecycle} />}>
    <PageHead eyebrow={data.coupleDisplayName} title={CONTENT_COPY.wedding.title} lede={<time dateTime={data.dateIso}>{formatDateWithWeekday(data.dateIso)}</time>}>
      <p className="gh-pagehead__place">
        {data.venueName}
        <br />
        {data.venueAddress}
      </p>
      {data.directions ? <Handoffs handoffs={[data.directions]} label="Directions" /> : null}
    </PageHead>

    <Section id="dress-code" number={1} labelledBy="dress-title">
      <SectionHeading level={2} id="dress-title" title={CONTENT_COPY.wedding.dress} />
      <Prose>
        <Block block={data.dressCode} />
      </Prose>
    </Section>

    <Section id="programme" ground="alt">
      <Programme events={data.events} venueName={data.venueName} startNumber={2} />
    </Section>

    <Section id="rooms" labelledBy="rooms-title">
      <SectionHeading level={2} id="rooms-title" title={CONTENT_COPY.wedding.rooms} />
      <Prose>
        <Block block={data.roomsNote} />
        <p>
          <Link href={ROUTES.exploreCaa}>{CONTENT_COPY.wedding.roomsLink} →</Link>
        </p>
      </Prose>
      <Provenance provenance={data.provenance} />
    </Section>
  </Shell>
);
