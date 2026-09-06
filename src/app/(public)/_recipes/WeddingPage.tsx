import Link from 'next/link';
import type { ReactNode } from 'react';
import { Paragraphs, Text } from '@/components/provenance';
import { formatDateWithWeekday } from '@/domain/content/format';
import type { WeddingPageData } from '@/domain/venue/wedding-page';
import { ROUTES } from '@/domain/routes';
import { Handoff, PageIntro, Provenance, Section, Shell } from './kit';

export interface WeddingRecipeProps {
  data: WeddingPageData;
  /** Swarm J's concierge island, passed in by the page so this recipe stays theme-agnostic. */
  concierge?: ReactNode;
}

export function WeddingPage({ data, concierge }: WeddingRecipeProps) {
  return (
    <Shell current={ROUTES.wedding}>
      <PageIntro eyebrow="The Wedding" title={data.coupleDisplayName} lede={<time dateTime={data.dateIso}>{formatDateWithWeekday(data.dateIso)}</time>}>
        <p>
          {data.venueName}, {data.venueAddress}
        </p>
        {data.directions ? (
          <ul className="wp-handoffs" aria-label="Directions">
            <Handoff handoff={data.directions} />
          </ul>
        ) : null}
      </PageIntro>

      <Section id="dress-code" number="01" title="What to wear">
        <div className="wp-prose">
          <Text block={data.dressCode} />
        </div>
      </Section>

      {data.events.map((e, i) => (
        <Section key={e.id} id={e.id} number={String(i + 2).padStart(2, '0')} title={e.name}>
          <div className="wp-prose">
            <dl className="wp-meta">
              <dt>When</dt>
              <dd>
                <time dateTime={e.dateIso}>{e.weekdayLabel}</time>
                {' · '}
                <Text block={e.timeLabel} inline />
              </dd>
              <dt>Where</dt>
              <dd>
                {data.venueName}
                {' · '}
                <Text block={e.room} inline />
              </dd>
            </dl>
            <Paragraphs blocks={e.whatHappens} />
          </div>
        </Section>
      ))}

      <Section id="rooms" title="About the rooms">
        <div className="wp-prose">
          <Text block={data.roomsNote} />
          <p>
            <Link href={ROUTES.exploreCaa}>Explore the building and its four spaces →</Link>
          </p>
          <Provenance provenance={data.provenance} />
        </div>
      </Section>

      {concierge ? (
        <Section id="concierge" title="Still have a question?">
          <div className="wp-slot" id="concierge-slot" data-slot="concierge">
            {concierge}
          </div>
        </Section>
      ) : null}
    </Shell>
  );
}
