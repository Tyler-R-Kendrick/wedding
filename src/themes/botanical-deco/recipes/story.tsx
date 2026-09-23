import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import type { StoryChapter } from '@/db/schema/content';
import type { StorySectionView, TimelineMomentView } from '@/domain/content/views';
import { ROUTES } from '@/domain/routes';
import type { ContentRecipe, StoryProps } from '@/themes/content-types';
import { formatPartialDate } from '@/themes/shared/format';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { timelineAnchors } from '@/themes/shared/timeline';
import { kit, More, PageHero } from '../kit';
import { StoryRide, type LineKey, type RideStop } from '../kit/StoryRide';
import { Botanical, Photo, firstMedia } from '../media';
import { TimelinePhoto } from '../timeline-media';

const { Shell, Button, content } = kit;
const { ProseBlock, StatusFlags, Provenance } = content;

/**
 * Our Story, as a ride on the Sara + Tyler Line (docs/design/inspo/our-story-timeline.md).
 *
 * The approved panoramic opening stays, and the line starts directly under it, so the first screen
 * already shows where the ride goes. Each chapter has a CTA colour, the couple's remembered moments
 * (the Paired timeline, `timeline_moments`) are its stations, the chapter's own words are where the
 * line changes colour, and the line ends at the Loop on the wedding day. The approved "places that
 * shaped us" band is the exit.
 *
 * Every moment leads with its words — what happened, when, where — and the picture follows (Sara's
 * ask: the memory is what catches the eye, not the photograph). Line names ("Red Line") are never
 * printed; the colour alone carries the way-finding, as it does on the platform.
 *
 * Nothing on the line is invented. A station without a date shows none; stand-in photographs say so
 * on the picture; the terminal's date and venue come from the site facts, never typed here.
 */

const LINES: Record<StoryChapter, LineKey> = {
  met: 'red',
  connection: 'blue',
  relationship: 'brown',
  love: 'pink',
  future: 'green',
  engagement: 'orange',
  marriage: 'gold',
};
const CHAPTER_ORDER = Object.keys(LINES) as StoryChapter[];
const ORDINALS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

const PLACES = [
  { ids: ['city.river', 'city.riverwalk', 'venue.exterior-green'], name: 'Chicago', line: 'The river, the bridges, the lake.', href: ROUTES.exploreCaa },
  { ids: ['place.starved-rock'], name: 'Starved Rock', line: 'Where “I love you” was said first.', href: `${ROUTES.adventures}/starved-rock` },
  { ids: ['city.north-pond', 'city.lakefront-adler'], name: 'Places ahead', line: 'More to explore together.', href: ROUTES.share },
] as const;

/** The "Details to come" pill, only where the prose does not already say it is unfinished. */
const sectionFlagged = (s: StorySectionView) => s.placeholder && !s.paragraphs.some((p) => p.placeholder);
const momentFlagged = (m: TimelineMomentView) => m.placeholder && !m.note.placeholder;

const PHOTO_SIZES = '(min-width: 1100px) 36rem, (min-width: 768px) 60vw, 92vw';

