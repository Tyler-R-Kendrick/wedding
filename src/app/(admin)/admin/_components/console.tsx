import Link from 'next/link';
import type { ReactNode } from 'react';
import { WEDDING_TIMEZONE } from '@/contracts/lifecycle';
import { ADMIN_SECTIONS } from './sections';
import './ops.css';
import './console.css';

/**
 * The console shell for the cross-cutting operations screens. Same foundation tokens and same
 * primitives as the guest-operations pages (`ops.css`); what it adds is dense-data furniture —
 * real tables with tabular figures, key/value strips, status pills — because lifecycle history,
 * the audit trail and the job queue are rows of numbers and timestamps, not cards.
 */
export function ConsolePage({
  title,
  lede,
  children,
  notice,
  actions,
}: {
  title: string;
  lede?: string;
  children: ReactNode;
  notice?: { ok?: string; error?: string };
  actions?: ReactNode;
}) {
  return (
    <main id="main" className="ops">
      <div className="con-head">
        <div>
          <h1 className="ops-title">{title}</h1>
          {lede ? <p className="ops-lede">{lede}</p> : null}
        </div>
        {actions ? <div className="con-head__actions">{actions}</div> : null}
      </div>
      {notice?.ok ? (
        <p className="ops-notice ops-notice-ok" role="status">
          {notice.ok}
        </p>
      ) : null}
      {notice?.error ? (
        <p className="ops-notice ops-notice-error" role="alert">
          {notice.error}
        </p>
      ) : null}
      {children}
    </main>
  );
}

export function ConsoleGate({ what }: { what: string }) {
  return (
    <main id="main" className="ops">
      <h1 className="ops-title">Administrator sign-in required</h1>
      <p>{what} is part of the admin console.</p>
      <p>
        <Link href="/sign-in/admin">Sign in with your administrator email</Link>
      </p>
    </main>
  );
}

/** A capability that answered `forbidden`: say which entitlement, not "something went wrong". */
export function Denied({ message, entitlement }: { message: string; entitlement?: string }) {
  return (
    <p className="ops-notice ops-notice-error" role="alert">
      {message}
      {entitlement ? ` This screen needs the ${entitlement} entitlement.` : ''}
    </p>
  );
}

/**
 * A titled region of a screen. `title` is optional: a screen whose section is the whole screen
 * (the media queue, the import form) has nothing to say in a second heading, and an
 * `aria-labelledby` pointing at an id that renders nothing is worse than no label at all — which
 * is what the media shell this replaced produced whenever it was given an id and no title.
 */
export function Section({ title, id, children, note }: { title?: string; id?: string; children: ReactNode; note?: ReactNode }) {
  // `id` falls back to a slug of the title, which is what the guest-operations shell did; screens
  // that a test or a link addresses by fragment (`#events`) pass their own and get it verbatim.
  const sectionId = id ?? (title ? title.replace(/\W+/g, '-').toLowerCase() : undefined);
  return (
    // The id lands on the section, not on the heading: `#events` has to select the region a reader
    // (or a test) means by it, and the heading gets its own id for `aria-labelledby`.
    <section id={sectionId} className="ops-section" aria-labelledby={title && sectionId ? `${sectionId}-heading` : undefined}>
      {title ? (
        <h2 id={sectionId ? `${sectionId}-heading` : undefined} className="ops-h2">
          {title}
        </h2>
      ) : null}
      {note ? <p className="con-note">{note}</p> : null}
      {children}
    </section>
  );
}

/**
 * Sub-navigation inside one family of screens (media, intelligence, content).
 *
 * The layout's index already reaches every screen; this is the local "you are here" strip a person
 * uses while working inside one family. It replaces three hand-rolled navs — `AdminMediaNav`,
 * `AdminAiNav` and the content pages' bare links — which each had their own markup, their own
 * button classes and their own idea of what `aria-current` meant.
 */
export function SubNav({ label, items }: { label: string; items: { href: string; label: string; current?: boolean }[] }) {
  return (
    <nav aria-label={label} className="con-subnav">
      <ul className="list list--plain">
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} aria-current={i.current ? 'page' : undefined}>
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** An empty state that is not a table row. Announced, because it usually replaces a list. */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="con-empty-note" role="status">
      {children}
    </p>
  );
}

/**
 * Where you are inside a family of screens. The content editor had its own `.ac-crumbs` list with
 * a `::before` separator; this is the console's, and it is a `<nav>` with a name so a screen reader
 * can skip it.
 */
