'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * A console screen that failed to render. Its own `<main>`, like every console page (the layout
 * renders only the admin nav), so the skip link still lands somewhere. The digest is the id the
 * server logged the failure under — quote it when looking in the logs; the error's text never
 * reaches the page.
 */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main id="main" className="ops">
      <h1 className="ops-title">This screen didn’t load</h1>
      <p className="ops-notice ops-notice-error" role="alert">
        Something failed on the server while building it. Nothing was changed.{error.digest ? ` Reference: ${error.digest}.` : ''}
      </p>
      <p>
        <button type="button" className="ops-button ops-button-primary" onClick={reset}>
          Try again
        </button>
      </p>
      <p>
        <Link className="link-block" href="/admin">
          Back to the console
        </Link>
      </p>
    </main>
  );
}