/** The line above a moment's title: a bullet in the chapter's colour, then what places it. */
function Meta({ children }: { children: ReactNode }) {
  return (
    <p className="bd-stopcard__meta">
      <span className="bd-stopcard__bullet" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function ChapterCard({ section, stop, ordinal }: { section: StorySectionView; stop: RideStop; ordinal: number }) {
  const photo = section.media.find((m) => m.src);
  return (
    <article className="bd-stopcard bd-stopcard--chapter" aria-labelledby={`${stop.slug}-title`}>
      <div className="bd-stopcard__text">
        <Meta>Chapter {ORDINALS[ordinal] ?? ordinal + 1}</Meta>
        <h3 id={`${stop.slug}-title`} className="bd-stopcard__title">
          {section.title}
        </h3>
        <StatusFlags placeholder={sectionFlagged(section)} />
        <ProseBlock blocks={section.paragraphs} />
        <Provenance provenance={section.provenance} />
      </div>
      {photo?.src ? (
        <TimelinePhoto src={photo.src} alt={photo.alt} sizes={PHOTO_SIZES} />
      ) : (
        // Where a chapter has no picture, the Deco numeral holds its place; the words already say it.
        <span className="bd-stopcard__numeral" aria-hidden="true">
          {ordinal + 1}
        </span>
      )}
    </article>
  );
}

function StationCard({ moment, stop, chapter }: { moment: TimelineMomentView; stop: RideStop; chapter?: string }) {
  const photo = moment.media.find((m) => m.src);
  const when = formatPartialDate(moment.occurredOn);
  // What places the moment: its date (else its chapter's name), then where it happened; only what is known.
  const placing: ReactNode[] = [when ? <time dateTime={moment.occurredOn}>{when}</time> : chapter, moment.locationLabel].filter(Boolean);
  return (
    <article className="bd-stopcard" aria-labelledby={`${stop.slug}-title`}>
      <div className="bd-stopcard__text">
        {placing.length ? (
          <Meta>
            {placing.map((part, i) => (
              <Fragment key={i}>
                {i ? <span aria-hidden="true"> · </span> : null}
                {part}
              </Fragment>
            ))}
          </Meta>
        ) : null}
        <h3 id={`${stop.slug}-title`} className="bd-stopcard__title">
          {moment.title}
        </h3>
        <StatusFlags placeholder={momentFlagged(moment)} />
        <ProseBlock blocks={[moment.note]} />
        {moment.adventureRoute ? <More href={moment.adventureRoute}>Read the memory</More> : null}
      </div>
      {photo?.src ? <TimelinePhoto src={photo.src} alt={photo.alt} sizes={PHOTO_SIZES} /> : null}
    </article>
  );
}

export const BotanicalStoryPage: ContentRecipe<StoryProps> = ({ data, frame }) => {
  const lineName = `${frame.site.coupleDisplayName} Line`;
  const stops: RideStop[] = [];
  const cards: ReactNode[] = [];
  const anchors = timelineAnchors(data.sections, data.timeline);
  const present = CHAPTER_ORDER.filter((c) => data.sections.some((s) => s.chapter === c) || data.timeline.some((m) => m.chapter === c));

  present.forEach((chapter, ci) => {
    const line = LINES[chapter];
    const section = data.sections.find((s) => s.chapter === chapter);
    if (section) {
      const stop: RideStop = { slug: section.slug, kind: stops.length ? 'transfer' : 'origin', line, name: section.title };
      stops.push(stop);
      cards.push(<ChapterCard key={stop.slug} section={section} stop={stop} ordinal={ci} />);
    }
    for (const moment of data.timeline.filter((m) => m.chapter === chapter)) {
      const when = formatPartialDate(moment.occurredOn);
      const stop: RideStop = { slug: anchors.get(moment.id) ?? moment.slug, kind: 'station', line, name: moment.title, ...(when ? { when } : {}) };
      stops.push(stop);
      cards.push(<StationCard key={stop.slug} moment={moment} stop={stop} {...(section ? { chapter: section.title } : {})} />);
    }
  });

  stops.push({ slug: 'the-loop', kind: 'terminal', line: 'gold', name: 'The Loop', when: frame.site.date.motif });
  cards.push(
    <article key="the-loop" className="bd-stopcard bd-stopcard--terminal" aria-labelledby="the-loop-title">
      <div className="bd-stopcard__text">
        <Meta>End of the line · The Loop</Meta>
        <h3 id="the-loop-title" className="bd-stopcard__title">
          <time dateTime={frame.site.date.iso.slice(0, 10)}>{frame.site.date.long}</time>
        </h3>
        <p className="bd-stopcard__where">
          {frame.site.venue.name},{' '}
          <a className="bd-stopcard__map" href={frame.site.venue.mapsUrl} rel="noopener">
            {frame.site.venue.address}
            <span className="bd-stopcard__map-provider"> · directions in {frame.site.venue.mapsProvider}</span>
          </a>
        </p>
        <p className="bd-stopcard__note">Everyone off here. The next chapter starts with all of you in the room.</p>
        <p className="bd-stopcard__actions">
          <Button variant="primary" href={ROUTES.wedding}>
            The wedding day
          </Button>
        </p>
      </div>
      <figure className="bd-stopcard__media">
        <Photo id="venue.exterior" sizes={PHOTO_SIZES} />
      </figure>
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
        words={['Love', 'peace', 'happiness']}
        lede="Every stop on the line below is a memory, in the order we lived them. Scroll to ride from the night we met to the wedding day, or tap a station to jump ahead."
      />

      <StoryRide
        stops={stops}
        cards={cards}
        lineName={lineName}
        title={
          <>
            Ride the <span className="bd-nowrap">{lineName}</span>
          </>
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
