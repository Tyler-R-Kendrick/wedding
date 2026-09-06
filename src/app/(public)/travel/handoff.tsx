import type { ExternalHandoff } from '@/contracts/providers';

/**
 * Explicit external hand-off: the provider is named, the guest is told they are leaving, and
 * the URL was already checked against the redirect allowlist by the capability that produced it.
 * Renders on the server and in client components alike (no hooks).
 */
export function HandoffLink({ handoff, className = '' }: { handoff: ExternalHandoff; className?: string }) {
  const newTab = handoff.opensNewTab;
  return (
    <a
      href={handoff.url}
      target={newTab ? '_blank' : undefined}
      rel={newTab ? 'noopener noreferrer external' : 'external'}
      className={`inline-flex min-h-11 items-center gap-2 rounded-sm border border-primary bg-primary px-4 py-2 text-base font-medium text-neutral underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${className}`}
    >
      {handoff.label}
      {newTab ? <span className="sr-only"> (opens in a new tab)</span> : null}
    </a>
  );
}

export function HandoffList({ handoffs, heading }: { handoffs: ExternalHandoff[]; heading: string }) {
  if (handoffs.length === 0) return null;
  return (
    <div className="mt-4">
      <h4 className="text-base font-semibold">{heading}</h4>
      <ul className="mt-2 flex flex-col gap-3">
        {handoffs.map((h) => (
          <li key={`${h.provider}-${h.url}`} className="flex flex-col gap-1">
            <HandoffLink handoff={h} />
            <p className="hint">{h.disclosure}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
