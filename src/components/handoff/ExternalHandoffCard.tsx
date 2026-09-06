import type { ReactNode } from 'react';
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
      {note ? <p className="mt-2 max-w-[65ch] text-primary">{note}</p> : null}
      {placeholder ? (
        <p className="mt-2 max-w-[65ch] italic text-primary">
          <span className="sr-only">Placeholder: </span>Not final yet: this link goes to the provider’s home page until Sara and Tyler add the real one.
        </p>
      ) : null}
      {testMode ? <p className="mt-2 hint">Test mode: this credit is not real.</p> : null}
      {meta ? <div className="mt-2 hint">{meta}</div> : null}
      <p className="mt-4">
        <a
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-7 py-3 text-base text-neutral no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
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
      <p className="mt-3 max-w-[65ch] hint">{handoff.disclosure}</p>
      <p className="hidden print:block">{handoff.url}</p>
    </article>
  );
}
