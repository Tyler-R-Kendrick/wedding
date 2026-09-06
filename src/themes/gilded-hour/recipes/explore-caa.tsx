import { Text as Block } from '@/components/provenance';
import { guestText } from '@/domain/content/text';
import { ROUTES } from '@/domain/routes';
import type { ContentRecipe, ExploreCaaProps } from '@/themes/content-types';
import { CONTENT_COPY } from '@/themes/shared/content';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { kit } from '../kit';

const { Shell, Section, SectionHeading, Prose, Link, content } = kit;
const { PageHead, FactList, RoomGrid, LookForList, OutletList, Provenance } = content;

/**
 * Explore CAA in five acts on the axis: the building (numbered, cited statements), the spaces as a
 * floor plan, the docent list, the outlets ledger, and getting here.
 */
export const GildedExploreCaaPage: ContentRecipe<ExploreCaaProps> = ({ data, frame }) => {
  const hook = data.history[0];
  return (
    <Shell frame={frame} banner={<PreviewBanner lifecycle={frame.lifecycle} />}>
      <PageHead eyebrow={CONTENT_COPY.exploreCaa.eyebrow} title={data.venueName} lede={hook ? guestText(hook.statement) : undefined} />

      <Section id="history" number={1} labelledBy="history-title">
        <SectionHeading level={2} id="history-title" title={CONTENT_COPY.exploreCaa.building} />
        <FactList facts={data.history} label="The building, in order" />
        {hook ? <Provenance provenance={hook.provenance} /> : null}
      </Section>

      <Section id="spaces" number={2} ground="alt" labelledBy="spaces-title">
        <SectionHeading level={2} id="spaces-title" title={CONTENT_COPY.exploreCaa.spaces} />
        <Prose>
          <Block block={data.roomsNotConfirmed} />
        </Prose>
        <RoomGrid spaces={data.spaces} />
      </Section>

      <Section id="look-for-this" number={3} labelledBy="look-title">
        <SectionHeading level={2} id="look-title" title={CONTENT_COPY.exploreCaa.lookFor} lede={CONTENT_COPY.exploreCaa.lookForLede} />
        <LookForList items={data.lookForThis.map((f) => ({ id: f.id, text: f.statement }))} label="Look for this" />
      </Section>

      <Section id="outlets" number={4} ground="wash" labelledBy="outlets-title">
        <SectionHeading level={2} id="outlets-title" title={CONTENT_COPY.exploreCaa.outlets} lede={CONTENT_COPY.exploreCaa.outletsLede} />
        <OutletList fields={data.outlets} label="On-property outlets" />
      </Section>

      <Section id="getting-here" number={5} labelledBy="getting-here-title">
        <SectionHeading level={2} id="getting-here-title" title={CONTENT_COPY.exploreCaa.gettingHere} />
        <OutletList fields={data.gettingHere} label="Practical details" />
        <Prose>
          <p className="gh-muted">
            Address: {frame.site.venue.address}. {CONTENT_COPY.exploreCaa.directions} <Link href={ROUTES.wedding}>The Wedding</Link>.
          </p>
        </Prose>
      </Section>
    </Shell>
  );
};
