import Link from 'next/link';
import type { ReactNode } from 'react';
import type { StoryChapter } from '@/db/schema/content';
import type { StorySectionView, TimelineMomentView } from '@/domain/content/views';
import { ROUTES } from '@/domain/routes';
import type { ContentRecipe, StoryProps } from '@/themes/content-types';
import { formatPartialDate } from '@/themes/shared/format';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { kit, More, PageHero } from '../kit';
import { StoryRide, type LineKey, type RideStop } from '../kit/StoryRide';
import { Botanical, Photo, firstMedia } from '../media';
import { TimelinePhoto } from '../timeline-media';

const { Shell, Button, content } = kit;
const { ProseBlock, StatusFlags, Provenance } = content;

/**
 * Our Story, as a ride on the Sara + Tyler Line (docs/design/inspo/our-story-timeline.md).
 *
 * The approved panoramic opening stays. Under it the story is a CTA 'L' line: each chapter is a line
 * with its CTA colour, the couple's remembered moments (the Paired timeline, `timeline_moments`) are
 * its stations, the chapter's own words are the transfer where the train changes line, and the line
 * ends at the Loop on the wedding day. The approved "places that shaped us" band is the exit.
 *
 * Nothing on the line is invented. A station without a date shows none; stand-in photographs say so
 * on the picture; the terminal's date and venue come from the site facts, never typed here.
 */

const LINES: Record<StoryChapter, { key: LineKey; name: string }> = {
  met: { key: 'red', name: 'Red Line' },
  connection: { key: 'blue', name: 'Blue Line' },
  relationship: { key: 'brown', name: 'Brown Line' },
  love: { key: 'pink', name: 'Pink Line' },
  future: { key: 'green', name: 'Green Line' },
  engagement: { key: 'orange', name: 'Orange Line' },
  marriage: { key: 'gold', name: 'Gold Line' },
};
const CHAPTER_ORDER = Object.keys(LINES) as StoryChapter[];

const PLACES = [
  { ids: ['city.river', 'city.riverwalk', 'venue.exterior-green'], name: 'Chicago', line: 'The river, the bridges, the lake.', href: ROUTES.exploreCaa },
  { ids: ['place.starved-rock'], name: 'Starved Rock', line: 'Where “I love you” was said first.', href: `${ROUTES.adventures}/starved-rock` },
  { ids: ['city.north-pond', 'city.lakefront-adler'], name: 'Places ahead', line: 'More to explore together.', href: ROUTES.share },
] as const;

/** The "Details to come" pill, only where the prose does not already say it is unfinished. */
const sectionFlagged = (s: StorySectionView) => s.placeholder && !s.paragraphs.some((p) => p.placeholder);
const momentFlagged = (m: TimelineMomentView) => m.placeholder && !m.note.placeholder;

function Bullet() {
  return <span className="bd-stopcard__bullet" aria-hidden="true" />;
}

function SignCard({ section, stop }: { section: StorySectionView; stop: RideStop }) {
  const photo = section.media.find((m) => m.src);
  return (
    <article className="bd-stopcard bd-stopcard--sign" aria-labelledby={`${stop.slug}-title`}>
      <header className="bd-stopcard__plate">
        <span className="bd-eyebrow bd-stopcard__plate-kicker">{stop.kind === 'origin' ? 'Board here' : 'Transfer here'}</span>
        <span className="bd-stopcard__plate-line">
          <Bullet />
          {stop.lineName}
        </span>
      </header>
      {photo?.src ? <TimelinePhoto src={photo.src} alt={photo.alt} sizes="(min-width: 1100px) 34rem, 88vw" /> : null}
      <div className="bd-stopcard__body">
        <h3 id={`${stop.slug}-title`} className="bd-stopcard__title">
          {section.title}
        </h3>
        <StatusFlags placeholder={sectionFlagged(section)} />
        <ProseBlock blocks={section.paragraphs} />
        <Provenance provenance={section.provenance} />
      </div>
    </article>
  );
}

function StationCard({ moment, stop }: { moment: TimelineMomentView; stop: RideStop }) {
  const photo = moment.media.find((m) => m.src);
  const when = formatPartialDate(moment.occurredOn);
  return (
    <article className="bd-stopcard" aria-labelledby={`${stop.slug}-title`}>
      {photo?.src ? <TimelinePhoto src={photo.src} alt={photo.alt} sizes="(min-width: 1100px) 34rem, 88vw" /> : null}
      <div className="bd-stopcard__body">
        <p className="bd-eyebrow bd-stopcard__line">
          <Bullet />
          {stop.lineName}
        </p>
        <h3 id={`${stop.slug}-title`} className="bd-stopcard__title">
          {moment.title}
        </h3>
        {when || moment.locationLabel ? (
          <p className="bd-stopcard__when">
            {when ? <time dateTime={moment.occurredOn}>{when}</time> : null}
            {when && moment.locationLabel ? <span aria-hidden="true"> · </span> : null}
            {moment.locationLabel ? <span>{moment.locationLabel}</span> : null}
          </p>
        ) : null}
        <StatusFlags placeholder={momentFlagged(moment)} />
        <ProseBlock blocks={[moment.note]} />
        {moment.adventureRoute ? <More href={moment.adventureRoute}>Read the memory</More> : null}
      </div>
    </article>
  );
}

