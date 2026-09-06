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
 * Explore CAA on the sheet: field notes for the building, four specimen sheets for the rooms, the
 * docent list as a leaf checklist, jar labels for the outlets and the practical rows.
 */
export const ConservatoryExploreCaaPage: ContentRecipe<ExploreCaaProps> = ({ data, frame }) => {
  const hook = data.history[0];
  return (
    <Shell frame={frame} banner={<PreviewBanner lifecycle={frame.lifecycle} />}>
      <PageHead eyebrow={CONTENT_COPY.exploreCaa.eyebrow} title={data.venueName} lede={hook ? guestText(hook.statement) : undefined} />

      <Section id="history" labelledBy="history-title">
        <div className="cv-section__text">
          <SectionHeading level={2} id="history-title" title={CONTENT_COPY.exploreCaa.building} />
          <FactList facts={data.history} label="The building, in order" />
          {hook ? <Provenance provenance={hook.provenance} /> : null}
        </div>
      </Section>

      <Section id="spaces" ground="alt" labelledBy="spaces-title">
        <div className="cv-section__text">
          <SectionHeading level={2} id="spaces-title" title={CONTENT_COPY.exploreCaa.spaces} />
          <Prose>
            <Block block={data.roomsNotConfirmed} />
          </Prose>
        </div>
        <div className="cv-section__full">
          <RoomGrid spaces={data.spaces} />
        </div>
      </Section>

      <Section id="look-for-this" labelledBy="look-title">
        <div className="cv-section__text">
          <SectionHeading level={2} id="look-title" title={CONTENT_COPY.exploreCaa.lookFor} lede={CONTENT_COPY.exploreCaa.lookForLede} />
        </div>
        <div className="cv-section__mount cv-section__mount--flat">
          <LookForList items={data.lookForThis.map((f) => ({ id: f.id, text: f.statement }))} label="Look for this" />
        </div>
      </Section>

      <Section id="outlets" ground="wash" labelledBy="outlets-title">
        <div className="cv-section__text">
          <SectionHeading level={2} id="outlets-title" title={CONTENT_COPY.exploreCaa.outlets} lede={CONTENT_COPY.exploreCaa.outletsLede} />
        </div>
        <div className="cv-section__full">
          <OutletList fields={data.outlets} label="On-property outlets" />
        </div>
      </Section>

      <Section id="getting-here" labelledBy="getting-here-title">
        <div className="cv-section__text">
          <SectionHeading level={2} id="getting-here-title" title={CONTENT_COPY.exploreCaa.gettingHere} />
        </div>
        <div className="cv-section__full">
          <OutletList fields={data.gettingHere} label="Practical details" />
          <Prose>
            <p className="cv-muted">
              Address: {frame.site.venue.address}. {CONTENT_COPY.exploreCaa.directions} <Link href={ROUTES.wedding}>The Wedding</Link>.
            </p>
          </Prose>
        </div>
      </Section>
    </Shell>
  );
};
