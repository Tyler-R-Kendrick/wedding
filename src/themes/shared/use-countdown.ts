'use client';

import { useEffect, useState } from 'react';
import { daysUntil, msUntilNextMidnight } from '@/domain/lifecycle/countdown';
import type { CountdownView } from '@/themes/types';

/**
 * Keeps a server-rendered countdown honest on the client: re-computes the calendar-day difference
 * in America/Chicago on mount and at each local midnight. Days only, no seconds, no pressure.
 */
export function useCountdown(initial: CountdownView): CountdownView {
  const [view, setView] = useState(initial);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const now = new Date();
      const days = daysUntil(now, initial.weddingDateIso, initial.timezone);
      setView({ ...initial, days, isToday: days === 0, isPast: days < 0 });
      timer = setTimeout(tick, msUntilNextMidnight(now, initial.timezone));
    };
    tick();
    return () => clearTimeout(timer);
  }, [initial]);
  return view;
}
