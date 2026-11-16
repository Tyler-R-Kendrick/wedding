'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { fallbackHref, isArmed, subscribeArmed } from '@/components/feedback/reporter-client';
import { captureError } from '@/lib/diagnostics/recorder';

/**
 * The last resort: the root layout itself failed, so nothing of the site's design is loaded and this
 * page brings its own <html>. Plain on purpose — system type at a readable size, one way back.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    captureError(error, 'boundary', error.digest ? { digest: error.digest } : {});
  }, [error]);
  // The root layout is gone, and the reporter's widget with it, so on the couple's own devices this
  // page links straight to the plain form. `false` on the server and for everyone else.
  const armed = useSyncExternalStore(subscribeArmed, isArmed, () => false);
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: '2rem 1rem', fontSize: '1.0625rem', lineHeight: 1.5, maxWidth: '36rem' }}>
        <main id="main">
          <h1>This page didn’t load</h1>
          <p>Something went wrong on our side, not yours. Trying again usually works.</p>
          <p>
            <button type="button" onClick={reset}>
              Try again
            </button>{' '}
            {/* A full navigation, deliberately: this boundary replaced the root layout. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            or <a href="/">go to the home page</a>.
          </p>
          {error.digest ? <p>Reference: {error.digest}</p> : null}
          {armed ? (
            <p>
              You can also <a href={fallbackHref(error.digest ? { digest: error.digest } : {})}>report this problem</a>.
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
