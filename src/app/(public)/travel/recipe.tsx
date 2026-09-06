import type { ReactNode } from 'react';
import { WEDDING_DATE_ISO } from '@/contracts/lifecycle';
import type { Citation } from '@/contracts/provenance';
import { Placeholder } from '@/components/provenance/Placeholder';
import { formatLongDate, type HotelRecommendation } from '@/domain/travel';
import type { PageRecipe } from './_shared/recipe';
import { HandoffLink } from './handoff';

export interface TravelPageData {
  venue: HotelRecommendation;
  alternatives: HotelRecommendation[];
  facts: {
    venue: { name: string; address: string; url: string; faqUrl: string; valetEntrance: string; valetNote: string; valetPending: string | null };
    airports: { code: string; name: string; note: string | null; pending: string | null }[];
  };
  sources: Citation[];
  viewer: { kind: 'anonymous' | 'guest' | 'admin' | 'system'; hasProfile: boolean };
}

export interface TravelPageSlots {
  flightSearch: ReactNode;
  hotelSearch: ReactNode;
}

/*
 * Widths are explicit rem values, not `max-w-3xl` / `max-w-4xl`.
 *
 * Tailwind v4 resolves `max-w-<name>` against `--container-<name>`, and this project's generated
 * `@theme` block (from DESIGN.md) defines no container scale — so those utilities fell through to
 * the SPACING scale, and `max-w-3xl` computed to `--spacing-3xl`, 96px. The whole public travel
 * page rendered 96px wide at every viewport. Swarm F wrote these pages against stock Tailwind
 * before level 04 generated the token scale, so the class names looked right and meant something
 * else. 46rem is the measure `recipes.css` uses for a page; 60rem is the wider admin measure.
 */
const mapsUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

/**
 * A gap is deliberately visible — the couple fills it in, we never guess — but it reads as
 * editorial, not as a bug with `TODO(...)` printed on it. This used to render the raw authoring
 * marker on a PUBLIC page, and to reach it the recipe was doing string surgery on the record
 * (`note.replace(/TODO\(Tyler & Sara\):.*$/, '')`). The split between a confirmed fact and a
 * pending one now lives in the record (`domain/travel/facts.ts`), so this just renders it.
 */
function Todo({ children }: { children: ReactNode }) {
  return <Placeholder inline>{children}</Placeholder>;
}

