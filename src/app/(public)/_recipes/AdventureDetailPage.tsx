import Link from 'next/link';
import { Paragraphs, Placeholder, Text, placeholderHint } from '@/components/provenance';
import type { AdventureDetailData } from '@/capabilities/show_adventure';
import { formatMinutes } from '@/domain/adventures/itineraries';
import { humanize } from '@/domain/content/format';
import { ROUTES } from '@/domain/routes';
import { DraftBadge, PageIntro, Provenance, RecommendationCardView, Section, Shell } from './kit';

export function AdventureDetailPage({ data }: { data: AdventureDetailData }) {
  return (
    <Shell current={ROUTES.adventures}>
      <PageIntro eyebrow="Our Adventures" title={data.title} lede={<Text block={data.summary} inline />}>
        <DraftBadge placeholder={data.placeholder} />
        <dl className="wp-meta">
          {data.place ? (
            <>
              <dt>Where</dt>
              <dd>
                {data.place.name}
                {data.place.city ? `, ${data.place.city}` : ''}
                {data.place.region ? `, ${data.place.region}` : ''}
              </dd>
            </>
          ) : null}
          {data.locationLabel ? (
            <>
              <dt>Where</dt>
              <dd>
                <Text block={data.locationLabel} inline />
              </dd>
            </>
          ) : null}
          {data.dateLabel ? (
            <>
              <dt>When</dt>
              <dd>
                <Text block={data.dateLabel} inline />
              </dd>
            </>
          ) : null}
          {data.season ? (
            <>
              <dt>Season</dt>
              <dd>{humanize(data.season)}</dd>
            </>
          ) : null}
          {data.durationMinutes ? (
            <>
              <dt>How long</dt>
              <dd>{formatMinutes(data.durationMinutes)}</dd>
            </>
          ) : null}
          {data.tags.length ? (
            <>
              <dt>Motifs</dt>
              <dd>{data.tags.map(humanize).join(', ')}</dd>
            </>
          ) : null}
        </dl>
      </PageIntro>

      <Section id="memory" number="01" title="The memory">
        <div className="wp-prose">
          {data.memory.length ? <Paragraphs blocks={data.memory} /> : <Placeholder>{placeholderHint('TODO(Tyler & Sara): this memory has not been written yet.')}</Placeholder>}
          {data.saraMemory || data.tylerMemory ? (
            <div className="wp-remember">
              {data.saraMemory ? (
                <section aria-labelledby="sara-remembers">
                  <h3 id="sara-remembers">Sara remembers</h3>
                  <p>
                    <Text block={data.saraMemory} inline />
                  </p>
                </section>
              ) : null}
              {data.tylerMemory ? (
                <section aria-labelledby="tyler-remembers">
                  <h3 id="tyler-remembers">Tyler remembers</h3>
                  <p>
                    <Text block={data.tylerMemory} inline />
                  </p>
                </section>
              ) : null}
            </div>
          ) : null}
          {data.accessibilityNotes ? (
            <p>
              <strong>Accessibility:</strong> <Text block={data.accessibilityNotes} inline />
            </p>
          ) : null}
          <Provenance provenance={data.provenance} />
        </div>
      </Section>

      {data.related.length ? (
        <Section id="share" number="02" title="Make it yours">
          <p className="wp-prose">If you have the time, here is how to go there yourself. Open &ldquo;Why we&rsquo;re sharing this&rdquo; on any card for the memory behind it.</p>
          <ul className="wp-grid" aria-label="Related recommendations">
            {data.related.map((r) => (
              <li key={r.id}>
                <RecommendationCardView card={r} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <p className="wp-prose">
        <Link href={ROUTES.adventures}>← All adventures</Link>
      </p>
    </Shell>
  );
}
