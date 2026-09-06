import { Text as Block } from '@/components/provenance';
import { formatDateWithWeekday } from '@/domain/content/format';
import { ROUTES } from '@/domain/routes';
import type { ContentRecipe, WeddingProps } from '@/themes/content-types';
import { CONTENT_COPY } from '@/themes/shared/content';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { kit } from '../kit';

const { Shell, Section, SectionHeading, Prose, Card, content } = kit;
const { PageHead, Handoffs, Programme, Provenance } = content;

/**
 * The Wedding on the sheet: date and venue as facts under the title, directions as a handoff. What
 * to wear is a pressed card in the mount; the order of the day then runs the full width of the sheet
 * as a vine with a leaf per event, times and rooms still marked placeholders.
 */
export const ConservatoryWeddingPage: ContentRecipe<WeddingProps> = ({ data, frame }) => (
  <Shell frame={frame} banner={<PreviewBanner lifecycle={frame.lifecycle} />}>
    <PageHead eyebrow={data.coupleDisplayName} title={CONTENT_COPY.wedding.title} lede={<time dateTime={data.dateIso}>{formatDateWithWeekday(data.dateIso)}</time>}>
      <p className="cv-pagehead__place">
        {data.venueName}
        <br />
        {data.venueAddress}
      </p>
      {data.directions ? <Handoffs handoffs={[data.directions]} label="Directions" /> : null}
    </PageHead>

    <Section id="dress-code" labelledBy="dress-title">
      <div className="cv-section__text">
        <SectionHeading level={2} id="dress-title" title={CONTENT_COPY.wedding.dress} />
      </div>
      <div className="cv-section__mount">
        <Card label="Wear" featured index={1}>
          <Block block={data.dressCode} />
        </Card>
      </div>
    </Section>

    <Section id="programme" labelledBy="programme-title">
      <div className="cv-section__full">
        <h2 id="programme-title" className="sr-only">
          Order of the day
        </h2>
        <Programme events={data.events} venueName={data.venueName} startNumber={1} />
      </div>
    </Section>

    <Section id="rooms" ground="alt" labelledBy="rooms-title">
      <div className="cv-section__text">
        <SectionHeading level={2} id="rooms-title" title={CONTENT_COPY.wedding.rooms} />
        <Prose>
          <Block block={data.roomsNote} />
        </Prose>
        <Provenance provenance={data.provenance} />
      </div>
      <p className="cv-section__hang">
        <a className="cv-tag cv-tag--hang" href={ROUTES.exploreCaa}>
          <span>{CONTENT_COPY.wedding.roomsLink}</span>
        </a>
      </p>
    </Section>
  </Shell>
);