export const BotanicalStoryPage: ContentRecipe<StoryProps> = ({ data, frame }) => {
  const lineName = `${frame.site.coupleDisplayName} Line`;
  const stops: RideStop[] = [];
  const cards: ReactNode[] = [];
  const present = CHAPTER_ORDER.filter((c) => data.sections.some((s) => s.chapter === c) || data.timeline.some((m) => m.chapter === c));

  present.forEach((chapter, ci) => {
    const line = LINES[chapter];
    const track = (ci % 2) as 0 | 1;
    const prev = stops.at(-1);
    const from = prev && prev.line !== line.key ? { line: prev.line, track: prev.track } : undefined;
    const section = data.sections.find((s) => s.chapter === chapter);
    if (section) {
      const stop: RideStop = { slug: section.slug, kind: stops.length ? 'transfer' : 'origin', line: line.key, lineName: line.name, track, ...(from ? { from } : {}), name: section.title };
      stops.push(stop);
      cards.push(<SignCard key={stop.slug} section={section} stop={stop} />);
    }
    for (const moment of data.timeline.filter((m) => m.chapter === chapter)) {
      const before = stops.at(-1);
      const arriving = before && before.line !== line.key ? { line: before.line, track: before.track } : undefined;
      const when = formatPartialDate(moment.occurredOn);
      const stop: RideStop = { slug: moment.slug, kind: 'station', line: line.key, lineName: line.name, track, ...(arriving ? { from: arriving } : {}), name: moment.title, ...(when ? { when } : {}) };
      stops.push(stop);
      cards.push(<StationCard key={stop.slug} moment={moment} stop={stop} />);
    }
  });

  const last = stops.at(-1);
  const terminal: RideStop = {
    slug: 'the-loop',
    kind: 'terminal',
    line: 'gold',
    lineName: LINES.marriage.name,
    track: last?.track ?? 0,
    ...(last && last.line !== 'gold' ? { from: { line: last.line, track: last.track } } : {}),
    name: 'The Loop',
    when: frame.site.date.motif,
  };
  stops.push(terminal);
  cards.push(
    <article key="the-loop" className="bd-stopcard bd-stopcard--terminal" aria-labelledby="the-loop-title">
      <header className="bd-stopcard__plate">
        <span className="bd-eyebrow bd-stopcard__plate-kicker">End of the line</span>
        <span className="bd-stopcard__plate-line">
          <Bullet />
          The Loop
        </span>
      </header>
      <figure className="bd-stopcard__media">
        <Photo id="venue.exterior" sizes="(min-width: 1100px) 34rem, 88vw" />
      </figure>
      <div className="bd-stopcard__body">
        <h3 id="the-loop-title" className="bd-stopcard__title">
          <time dateTime={frame.site.date.iso.slice(0, 10)}>{frame.site.date.long}</time>
        </h3>
        <p className="bd-stopcard__when">
          {frame.site.venue.name}, {frame.site.venue.address}
        </p>
        <p className="bd-stopcard__note">Everyone off here. The next chapter starts with all of you in the room.</p>
        <p className="bd-stopcard__actions">
          <Button variant="primary" href={ROUTES.wedding}>
            The wedding day
          </Button>
        </p>
      </div>
    </article>,
  );

  return (
    <Shell frame={frame} banner={<PreviewBanner lifecycle={frame.lifecycle} />}>
      <PageHero
        eyebrow={data.title}
        title={
          <>
            How we <br className="bd-br-wide" />
            found our way <br className="bd-br-wide" />
            to forever
          </>
        }
        sub={[frame.site.coupleDisplayName, 'Same people. A bigger chapter.']}
        photo="couple.hero.story"
        mobilePhoto="couple.hero.story.mobile"
        words={['Good', 'people', 'beautiful', 'places', 'great', 'love']}
      />

      <StoryRide
        stops={stops}
        cards={cards}
        lineName={lineName}
        intro={
          <header className="bd-ride__intro">
            <p className="bd-eyebrow">All aboard</p>
            <h2 id="ride-title" className="bd-h bd-h--2 bd-ride__title">
              Ride the {lineName}
            </h2>
            <p className="bd-ride__lede">Every stop is a memory, in the order we lived them. Scroll to ride from the night we met to the Loop, or tap a station on the map to jump ahead.</p>
          </header>
        }
      />

      <section className="bd-places" aria-labelledby="places-title">
        <div className="bd-places__intro">
          <h2 id="places-title" className="bd-places__title">
            Places that shaped us
          </h2>
          <p className="bd-places__text">A few of the places that shaped this story, and the adventures still to come.</p>
        </div>
        <ul className="bd-places__tiles">
          {PLACES.filter((p) => firstMedia(p.ids)).map((p) => (
            <li key={p.name} className="bd-places__tile">
              <Link className="bd-places__link" href={p.href}>
                <Photo id={p.ids} sizes="(min-width: 1100px) 21vw, (min-width: 768px) 33vw, 100vw" alt="" className="bd-places__photo" />
                <span className="bd-places__caption">
                  <span className="bd-places__name">{p.name}</span>
                  <span className="bd-places__line">{p.line}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="bd-places__action">
          <Button variant="primary" href={ROUTES.adventures} className="bd-btn--moss">
            Explore our favorite places
          </Button>
        </p>
        <Botanical id="botanical.vine-right" className="bd-bloom--places" />
      </section>
      <p className="bd-sr-more">
        <More href={ROUTES.share}>Borrow a few for your own weekend</More>
      </p>
    </Shell>
  );
};
