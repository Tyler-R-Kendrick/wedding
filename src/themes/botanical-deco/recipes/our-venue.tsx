import { Text as Block } from '@/components/provenance';
import { mapsUrlFor } from '@/domain/lifecycle/facts';
import { ROUTES } from '@/domain/routes';
import type { ContentRecipe, OurVenueProps } from '@/themes/content-types';
import { CONTENT_COPY } from '@/themes/shared/content';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { Arrow, kit, PageHero } from '../kit';
import { CityGuide, type CityPin } from '../kit/CityGuide';
import { Reveal } from '../kit/Reveal';
import { Botanical, Photo, firstMedia, mediaItem } from '../media';

const { Shell, Section, SectionHeading, Prose, Button, Link, content } = kit;
const { FactList, RoomGrid, LookForList, OutletList, Provenance } = content;

/**
 * Our Venue. The approved Explore opening (REF-EXPLORE: the couple, the title panel, the theme words)
 * and then a page that unfolds as a guest scrolls, the way Home does: the building, with its
 * introduction and the way into the details pinned beside three real photographs, each whole at its
 * own proportions and each opening out as it arrives; the details on one column line (the cited
 * history, the four event spaces, what to look for, what is open inside, getting here), each
 * rising into place once; then the city right outside the door, and the skyline as the close.
 *
 * The page is about the building first. Chicago follows it rather than sharing the title, because
 * Share an Adventure is where the city lives; here it is the places a short trip from the hotel.
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
      label: 'below',
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

/** Three scales, like Home's: the building wide, the carving narrower, the 1897 engraving tall. */
const VENUE_FRAMES = [
  { id: 'venue.exterior', kicker: 'An icon in the Loop', sizes: '(min-width: 900px) 52vw, 100vw' },
  { id: 'venue.facade', kicker: 'The details', sizes: '(min-width: 900px) 40vw, 82vw' },
  { id: 'venue.historic', kicker: 'As it was', sizes: '(min-width: 900px) 30vw, 64vw' },
] as const;

/** Each jump reads as the heading it lands on, so a guest arriving by it knows they are there. */
const JUMPS = [
  { href: '#history', label: CONTENT_COPY.ourVenue.building },
  { href: '#spaces', label: CONTENT_COPY.ourVenue.spaces },
  { href: '#look-for-this', label: CONTENT_COPY.ourVenue.lookFor },
  { href: '#outlets', label: CONTENT_COPY.ourVenue.outlets },
  { href: '#getting-here', label: CONTENT_COPY.ourVenue.gettingHere },
  { href: '#city', label: 'Chicago' },
];

/**
 * The building: its name, what it is, and the way into the details, pinned while the three
 * photographs come in beside it. On a phone the introduction comes first and the photographs follow,
 * stepped across the width so three pictures read as a sequence rather than a stack of tiles.
 */
