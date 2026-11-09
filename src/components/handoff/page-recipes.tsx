import Link from 'next/link';
import { Placeholder } from '@/components/provenance/Placeholder';
import type { TransportationOptions } from '@/capabilities/get_my_transportation_options';
import type { GiftLinks } from '@/capabilities/list_gift_links';
import { ClaimBenefitFlow } from './ClaimBenefitFlow';
import { GiftFunds } from './GiftFunds';
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
        <h1 className="page__title">Your ride</h1>
        <p className="page__lede">A ride benefit on your invitation. It is personal to you, so the code or link below is yours alone.</p>
      </header>

      <GuestSection theme={theme} id="ride-benefit" index={0} title="Your ride home">
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
              {/* A benefit waiting on ride claims to open is still the guest's: say what it is. */}
              {b.status === 'unavailable' ? (
                <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1">
                  <dt className="text-primary">Amount</dt>
                  <dd>{b.amountNote ?? 'To be confirmed'}</dd>
                  <dt className="text-primary">Valid</dt>
                  <dd>{b.validityNote ?? 'To be confirmed'}</dd>
                  <dt className="text-primary">Area</dt>
                  <dd>{b.geofenceNote ?? 'To be confirmed'}</dd>
                </dl>
              ) : null}
              <p className="measure">{b.statusMessage}</p>
            </GuestCard>
          </div>
        ))}
      </GuestSection>

      {/* Trains, taxis, parking and directions are on Travel & Stay, once: this page used to repeat
          them under four more headings, which is how the same Blue Line sentence came to be on the
          site three times. */}
      <footer className="wp-guest-foot">
        <p className="hint">
          Trains, taxis and parking are on{' '}
          <Link className="underline underline-offset-4" href="/guests/travel#getting-around">
            Travel &amp; Stay
          </Link>
          . Questions?{' '}
          <Link className="underline underline-offset-4" href="/guests/ask-us">
            Ask us
          </Link>
          .
        </p>
      </footer>
    </div>
  );
};

export type GiftsPageData = GiftLinks;

export const GiftsPageRecipe: PageRecipe<GiftsPageData> = ({ data }) => {
  const registry = data.links.filter((l) => l.kind === 'registry');
  const adventures = data.links.filter((l) => l.kind === 'adventure-fund');
  const funds = data.funds.length > 0;
  const pending = !registry.length || (!adventures.length && !funds) || data.links.some((l) => l.placeholder);
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
        {funds ? (
          <div className="mt-3">
            <GiftFunds data={data} />
          </div>
        ) : null}
        {adventures.length ? <p className="mt-3 measure">{data.copy.adventureIntro}</p> : null}
        <div className="mt-4">
          {adventures.length ? adventures.map((l) => <GiftLinkCard key={l.id} link={l} />) : funds ? null : <Placeholder>{data.copy.adventurePending}</Placeholder>}
        </div>
      </section>
      <footer className={SECTION}>
        {data.links.length || funds ? <p className="measure hint">{data.copy.handoffNote}</p> : null}
        {pending ? (
          <div className="mt-2 measure">
            <Placeholder>{data.copy.placeholderNote}</Placeholder>
          </div>
        ) : null}
        {pending ? (
          <p className="mt-4 measure">
            {data.copy.askIntro}{' '}
            <Link className="underline underline-offset-4" href="/guests/ask-us">
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
