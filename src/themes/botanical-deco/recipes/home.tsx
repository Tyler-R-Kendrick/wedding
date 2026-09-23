import { Placeholder } from '@/components/provenance';
import { placeholderTimeline } from '@/themes/shared/home-content';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import type { HomeData, HomeSection } from '@/themes/types';
import { DecoFrame, kit, More } from '../kit';
import { dateParts } from '../kit/content';
import { Reveal } from '../kit/Reveal';
import { Botanical, Photo } from '../media';

const { Shell, Hero, Button, Stat, Timeline, MapHandoff, Text } = kit;

/**
 * Home. The approved opening (the couple on the riverfront, the invitation beside them, now with the
 * day count on the portrait), and then a page that unfolds as a guest scrolls instead of arriving
 * all at once: the wedding's theme — love, peace and happiness — as three words that come in one at
 * a time beside a pinned introduction; the three things Sara and Tyler most want to share, each at
 * its own scale and with its photograph whole; the moss schedule; and a closing invitation.
 *
 * Sara and Tyler's brief for the words: they have been lucky, and this weekend is about sharing those
 * places and experiences with the people they love who have not had them yet. Every sentence below
 * says so without inventing a fact; what is not settled stays a typed placeholder.
 *
 * What the approved image said that was not true stays corrected: the story entry says where they
 * met (a wedding), the schedule lists only the one confirmed day, and the venue is a real photograph
 * of the building. docs/design/approved-botanical-deco/parity-exceptions.json lists each one.
 */

const ROUTES = { story: '/our-story', caa: '/explore-caa', guide: '/share-an-adventure', wedding: '/the-wedding', photos: '/photos' } as const;

