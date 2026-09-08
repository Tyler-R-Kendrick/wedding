import Link from 'next/link';
import type { ReactNode } from 'react';
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

export function Section({ title, id, children, note }: { title: string; id: string; children: ReactNode; note?: ReactNode }) {
  return (
    // The id lands on the section, not on the heading: `#events` has to select the region a reader
    // (or a test) means by it, and the heading gets its own id for `aria-labelledby`.
    <section id={id} className="ops-section" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="ops-h2">
        {title}
      </h2>
      {note ? <p className="con-note">{note}</p> : null}
      {children}
    </section>
  );
}

/**
 * A real table in a scroll container, so wide operational data scrolls inside its own region
 * instead of making the page scroll sideways. `caption` is the accessible name.
 */
export function DataTable({ caption, head, children, dense = true }: { caption: string; head: ReactNode; children: ReactNode; dense?: boolean }) {
  return (
    <div className="ops-table-wrap con-scroll" tabIndex={0} role="region" aria-label={caption}>
      <table className={dense ? 'ops-table con-table' : 'ops-table'}>
        <caption className="con-caption">{caption}</caption>
        <thead>{head}</thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function EmptyRow({ span, children }: { span: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={span} className="con-empty">
        {children}
      </td>
    </tr>
  );
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

/** Numbers in tables are aligned on the decimal: tabular figures, right-aligned, one class. */
export const NUM = 'con-num';
