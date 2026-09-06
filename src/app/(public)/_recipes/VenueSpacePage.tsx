import Link from 'next/link';
import { Text } from '@/components/provenance';
import type { VenueRoomData } from '@/capabilities/show_venue_room';
import { ROUTES } from '@/domain/routes';
import { PageIntro, Provenance, Section, Shell } from './kit';

export function VenueSpacePage({ data }: { data: VenueRoomData }) {
  const { space } = data;
  return (
    <Shell current={ROUTES.exploreCaa}>
      <PageIntro eyebrow="Explore CAA" title={space.name} lede={space.character} />
      <div className="wp-prose">
        <Text block={data.roomsNotConfirmed} />
      </div>

      <Section id="look" number="01" title="Look for this">
        <ul className="wp-bullets">
          {space.lookForThis.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </Section>

      <Section id="features" number="02" title="What is in the room">
        <ul className="wp-bullets">
          {space.features.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      </Section>

      <Section id="capacity" number="03" title="Capacity (from the venue kit)">
        <div className="wp-scroll">
          <table className="wp-table">
            <caption className="wp-muted">{space.capacities.note}</caption>
            <thead>
              <tr>
                <th scope="col">Ceremony</th>
                <th scope="col">Dinner and dancing</th>
                <th scope="col">Reception</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{space.capacities.ceremony ?? '—'}</td>
                <td>{space.capacities.dinnerDance ?? '—'}</td>
                <td>{space.capacities.reception ?? '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <Provenance provenance={space.provenance} freshness />
      </Section>

      <p className="wp-prose">
        <Link href={ROUTES.exploreCaa}>← Explore the whole building</Link>
      </p>
    </Shell>
  );
}
