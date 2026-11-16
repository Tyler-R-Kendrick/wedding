'use client';

import { useSyncExternalStore } from 'react';
import { REPORTER_GLOBAL } from '@/lib/feedback/constants';
import { fallbackHref, isArmed, openReporter, subscribeArmed } from './reporter-client';

/**
 * "Report this problem", on an error page. Rendered only on a device armed for reporting, so a
 * guest's error page is unchanged. A link first and a button second: with the widget alive it
 * opens the dialog; without it (this is an error page, after all) the link goes to the plain form.
 */
export function ReportProblemButton({ digest, className }: { digest?: string | undefined; className?: string }) {
  const armed = useSyncExternalStore(subscribeArmed, isArmed, () => false);
  if (!armed) return null;
  const request = digest ? { digest } : {};
  return (
    <a
      className={className}
      href={fallbackHref(request)}
      onClick={(e) => {
        if (typeof (window as unknown as Record<string, unknown>)[REPORTER_GLOBAL] !== 'function') return;
        e.preventDefault();
        openReporter(request);
      }}
    >
      Report this problem
    </a>
  );
}
