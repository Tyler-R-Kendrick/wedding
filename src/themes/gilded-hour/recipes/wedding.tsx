import { DressCodeContent } from '@/components/wedding/DressCodeContent';
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
 * placeholder. What to wear sits straight under the head — it is the first thing a guest wants and it
 * belongs in the phone's first screen — and the order of the day owns the numbered spine from 01.
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

    <Section id="dress-code" labelledBy="dress-title">
      <SectionHeading level={2} id="dress-title" title={CONTENT_COPY.wedding.dress} />
      <Prose>
        <DressCodeContent />
      </Prose>
    </Section>

    <Section id="celebrating-together" labelledBy="celebrating-title">
      <SectionHeading level={2} id="celebrating-title" title="A day together" />
      <Prose><p>{CONTENT_COPY.wedding.welcome}</p><p>{CONTENT_COPY.wedding.together}</p></Prose>
    </Section>

    <Section id="ceremony-guidelines" labelledBy="ceremony-guidelines-title">
      <SectionHeading level={2} id="ceremony-guidelines-title" title="An unplugged ceremony" />
      <Prose><p>{CONTENT_COPY.wedding.unplugged}</p></Prose>
    </Section>

    <Section id="helpful-information" labelledBy="helpful-information-title">
      <SectionHeading level={2} id="helpful-information-title" title="Planning your visit" />
      <Prose>
        <p>We’ll share more about accessibility requests and dietary needs as the day approaches.</p>
        <p><Link standalone href="/travel">Travel and accommodations →</Link></p>
        <p><Link standalone href="/ask-us">Questions about invitations, children, or plus-ones? →</Link></p>
        <p><Link standalone href="/sign-in?next=%2Fyour-weekend">Sign in for your events and personal agenda →</Link></p>
      </Prose>
    </Section>



    <Section id="programme" ground="alt">
      <Programme events={data.events} venueName={data.venueName} startNumber={1} />
    </Section>

    <Section id="rooms" labelledBy="rooms-title">
      <SectionHeading level={2} id="rooms-title" title={CONTENT_COPY.wedding.rooms} />
      <Prose>
        <Block block={data.roomsNote} />
        <p>
          <Link href={ROUTES.ourVenue} standalone>{CONTENT_COPY.wedding.roomsLink} →</Link>
        </p>
      </Prose>
      <Provenance provenance={data.provenance} />
    </Section>
  </Shell>
);
