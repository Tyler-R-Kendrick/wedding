import { Text as Block } from '@/components/provenance';
import { guestText } from '@/domain/content/text';
import { ROUTES } from '@/domain/routes';
import type { ContentRecipe, VenueSpaceProps } from '@/themes/content-types';
import { CONTENT_COPY } from '@/themes/shared/content';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { kit } from '../kit';

const { Shell, Section, SectionHeading, Prose, Card, content } = kit;
const { PageHead, LookForList, CapacityTable, Provenance, BackLink } = content;

/** One event space: the docent leaf list on the left, the features and the kit figures mounted as pressed cards. */
export const ConservatoryVenueSpacePage: ContentRecipe<VenueSpaceProps> = ({ data, frame }) => {
  const { space } = data;
  return (
    <Shell frame={frame} banner={<PreviewBanner lifecycle={frame.lifecycle} />}>
      <PageHead eyebrow={CONTENT_COPY.exploreCaa.eyebrow} title={space.name} lede={guestText(space.character)} />

      <Section id="look" labelledBy="look-title">
        <div className="cv-section__text">
          <SectionHeading level={2} id="look-title" title={CONTENT_COPY.exploreCaa.roomLookFor} />
          <LookForList items={space.lookForThis.map((text, i) => ({ id: `look-${i}`, text }))} label="Look for this" />
        </div>
        <div className="cv-section__mount">
          <Card label="In the room" featured index={1} headingLevel={2} title={CONTENT_COPY.exploreCaa.roomFeatures}>
            <ul className="cv-list">
              {space.features.map((f, i) => (
                <li key={i}>{guestText(f)}</li>
              ))}
            </ul>
          </Card>
        </div>
      </Section>

      <Section id="capacity" ground="alt" labelledBy="capacity-title">
        <div className="cv-section__text">
          <SectionHeading level={2} id="capacity-title" title={CONTENT_COPY.exploreCaa.roomCapacity} />
          <Prose>
            <Block block={data.roomsNotConfirmed} />
          </Prose>
          <CapacityTable capacities={space.capacities} />
          <Provenance provenance={space.provenance} freshness />
          <Prose>
            <BackLink href={ROUTES.exploreCaa}>{CONTENT_COPY.exploreCaa.wholeBuilding}</BackLink>
          </Prose>
        </div>
      </Section>
    </Shell>
  );
};
