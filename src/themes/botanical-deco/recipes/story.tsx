import Link from 'next/link';
import { Fragment } from 'react';
import { ROUTES } from '@/domain/routes';
import type { ContentRecipe, StoryProps } from '@/themes/content-types';
import { chapterLabel } from '@/themes/shared/content';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { DecoFrame, kit, More, PageHero } from '../kit';
import { ChapterJourney } from '../kit/ChapterJourney';
import { Botanical, Photo, firstMedia } from '../media';

const { Shell, Button, content } = kit;
const { ProseBlock, StatusFlags, Provenance } = content;

/**
 * Our Story, as approved (REF-STORY): the shorter panoramic opening; a spread of a broad monochrome
 * portrait, the first chapter as a readable narrative column, and a varied strip of three pictures
 * with one handwritten line under it; the moss journey panel with the chapters strung along a fine
 * gold line; the chapters in full; and the places that shaped them.
 *
 * Corrected in place, keeping each slot: the approved image dated the journey 2017–2024 (generated
 * years — the chapters here are undated), attributed "Life is better with you" to Sara (it is an
 * unattributed editorial line here), and filled the strip with the couple's own snapshots (this is a
 * public repository; the strip uses the approved generated portrait and licensed photographs of
 * real places instead). docs/design/approved-botanical-deco/parity-exceptions.json lists each one.
 */

/**
 * Three pictures of different shapes, each with a short true caption. A slot lists only pictures
 * its caption is true of: a tile with no such picture is left out, never filled with a different
 * place under the wrong name.
 */
const MEMORIES = [
  { ids: ['couple.lakefront'], kicker: 'Exploring together', caption: 'The lakefront, one of our favorite places in Chicago.' },
  { ids: ['place.starved-rock'], kicker: 'Starved Rock', caption: 'Where we first said “I love you.”' },
  { ids: ['city.lakefront-adler', 'city.river', 'city.riverwalk'], kicker: 'All the joy', caption: 'A city we keep coming back to.' },
] as const;

const PLACES = [
  { ids: ['city.river', 'city.riverwalk', 'venue.exterior-green'], name: 'Chicago', line: 'The river, the bridges, the lake.', href: ROUTES.exploreCaa },
  { ids: ['place.starved-rock'], name: 'Starved Rock', line: 'Where “I love you” was said first.', href: `${ROUTES.adventures}/starved-rock` },
  { ids: ['city.north-pond', 'city.lakefront-adler'], name: 'Places ahead', line: 'More to explore together.', href: ROUTES.share },
] as const;

/**
 * The "Details to come" pill, only where nothing else says so. A chapter whose prose already holds a
 * labelled placeholder ("Sara + Tyler are still writing this: …") said the same thing twice, a line
 * apart; a chapter marked unfinished with no such block still gets the pill.
 */
const flagged = (s: StoryProps['data']['sections'][number]) => s.placeholder && !s.paragraphs.some((p) => p.placeholder);

export const BotanicalStoryPage: ContentRecipe<StoryProps> = ({ data, frame }) => {
  const [first, ...rest] = data.sections;
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

      {first ? (
        <section className="bd-spread" id={first.slug} aria-labelledby={`${first.slug}-title`}>
          <div className="bd-spread__narrative">
            <p className="bd-eyebrow">It all started somewhere beautiful</p>
            <h2 id={`${first.slug}-title`} className="bd-h bd-h--2 bd-spread__title">
              {first.title}
            </h2>
            <StatusFlags placeholder={flagged(first)} />
            <ProseBlock blocks={first.paragraphs} lead />
            <Provenance provenance={first.provenance} />
          </div>
          <figure className="bd-spread__portrait">
            <Photo id="couple.story.monochrome" sizes="(min-width: 1100px) 26vw, 100vw" />
            <figcaption className="bd-spread__script" aria-hidden="true">
              Better together
            </figcaption>
          </figure>
          <div className="bd-spread__memories">
            <ul className="bd-memories" aria-label="A few pictures">
              {MEMORIES.map((m) => {
                const item = firstMedia(m.ids);
                if (!item) return null;
                return (
                  <li key={m.kicker} className={`bd-memories__item${m.kicker === 'Starved Rock' ? ' bd-memories__item--tall' : ''}`}>
                    <figure>
                      <Photo id={m.ids} sizes="(min-width: 1100px) 17vw, (min-width: 768px) 33vw, 100vw" />
                      <figcaption>
                        <span className="bd-kicker">{m.kicker}</span>
                        <span className="bd-memories__caption">{m.caption}</span>
                      </figcaption>
                    </figure>
                  </li>
                );
              })}
            </ul>
            <p className="bd-spread__sentiment">
              <span className="bd-script">Life is better with you.</span>
            </p>
            <Botanical id="botanical.sprig-right" className="bd-bloom--spread" />
          </div>
        </section>
      ) : null}

      <section className="bd-journey" aria-labelledby="journey-title">
        <div className="bd-journey__panel">
          <DecoFrame />
          <p className="bd-eyebrow">Our journey</p>
          <h2 id="journey-title" className="bd-h bd-h--2 bd-journey__title">
            A few chapters <br />
            so far
          </h2>
          <p>Different places, brighter days. The same two people.</p>
        </div>
        {rest.length ? (
          <ChapterJourney
            label="Chapters"
            stops={rest.map((c) => ({ slug: c.slug, label: chapterLabel(c.chapter), title: c.title }))}
            chapters={rest.map((c) => (
              <Fragment key={c.id}>
                <div className="bd-reader__head">
                  <p className="bd-eyebrow">{chapterLabel(c.chapter)}</p>
                  <h3 id={`${c.slug}-title`} className="bd-h bd-reader__title" tabIndex={-1}>
                    {c.title}
                  </h3>
                  <StatusFlags placeholder={flagged(c)} />
                </div>
                <div className="bd-reader__body">
                  <ProseBlock blocks={c.paragraphs} lead />
                  <Provenance provenance={c.provenance} />
                </div>
              </Fragment>
            ))}
          />
        ) : null}
        <span className="bd-journey__skyline" aria-hidden="true" />
      </section>

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
