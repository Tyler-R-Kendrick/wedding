'use client';

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
