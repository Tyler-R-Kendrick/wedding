import { Text as Block } from '@/components/provenance';
import { ROUTES } from '@/domain/routes';
import type { AdventureDetailProps, ContentRecipe } from '@/themes/content-types';
import { CONTENT_COPY, adventureFacts } from '@/themes/shared/content';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { kit } from '../kit';

const { Shell, Section, SectionHeading, Prose, content } = kit;
const { PageHead, StatusFlags, MetaList, MemoryCard, RecommendationCard, BackLink } = content;

/** One adventure: title plaque with its facts, act 01 the memory (with the diptych), act 02 how to make it yours. */
export const BotanicalAdventureDetailPage: ContentRecipe<AdventureDetailProps> = ({ data, frame }) => (
  <Shell frame={frame} banner={<PreviewBanner lifecycle={frame.lifecycle} />}>
    <PageHead eyebrow={CONTENT_COPY.adventures.eyebrow} title={data.title} lede={<Block block={data.summary} inline />}>
      <StatusFlags placeholder={data.placeholder} />
      <MetaList items={adventureFacts(data).map((f) => ({ label: f.label, value: typeof f.value === 'string' ? f.value : <Block block={f.value.block} inline /> }))} />
    </PageHead>

    <Section id="memory" number={1} labelledBy="memory-title">
      <SectionHeading level={2} id="memory-title" title={CONTENT_COPY.adventureDetail.memory} />
      {data.media.some((m) => m.src) ? (
        <div className="bd-adventure-photos">
          {data.media
            .filter((m): m is typeof m & { src: string } => !!m.src)
            .map((m) => (
              <figure key={m.src} className="bd-adventure-photos__item">
                {/* eslint-disable-next-line @next/next/no-img-element -- couple-supplied photo of unknown size; the kit draws every photo with <img> */}
                <img className="bd-adventure-photos__img" src={m.src} alt={m.alt} loading="lazy" decoding="async" />
                {m.caption ? <figcaption>{m.caption}</figcaption> : null}
              </figure>
            ))}
        </div>
      ) : null}
      <MemoryCard memory={data.memory} sara={data.saraMemory} tyler={data.tylerMemory} accessibility={data.accessibilityNotes} provenance={data.provenance} />
    </Section>

    {data.related.length ? (
      <Section id="share" number={2} ground="alt" labelledBy="share-title">
        <SectionHeading level={2} id="share-title" title={CONTENT_COPY.adventureDetail.share} lede={CONTENT_COPY.adventureDetail.shareLede} />
        <ul className="bd-grid" aria-label="Related recommendations">
          {data.related.map((r) => (
            <li key={r.id}>
              <RecommendationCard card={r} />
            </li>
          ))}
        </ul>
      </Section>
    ) : null}

    <Section id="back">
      <Prose>
        <BackLink href={ROUTES.adventures}>{CONTENT_COPY.adventureDetail.back}</BackLink>
      </Prose>
    </Section>
  </Shell>
);
