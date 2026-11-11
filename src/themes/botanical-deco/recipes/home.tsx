import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import type { HomeData } from '@/themes/types';
import { kit, More } from '../kit';
import { Reveal } from '../kit/Reveal';
import { Botanical, Photo } from '../media';

const { Shell, Hero, Button, Text } = kit;

/**
 * Home, for a reader who has not signed in (a signed-in guest's home is their dashboard, and `/`
 * sends them there).
 *
 * The opening is the couple, their names, and the one thing a guest should do now, as a button that
 * leads through sign-in to the page that does it. Then the wedding's theme — love, peace and
 * happiness — as three words beside the welcome; the two things anyone may read, the story and the
 * adventures, each beside its photograph; and the door again at the foot of the page.
 *
 * **Nothing on this page says when or where the wedding is.** No date, no venue, no city, no
 * schedule, no countdown: those are the invited guests' and open with the dashboard. The model
 * (`themes/shared/home-content.ts`) is built from the two names alone, so there is nothing here to
 * print them from.
 */

const ROUTES = { story: '/our-story', adventures: '/our-adventures' } as const;

function Theme({ data }: { data: HomeData }) {
  const after = data.lifecycle.mode === 'remember';
  const words = [
    { word: 'Love', line: 'Every one of you is part of how we got here. This celebration is as much about you as it is about us.' },
    { word: 'Peace', line: 'No rush and no guesswork: a chance to slow down, catch up and simply be together.' },
    { word: 'Happiness', line: 'The places and moments that made us happy, shared with the people we love.' },
  ];
  return (
    <section className="bd-theme" aria-labelledby="theme-title">
      <Botanical id="botanical.edge-left-tall" className="bd-bloom--theme" />
      <div className="bd-theme__inner">
        <div className="bd-theme__intro">
          <h2 className="bd-h bd-h--2 bd-theme__title" id="theme-title">
            Rooted in love. Surrounded by peace. Filled with happiness.
          </h2>
          <span className="bd-head__rule" aria-hidden="true" />
          <p className="bd-theme__lede">
            {after ? 'Thank you for sharing this celebration with us.' : "We're so happy you're here! We believe life's greatest joys are found in the people we love, the moments we share, and the memories we make along the way."}
          </p>
          <p className="bd-theme__lede">
            {after ? 'Thank you for slowing down, being present, and celebrating with us. We’re so grateful to have you in our lives.' : 'We hope our wedding is a reflection of these things and a chance to slow down, be present, and celebrate the happiness that comes from being together. We’re so grateful to have you in our lives.'}
          </p>
          <p className="bd-theme__lede">
            With love,<br />Sara &amp; Tyler
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
 * What anyone may read: the story beside a portrait, and the adventures beside a place from them.
 * Each photograph keeps its own proportions, so no face or canyon wall is cut at a tile edge.
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

      <article className="bd-share__item bd-share__item--story" id="our-story">
        <figure className="bd-share__photo" data-reveal="photo">
          <Photo id="couple.story.monochrome" sizes="(min-width: 900px) 52vw, 100vw" />
        </figure>
        <div className="bd-share__body" data-reveal="">
          <p className="bd-eyebrow">Our story</p>
          <h3 className="bd-share__name bd-italic">How it all started</h3>
          <p>We met at a friend’s wedding, where an evening of talking, playing games, and getting to know each other became the start of our story.</p>
          <More href={ROUTES.story}>Read our story</More>
        </div>
      </article>

      <article className="bd-share__item bd-share__item--venue" id="adventures">
        <figure className="bd-share__photo" data-reveal="photo">
          <Photo id="place.starved-rock" sizes="(min-width: 900px) 40vw, 100vw" />
        </figure>
        <div className="bd-share__body" data-reveal="">
          <p className="bd-eyebrow">Our adventures</p>
          <h3 className="bd-share__name bd-italic">The places we have been</h3>
          <p>A map of where we have been together, each place with what Sara remembers and what Tyler remembers.</p>
          <More href={ROUTES.adventures}>See our adventures</More>
        </div>
      </article>
    </section>
  );
}

/**
 * The door, once more, at the foot of the page: who the rest of the site is for, how they get in,
 * and the same action the hero offered. The painted cluster is a corner cut-out, so it enters from
 * the section's top right corner, turned so its cut edges lie along the page edge.
 */
function Closing({ data }: { data: HomeData }) {
  const guests = data.content.sections.find((s) => s.id === 'guests');
  if (!guests) return null;
  return (
    <section className="bd-closing" aria-labelledby="closing-title">
      <Botanical id="botanical.cluster-tl" className="bd-bloom--closing" />
      <div className="bd-closing__text" data-reveal="">
        <p className="bd-eyebrow">{guests.label}</p>
        <h2 className="bd-h bd-h--2 bd-closing__title" id="closing-title">
          {guests.title}
        </h2>
        <p>
          <Text copy={guests.body} />
        </p>
        {guests.link ? (
          <p>
            <Button variant="primary" href={guests.link.href}>
              {guests.link.label}
            </Button>
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function BotanicalHomePage(data: HomeData) {
  return (
    <Shell frame={data} banner={<PreviewBanner lifecycle={data.lifecycle} />}>
      <Hero content={data.content} site={data.site} state={data.lifecycle.state} />
      <Theme data={data} />
      <Share data={data} />
      <Closing data={data} />
      <Reveal />
    </Shell>
  );
}
