import { Text as Block } from '@/components/provenance';
import { ROUTES } from '@/domain/routes';
import type { ContentRecipe, VenueSpaceProps } from '@/themes/content-types';
import { CONTENT_COPY } from '@/themes/shared/content';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { kit } from '../kit';

const { Shell, Section, SectionHeading, Prose, content } = kit;
const { PageHead, LookForList, CapacityTable, Provenance, BackLink } = content;

/** One event space: the docent list first, then what is in the room, then the kit figures as a table. */
export const GildedVenueSpacePage: ContentRecipe<VenueSpaceProps> = ({ data, frame }) => {
  const { space } = data;
  return (
    <Shell frame={frame} banner={<PreviewBanner lifecycle={frame.lifecycle} />}>
      <PageHead eyebrow={CONTENT_COPY.exploreCaa.eyebrow} title={space.name} lede={space.character}>
        <div className="gh-prose">
          <Block block={data.roomsNotConfirmed} />
        </div>
      </PageHead>

      <Section id="look" number={1} labelledBy="look-title">
        <SectionHeading level={2} id="look-title" title={CONTENT_COPY.exploreCaa.roomLookFor} />
        <LookForList items={space.lookForThis.map((text, i) => ({ id: `look-${i}`, text }))} label="Look for this" />
      </Section>

      <Section id="features" number={2} ground="alt" labelledBy="features-title">
        <SectionHeading level={2} id="features-title" title={CONTENT_COPY.exploreCaa.roomFeatures} />
        <Prose>
          <ul className="gh-list">
            {space.features.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </Prose>
      </Section>

      <Section id="capacity" number={3} labelledBy="capacity-title">
        <SectionHeading level={2} id="capacity-title" title={CONTENT_COPY.exploreCaa.roomCapacity} />
        <CapacityTable capacities={space.capacities} />
        <Provenance provenance={space.provenance} freshness />
        <Prose>
          <BackLink href={ROUTES.exploreCaa}>{CONTENT_COPY.exploreCaa.wholeBuilding}</BackLink>
        </Prose>
      </Section>
    </Shell>
  );
};
