import type { ReactNode } from 'react';
import { Placeholder } from '@/components/provenance/Placeholder';
import type { GuestHandoff } from '@/domain/external/handoff';

export interface ExternalHandoffCardProps {
  handoff: GuestHandoff;
  /** Card heading (the place, the registry, the benefit). */
  heading: string;
  note?: string | null;
  /** Editorial placeholder: the couple have not supplied the real link yet. */
  placeholder?: boolean;
  /** The provider is a mock: say so, loudly, so nobody mistakes it for a live credit. */
  testMode?: boolean;
  /** Extra guest-facing status or provenance line. */
  meta?: ReactNode;
  /** Server-side handoff capability to record the click through (progressive enhancement: the link works without JS). */
  recordVia?: { capability: string; input: Record<string, unknown> };
}

/**
 * The one way an outbound link is shown to a guest: names the provider, says what happens
 * next, opens in a new tab, and prints the full URL. It never claims that anything was done.
 */
export function ExternalHandoffCard({ handoff, heading, note, placeholder, testMode, meta, recordVia }: ExternalHandoffCardProps) {
  return (
    <article className="border-t border-primary/20 py-6" data-handoff-provider={handoff.provider} data-handoff-host={handoff.host}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h3 className="text-xl">{heading}</h3>
        <p className="hint">via {handoff.providerDisplayName}</p>
      </div>
      {note ? <p className="mt-2 measure text-primary">{note}</p> : null}
      {/* One placeholder, one contract. This was a hand-rolled <p> whose only "this is a note"
          signal was an `sr-only` word — invisible to a sighted guest, and the same defect shape as
          the marker the level fixed elsewhere — plus a dead `italic` (`font-synthesis: none` is set
          globally and neither design ships an italic text face, so it rendered upright). The shared
          component carries the visible stamp, `role="note"` and `data-placeholder="true"`, which is
          what makes the honesty invariant machine-checkable. Voice is first person: PRODUCT.md sets
          "first person plural for the couple", and this card sat 40px from "Sara + Tyler are still
          writing this" while saying "Sara and Tyler". */}
      {placeholder ? (
        <div className="mt-2 measure">
          <Placeholder>we have not added the real link yet, so this one goes to the provider’s home page</Placeholder>
        </div>
      ) : null}
      {testMode ? <p className="mt-2 hint">Test mode: this credit is not real.</p> : null}
      {meta ? <div className="mt-2 hint">{meta}</div> : null}
      <p className="mt-4">
        <a
          /*
           * `.btn` (components/rsvp/recipes.css), not Tailwind utilities. This is the only action
           * on `/gifts`, and it shipped `px-7 py-3 text-base` — Tailwind's own scale, which
           * survives beside the named steps because nothing resets it — so the page's CTA answered
           * to neither DESIGN.md while every other control on it is tracked and uppercase in
           * Gilded Hour. `.btn` is written against the tokens, so each design restyles it.
           *
           * The better end state is the active theme kit's `Button variant="external"`, which
           * already carries each design's padding, type and radius and emits its own external mark.
           * That needs a theme threaded into this shared card, which several routes render; this
           * change removes the hard-coded scale without that refactor.
           */
          className="btn btn--primary"
          href={handoff.url}
          target={handoff.opensNewTab ? '_blank' : undefined}
          rel="noopener noreferrer external"
          data-record-capability={recordVia?.capability}
          data-record-input={recordVia ? JSON.stringify(recordVia.input) : undefined}
        >
          {handoff.label}
          <span aria-hidden="true">↗</span>
          <span className="sr-only">(opens {handoff.providerDisplayName} in a new tab)</span>
        </a>
      </p>
      <p className="mt-3 measure hint">{handoff.disclosure}</p>
      <p className="hidden print:block">{handoff.url}</p>
    </article>
  );
}
