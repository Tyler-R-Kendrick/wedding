import type { BenefitView } from '@/domain/transport/service';
import { ExternalHandoffCard } from './ExternalHandoffCard';

/** What a guest sees once their ride benefit is claimed: an "Open in Uber" handoff or their personal code. */
export function RedemptionCard({ benefit }: { benefit: BenefitView }) {
  const r = benefit.redemption;
  const claimedAt = benefit.claim?.claimedAt ? new Date(benefit.claim.claimedAt) : undefined;
  const meta = claimedAt ? (
    <span>
      Claimed <time dateTime={claimedAt.toISOString()}>{claimedAt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })}</time>
      {r && r.kind !== 'hidden' && r.expiresAt ? <> · valid until <time dateTime={r.expiresAt}>{new Date(r.expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })}</time></> : null}
    </span>
  ) : null;
  if (!r || r.kind === 'hidden') {
    return (
      <article className="border-t border-primary/20 py-6" data-benefit-status={benefit.status}>
        <h3 className="text-xl">Your ride benefit</h3>
        <p className="mt-2 max-w-[65ch]">{benefit.statusMessage}</p>
      </article>
    );
  }
  if (r.kind === 'link') {
    return (
      <ExternalHandoffCard
        heading="Your ride home"
        handoff={{ provider: benefit.claim?.provider ?? 'uber', providerDisplayName: r.providerDisplayName, label: r.label, url: r.url, host: r.host, opensNewTab: true, disclosure: r.disclosure }}
        note={benefit.amountNote ? `${benefit.amountNote}${benefit.validityNote ? ` · ${benefit.validityNote}` : ''}` : benefit.validityNote}
        testMode={benefit.claim?.testMode}
        meta={meta}
      />
    );
  }
  return (
    <article className="border-t border-primary/20 py-6" data-benefit-status={benefit.status} data-handoff-provider="manual-code">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h3 className="text-xl">Your ride code</h3>
        <p className="text-[0.75rem] uppercase tracking-[0.14em] text-primary/70">personal to you</p>
      </div>
      <p className="mt-4 select-all font-mono text-2xl tracking-[0.12em]" aria-label="Your ride code">
        {r.code}
      </p>
      <p className="mt-3 max-w-[65ch] text-sm text-primary/70">{r.instructions}</p>
      {meta ? <p className="mt-2 text-sm text-primary/70">{meta}</p> : null}
    </article>
  );
}
