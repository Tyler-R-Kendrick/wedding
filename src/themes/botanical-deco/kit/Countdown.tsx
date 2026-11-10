'use client';

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

