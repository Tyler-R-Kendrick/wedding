'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { trackPageView } from './beacon';

/**
 * The telemetry island. Renders nothing and does nothing during render: after the page has
 * painted, an effect records a view, and again on every client navigation. What it records and
 * what it never does is in `./beacon.ts`.
 *
 * `usePathname()` is only the signal that the address changed. The path that is sent is read from
 * `window.location`, because a prerendered public page is served by a rewrite and the router's own
 * value can be the internal `/t/<theme>/…` address rather than the one the visitor sees.
 */
export function Telemetry() {
  const pathname = usePathname();
  useEffect(() => {
    trackPageView();
  }, [pathname]);
  return null;
}

export default Telemetry;
