'use client';

import type { CSSProperties } from 'react';
import { useCountdown } from '@/themes/shared/use-countdown';
import type { CountdownProps } from '@/themes/types';

/** A quiet line under the date, never a ticking poster. Counts days to the date, not to an invented time. */
export function Countdown(props: CountdownProps) {
  const view = useCountdown(props);
  if (props.hidden || view.isToday) return null;
  const n = Math.abs(view.days);
  const unit = n === 1 ? 'day' : 'days';
  return (
    <p className="bd-countdown">
      <span className="bd-countdown__num" key={n}>
        {n}
      </span>{' '}
      <span className="bd-countdown__label">
        {unit} {view.isPast ? 'ago' : 'to go'}
      </span>
    </p>
  );
}

/**
 * The hero's day count: one large Bodoni numeral over "days to go". Days only — no hours, minutes or
 * seconds ticking, which would turn an invitation into a deadline.
 *
 * The digits a sighted guest sees are drawn by a CSS counter so they can count up once on arrival
 * (`--bd-days`, animated from 0 where motion is welcome); the number itself is real text beside them
 * for assistive technology, copy and paste, and browsers without registered custom properties.
 */
export function HeroCountdown(props: CountdownProps) {
  const view = useCountdown(props);
  if (props.hidden || view.isToday) return null;
  const n = Math.abs(view.days);
  const unit = n === 1 ? 'day' : 'days';
  return (
    <p className="bd-countdown bd-countdown--hero">
      <span className="bd-countdown__num" style={{ '--bd-days': n } as CSSProperties}>
        <span className="sr-only">{n}</span>
        <span className="bd-countdown__digits" aria-hidden="true" />
      </span>{' '}
      <span className="bd-countdown__label">
        {unit} {view.isPast ? 'ago' : 'to go'}
      </span>
    </p>
  );
}
