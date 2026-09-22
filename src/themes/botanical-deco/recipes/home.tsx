import { Placeholder } from '@/components/provenance';
import { placeholderTimeline } from '@/themes/shared/home-content';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import type { HomeData, HomeSection } from '@/themes/types';
import { DecoFrame, kit, More } from '../kit';
import { dateParts } from '../kit/content';
import { Botanical, Photo } from '../media';

const { Shell, Hero, Button, Stat, Timeline, MapHandoff, Text, Countdown } = kit;

/**
 * Home, as approved (REF-HOME): the riverfront portrait opening; an asymmetric editorial strip of
 * four different jobs — a welcome, the story, the building, the city — at four different widths;
 * a band that joins the moss schedule, a second portrait and the gallery invitation; then the light
 * architectural footer. No feature cards, no numbered acts.
 *
 * What the approved image said that was not true is corrected in place, keeping the slot: the
 * story entry says where they met (a wedding) instead of "college days"; the schedule lists the
 * parts of the one confirmed day instead of an invented welcome party and brunch; the venue tile is
 * a real photograph of the building instead of a generated room. docs/design/approved-botanical-deco/
 * parity-exceptions.json lists each one.
 */

const ROUTES = { story: '/our-story', caa: '/explore-caa', guide: '/share-an-adventure', wedding: '/the-wedding', photos: '/photos' } as const;

function Strip({ data }: { data: HomeData }) {
  return (
    <section className="bd-strip" aria-label="Welcome">
      <div className="bd-strip__welcome">
        <Botanical id="botanical.edge-left" className="bd-bloom--strip" />
        <p className="bd-eyebrow">Welcome</p>
        <h2 className="bd-h bd-h--2 bd-strip__headline">
          Same people. <br />A bigger chapter.
        </h2>
        <p className="bd-strip__text">
          A weekend in {data.site.venue.city}, with our favorite people. The day, the building, the city and getting here are gathered on this site, and fill in as each detail is settled.
        </p>
        {/* A line for the weeks before the weekend; after it (mode "remember") there is nobody to see there. */}
        {data.lifecycle.mode === 'remember' ? null : (
          <p className="bd-script bd-strip__sign" aria-hidden="true">
            See you in Chicago
          </p>
        )}
      </div>

      <article className="bd-strip__tile bd-strip__tile--story">
        <Photo id="couple.story.monochrome" sizes="(min-width: 1100px) 21vw, (min-width: 768px) 50vw, 100vw" className="bd-strip__photo bd-strip__photo--mono" />
        <div className="bd-strip__body">
          <p className="bd-eyebrow">Our story</p>
          <h2 className="bd-strip__title">How it all started</h2>
          <p>At Allison and Jamie’s wedding: flirty glances across the room, and a connection that was immediate.</p>
          <More href={ROUTES.story}>Read our story</More>
        </div>
      </article>

      <article className="bd-strip__tile bd-strip__tile--venue">
        <Photo id={['venue.exterior', 'venue.facade']} sizes="(min-width: 1100px) 23vw, (min-width: 768px) 50vw, 100vw" className="bd-strip__photo" />
        <div className="bd-strip__body">
          <p className="bd-eyebrow">The venue</p>
          <h2 className="bd-strip__title bd-italic">Chicago Athletic Association</h2>
          <p>Venetian Gothic on Michigan Avenue since 1893, restored as a hotel. {data.lifecycle.mode === 'remember' ? 'Where we said “I do.”' : 'Where we will say “I do.”'}</p>
          <More href={ROUTES.caa}>Explore the venue</More>
        </div>
      </article>

      <article className="bd-strip__tile bd-strip__tile--city">
        <Photo id={['city.riverwalk', 'city.river', 'venue.facade']} sizes="(min-width: 1100px) 27vw, (min-width: 768px) 50vw, 100vw" className="bd-strip__photo" />
        <Botanical id="botanical.edge-right" className="bd-bloom--strip-right" />
        <div className="bd-strip__body">
          <p className="bd-eyebrow">Explore Chicago</p>
          <h2 className="bd-strip__title">A city we love</h2>
          <p>The river and its bridges, North Pond, the lakefront by the Adler: a few of our favorite places, and how to reach them.</p>
          <More href={ROUTES.guide}>Get our guide</More>
        </div>
      </article>
    </section>
  );
}

/**
 * The moss schedule. The approved image listed a welcome party on the 16th and a brunch on the 18th;
 * neither is confirmed, so the rows carry the one day that is — its date derived from the date
 * itself — and its three parts, each with only what is settled about it. What is not settled (the
 * times and the rooms) is one typed placeholder under the list, not a prose note per row that
 * would read as finished copy.
 */
