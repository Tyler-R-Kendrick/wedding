import type { ReactNode } from 'react';

export interface ConfirmationRow {
  label: string;
  value: ReactNode;
}

export interface ConfirmationCardProps {
  /** One line under the heading saying what to do ("Please review before you confirm."). */
  lede?: string;
  title: string;
  rows: ConfirmationRow[];
  /** What the guest is agreeing to, before they press anything. */
  disclosure?: string;
  children?: ReactNode;
}

/** The review card a guest reads before a consequential step: what, with whom, what happens next. */
export function ConfirmationCard({ lede = 'Please review before you confirm.', title, rows, disclosure, children }: ConfirmationCardProps) {
  return (
    <section className="border border-primary/20 p-6" aria-labelledby={`confirm-${slug(title)}`}>
      <h3 id={`confirm-${slug(title)}`} className="text-xl">
        {title}
      </h3>
      <p className="mt-1 hint">{lede}</p>
      <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-primary">{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
      {disclosure ? <p className="mt-4 max-w-[65ch] hint">{disclosure}</p> : null}
      {children ? <div className="mt-5 flex flex-wrap gap-3">{children}</div> : null}
    </section>
  );
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
