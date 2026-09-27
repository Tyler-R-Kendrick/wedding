import type { ReactNode } from 'react';
import './flow.css';

/*
 * How a console screen lists the things it manages, and where their actions live.
 *
 * Every screen used to build this itself: a table with a form per row (a confirm checkbox and a red
 * button repeated down the page), a second form beside the table to "add or change" a row by typing
 * its id, and a `?edit=` round trip that reloaded the page to fill that form in. The pattern now:
 *
 *   - `RecordList` / `RecordRow`: one row per thing, its name and state first, its details under it,
 *     its actions (quiet text buttons that open flows) on the right. Hairlines, not cards.
 *   - Dense data that is read across columns (the audit trail, the job queue, RSVP counts) stays a
 *     `DataTable`; its actions cell holds the same quiet flow triggers.
 *   - `FilterBar`: search and filters stay plain GET forms. They change what is shown, not what is
 *     saved, so they are not flows.
 *
 * Server-safe: no hooks. The flows and quick actions inside a row are the client islands.
 */

export type PillTone = 'neutral' | 'good' | 'warn' | 'bad';

/**
 * A short state beside a name ("Shown", "Hidden"). Here, not in `console.tsx`, so client components
 * (a queue, a flow's preview) can use it: `console.tsx` reads request headers and is server-only.
 */
export function Pill({ tone = 'neutral', children }: { tone?: PillTone; children: ReactNode }) {
  return <span className={`con-pill con-pill--${tone}`}>{children}</span>;
}

export function RecordList({ label, children, empty }: { label: string; children: ReactNode; empty?: ReactNode }) {
  if (empty) {
    return (
      <p className="flow-empty" role="status">
        {empty}
      </p>
    );
  }
  return (
    <ul className="flow-rows" role="list" aria-label={label}>
      {children}
    </ul>
  );
}

export function RecordRow({
  title,
  status,
  meta,
  actions,
  children,
  ...data
}: {
  title: ReactNode;
  /** Pills after the name: `<Pill tone="good">Shown</Pill>`. */
  status?: ReactNode;
  /** One muted line of details under the name. */
  meta?: ReactNode;
  actions?: ReactNode;
  /** Anything longer than a line, under the details. */
  children?: ReactNode;
  /** `data-*` attributes pass through, so tests and styles can address a row by its id. */
  [data: `data-${string}`]: string | undefined;
}) {
  return (
    <li className="flow-row" {...data}>
      <div className="flow-row__main">
        <p className="flow-row__title">
          {title} {status}
        </p>
        {meta ? <p className="flow-row__meta">{meta}</p> : null}
        {children}
      </div>
      {actions ? <div className="flow-row__actions">{actions}</div> : null}
    </li>
  );
}

/**
 * A search/filter form. GET, so the result is a URL an admin can reload or share, and it works
 * without scripts. `children` are the fields (`Input`, `Checkbox` from `_components/ops`).
 */
export function FilterBar({ children, submitLabel = 'Search', action, extra }: { children: ReactNode; submitLabel?: string; action?: string; extra?: ReactNode }) {
  return (
    <form method="get" action={action} className="flow-filter" role="search">
      {children}
      <button type="submit" className="ops-button ops-button-ghost">
        {submitLabel}
      </button>
      {extra ? <span className="flow-filter__extra">{extra}</span> : null}
    </form>
  );
}