function Schedule({ data }: { data: HomeData }) {
  const parts = placeholderTimeline();
  const day = dateParts(data.site.date.iso);
  const notes: Record<string, string> = { ceremony: 'Indoors, at the hotel', 'cocktail-hour': 'Between the two', reception: 'Dinner, toasts, dancing' };
  return (
    <div className="bd-schedule">
      <DecoFrame />
      <div className="bd-schedule__intro">
        <p className="bd-eyebrow">Wedding weekend</p>
        <h2 className="bd-h bd-h--2 bd-schedule__title" id="schedule-title">
          A weekend <br />
          to remember
        </h2>
        <p>A ceremony, dinner, toasts and dancing, all on one Saturday.</p>
        <More href={ROUTES.wedding}>See the full schedule</More>
      </div>
      {data.content.showCountdown ? (
        <div className="bd-schedule__count">
          <Countdown {...data.countdown} />
        </div>
      ) : null}
      <div className="bd-schedule__day-block">
        {/* One date for the one confirmed day, with its weekday derived from the date itself. */}
        <time className="bd-schedule__day" dateTime={data.site.date.iso}>
          <span className="sr-only">{day.long}</span>
          <span aria-hidden="true">{day.weekday}</span>
          <span aria-hidden="true">
            {day.month} {day.day}
          </span>
        </time>
        <ol className="bd-schedule__list" aria-label={`${day.long}, in order`}>
          {parts.map((p) => (
            <li key={p.id} className="bd-schedule__row">
              <span className="bd-schedule__name">{p.name}</span>
              {notes[p.id] ? <span className="bd-schedule__note">{notes[p.id]}</span> : null}
            </li>
          ))}
        </ol>
      </div>
      <p className="bd-schedule__todo">
        <Placeholder inline>the times and the rooms.</Placeholder>
      </p>
    </div>
  );
}

function Band({ data }: { data: HomeData }) {
  return (
    <section className="bd-band" aria-labelledby="schedule-title">
      <Schedule data={data} />
      <figure className="bd-band__photo">
        <Photo id="couple.lakefront" sizes="(min-width: 1100px) 30vw, 100vw" />
        <figcaption className="bd-band__script" aria-hidden="true">
          Better together
        </figcaption>
      </figure>
      <div className="bd-band__gallery">
        <div className="bd-band__gallery-text">
          <p className="bd-eyebrow">Gallery</p>
          <h2 className="bd-strip__title">Our memories</h2>
          <p>A few of our favorite moments so far, and many more to come.</p>
          <More href={ROUTES.photos}>View gallery</More>
        </div>
        {/* The approved still life of white flowers: no gallery photographs exist yet, so the slot
            keeps its size and holds a painted sprig from the same set (PX-08). */}
        <figure className="bd-band__still" aria-hidden="true">
          <Botanical id="botanical.cluster-tl" className="bd-bloom--still" />
        </figure>
        <p className="bd-band__words" aria-hidden="true">
          <span>Same</span> <span>adventure</span> <span>always</span>
        </p>
      </div>
    </section>
  );
}

/**
 * Whatever this lifecycle state needs a guest to know that the approved composition has no slot
 * for — the RSVP line, the day's running order on the day itself, a ride home — as a quiet index
 * under the band, never as a second hero. Each keeps its anchor (`/#now` is the phone bar's "Now").
 */
/** Sections the strip above already is: the story tile, the venue tile, the city tile. */
const IN_THE_STRIP = new Set(['our-story', 'the-building', 'adventures']);

function Details({ data }: { data: HomeData }) {
  const sections = data.content.sections.filter((s) => !IN_THE_STRIP.has(s.id));
  if (!sections.length) return null;
  return (
    <section className="bd-details" aria-labelledby="details-title">
      <div className="bd-details__inner">
        <div className="bd-details__head">
          <h2 className="bd-h bd-h--2" id="details-title">
            {data.lifecycle.state === 'WEDDING_DAY' ? 'Today' : data.lifecycle.mode === 'remember' ? 'After the weekend' : 'The details'}
          </h2>
          <span className="bd-head__rule" aria-hidden="true" />
          {data.content.note ? (
            <p className="bd-lede">
              <Text copy={data.content.note} />
            </p>
          ) : null}
        </div>
        <ul className="bd-details__list">
          {sections.map((s) => (
            <Detail key={s.id} section={s} data={data} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function Detail({ section, data }: { section: HomeSection; data: HomeData }) {
  const id = `${section.id}-title`;
  return (
    <li id={section.id} className="bd-detail">
      <p className="bd-eyebrow">{section.label}</p>
      <h3 className="bd-detail__title" id={id}>
        {section.title}
      </h3>
      <p>
        <Text copy={section.body} />
      </p>
      {section.facts?.length ? (
        <dl className="bd-stats">
          {section.facts.map((f) => (
            <Stat key={f.label} {...f} />
          ))}
        </dl>
      ) : null}
      {section.timeline ? <Timeline events={section.timeline} timezone={data.site.date.timezone} label={section.title} nowId={data.lifecycle.state === 'WEDDING_DAY' ? section.timeline[0]?.id : null} /> : null}
      {section.map ? <MapHandoff venue={data.site.venue} /> : null}
      {section.link ? (
        section.link.variant === 'accent' || section.link.variant === 'primary' ? (
          <p>
            <Button variant="primary" href={section.link.href} provider={section.link.provider}>
              {section.link.label}
            </Button>
          </p>
        ) : (
          <p>
            <More href={section.link.href}>{section.link.label}</More>
          </p>
        )
      ) : null}
    </li>
  );
}

export function BotanicalHomePage(data: HomeData) {
  return (
    <Shell frame={data} banner={<PreviewBanner lifecycle={data.lifecycle} />}>
      <Hero content={data.content} site={data.site} countdown={data.countdown} state={data.lifecycle.state} />
      <Strip data={data} />
      <Band data={data} />
      <Details data={data} />
    </Shell>
  );
}