function Theme({ data }: { data: HomeData }) {
  const after = data.lifecycle.mode === 'remember';
  const words = [
    {
      word: 'Love',
      line: 'Every one of you is part of how we got here. This weekend is as much about you as it is about us.',
    },
    {
      word: 'Peace',
      line: after
        ? 'No rush and no guesswork: a weekend to slow down, catch up and simply be together.'
        : 'No rush and no guesswork: a weekend to slow down, catch up and simply be together. Everything practical is on this site as it is settled, so you can come relaxed.',
    },
    {
      word: 'Happiness',
      line: `The places that made us happy, shared with you: the river and its bridges, the lakefront, a Venetian Gothic landmark on Michigan Avenue. Then dinner, toasts and dancing.`,
    },
  ];
  return (
    <section className="bd-theme" aria-labelledby="theme-title">
      <Botanical id="botanical.edge-left-tall" className="bd-bloom--theme" />
      <div className="bd-theme__inner">
        <div className="bd-theme__intro">
          <h2 className="bd-h bd-h--2 bd-theme__title" id="theme-title">
            Love, peace <br />
            &amp; happiness
          </h2>
          <span className="bd-head__rule" aria-hidden="true" />
          <p className="bd-theme__lede">
            We have been lucky. A city we love, adventures that changed us, and people who made every one of them better.{' '}
            {after
              ? 'Thank you for letting us share them with you.'
              : `Not everyone we love has been able to share them with us yet, so on ${data.site.date.long}, we are bringing you along to ${data.site.venue.city}.`}
          </p>
        </div>
        <ol className="bd-theme__list">
          {words.map((w) => (
            <li key={w.word} className="bd-theme__item" data-reveal="">
              <h3 className="bd-theme__word">{w.word}</h3>
              <span className="bd-theme__rule" aria-hidden="true" />
              <p className="bd-theme__line">{w.line}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/**
 * What we want to share: three entries at three different scales — the story beside a large
 * portrait, the building beside a tall photograph, the city as a panorama across the full width.
 * Each photograph keeps its own proportions, so no face, spire or skyline is cut at a tile edge.
 */
function Share({ data }: { data: HomeData }) {
  const remember = data.lifecycle.mode === 'remember';
  return (
    <section className="bd-share" aria-labelledby="share-title">
      <header className="bd-share__head" data-reveal="">
        <h2 className="bd-h bd-h--2 bd-share__title" id="share-title">
          {remember ? 'What we shared' : 'What we can’t wait to share'}
        </h2>
      </header>

      <article className="bd-share__item bd-share__item--story">
        <figure className="bd-share__photo" data-reveal="photo">
          <Photo id="couple.story.monochrome" sizes="(min-width: 900px) 52vw, 100vw" />
        </figure>
        <div className="bd-share__body" data-reveal="">
          <p className="bd-eyebrow">Our story</p>
          <h3 className="bd-share__name">How it all started</h3>
          <p>At Allison and Jamie’s wedding: flirty glances across the room, and a connection that was immediate. Weddings have been good to us; we hope this one is good to you.</p>
          <More href={ROUTES.story}>Read our story</More>
        </div>
      </article>

      <article className="bd-share__item bd-share__item--venue">
        <figure className="bd-share__photo" data-reveal="photo">
          <Photo id={['venue.exterior', 'venue.facade']} sizes="(min-width: 900px) 40vw, 100vw" />
        </figure>
        <div className="bd-share__body" data-reveal="">
          <p className="bd-eyebrow">The venue</p>
          <h3 className="bd-share__name bd-italic">Chicago Athletic Association</h3>
          <p>
            Venetian Gothic on Michigan Avenue since 1893, restored as a hotel. {remember ? 'Where we said “I do.”' : 'Where we will say “I do.”'} Carved limestone, stained glass, marble floors, and Millennium Park out the windows.
          </p>
          <More href={ROUTES.caa}>Explore the venue</More>
        </div>
      </article>

      <article className="bd-share__item bd-share__item--city">
        <figure className="bd-share__photo" data-reveal="photo">
          <Photo id={['city.skyline', 'city.lakefront-adler', 'city.river']} sizes="100vw" />
        </figure>
        <div className="bd-share__body bd-share__body--plate" data-reveal="">
          <p className="bd-eyebrow">Explore Chicago</p>
          <h3 className="bd-share__name">A city we love</h3>
          <p>The river and its bridges, North Pond, the lakefront by the Adler: a few of our favorite places, and how to reach them from the hotel.</p>
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
    <section className="bd-band" aria-labelledby="schedule-title" data-reveal="">
      <Schedule data={data} />
    </section>
  );
}

/**
 * The closing invitation: the gallery, and the one handwritten line on the page. The painted cluster
 * is a corner cut-out, so it enters from the section's top right corner, turned so its cut edges lie
 * along the page edge instead of showing as a cropped rectangle.
 */
function Closing({ data }: { data: HomeData }) {
  const remember = data.lifecycle.mode === 'remember';
  return (
    <section className="bd-closing" aria-labelledby="closing-title">
      <Botanical id="botanical.cluster-tl" className="bd-bloom--closing" />
      <div className="bd-closing__text" data-reveal="">
        <p className="bd-eyebrow">Gallery</p>
        <h2 className="bd-h bd-h--2 bd-closing__title" id="closing-title">
          Our memories, <br />
          and yours to come
        </h2>
        {/* No gallery photographs exist yet (PX-08): say what the page will hold, not what it holds. */}
        <p>{remember ? 'Photographs from the weekend gather here as they come in, ours and yours.' : 'Photographs from our adventures will gather here, and after the weekend the ones from it will too, yours included.'}</p>
        <More href={ROUTES.photos}>{remember ? 'View the gallery' : 'Visit the gallery'}</More>
        {remember ? null : (
          <p className="bd-script bd-closing__sign" aria-hidden="true">
            See you in Chicago
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * Whatever this lifecycle state needs a guest to know that the approved composition has no slot
 * for — the RSVP line, the day's running order on the day itself, a ride home — as a quiet index
 * under the band, never as a second hero. Each keeps its anchor (`/#now` is the phone bar's "Now").
 */
/** Sections the entries above already are: the story, the venue, the city. */
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
      <Theme data={data} />
      <Share data={data} />
      <Band data={data} />
      <Details data={data} />
      <Closing data={data} />
      <Reveal />
    </Shell>
  );
}
