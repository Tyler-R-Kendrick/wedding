import type { ReactNode } from 'react';

/**
 * A table that may overflow sideways on a phone. The scroll container is focusable and named, so
 * it can be reached and scrolled from the keyboard (WCAG 2.1.1); without that, a mouse is the only
 * way to see the columns past the edge.
 */
export function ScrollableTable({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mi-table-wrap" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
