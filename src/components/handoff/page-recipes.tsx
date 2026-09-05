import Link from 'next/link';
import type { TransportationOptions } from '@/capabilities/get_my_transportation_options';
import type { GiftLinks } from '@/capabilities/list_gift_links';
import { ClaimBenefitFlow } from './ClaimBenefitFlow';
import { ExternalHandoffCard } from './ExternalHandoffCard';
import { GiftLinkCard } from './GiftLinkCard';
import { HandoffClickRecorder } from './HandoffClickRecorder';
import { RedemptionCard } from './RedemptionCard';

/**
 * PageRecipe seam. Pages fetch theme-agnostic data through capabilities and render a recipe;
 * the theme engine (Swarm B) supplies themed recipes with the same `PageData` props and
 * replaces these plain server components at integration. Tokens only; no raw colours or fonts.
 */
export interface TransportationPageData extends TransportationOptions {
  /** Sign-in route for anonymous visitors (the identity swarm's claim flow). */
  signInRoute: string;
}

export interface PageRecipe<D> {
  (props: { data: D }): React.JSX.Element;
}

const SECTION = 'mx-auto w-full max-w-[42rem] px-5 py-10';
const EYEBROW = 'text-[0.75rem] uppercase tracking-[0.14em] text-primary/70';

function Paragraph({ text }: { text: string }) {
  const placeholder = text.startsWith('TODO(Tyler & Sara)');
  return placeholder ? (
    <p className="max-w-[65ch] italic text-primary/70" data-placeholder="true">
      <span className="sr-only">Still to be confirmed: </span>
      {text}
    </p>
  ) : (
    <p className="max-w-[65ch]">{text}</p>
  );
}

