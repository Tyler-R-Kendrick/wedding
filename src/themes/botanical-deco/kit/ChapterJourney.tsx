'use client';

import { useCallback, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';

export interface JourneyStop {
  slug: string;
  label: string;
  title: string;
}

const noop = () => () => {};
const onHash = (notify: () => void) => {
  window.addEventListener('hashchange', notify);
  return () => window.removeEventListener('hashchange', notify);
};

/**
 * The approved journey band as a reader: the beads on the gold line choose which chapter opens in
 * the reader beneath it, one at a time, instead of every chapter stacked down the page (the approved
 * composition goes straight from the band to the places strip).
 *
 * It works before and without script. The server renders the stops as `#slug` links and the reader
 * as every chapter with only the first shown; `:target` in kit.css opens whichever one a link — or
 * an assistant's citation, `/our-story#love` — points at. Once hydrated, it becomes a tab list
 * (arrow keys, Home and End), the chapter panels switch with the `hidden` attribute, the URL follows
 * the chapter so a guest can share it, and each chapter gains previous/next steps.
 */
export function ChapterJourney({ stops, chapters, label }: { stops: JourneyStop[]; chapters: ReactNode[]; label: string }) {
  const enhanced = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  const hash = useSyncExternalStore(
    onHash,
    () => window.location.hash,
    () => '',
  );
  const [picked, setPicked] = useState<number | null>(null);
  // Only a chapter a guest chose fades in; the one on screen at load is at rest (and measurable).
  const [moved, setMoved] = useState(false);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const fromHash = stops.findIndex((s) => `#${s.slug}` === hash);
  const current = fromHash >= 0 ? fromHash : (picked ?? 0);

  const select = useCallback(
    (i: number, focus = false) => {
      const next = (i + stops.length) % stops.length;
      const stop = stops[next];
      if (!stop) return;
      window.history.replaceState(window.history.state, '', `#${stop.slug}`);
      setPicked(next);
      setMoved(true);
      if (focus) tabs.current[next]?.focus();
      // On a phone the reader sits under the whole list: bring the opened chapter into view.
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.requestAnimationFrame(() => document.getElementById(stop.slug)?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' }));
    },
    [stops],
  );

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const to = {
      ArrowRight: i + 1,
      ArrowDown: i + 1,
      ArrowLeft: i - 1,
      ArrowUp: i - 1,
      Home: 0,
      End: stops.length - 1,
    }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    select(to, true);
  };

  return (
    <>
      <ol className="bd-journey__line" aria-label={label} role={enhanced ? 'tablist' : undefined}>
        {stops.map((s, i) => (
          <li key={s.slug} className="bd-journey__stop" role={enhanced ? 'presentation' : undefined}>
            {enhanced ? (
              <button
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${s.slug}-tab`}
                aria-selected={i === current}
                aria-controls={s.slug}
                tabIndex={i === current ? 0 : -1}
                className="bd-journey__link"
                onClick={() => select(i)}
                onKeyDown={(e) => onKey(e, i)}
              >
                <span className="bd-journey__bead" aria-hidden="true" />
                <span className="bd-kicker">{s.label}</span>
                <span className="bd-journey__name">{s.title}</span>
              </button>
            ) : (
              <a className="bd-journey__link" href={`#${s.slug}`}>
                <span className="bd-journey__bead" aria-hidden="true" />
                <span className="bd-kicker">{s.label}</span>
                <span className="bd-journey__name">{s.title}</span>
              </a>
            )}
          </li>
        ))}
      </ol>
      <div className="bd-reader" data-enhanced={enhanced ? '' : undefined}>
        {chapters.map((chapter, i) => {
          const s = stops[i];
          if (!s) return null;
          const prev = stops[i - 1];
          const next = stops[i + 1];
          return (
            <section
              key={s.slug}
              id={s.slug}
              className="bd-reader__chapter"
              role={enhanced ? 'tabpanel' : undefined}
              aria-labelledby={enhanced ? `${s.slug}-tab` : `${s.slug}-title`}
              hidden={enhanced && i !== current}
              data-entering={moved && i === current ? '' : undefined}
            >
              {chapter}
              {enhanced && (prev || next) ? (
                <nav className="bd-reader__steps" aria-label="More chapters">
                  {prev ? (
                    <button type="button" className="bd-reader__step bd-reader__step--prev" onClick={() => select(i - 1, true)}>
                      <span className="bd-reader__arrow" aria-hidden="true">
                        ←
                      </span>
                      <span className="sr-only">Previous chapter: </span>
                      {prev.title}
                    </button>
                  ) : (
                    <span />
                  )}
                  {next ? (
                    <button type="button" className="bd-reader__step bd-reader__step--next" onClick={() => select(i + 1, true)}>
                      <span className="sr-only">Next chapter: </span>
                      {next.title}
                      <span className="bd-reader__arrow" aria-hidden="true">
                        →
                      </span>
                    </button>
                  ) : null}
                </nav>
              ) : null}
            </section>
          );
        })}
      </div>
    </>
  );
}
