'use client';

import { lazy, Suspense, useState } from 'react';
import './concierge.css';

/**
 * The lazy slot. The panel (and the streaming decoder with it) is only fetched once a guest asks
 * for it, so every page that offers the concierge stays as light as it was without one. Before
 * that, and whenever JavaScript never arrives, the surrounding page's own answers are the product:
 * the FAQ, the search form and the page links all work on their own.
 */
const ConciergePanel = lazy(() => import('./ConciergePanel'));

export interface ConciergeSlotProps {
  /** Overridable so a test or a preview can point at a different endpoint. */
  chatRoute?: string;
  /** Copy shown before the panel is opened. */
  invitation?: string;
}

export function ConciergeSlot({ chatRoute, invitation }: ConciergeSlotProps) {
  const [open, setOpen] = useState(false);
  if (open) {
    return (
      <Suspense fallback={<p className="cq__meta">Opening the concierge…</p>}>
        <ConciergePanel {...(chatRoute ? { chatRoute } : {})} />
      </Suspense>
    );
  }
  return (
    <div className="cq">
      <p className="cq__intro">
        {invitation ?? 'Ask a question in your own words. The concierge answers only from what this site knows, shows you the page each fact came from, and says when something is not decided yet.'}
      </p>
      <p className="cq__start">
        <button className="cq__button" type="button" onClick={() => setOpen(true)} data-testid="concierge-open">
          Ask the concierge
        </button>
      </p>
    </div>
  );
}

export default ConciergeSlot;
