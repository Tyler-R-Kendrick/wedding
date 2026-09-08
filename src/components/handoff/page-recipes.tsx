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
import { GuestCard, GuestSection } from '@/themes/guest';
import type { ThemeId } from '@/themes/types';

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

/** A recipe that renders the active design's own sections and cards, so it needs to know which. */
export interface ThemedPageRecipe<D> {
  (props: { data: D; theme: ThemeId }): React.JSX.Element;
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
  if (at < 0) return <p className="measure">{text}</p>;
  const fact = text.slice(0, at).trim();
  return (
    <>
      {fact ? <p className="measure">{fact}</p> : null}
      <Placeholder>{placeholderHint(text.slice(at))}</Placeholder>
    </>
  );
}

export const TransportationPageRecipe: ThemedPageRecipe<TransportationPageData> = ({ data, theme }) => {
  const claimable = data.benefits.filter((b) => b.status === 'eligible' || b.status === 'failed');
  const claimed = data.benefits.filter((b) => b.status === 'claimed');
  const other = data.benefits.filter((b) => !claimable.includes(b) && !claimed.includes(b));
  // `page` and `page__title` are the guest kit (`components/rsvp/recipes.css`); the SECTIONS and
  // CARDS are the active design's own (`themes/<id>/guest.tsx`). `.sec` gave every section a 1px
  // full-width rule and a left-aligned heading, which Gilded Hour's DESIGN.md contradicts and
  // Conservatory's forbids by name — and it looked identical under both designs, which is what an
  // independent review measured here as zero themed elements inside `<main>`.
  return (
    <div className="page">
      <HandoffClickRecorder />
      <header>
        <h1 className="page__title">Getting here, getting around, getting home.</h1>
        <p className="page__lede">The wedding is at the Chicago Athletic Association Hotel, 12 S Michigan Ave. Everything below is meant to take the guesswork out of the day so you can relax and dance.</p>
      </header>

      <GuestSection theme={theme} id="ride-benefit" index={0} title="Your ride home">
        {!data.signedIn ? (
          <p className="mt-3 measure">
            Ride benefits are personal. Open this page from your invitation link to see whether one is waiting for you.{' '}
            <Link className="underline underline-offset-4" href={data.signInRoute}>
              Find your invitation
            </Link>
            .
          </p>
        ) : data.benefits.length === 0 ? (
          <p className="mt-3 measure">There is no ride benefit on your invitation yet. If you were expecting one, ask us and we will sort it out.</p>
        ) : null}
        {claimed.map((b) => (
          <RedemptionCard key={b.entitlementId} benefit={b} />
        ))}
        {claimable.map((b) => (
          <div key={b.entitlementId} data-benefit-status={b.status}>
            <GuestCard theme={theme} title="A ride benefit is waiting for you">
            <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1">
              <dt className="text-primary">Amount</dt>
              <dd>{b.amountNote ?? 'To be confirmed'}</dd>
              <dt className="text-primary">Valid</dt>
              <dd>{b.validityNote ?? 'To be confirmed'}</dd>
              <dt className="text-primary">Area</dt>
              <dd>{b.geofenceNote ?? 'To be confirmed'}</dd>
            </dl>
            <p className="mt-3 measure">{b.statusMessage}</p>
            <ClaimBenefitFlow entitlementId={b.entitlementId} program={b.program} />
            </GuestCard>
          </div>
        ))}
        {other.map((b) => (
          <div key={b.entitlementId} data-benefit-status={b.status}>
            <GuestCard theme={theme} title="Ride benefit">
              <p className="measure">{b.statusMessage}</p>
            </GuestCard>
          </div>
        ))}
      </GuestSection>

      {data.topics.map((t, i) => (
        <GuestSection theme={theme} key={t.id} id={`topic-${t.id}`} index={i + 1} title={t.title}>
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
        </GuestSection>
      ))}
      <footer className="wp-guest-foot">
        <p className="hint">Questions? <Link className="underline underline-offset-4" href="/ask-us">Ask us</Link>.</p>
      </footer>
    </div>
  );
};

export type GiftsPageData = GiftLinks;

export const GiftsPageRecipe: PageRecipe<GiftsPageData> = ({ data }) => {
  const registry = data.links.filter((l) => l.kind === 'registry');
  const adventures = data.links.filter((l) => l.kind === 'adventure-fund');
  const pending = !registry.length || !adventures.length || data.links.some((l) => l.placeholder);
  return (
    <main id="main" className="bg-neutral text-primary">
      <HandoffClickRecorder />
      <header className={SECTION}>
        <h1 className="text-3xl leading-tight">{data.copy.title}</h1>
        <p className="mt-4 measure text-lg">{data.copy.lede}</p>
      </header>
      <section className={SECTION} aria-labelledby="gifts-registry">
        <h2 id="gifts-registry" className="text-2xl">
          {data.copy.registryHeading}
        </h2>
        {/* The intro describes a list that is kept with a provider. Until one exists it is a claim the
            site has no right to make — and it used to render directly above the placeholder saying
            the couple have not chosen where to keep it. It appears with the links, or not at all. */}
        {registry.length ? <p className="mt-3 measure">{data.copy.registryIntro}</p> : null}
        <div className="mt-4">
          {registry.length ? registry.map((l) => <GiftLinkCard key={l.id} link={l} />) : <Placeholder>{data.copy.registryPending}</Placeholder>}
        </div>
      </section>
      <section className={SECTION} aria-labelledby="gifts-adventures">
        <h2 id="gifts-adventures" className="text-2xl">
          {data.copy.adventureHeading}
        </h2>
        {adventures.length ? <p className="mt-3 measure">{data.copy.adventureIntro}</p> : null}
        <div className="mt-4">
          {adventures.length ? adventures.map((l) => <GiftLinkCard key={l.id} link={l} />) : <Placeholder>{data.copy.adventurePending}</Placeholder>}
        </div>
      </section>
      <footer className={SECTION}>
        {data.links.length ? <p className="measure hint">{data.copy.handoffNote}</p> : null}
        {pending ? (
          <div className="mt-2 measure">
            <Placeholder>{data.copy.placeholderNote}</Placeholder>
          </div>
        ) : null}
        {pending ? (
          <p className="mt-4 measure">
            {data.copy.askIntro}{' '}
            <Link className="underline underline-offset-4" href="/ask-us">
              {data.copy.askLabel}
            </Link>
            .
          </p>
        ) : null}
        <p className="mt-6 text-lg">{data.copy.thanks}</p>
      </footer>
    </main>
  );
};
