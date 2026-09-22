import { Text as Block } from '@/components/provenance';
import { guestText } from '@/domain/content/text';
import { mapsUrlFor } from '@/domain/lifecycle/facts';
import { ROUTES } from '@/domain/routes';
import type { ContentRecipe, ExploreCaaProps } from '@/themes/content-types';
import { CONTENT_COPY } from '@/themes/shared/content';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { Arrow, kit, More, PageHero } from '../kit';
import { CityGuide, type CityPin } from '../kit/CityGuide';
import { Botanical, Photo, firstMedia, mediaItem } from '../media';

const { Shell, Section, SectionHeading, Prose, Button, Link, content } = kit;
const { FactList, RoomGrid, LookForList, OutletList, Provenance } = content;

/**
 * Explore CAA + Chicago, as approved (REF-EXPLORE): the shorter couple opening; the venue told by
 * three real photographs of the building and a dusty-blue panel that jumps into the details; the
 * deep-blue Chicago band with three of Sara and Tyler's favorite places and a map drawn to scale;
 * the details layer (cited history, the four event spaces, what to look for, what is open in the
 * building, getting here); and the skyline ribbon.
 *
 * Corrected in place: the approved image captioned two generated rooms as "The Ceremony" and "The
 * Celebration" at the CAA. No room is assigned yet and a plausible ballroom is not evidence, so the
 * three frames are real photographs of the building with true captions, and the spaces are named
 * as venue examples further down.
 */

interface CityPlace extends CityPin {
  /** Why they share it: their preference, never a claim about times or access. */
  why: string;
  directions: string;
  /** Media slots, first available wins; a place with no true picture is listed without one. */
  media?: string[];
}

/** The couple's confirmed Chicago favorites (handoff: river and bridges, North Pond, the lakefront by the Adler). */
function cityPlaces(): CityPlace[] {
  const tile = (ids: string[]) => (firstMedia(ids) ? ids : undefined);
  return [
    {
      id: 'riverwalk',
      name: 'The Riverwalk',
      why: 'Walk the river under its bridges, right in the Loop. A true Chicago favorite of ours.',
      lat: 41.8877,
      lon: -87.628,
      directions: mapsUrlFor('Chicago Riverwalk, Chicago, IL'),
      media: tile(['city.riverwalk', 'city.river']),
    },
    {
      // The pond in Lincoln Park — not North Pond the restaurant, which is a different place.
      id: 'north-pond',
      name: 'North Pond',
      why: 'The pond in Lincoln Park, with the skyline over the trees.',
      lat: 41.9296,
      lon: -87.6368,
      directions: mapsUrlFor('North Pond Nature Sanctuary, Lincoln Park, Chicago, IL'),
      media: tile(['city.north-pond']),
    },
    {
      id: 'lakefront-adler',
      name: 'Lake Michigan + the Adler',
      why: 'The lakefront by the Adler Planetarium, with the whole skyline across the water.',
      lat: 41.8663,
      lon: -87.6068,
      directions: mapsUrlFor('Adler Planetarium, 1300 S DuSable Lake Shore Dr, Chicago, IL'),
      media: tile(['city.lakefront-adler']),
    },
  ];
}

const VENUE_FRAMES = [
  { id: 'venue.exterior', kicker: 'An icon in the Loop' },
  { id: 'venue.facade', kicker: 'The details' },
  { id: 'venue.historic', kicker: 'In 1897' },
] as const;

const JUMPS = [
  { href: '#spaces', label: 'The event spaces' },
  { href: '#history', label: 'The building’s history' },
  { href: '#look-for-this', label: 'What to look for' },
  { href: '#outlets', label: 'Food and drink inside' },
  { href: '#getting-here', label: 'Location and access' },
];

