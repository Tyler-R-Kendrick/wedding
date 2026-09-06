'use client';

import { useCountdown } from '@/themes/shared/use-countdown';
import type { CountdownProps } from '@/themes/types';

/** Big Shoulders tabular numerals; digits crossfade (CSS), never flip or bounce. Hidden on the day itself. */
export function Countdown(props: CountdownProps) {
  const view = useCountdown(props);
  if (props.hidden || view.isToday) return null;
  const n = Math.abs(view.days);
  const unit = n === 1 ? 'day' : 'days';
  return (
    <p className="gh-countdown">
      <span className="gh-countdown__num" key={n}>
        {n}
      </span>
      <span className="gh-countdown__label">
        {unit} {view.isPast ? 'ago' : 'to go'}
      </span>
    </p>
  );
}
