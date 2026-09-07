import Link from 'next/link';
import type { TransportationOptions } from '@/capabilities/get_my_transportation_options';
import type { GiftLinks } from '@/capabilities/list_gift_links';
import { Placeholder, placeholderHint } from '@/components/provenance/Placeholder';
import { PLACEHOLDER_MARKER } from '@/content/schemas';
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

/**
 * A topic paragraph, which may be a fact, a placeholder, or a fact that trails off into one.
 *
 * This used to print the authoring marker to the guest — literally `TODO(Tyler & Sara): which
 * airport we recommend` on /transportation — behind an `sr-only` "Still to be confirmed", so a
 * sighted guest got the marker with no label at all. It also tested `startsWith`, and two of the
 * seeded topics carry the marker mid-sentence ("the valet entrance is at 71 E Madison.
 * TODO(Tyler & Sara): the special event valet rate…"), which therefore rendered as plain fact.
 *
 * The marker is a split point, not text: everything before it is what the couple have confirmed and
 * stays a paragraph; everything after is the hint, handed to the shared `Placeholder` that names
 * who is still writing, visibly and to assistive tech alike.
 */
function Paragraph({ text }: { text: string }) {
  const at = text.indexOf(PLACEHOLDER_MARKER);
  if (at < 0) return <p className="max-w-[65ch]">{text}</p>;
  const fact = text.slice(0, at).trim();
  return (
    <>
      {fact ? <p className="max-w-[65ch]">{fact}</p> : null}
      <Placeholder>{placeholderHint(text.slice(at))}</Placeholder>
    </>
  );
}

export const TransportationPageRecipe: PageRecipe<TransportationPageData> = ({ data }) => {
  const claimable = data.benefits.filter((b) => b.status === 'eligible' || b.status === 'failed');
  const claimed = data.benefits.filter((b) => b.status === 'claimed');
  const other = data.benefits.filter((b) => !claimable.includes(b) && !claimed.includes(b));
  // `page`, `page__title`, `sec` and `sec__title` are the guest kit from `components/rsvp/recipes.css`,
  // which the (guest) layout already imports: they take the active design's DISPLAY face and its
  // 72ch measure. Before this the headings rendered in the theme's text face at a fixed `text-3xl`
  // and `main` ran the full viewport width — the page sat on the themed ground without being
  // composed by the design. Same treatment as /rsvp and /your-weekend at level 07.
  return (
    <main id="main" className="page">
      <HandoffClickRecorder />
      <header>
        <h1 className="page__title">Getting here, getting around, getting home.</h1>
        <p className="page__lede">The wedding is at the Chicago Athletic Association Hotel, 12 S Michigan Ave. Everything below is meant to take the guesswork out of the day so you can relax and dance.</p>
      </header>

      <section className="sec" aria-labelledby="ride-benefit">
        <h2 id="ride-benefit" className="sec__title">
          Your ride home
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
            <h3 className="sec__title sec__title--sm">A ride benefit is waiting for you</h3>
            <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1">
              <dt className="text-primary">Amount</dt>
              <dd>{b.amountNote ?? 'To be confirmed'}</dd>
              <dt className="text-primary">Valid</dt>
              <dd>{b.validityNote ?? 'To be confirmed'}</dd>
              <dt className="text-primary">Area</dt>
              <dd>{b.geofenceNote ?? 'To be confirmed'}</dd>
            </dl>
            <p className="mt-3 max-w-[65ch]">{b.statusMessage}</p>
            <ClaimBenefitFlow entitlementId={b.entitlementId} program={b.program} />
          </article>
        ))}
        {other.map((b) => (
          <article key={b.entitlementId} className="border-t border-primary/20 py-6" data-benefit-status={b.status}>
            <h3 className="sec__title sec__title--sm">Ride benefit</h3>
            <p className="mt-2 max-w-[65ch]">{b.statusMessage}</p>
          </article>
        ))}
      </section>

      {data.topics.map((t) => (
        <section key={t.id} className="sec" aria-labelledby={`topic-${t.id}`}>
          <h2 id={`topic-${t.id}`} className="sec__title">
            {t.title}
          </h2>
          <div className="mt-3 space-y-3">
            {/* Keyed by position, not by the text: a paragraph's text is the authoring string, so
                keying on it wrote `TODO(Tyler & Sara): …` into the RSC payload as a React key —
                invisible on the page but sitting in view-source. The list is a fixed, ordered
                array from the content record, so the index is a stable key. */}
            {t.paragraphs.map((p, i) => (
              <Paragraph key={`${t.id}-${i}`} text={p} />
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
      <footer className="sec">
        <p className="hint">Questions? <Link className="underline underline-offset-4" href="/ask-us">Ask us</Link>.</p>
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
        <h1 className="text-3xl leading-tight">{data.copy.title}</h1>
        <p className="mt-4 max-w-[65ch] text-lg">{data.copy.lede}</p>
      </header>
      <section className={SECTION} aria-labelledby="gifts-registry">
        <h2 id="gifts-registry" className="text-2xl">
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
        <h2 id="gifts-adventures" className="text-2xl">
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
        <p className="max-w-[65ch] hint">{data.copy.handoffNote}</p>
        {anyPlaceholder ? (
          <div className="mt-2 max-w-[65ch]">
            <Placeholder>{data.copy.placeholderNote}</Placeholder>
          </div>
        ) : null}
        <p className="mt-6 text-lg">{data.copy.thanks}</p>
      </footer>
    </main>
  );
};
