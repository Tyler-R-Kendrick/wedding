import Link from 'next/link';
import { Text } from '@/components/provenance';
import type { ExploreCaaPageData } from '@/capabilities/get_venue_facts';
import { ROUTES } from '@/domain/routes';
import { OperationalRow, PageIntro, Provenance, Section, Shell } from './kit';

export function ExploreCaaPage({ data }: { data: ExploreCaaPageData }) {
  const hook = data.history[0];
  return (
    <Shell current={ROUTES.exploreCaa}>
      <PageIntro eyebrow="Explore CAA" title={data.venueName} lede={hook ? hook.statement : undefined} />

      <Section id="history" number="01" title="The building">
        <div className="wp-prose">
          <ul className="wp-bullets">
            {data.history.map((f) => (
              <li key={f.id} id={`fact-${f.slug}`}>
                {f.statement}
              </li>
            ))}
          </ul>
          {data.history[0] ? <Provenance provenance={data.history[0].provenance} /> : null}
        </div>
      </Section>

      <Section id="spaces" number="02" title="The spaces">
        <div className="wp-prose">
          <Text block={data.roomsNotConfirmed} />
        </div>
        <ul className="wp-grid" aria-label="Event spaces">
          {data.spaces.map((s) => (
            <li key={s.id}>
              <article className="wp-card" data-space={s.slug}>
                <h3>
                  <Link href={s.href}>{s.name}</Link>
                </h3>
                <p>{s.character}</p>
                <p className="wp-muted">{s.capacities.note}</p>
              </article>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="look-for-this" number="03" title="Look for this">
        <div className="wp-prose">
          <p>A self-guided list for the hour before things start. The rooms have their own lists on their pages.</p>
          <ul className="wp-bullets">
            {data.lookForThis.map((f) => (
              <li key={f.id}>{f.statement}</li>
            ))}
          </ul>
        </div>
      </Section>

      <Section id="outlets" number="04" title="Eat and drink without leaving">
        <p className="wp-prose">
          These are the hotel&rsquo;s own places as listed on its website. Hours and menus change, so each link shows the day we last checked it; confirm with the official page before you plan around it.
        </p>
        <ul className="wp-grid" aria-label="On-property outlets">
          {data.outlets.map((o) => (
            <OperationalRow key={o.id} field={o} />
          ))}
        </ul>
      </Section>

      <Section id="getting-here" number="05" title="Getting here, parking, accessibility">
        <ul className="wp-grid" aria-label="Practical details">
          {data.gettingHere.map((o) => (
            <OperationalRow key={o.id} field={o} />
          ))}
        </ul>
        <p className="wp-prose wp-muted">
          Address: 12 S Michigan Ave, Chicago, IL 60603. Directions are on <Link href={ROUTES.wedding}>The Wedding</Link>.
        </p>
      </Section>
    </Shell>
  );
}
