'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useCountdown } from '@/themes/shared/use-countdown';
import type { CountdownProps } from '@/themes/types';

/** The count both views share: null on the day itself (and when hidden), else the number and its words. */
function useDayCount(props: CountdownProps) {
  const view = useCountdown(props);
  if (props.hidden || view.isToday) return null;
  const n = Math.abs(view.days);
  return { n, words: `${n === 1 ? 'day' : 'days'} ${view.isPast ? 'ago' : 'to go'}` };
}

/** A quiet line under the date, never a ticking poster. Counts days to the date, not to an invented time. */
export function Countdown(props: CountdownProps) {
  const count = useDayCount(props);
  if (!count) return null;
  return (
    <p className="bd-countdown">
      <span className="bd-countdown__num" key={count.n}>
        {count.n}
      </span>{' '}
      <span className="bd-countdown__label">{count.words}</span>
    </p>
  );
}

/**
 * The hero's day count, and the plate that carries it: one large Bodoni numeral over "days to go",
 * with `children` (the wedding's theme) under a gold rule. Days only — no hours, minutes or seconds ticking,
 * which would turn an invitation into a deadline. The whole plate goes on the day itself, so a page
 * left open overnight never keeps an empty frame over the portrait.
 *
 * The digits a sighted guest sees are drawn by a CSS counter so they can run up once on arrival
 * (`--bd-days`; kit.css only animates it where registered custom properties exist). The number is
 * also real text beside them for assistive technology and copy and paste.
 */
export function HeroCountdown(props: CountdownProps & { children?: ReactNode }) {
  // The props object itself, not a rest copy: useCountdown keys its effect on it, and a fresh copy
  // every render would re-run that effect (and its setState) forever.
  const count = useDayCount(props);
  if (!count) return null;
  return (
    <div className="bd-hero__count">
      <p className="bd-countdown bd-countdown--hero">
        <span className="bd-countdown__num" style={{ '--bd-days': count.n } as CSSProperties}>
          <span className="sr-only">{count.n}</span>
          <span className="bd-countdown__digits" aria-hidden="true" />
        </span>{' '}
        <span className="bd-countdown__label">{count.words}</span>
      </p>
      {props.children}
    </div>
  );
}
