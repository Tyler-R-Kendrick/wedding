import { Text as Block } from '@/components/provenance';
import { ROUTES } from '@/domain/routes';
import type { AdventureDetailProps, ContentRecipe } from '@/themes/content-types';
import { CONTENT_COPY, adventureFacts } from '@/themes/shared/content';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { kit } from '../kit';

const { Shell, Section, SectionHeading, Prose, Card, content } = kit;
const { PageHead, StatusFlags, MetaList, MemoryCard, RecommendationCard, BackLink } = content;

/**
 * One adventure on the sheet: the memory runs down the left, its facts hang as a specimen card in the
 * mount, the two voices are two pressed cards, and the practical cards follow on a moss wash.
 */
export const ConservatoryAdventureDetailPage: ContentRecipe<AdventureDetailProps> = ({ data, frame }) => {
  const facts = adventureFacts(data);
  return (
    <Shell frame={frame} banner={<PreviewBanner lifecycle={frame.lifecycle} />}>
      <PageHead eyebrow={CONTENT_COPY.adventures.eyebrow} title={data.title} lede={<Block block={data.summary} inline />}>
        <StatusFlags placeholder={data.placeholder} />
      </PageHead>

      <Section id="memory" labelledBy="memory-title">
        <div className="cv-section__text">
          <SectionHeading level={2} id="memory-title" title={CONTENT_COPY.adventureDetail.memory} />
          <MemoryCard memory={data.memory} sara={data.saraMemory} tyler={data.tylerMemory} accessibility={data.accessibilityNotes} provenance={data.provenance} />
        </div>
        {facts.length ? (
          <div className="cv-section__mount">
            <Card label="Specimen" featured index={2} headingLevel={3} title={data.place?.name ?? data.title}>
              <MetaList items={facts.map((f) => ({ label: f.label, value: typeof f.value === 'string' ? f.value : <Block block={f.value.block} inline /> }))} />
            </Card>
          </div>
        ) : null}
      </Section>

      {data.related.length ? (
        <Section id="share" ground="alt" labelledBy="share-title">
          <div className="cv-section__text">
            <SectionHeading level={2} id="share-title" title={CONTENT_COPY.adventureDetail.share} lede={CONTENT_COPY.adventureDetail.shareLede} />
          </div>
          <ul className="cv-section__full cv-mount" aria-label="Related recommendations">
            {data.related.map((r) => (
              <li key={r.id} className="cv-mount__item">
                <RecommendationCard card={r} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section id="back">
        <div className="cv-section__text">
          <Prose>
            <BackLink href={ROUTES.adventures}>{CONTENT_COPY.adventureDetail.back}</BackLink>
          </Prose>
        </div>
      </Section>
    </Shell>
  );
};
