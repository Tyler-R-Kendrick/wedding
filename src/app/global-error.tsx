'use client';

/**
 * The last resort: the root layout itself failed, so nothing of the site's design is loaded and this
 * page brings its own <html>. Plain on purpose — system type at a readable size, one way back.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
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
            or <a href="/">go to the home page</a>.
          </p>
          {error.digest ? <p>Reference: {error.digest}</p> : null}
        </main>
      </body>
    </html>
  );
}