export const TransportationPageRecipe: PageRecipe<TransportationPageData> = ({ data }) => {
  const claimable = data.benefits.filter((b) => b.status === 'eligible' || b.status === 'failed');
  const claimed = data.benefits.filter((b) => b.status === 'claimed');
  const other = data.benefits.filter((b) => !claimable.includes(b) && !claimed.includes(b));
  return (
    <main id="main" className="bg-neutral text-primary">
      <HandoffClickRecorder />
      <header className={SECTION}>
        <p className={EYEBROW}>Transportation</p>
        <h1 className="mt-2 text-3xl leading-tight">Getting here, getting around, getting home.</h1>
        <p className="mt-4 max-w-[65ch] text-lg">The wedding is at the Chicago Athletic Association Hotel, 12 S Michigan Ave. Everything below is meant to take the guesswork out of the day so you can relax and dance.</p>
      </header>

      <section className={SECTION} aria-labelledby="ride-benefit">
        <p className={EYEBROW}>Your ride home</p>
        <h2 id="ride-benefit" className="mt-2 text-2xl">
          Ride benefit
        </h2>
        {!data.signedIn ? (
          <p className="mt-3 max-w-[65ch]">
            Ride benefits are personal. Open this page from your invitation link to see whether one is waiting for you.{' '}
            <Link className="underline underline-offset-4" href={data.signInRoute}>
              Find your invitation
            </Link>
            .
          </p>
        ) : data.benefits.length === 0 ? (
          <p className="mt-3 max-w-[65ch]">There is no ride benefit on your invitation yet. If you were expecting one, ask us and we will sort it out.</p>
        ) : null}
        {claimed.map((b) => (
          <RedemptionCard key={b.entitlementId} benefit={b} />
        ))}
        {claimable.map((b) => (
          <article key={b.entitlementId} className="border-t border-primary/20 py-6" data-benefit-status={b.status}>
            <h3 className="text-xl">A ride benefit is waiting for you</h3>
            <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1">
              <dt className="text-primary/70">Amount</dt>
              <dd>{b.amountNote ?? 'To be confirmed'}</dd>
              <dt className="text-primary/70">Valid</dt>
              <dd>{b.validityNote ?? 'To be confirmed'}</dd>
              <dt className="text-primary/70">Area</dt>
              <dd>{b.geofenceNote ?? 'To be confirmed'}</dd>
            </dl>
            <p className="mt-3 max-w-[65ch]">{b.statusMessage}</p>
            <ClaimBenefitFlow entitlementId={b.entitlementId} program={b.program} />
          </article>
        ))}
        {other.map((b) => (
          <article key={b.entitlementId} className="border-t border-primary/20 py-6" data-benefit-status={b.status}>
            <h3 className="text-xl">Ride benefit</h3>
            <p className="mt-2 max-w-[65ch]">{b.statusMessage}</p>
          </article>
        ))}
      </section>

      {data.topics.map((t, i) => (
        <section key={t.id} className={SECTION} aria-labelledby={`topic-${t.id}`}>
          <p className={EYEBROW}>{String(i + 1).padStart(2, '0')}</p>
          <h2 id={`topic-${t.id}`} className="mt-2 text-2xl">
            {t.title}
          </h2>
          <div className="mt-3 space-y-3">
            {t.paragraphs.map((p) => (
              <Paragraph key={p} text={p} />
            ))}
          </div>
          {t.directions ? (
            <p className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
              <a className="inline-flex min-h-11 items-center underline underline-offset-4" href={t.directions.google.url} target="_blank" rel="noopener noreferrer external">
                {t.directions.google.label}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              <a className="inline-flex min-h-11 items-center underline underline-offset-4" href={t.directions.apple.url} target="_blank" rel="noopener noreferrer external">
                {t.directions.apple.label}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </p>
          ) : null}
          {t.official ? <ExternalHandoffCard heading="On the hotel’s site" handoff={t.official} meta={<span>Checked <time dateTime={t.verifiedAt}>{new Date(t.verifiedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</time></span>} /> : null}
        </section>
      ))}
      <footer className={SECTION}>
        <p className="text-sm text-primary/70">Questions? <Link className="underline underline-offset-4" href="/ask-us">Ask us</Link>.</p>
      </footer>
    </main>
  );
};

export type GiftsPageData = GiftLinks;

export const GiftsPageRecipe: PageRecipe<GiftsPageData> = ({ data }) => {
  const registry = data.links.filter((l) => l.kind === 'registry');
  const adventures = data.links.filter((l) => l.kind === 'adventure-fund');
  const anyPlaceholder = data.links.some((l) => l.placeholder);
  return (
    <main id="main" className="bg-neutral text-primary">
      <HandoffClickRecorder />
      <header className={SECTION}>
        <p className={EYEBROW}>{data.copy.eyebrow}</p>
        <h1 className="mt-2 text-3xl leading-tight">{data.copy.title}</h1>
        <p className="mt-4 max-w-[65ch] text-lg">{data.copy.lede}</p>
      </header>
      <section className={SECTION} aria-labelledby="gifts-registry">
        <p className={EYEBROW}>01</p>
        <h2 id="gifts-registry" className="mt-2 text-2xl">
          {data.copy.registryHeading}
        </h2>
        <p className="mt-3 max-w-[65ch]">{data.copy.registryIntro}</p>
        <div className="mt-4">
          {registry.map((l) => (
            <GiftLinkCard key={l.id} link={l} />
          ))}
        </div>
      </section>
      <section className={SECTION} aria-labelledby="gifts-adventures">
        <p className={EYEBROW}>02</p>
        <h2 id="gifts-adventures" className="mt-2 text-2xl">
          {data.copy.adventureHeading}
        </h2>
        <p className="mt-3 max-w-[65ch]">{data.copy.adventureIntro}</p>
        <div className="mt-4">
          {adventures.map((l) => (
            <GiftLinkCard key={l.id} link={l} />
          ))}
        </div>
      </section>
      <footer className={SECTION}>
        <p className="max-w-[65ch] text-sm text-primary/70">{data.copy.handoffNote}</p>
        {anyPlaceholder ? (
          <p className="mt-2 max-w-[65ch] text-sm italic text-primary/70" data-placeholder="true">
            {data.copy.placeholderNote}
          </p>
        ) : null}
        <p className="mt-6 text-lg">{data.copy.thanks}</p>
      </footer>
    </main>
  );
};
