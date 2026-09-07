import { GiftLinkCard } from '@/components/handoff/GiftLinkCard';
import { ROUTES } from '@/domain/routes';
import type { ContentRecipe, GiftsProps } from '@/themes/content-types';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { kit } from '../kit';

const { Shell, Section, SectionHeading, Prose, Placeholder, Link, content } = kit;
const { PageHead } = content;

/**
 * Gifts, Conservatory.
 *
 * Same information architecture as Gilded Hour (see the note there); what differs is the kit —
 * specimen cards and kraft labels rather than plaques — and that this design keeps one washed sheet
 * throughout instead of stepping down the page on alternating grounds.
 */
export const ConservatoryGiftsPage: ContentRecipe<GiftsProps> = ({ data, frame }) => {
  const registry = data.links.filter((l) => l.kind === 'registry');
  const adventures = data.links.filter((l) => l.kind === 'adventure-fund');
  // A section with no configured links is the normal state today: the couple have not chosen a
  // provider, so the page says that rather than naming one. `pending` also drives the closing note.
  const pending = !registry.length || !adventures.length || data.links.some((l) => l.placeholder);
  return (
    <Shell frame={frame} banner={<PreviewBanner lifecycle={frame.lifecycle} />}>
      <PageHead eyebrow={data.copy.eyebrow} title={data.copy.title} lede={data.copy.lede} />

      <Section id="gifts-registry" labelledBy="gifts-registry-title">
        <SectionHeading level={2} id="gifts-registry-title" title={data.copy.registryHeading} />
        <Prose>
          <p>{data.copy.registryIntro}</p>
        </Prose>
        {registry.length ? (
          registry.map((l) => <GiftLinkCard key={l.id} link={l} />)
        ) : (
          <Prose>
            <p>
              <Placeholder block todo={data.copy.registryPending} />
            </p>
          </Prose>
        )}
      </Section>

      <Section id="gifts-adventures" ground="wash" labelledBy="gifts-adventures-title">
        <SectionHeading level={2} id="gifts-adventures-title" title={data.copy.adventureHeading} />
        <Prose>
          <p>{data.copy.adventureIntro}</p>
        </Prose>
        {adventures.length ? (
          adventures.map((l) => <GiftLinkCard key={l.id} link={l} />)
        ) : (
          <Prose>
            <p>
              <Placeholder block todo={data.copy.adventurePending} />
            </p>
          </Prose>
        )}
      </Section>

      <Section id="gifts-note">
        <Prose>
          {/* "Each link opens the provider's own site in a new tab" is false on a page with no
              links, and it ships in the capability response the concierge reads, so it is
              conditional on there being a link rather than always printed. What replaces it is the
              one thing a guest can actually do here while the couple are still deciding. */}
          {data.links.length ? <p>{data.copy.handoffNote}</p> : null}
          {pending ? (
            <p>
              <Placeholder block todo={data.copy.placeholderNote} />
            </p>
          ) : null}
          {pending ? (
            <p>
              {data.copy.askIntro} <Link href={ROUTES.ask}>{data.copy.askLabel}</Link>.
            </p>
          ) : null}
          <p>{data.copy.thanks}</p>
        </Prose>
      </Section>
    </Shell>
  );
};
