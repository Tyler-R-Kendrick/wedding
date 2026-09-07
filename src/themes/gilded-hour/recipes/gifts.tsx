import { GiftLinkCard } from '@/components/handoff/GiftLinkCard';
import type { ContentRecipe, GiftsProps } from '@/themes/content-types';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { kit } from '../kit';

const { Shell, Section, SectionHeading, Prose, Placeholder, content } = kit;
const { PageHead } = content;

/**
 * Gifts, Gilded Hour.
 *
 * Same information architecture as Conservatory by design — registry, then the adventure fund, then
 * the note about how hand-offs work — because a guest comparing designs should find the page, not
 * learn a new one. What differs is the kit and the grounds: plaques and alternating plates here,
 * pressed cards on one washed sheet there.
 *
 * The page takes no numbered sections: those are reserved for the five acts of the wedding day, and
 * a registry is not one of them.
 */
export const GildedGiftsPage: ContentRecipe<GiftsProps> = ({ data, frame }) => {
  const registry = data.links.filter((l) => l.kind === 'registry');
  const adventures = data.links.filter((l) => l.kind === 'adventure-fund');
  const anyPlaceholder = data.links.some((l) => l.placeholder);
  return (
    <Shell frame={frame} banner={<PreviewBanner lifecycle={frame.lifecycle} />}>
      <PageHead eyebrow={data.copy.eyebrow} title={data.copy.title} lede={data.copy.lede} />

      <Section id="gifts-registry" labelledBy="gifts-registry-title">
        <SectionHeading level={2} id="gifts-registry-title" title={data.copy.registryHeading} />
        <Prose>
          <p>{data.copy.registryIntro}</p>
        </Prose>
        {registry.map((l) => (
          <GiftLinkCard key={l.id} link={l} />
        ))}
      </Section>

      <Section id="gifts-adventures" ground="alt" labelledBy="gifts-adventures-title">
        <SectionHeading level={2} id="gifts-adventures-title" title={data.copy.adventureHeading} />
        <Prose>
          <p>{data.copy.adventureIntro}</p>
        </Prose>
        {adventures.map((l) => (
          <GiftLinkCard key={l.id} link={l} />
        ))}
      </Section>

      <Section id="gifts-note">
        <Prose>
          <p>{data.copy.handoffNote}</p>
          {anyPlaceholder ? (
            <p>
              <Placeholder todo={data.copy.placeholderNote} />
            </p>
          ) : null}
          <p>{data.copy.thanks}</p>
        </Prose>
      </Section>
    </Shell>
  );
};
