import type { ReactNode } from 'react';
import './media.css';

/**
 * Page recipe for media surfaces: title + lede, then sections. Theme-agnostic markup; the theme
 * kit's variables paint it.
 *
 * It renders a `<div>`, not a `<main>`: every route that uses it is inside the (guest) layout,
 * whose Shell — the active design's own — provides the document's single `<main id="main">`. The
 * two fallback recipes in `app/(public)/_recipes` render outside a Shell and carry their own.
 *
 * There is no eyebrow. It read "Photos & Video" directly above the h1 "Add your photos and
 * videos", and `impeccable detect` banned it outright on both guest pages in both designs —
 * "a tiny tracked uppercase or small-caps label sitting as its own block directly above a heading
 * is banned outright, repeated or not … the heading carries its own weight". It said the same of
 * "Sara + Tyler" over "Photos & Video", where the label also repeated the wordmark 50px above it.
 * The rule's own remedy is to delete the label, so it is deleted rather than restyled.
 */
export function MediaPage({ title, lede, children, actions }: { title: string; lede?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="media-page">
      <header className="media-page__head">
        <h1>{title}</h1>
        {lede ? <p className="media-lede">{lede}</p> : null}
        {actions ? <div className="media-actions">{actions}</div> : null}
      </header>
      {children}
    </div>
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
