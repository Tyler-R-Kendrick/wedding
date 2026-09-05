import { WEDDING_DATE_ISO } from '@/contracts/lifecycle';

/**
 * Placeholder home. Server-rendered, static, no design: the design swarm owns the real page.
 * It exists so the app boots, axe passes, and the smoke test has something to assert.
 */
export default function HomePage() {
  return (
    <>
      <header>
        <p>Sara + Tyler</p>
      </header>
      <main id="main">
        <h1>Sara + Tyler</h1>
        <p>
          <time dateTime={WEDDING_DATE_ISO}>07 &middot; 17 &middot; 27</time> &middot; Chicago
        </p>
        <p>Chicago Athletic Association Hotel, 12 S Michigan Ave, Chicago, IL 60603.</p>
        <p>TODO(Tyler &amp; Sara): the real site is on its way.</p>
      </main>
      <footer>
        <p>Sara + Tyler, July 17, 2027.</p>
      </footer>
    </>
  );
}
