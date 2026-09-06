'use client';

import { useCountdown } from '@/themes/shared/use-countdown';
import type { CountdownProps } from '@/themes/types';

/** The sky band: Gloock tabular numerals on sky wash; digits swap, never bounce. */
export function Countdown(props: CountdownProps) {
  const view = useCountdown(props);
  if (props.hidden || view.isToday) return null;
  const n = Math.abs(view.days);
  return (
    <p className="cv-sky">
      <span className="cv-sky__num" key={n}>
        {n}
      </span>
      <span className="cv-sky__unit">
        {n === 1 ? 'day' : 'days'} {view.isPast ? 'ago' : 'to go'}
      </span>
    </p>
  );
}
