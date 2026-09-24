import { Text as Block } from "@/components/provenance";
import { formatDateWithWeekday } from "@/domain/content/format";
import { ROUTES } from "@/domain/routes";
import type { ContentRecipe, WeddingProps } from "@/themes/content-types";
import { CONTENT_COPY } from "@/themes/shared/content";
import { PreviewBanner } from "@/themes/shared/PreviewBanner";
import { DecoFrame, kit } from "../kit";
import { Photo } from "../media";

const { Shell, Section, SectionHeading, Prose, Link, content } = kit;
const { PageHead, Handoffs, Programme, Provenance } = content;

/**
 * The Wedding in the approved vocabulary: the botanical title panel with the date and the address,
 * what to wear straight under it (the first thing a guest wants), the day's running order on the
 * moss band with calendar tiles derived from each event's date, and the rooms beside a real
 * photograph of the building. Every time and room still to be settled is a marked placeholder.
 */
export const BotanicalWeddingPage: ContentRecipe<WeddingProps> = ({
  data,
  frame,
}) => (
  <Shell frame={frame} banner={<PreviewBanner lifecycle={frame.lifecycle} />}>
    <PageHead
      eyebrow={data.coupleDisplayName}
      title={CONTENT_COPY.wedding.title}
      lede={
        <time dateTime={data.dateIso}>
          {formatDateWithWeekday(data.dateIso)}
        </time>
      }
    >
      <p className="bd-pagehead__place">
        {data.venueName}
        <br />
        {data.venueAddress}
      </p>
      {data.directions ? (
        <Handoffs handoffs={[data.directions]} label="Directions" />
      ) : null}
    </PageHead>

    <Section id="dress-code" labelledBy="dress-title">
      <SectionHeading
        level={2}
        id="dress-title"
        title={CONTENT_COPY.wedding.dress}
      />
      <Prose>
        <Block block={data.dressCode} />
      </Prose>
    </Section>

    <section
      id="programme"
      className="bd-section bd-section--moss bd-programme-band"
      aria-label="The order of the day"
    >
      <DecoFrame />
      <div className="bd-section__inner">
        <Programme
          events={data.events}
          venueName={data.venueName}
          startNumber={1}
        />
      </div>
    </section>

    <Section id="rooms" labelledBy="rooms-title">
      <div className="bd-rooms-split">
        <Photo
          id="venue.exterior"
          sizes="(min-width: 900px) 40vw, 100vw"
          className="bd-rooms-split__photo"
        />
        <div className="bd-rooms-split__text">
          <SectionHeading
            level={2}
            id="rooms-title"
            title={CONTENT_COPY.wedding.rooms}
          />
          <Prose>
            <Block block={data.roomsNote} />
            <p>
              <Link href={ROUTES.ourVenue} standalone>
                {CONTENT_COPY.wedding.roomsLink} →
              </Link>
            </p>
          </Prose>
          <Provenance provenance={data.provenance} />
        </div>
      </div>
    </Section>
  </Shell>
);