function Building({ name, remember }: { name: string; remember: boolean }) {
  return (
    <section className="bd-place" aria-labelledby="venue-title">
      <Botanical id="botanical.edge-left" className="bd-bloom--venue" />
      <div className="bd-place__inner">
        <div className="bd-place__intro">
          <p className="bd-eyebrow">{remember ? 'Where we said “I do”' : 'Where we’ll say “I do”'}</p>
          <h2 id="venue-title" className="bd-h bd-h--2 bd-place__title">
            {name}
          </h2>
          <span className="bd-head__rule" aria-hidden="true" />
          {/* Not the first history fact again: the facts are listed in full just below. */}
          <p className="bd-place__lede">A private athletic club for more than a century, restored as a hotel, with Millennium Park out the windows.</p>
          <nav className="bd-place__index" aria-label="On this page">
            <span className="bd-place__crest" aria-hidden="true">
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
          </nav>
        </div>
        <ul className="bd-place__frames" aria-label="The building">
          {VENUE_FRAMES.map((f) => {
            const item = mediaItem(f.id);
            if (!item) return null;
            return (
              <li key={f.id} className="bd-place__frame">
                <figure>
                  <div className="bd-place__photo" data-reveal="photo">
                    <Photo id={f.id} sizes={f.sizes} />
                  </div>
                  <figcaption data-reveal="">
                    <span className="bd-kicker">{f.kicker}</span>
                    <span className="bd-place__caption">{item.caption}</span>
                  </figcaption>
                </figure>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

export const BotanicalOurVenuePage: ContentRecipe<OurVenueProps> = ({ data, frame }) => {
  const hook = data.history[0];
  const remember = frame.lifecycle.mode === 'remember';
  const skyline = mediaItem('city.skyline');
  const places = cityPlaces();
  const name = data.venueName.replace(/\s+Hotel$/, '');
  return (
    <Shell frame={frame} banner={<PreviewBanner lifecycle={frame.lifecycle} />}>
      <PageHero
        className="bd-pagehero--settle bd-pagehero--column"
        eyebrow={frame.site.coupleDisplayName}
        title={
          <>
            Our <em>Venue</em>
          </>
        }
        sub={['On Michigan Avenue']}
        lede={
          remember
            ? 'The Venetian Gothic landmark on Michigan Avenue where we said “I do,” and the city right outside its doors.'
            : 'A Venetian Gothic landmark on Michigan Avenue, and the place we can’t wait to share with you: its rooms, its history, and the city right outside its doors.'
        }
        photo="couple.hero.explore"
        mobilePhoto="couple.hero.explore.mobile"
        words={['Love', 'peace', 'happiness']}
        actions={
          <Button variant="secondary" href={ROUTES.wedding}>
            The wedding
          </Button>
        }
      />

      <Building name={name} remember={remember} />

      <Section id="history" labelledBy="history-title">
        <div data-reveal="">
          <SectionHeading level={2} id="history-title" eyebrow="Since 1893" title={CONTENT_COPY.ourVenue.building} />
        </div>
        <div data-reveal="list">
          <FactList facts={data.history} label="The building, in order" />
        </div>
        {hook ? <Provenance provenance={hook.provenance} /> : null}
      </Section>

      <Section id="spaces" ground="alt" labelledBy="spaces-title">
        <div data-reveal="">
          <SectionHeading level={2} id="spaces-title" title={CONTENT_COPY.ourVenue.spaces} />
        </div>
        <Prose>
          <Block block={data.roomsNotConfirmed} />
        </Prose>
        <div data-reveal="list">
          <RoomGrid spaces={data.spaces} />
        </div>
      </Section>

      <Section id="look-for-this" labelledBy="look-title">
        <div data-reveal="">
          <SectionHeading level={2} id="look-title" title={CONTENT_COPY.ourVenue.lookFor} lede={CONTENT_COPY.ourVenue.lookForLede} />
        </div>
        <div data-reveal="list">
          <LookForList items={data.lookForThis.map((f) => ({ id: f.id, text: f.statement }))} label="Look for this" />
        </div>
      </Section>

      <Section id="outlets" ground="wash" labelledBy="outlets-title">
        <div data-reveal="">
          <SectionHeading level={2} id="outlets-title" title={CONTENT_COPY.ourVenue.outlets} lede={CONTENT_COPY.ourVenue.outletsLede} />
        </div>
        <div data-reveal="list">
          <OutletList fields={data.outlets} label="On-property outlets" />
        </div>
      </Section>

      <Section id="getting-here" labelledBy="getting-here-title">
        <div data-reveal="">
          <SectionHeading level={2} id="getting-here-title" title={CONTENT_COPY.ourVenue.gettingHere} />
        </div>
        <div data-reveal="list">
          <OutletList fields={data.gettingHere} label="Practical details" />
        </div>
        <Prose>
          <p className="bd-muted">
            Address:{' '}
            <a className="bd-link" href={mapsUrlFor(frame.site.venue.address)} target="_blank" rel="noopener noreferrer">
              {frame.site.venue.address}
              <span className="sr-only">, opens Google Maps</span>
            </a>
            . {CONTENT_COPY.ourVenue.directions} <Link href={ROUTES.wedding}>The Wedding</Link>.
          </p>
        </Prose>
      </Section>

      <section id="city" className="bd-city" aria-labelledby="city-title">
        <div className="bd-city__intro" data-reveal="">
          <p className="bd-eyebrow">Right outside the door</p>
          <h2 id="city-title" className="bd-city__title">
            Chicago
          </h2>
          <p>The places that made us happy, a short trip from the hotel: the river and its bridges, North Pond, and the lakefront by the Adler.</p>
        </div>
        <div data-reveal="">
          <CityGuide places={places.map(({ id, name: n, lat, lon, label }) => ({ id, name: n, lat, lon, label }))} venue={{ name: 'The hotel', lat: 41.8815, lon: -87.6246 }} guide={null}>
            {places.map((p) => (
              <li key={p.id} data-place={p.id} className="bd-cityguide__entry">
                {p.media ? (
                  <div className="bd-cityguide__media">
                    <Photo id={p.media} sizes="(min-width: 1100px) 20vw, (min-width: 768px) 33vw, 100vw" alt="" />
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
        </div>
      </section>

      <section className={`bd-ribbon${skyline ? ' bd-ribbon--photo' : ''}`} aria-labelledby="ribbon-title">
        {skyline ? <Photo id="city.skyline" sizes="100vw" className="bd-ribbon__photo" alt="" /> : <span className="bd-ribbon__drawing" aria-hidden="true" />}
        <div className="bd-ribbon__center" data-reveal="">
          <h2 id="ribbon-title" className="bd-ribbon__title">
            Share an adventure
          </h2>
          <p className="bd-ribbon__sub">More of our favorite places, and how to reach them from the hotel.</p>
        </div>
        <p className="bd-ribbon__action">
          <Button variant="primary" href={ROUTES.share}>
            Our Chicago guide
          </Button>
        </p>
        {remember ? null : (
          <p className="bd-ribbon__script">See you in Chicago</p>
        )}
      </section>

      <Reveal />
    </Shell>
  );
};
