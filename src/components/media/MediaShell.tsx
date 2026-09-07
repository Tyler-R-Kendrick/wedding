import type { ReactNode } from 'react';
import './media.css';

/**
 * Page recipe for media surfaces: eyebrow + title + lede, then sections. Theme-agnostic markup;
 * the theme kit's variables paint it. Landmarks: <main id="main"> with a single h1.
 */
export function MediaPage({ eyebrow, title, lede, children, actions }: { eyebrow: string; title: string; lede?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <main id="main" className="media-page">
      <header className="media-page__head">
        <p className="media-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {lede ? <p className="media-lede">{lede}</p> : null}
        {actions ? <div className="media-actions">{actions}</div> : null}
      </header>
      {children}
    </main>
  );
}

export function MediaSection({ title, children, id }: { title?: string; id?: string; children: ReactNode }) {
  return (
    <section className="media-section" id={id} aria-labelledby={title && id ? `${id}-title` : undefined}>
      {title ? <h2 id={id ? `${id}-title` : undefined}>{title}</h2> : null}
      {children}
    </section>
  );
}

export function MediaEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="media-empty" role="status">
      <p>{children}</p>
    </div>
  );
}

export function StatusBadge({ label }: { label: string }) {
  return <span className="media-status">{label}</span>;
}

export function formatDuration(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