export function Breadcrumbs({ trail }: { trail: { href?: string; label: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="con-crumbs">
      <ol className="list list--plain">
        {trail.map((c) => (
          <li key={c.label}>{c.href ? <Link href={c.href}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}</li>
        ))}
      </ol>
    </nav>
  );
}

/** A muted explanatory line inside a section. */
export function Note({ children }: { children: ReactNode }) {
  return <p className="con-note">{children}</p>;
}

/**
 * A real table in a scroll container, so wide operational data scrolls inside its own region
 * instead of making the page scroll sideways. `<caption>` is the accessible name — once.
 *
 * The wrapper used to carry `role="region" aria-label={caption}` as well, so every table announced
 * "region, Audit events newest first … table, Audit events newest first": one string, two nodes,
 * read twice before a single row. The `<caption>` is the name worth keeping — it is what table
 * navigation in a screen reader reports, and it is visible — so the region role and its label are
 * gone. Nothing is lost for keyboard users: `scrollable-region-focusable` (the axe rule this
 * wrapper exists for) asks for focusability, not for a role.
 *
 * `empty` decides whether the wrapper is focusable at all. A table with a header row and no body
 * cannot scroll, and a focusable element that does nothing is a stop in the tab order that costs a
 * keyboard user a keystroke on every empty screen — which, on a fresh deployment, is most of them.
 */
/**
 * The scroll container wide operational data lives in. Focusable so a keyboard can reach the
 * overflow (axe `scrollable-region-focusable`), and unnamed and role-less so it does not repeat the
 * name of whatever it wraps.
 */
export function ScrollRegion({ children, scrollable = true }: { children: ReactNode; scrollable?: boolean }) {
  return (
    <div className="ops-table-wrap con-scroll" tabIndex={scrollable ? 0 : undefined}>
      {children}
    </div>
  );
}

/**
 * A real table in a scroll container, so wide operational data scrolls inside its own region
 * instead of making the page scroll sideways. `<caption>` is the accessible name — once.
 *
 * The wrapper used to carry `role="region" aria-label={caption}` as well, so every table announced
 * "region, Audit events newest first … table, Audit events newest first": one string, two nodes,
 * read twice before a single row. The `<caption>` is the name worth keeping — it is what table
 * navigation in a screen reader reports, and it is visible — so the region role and its label are
 * gone. Nothing is lost for keyboard users: `scrollable-region-focusable` (the axe rule this
 * wrapper exists for) asks for focusability, not for a role.
 *
 * `empty` is the message to show when there are no rows, and when it is set NO TABLE IS RENDERED.
 * An eight-column header row on a 390px phone is 500px of sideways scrolling and a stop in the tab
 * order, both in service of showing an operator the shape of nothing — and on a fresh deployment
 * that is most of this console. Dropping the `tabIndex` alone is not enough and is worse: the
 * header row still overflows, so axe reports `scrollable-region-focusable` on a region a keyboard
 * can no longer reach. The empty state is a sentence, announced, and the caption above it still
 * says what the table would have held.
 */
export function DataTable({ caption, head, children, dense = true, empty = null }: { caption: string; head: ReactNode; children: ReactNode; dense?: boolean; empty?: ReactNode }) {
  if (empty) {
    return (
      <>
        <p className="con-caption con-caption--standalone">{caption}</p>
        <Empty>{empty}</Empty>
      </>
    );
  }
  return (
    <ScrollRegion>
      <table className={dense ? 'ops-table con-table' : 'ops-table'}>
        <caption className="con-caption">{caption}</caption>
        <thead>{head}</thead>
        <tbody>{children}</tbody>
      </table>
    </ScrollRegion>
  );
}

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
 * this is safe in a server component and safe to hydrate.
 */
const STAMP = new Intl.DateTimeFormat('en-US', {
  timeZone: WEDDING_TIMEZONE,
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
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

export function Day({ at }: { at: string | null | undefined }) {
  if (!at) return <>—</>;
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? <>{at}</> : <time dateTime={at}>{DAY.format(d)}</time>;
}

export function Stamp({ at }: { at: string | null | undefined }) {
  if (!at) return <>—</>;
  return <time dateTime={at}>{formatStamp(at)}</time>;
}

/** One headline number with its label underneath. Used in strips of three or four, never as cards. */
export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="con-stat">
      <span className="con-stat__value">{value}</span>
      <span className="con-stat__label">{label}</span>
      {hint ? <span className="con-stat__hint">{hint}</span> : null}
    </div>
  );
}

export function StatStrip({ children }: { children: ReactNode }) {
  return <div className="con-stats">{children}</div>;
}

export type PillTone = 'neutral' | 'good' | 'warn' | 'bad';

export function Pill({ tone = 'neutral', children }: { tone?: PillTone; children: ReactNode }) {
  return <span className={`con-pill con-pill--${tone}`}>{children}</span>;
}

/** A definition strip for "what this thing is" — label above value, wraps at 390px. */
export function KeyValues({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="con-kv">
      {items.map((i) => (
        <div key={i.label}>
          <dt>{i.label}</dt>
          <dd>{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The grouped index of every admin screen. Rendered twice: as the console home page's content
 * (`headings` — real `<h2>`s under the page's `<h1>`) and inside the layout's navigation
 * disclosure (`labels` — the same text as plain labels, because a heading above the page's own
 * `<h1>` puts the document outline out of order on every admin screen).
 */
export function AdminIndex({ current, variant = 'labels', idPrefix = 'index' }: { current?: string; variant?: 'headings' | 'labels'; idPrefix?: string }) {
  return (
    <div className="con-index">
      {ADMIN_SECTIONS.map((section) => {
        const labelId = `${idPrefix}-${section.id}`;
        return (
          <section key={section.id} aria-labelledby={labelId}>
            {variant === 'headings' ? (
              <h2 id={labelId} className="con-index__label">
                {section.label}
              </h2>
            ) : (
              <p id={labelId} className="con-index__label">
                {section.label}
              </p>
            )}
            <ul className="list list--plain con-index__list">
              {section.screens.map((screen) => (
                <li key={screen.href}>
                  <Link href={screen.href} aria-current={screen.href === current ? 'page' : undefined}>
                    {screen.label}
                  </Link>
                  <span className="con-index__blurb">{screen.blurb}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