function Section({ id, title, eyebrow, children }: { id: string; title: string; eyebrow?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="border-t border-primary/20 py-10">
      {eyebrow ? <p className="text-sm uppercase tracking-wide text-primary/70">{eyebrow}</p> : null}
      <h2 id={`${id}-title`} className="mt-1 text-2xl font-semibold">
        {title}
      </h2>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

function BlockCard({ venue }: { venue: HotelRecommendation }) {
  const block = venue.block;
  const placeholder = !block || block.placeholder;
  return (
    <article aria-labelledby="block-title" className="rounded-sm border border-primary/30 p-5">
      <h3 id="block-title" className="text-xl font-semibold">
        {venue.name}
      </h3>
      {venue.address ? (
        <p className="mt-1">
          <a className="underline underline-offset-4" href={mapsUrl(venue.address)} target="_blank" rel="noopener noreferrer external">
            {venue.address}
            <span className="sr-only"> (opens in Google Maps, new tab)</span>
          </a>
        </p>
      ) : null}
      <p className="mt-3">The wedding is here, so staying here means no travel on the day.</p>
      {block?.note ? <p className="mt-2">{block.note}</p> : null}
      <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-primary/70">Group rate</dt>
          <dd>{block?.rateText ?? <Todo>the group rate</Todo>}</dd>
        </div>
        <div>
          <dt className="text-sm text-primary/70">Book by</dt>
          <dd>{block?.cutoff ? formatLongDate(block.cutoff) : <Todo>the date to book by</Todo>}</dd>
        </div>
        <div>
          <dt className="text-sm text-primary/70">Block dates</dt>
          <dd>{block?.checkIn && block?.checkOut ? `${formatLongDate(block.checkIn)} to ${formatLongDate(block.checkOut)}` : <Todo>the block dates</Todo>}</dd>
        </div>
        <div>
          <dt className="text-sm text-primary/70">Booking code</dt>
          <dd>{block?.code ?? <Todo>the booking code or link</Todo>}</dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-col gap-2">
        {block?.url ? (
          <HandoffLink handoff={{ provider: 'hotel', label: 'Book in the wedding block', url: block.url, opensNewTab: true, disclosure: '' }} />
        ) : venue.websiteUrl ? (
          <HandoffLink handoff={{ provider: 'chicagoathletichotel.com', label: 'Visit the hotel website', url: venue.websiteUrl, opensNewTab: true, disclosure: '' }} />
        ) : null}
        <p className="text-sm text-primary/80">
          {placeholder ? 'The block link is not live yet; the hotel website shows standard rates. We never see your payment details.' : 'You will book directly with the hotel. We never see your payment details.'}
        </p>
      </div>
      <p className="mt-3 text-sm text-primary/70">Last checked {formatLongDate(venue.verifiedAt.slice(0, 10))}.</p>
    </article>
  );
}

function HotelCard({ hotel }: { hotel: HotelRecommendation }) {
  const link = hotel.bookingUrl ?? hotel.websiteUrl;
  return (
    <li className="rounded-sm border border-primary/20 p-5">
      <h3 className="text-lg font-semibold">{hotel.name}</h3>
      {hotel.address ? (
        <p className="mt-1 text-primary/80">
          <a className="underline underline-offset-4" href={mapsUrl(hotel.address)} target="_blank" rel="noopener noreferrer external">
            {hotel.address}
            <span className="sr-only"> (opens in Google Maps, new tab)</span>
          </a>
        </p>
      ) : null}
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {hotel.walkMinutesToVenue !== null ? <span>{hotel.walkMinutesToVenue} min walk to the CAA</span> : null}
        {hotel.priceBand ? <span>Price band {hotel.priceBand}</span> : null}
        {hotel.freshness !== 'fresh' ? <span>Last checked {formatLongDate(hotel.verifiedAt.slice(0, 10))}</span> : null}
      </p>
      {hotel.reasons.length ? (
        <ul className="mt-3 list-disc pl-5">
          {hotel.reasons.map((r, i) => (
            <li key={i}>{r.text}</li>
          ))}
        </ul>
      ) : null}
      {hotel.placeholder ? (
        <p className="mt-3">
          <Todo>the details for this one</Todo>
        </p>
      ) : null}
      {link ? (
        <div className="mt-4">
          <HandoffLink handoff={{ provider: 'hotel', label: hotel.bookingUrl ? `Book ${hotel.name}` : `Visit ${hotel.name}`, url: link, opensNewTab: true, disclosure: '' }} />
        </div>
      ) : null}
    </li>
  );
}

export const TravelPageRecipe: PageRecipe<TravelPageData, TravelPageSlots> = ({ data, slots }) => {
  const { venue, alternatives, facts, viewer } = data;
  return (
    <main id="main" className="mx-auto max-w-[46rem] px-4 pb-16 pt-10">
      <header>
        <p className="text-sm uppercase tracking-wide text-primary/70">Travel &amp; Stay</p>
        <h1 className="mt-1 text-4xl font-semibold">Getting to Chicago</h1>
        <p className="mt-3 max-w-prose">
          We are getting married on {formatLongDate(WEDDING_DATE_ISO)} at the {facts.venue.name}. Here is how to get here and where to sleep, with links that always take you to the airline or hotel to book. We never handle payments.
        </p>
        <nav aria-label="On this page" className="mt-4">
          <ul className="flex flex-wrap gap-x-4 gap-y-2 text-base">
            <li><a className="underline underline-offset-4" href="#airports">Airports</a></li>
            <li><a className="underline underline-offset-4" href="#stay">Where to stay</a></li>
            <li><a className="underline underline-offset-4" href="#flights">Flights</a></li>
            <li><a className="underline underline-offset-4" href="#hotel-rates">Hotel rates</a></li>
            <li><a className="underline underline-offset-4" href="#getting-around">Getting around</a></li>
          </ul>
        </nav>
      </header>

      <Section id="airports" eyebrow="Fly in" title="Two airports serve Chicago">
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {facts.airports.map((a) => (
            <li key={a.code} className="rounded-sm border border-primary/20 p-4">
              <p className="text-2xl font-semibold tabular-nums">{a.code}</p>
              <p>{a.name}</p>
            </li>
          ))}
        </ul>
        <p>
          <Todo>{facts.airports[0]?.pending}</Todo>
        </p>
      </Section>

      <Section id="stay" eyebrow="Sleep" title="Where to stay">
        <BlockCard venue={venue} />
        <h3 className="mt-4 text-xl font-semibold">Nearby, hand-picked</h3>
        {alternatives.length ? (
          <ul className="flex flex-col gap-4">
            {alternatives.map((h) => (
              <HotelCard key={h.id} hotel={h} />
            ))}
          </ul>
        ) : (
          <p>
            We are still confirming a few nearby options at different prices. <Todo>which hotels we recommend nearby</Todo>
          </p>
        )}
        <p className="text-sm text-primary/80">We list why we picked each place (walk time, staffed desk, family suites, price, step-free route, transit). We do not rate safety; please use your own judgement.</p>
      </Section>

      <Section id="flights" eyebrow="Compare" title="Search flights">
        {slots.flightSearch}
      </Section>

      <Section id="hotel-rates" eyebrow="Compare" title="Check hotel rates">
        {slots.hotelSearch}
      </Section>

      <Section id="getting-around" eyebrow="Arrive" title="Getting around">
        <p>
          Valet entrance: {facts.venue.valetEntrance}. {facts.venue.valetNote}{' '}
          {facts.venue.valetPending ? <Todo>{facts.venue.valetPending}</Todo> : null}
        </p>
        <p>
          Accessibility and transit directions are on the{' '}
          <a className="underline underline-offset-4" href={facts.venue.faqUrl} target="_blank" rel="noopener noreferrer external">
            hotel&rsquo;s FAQ page<span className="sr-only"> (opens in a new tab)</span>
          </a>
          . Last checked {formatLongDate(venue.verifiedAt.slice(0, 10))}.
        </p>
      </Section>

      <Section id="your-trip" eyebrow="Keep track" title="Your trip">
        {viewer.kind === 'guest' ? (
          <p>
            Keep your flights and hotel in one place on{' '}
            <a className="underline underline-offset-4" href="/trip">
              your trip page
            </a>
            {viewer.hasProfile ? ', which already knows your preferred airport.' : '.'}
          </p>
        ) : (
          <p>Once you have claimed your invitation, you can keep your flights and hotel on a trip page and we will suggest things to do in your free time.</p>
        )}
      </Section>

      <footer className="border-t border-primary/20 pt-6 text-sm text-primary/70">
        <p>Based on: {data.sources.map((s) => s.title).join(' · ')}.</p>
      </footer>
    </main>
  );
};
