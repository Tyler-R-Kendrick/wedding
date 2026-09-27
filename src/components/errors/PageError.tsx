'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import '@/components/rsvp/recipes.css';

/**
 * What a page that failed to render shows instead of Next's "Application error" screen: what
 * happened in plain words, a way to try again, and a way home. The digest is the id the server
 * logged the failure under, so the couple can quote it and it can be found; no error text reaches
 * the page (it can carry internals).
 */
export function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="page">
      <h1 className="page__title">This page didn’t load</h1>
      <p className="page__lede" role="alert">
        Something went wrong on our side, not yours. Trying again usually works; if it doesn’t, the rest of the site is still here.
      </p>
      <p>
        <button type="button" className="btn btn--primary" onClick={reset}>
          Try again
        </button>
      </p>
      <p>
        <Link className="link-block" href="/">
          Go to the home page
        </Link>
      </p>
      {error.digest ? <p className="card__meta">Reference: {error.digest}</p> : null}
    </div>
  );
}
