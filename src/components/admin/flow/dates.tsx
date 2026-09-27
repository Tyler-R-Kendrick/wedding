import { WEDDING_TIMEZONE } from '@/contracts/lifecycle';

/*
 * The console's two date formats, in one place: `Stamp`/`formatStamp` for an instant (the audit
 * trail, a job's last run) and `Day`/`formatDay` for a day (an expiry, a deadline). Server-safe and
 * hook-free, so a client component — the media queue, an invitation's Done panel — shows dates the
 * way the pages around it do instead of keeping its own `Intl` formatter. `console.tsx` re-exports
 * these for the server pages that already import them from there.
 */

/**
 * A machine timestamp, rendered in the deployment's time zone.
 *
 * Every stamp in this console was the raw ISO string the database returned —
 * `2026-09-08T05:04:07.912Z` — on a deployment whose operators, whose venue and whose lifecycle
 * dates are all America/Chicago. The milliseconds were noise in a table already scrolling
 * sideways, and the offset was a subtraction the reader had to do. `dateTime` keeps the exact
 * instant for anything parsing the page.
 *
 * `Intl` with an explicit `timeZone` gives the same string on the server and in the browser, so
 * this is safe in a server component and safe to hydrate. No seconds: the 2026-09-27 console
 * review found them noise on every screen but the one that already sorts by the instant.
 */
const STAMP = new Intl.DateTimeFormat('en-US', {
  timeZone: WEDDING_TIMEZONE,
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZoneName: 'short',
});

export function formatStamp(at: string | null | undefined): string {
  if (!at) return '—';
  const d = new Date(at);
  // An unparseable value is shown as it stands rather than as "Invalid Date": on this screen the
  // raw string is the evidence.
  return Number.isNaN(d.getTime()) ? at : STAMP.format(d);
}

/** Day only, same time zone. For a cutoff or an expiry, where the clock is noise. */
const DAY = new Intl.DateTimeFormat('en-US', { timeZone: WEDDING_TIMEZONE, year: 'numeric', month: 'short', day: '2-digit' });

/** The same day as a string, for a sentence ("It works until Jul 17, 2027."). */
export function formatDay(at: string | null | undefined): string {
  if (!at) return '—';
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? at : DAY.format(d);
}

export function Day({ at }: { at: string | null | undefined }) {
  if (!at) return <>—</>;
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? <>{at}</> : <time dateTime={at}>{DAY.format(d)}</time>;
}

export function Stamp({ at }: { at: string | null | undefined }) {
  if (!at) return <>—</>;
  return <time dateTime={at}>{formatStamp(at)}</time>;
}