export const BotanicalExploreCaaPage: ContentRecipe<ExploreCaaProps> = ({ data, frame }) => {
  const hook = data.history[0];
  const skyline = mediaItem('city.skyline');
  const places = cityPlaces();
  return (
    <Shell frame={frame} banner={<PreviewBanner lifecycle={frame.lifecycle} />}>
      <PageHero
        eyebrow={frame.site.coupleDisplayName}
        title={
          <>
            Explore <br />
            <em>
              CAA <span className="bd-plus">+</span> Chicago
            </em>
          </>
        }
        sub={['Iconic places. Meaningful moments.', 'A weekend to remember.']}
        lede="From a historic landmark to a world-class city: the places we can’t wait to share with you."
        photo="couple.hero.explore"
        mobilePhoto="couple.hero.explore.mobile"
        words={['Same', 'people', 'a bigger', 'Chicago', 'adventure']}
        actions={
          <Button variant="secondary" href={ROUTES.wedding}>
            See the weekend
          </Button>
        }
      />

      <section className="bd-venue" aria-labelledby="venue-title">
        <div className="bd-venue__intro">
          <Botanical id="botanical.edge-left" className="bd-bloom--venue" />
          <p className="bd-eyebrow">The venue</p>
          <h2 id="venue-title" className="bd-h bd-h--2 bd-venue__title">
            {data.venueName.replace(/\s+Hotel$/, '')}
          </h2>
          <p className="bd-caps bd-venue__tag">History lives here</p>
          {hook ? <p className="bd-venue__lede">{guestText(hook.statement)} Venetian Gothic on Michigan Avenue, restored as a hotel, in the heart of downtown.</p> : null}
          <More href="#history">Explore the venue</More>
        </div>
        <ul className="bd-venue__frames" aria-label="The building">
          {VENUE_FRAMES.map((f) => {
            const item = mediaItem(f.id);
            if (!item) return null;
            return (
              <li key={f.id} className="bd-venue__frame">
                <figure>
                  <Photo id={f.id} sizes="(min-width: 1100px) 19vw, (min-width: 768px) 33vw, 100vw" />
                  <figcaption>
                    <span className="bd-kicker">{f.kicker}</span>
                    <span className="bd-venue__caption">{item.caption}</span>
                  </figcaption>
                </figure>
              </li>
            );
          })}
        </ul>
        <nav className="bd-venue__jump" aria-label="On this page">
          <span className="bd-venue__crest" aria-hidden="true">
            CAA
          </span>
          <ul>
            {JUMPS.map((j) => (
              <li key={j.href}>
                <a href={j.href}>
                  <span>{j.label}</span>
                  <Arrow />
                </a>
              </li>
            ))}
          </ul>
          <p className="bd-venue__words" aria-hidden="true">
            Good people · beautiful places · great love
          </p>
        </nav>
      </section>

      <section className="bd-city" aria-labelledby="city-title">
        <div className="bd-city__intro">
          <p className="bd-eyebrow">A weekend in</p>
          <h2 id="city-title" className="bd-city__title">
            Chicago
          </h2>
          <p>World-class food, iconic views, and a lake like a sea. Here are a few of our favorite places to explore while you’re in town.</p>
          <span className="bd-city__skyline" aria-hidden="true" />
        </div>
        <CityGuide
          places={places.map(({ id, name, lat, lon }) => ({ id, name, lat, lon }))}
          venue={{ name: 'The hotel', lat: 41.8815, lon: -87.6246 }}
          guide={
            <p className="bd-citymap__guide">
              <Button variant="secondary" href={ROUTES.share}>
                Our Chicago guide
              </Button>
            </p>
          }
        >
          {places.map((p) => (
            <li key={p.id} data-place={p.id} className="bd-cityguide__entry">
              {p.media ? (
                <div className="bd-cityguide__media">
                  <Photo id={p.media} sizes="(min-width: 1100px) 17vw, (min-width: 768px) 33vw, 100vw" alt="" />
                </div>
              ) : null}
              <div className="bd-cityguide__body">
                <h3 className="bd-cityguide__name">{p.name}</h3>
                <p className="bd-cityguide__why">{p.why}</p>
                <a className="bd-cityguide__go" href={p.directions} target="_blank" rel="noopener noreferrer">
                  <span>Directions</span>
                  <span className="sr-only">{` to ${p.name}, opens Google Maps`}</span>
                  <Arrow />
                </a>
              </div>
            </li>
          ))}
        </CityGuide>
      </section>

      <section className={`bd-ribbon${skyline ? ' bd-ribbon--photo' : ''}`} aria-labelledby="ribbon-title">
        {skyline ? <Photo id="city.skyline" sizes="100vw" className="bd-ribbon__photo" alt="" /> : <span className="bd-ribbon__drawing" aria-hidden="true" />}
        <p className="bd-ribbon__words" aria-hidden="true">
          <span>Chicago</span> <span>people</span> <span>love</span> <span>brighter together</span>
        </p>
        <div className="bd-ribbon__center">
          <h2 id="ribbon-title" className="bd-ribbon__title">
            Save an adventure
          </h2>
          <p className="bd-ribbon__sub">Wedding weekend · Chicago exploration · Lifelong memories</p>
        </div>
        <p className="bd-ribbon__action">
          <Button variant="primary" href={ROUTES.share}>
            See our full guide
          </Button>
        </p>
        <p className="bd-ribbon__script" aria-hidden="true">
          Same people, brighter together
        </p>
      </section>

      <Section id="history" labelledBy="history-title">
        <SectionHeading level={2} id="history-title" eyebrow="Details" title={CONTENT_COPY.exploreCaa.building} />
        <FactList facts={data.history} label="The building, in order" />
        {hook ? <Provenance provenance={hook.provenance} /> : null}
      </Section>

      <Section id="spaces" ground="alt" labelledBy="spaces-title">
        <SectionHeading level={2} id="spaces-title" title={CONTENT_COPY.exploreCaa.spaces} />
        <Prose>
          <Block block={data.roomsNotConfirmed} />
        </Prose>
        <RoomGrid spaces={data.spaces} />
      </Section>

      <Section id="look-for-this" labelledBy="look-title">
        <SectionHeading level={2} id="look-title" title={CONTENT_COPY.exploreCaa.lookFor} lede={CONTENT_COPY.exploreCaa.lookForLede} />
        <LookForList items={data.lookForThis.map((f) => ({ id: f.id, text: f.statement }))} label="Look for this" />
      </Section>

      <Section id="outlets" ground="wash" labelledBy="outlets-title">
        <SectionHeading level={2} id="outlets-title" title={CONTENT_COPY.exploreCaa.outlets} lede={CONTENT_COPY.exploreCaa.outletsLede} />
        <OutletList fields={data.outlets} label="On-property outlets" />
      </Section>

      <Section id="getting-here" labelledBy="getting-here-title">
        <SectionHeading level={2} id="getting-here-title" title={CONTENT_COPY.exploreCaa.gettingHere} />
        <OutletList fields={data.gettingHere} label="Practical details" />
        <Prose>
          <p className="bd-muted">
            Address: {frame.site.venue.address}. {CONTENT_COPY.exploreCaa.directions} <Link href={ROUTES.wedding}>The Wedding</Link>.
          </p>
        </Prose>
      </Section>

    </Shell>
  );
};
