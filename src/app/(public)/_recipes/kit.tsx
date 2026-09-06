import Link from 'next/link';
import type { ReactNode } from 'react';
import { FreshnessBadge, ProvenanceLine, Text } from '@/components/provenance';
import { formatMinutes } from '@/domain/adventures/itineraries';
import { humanize } from '@/domain/content/format';
import type { HandoffView, OperationalFieldView, ProvenanceViewData, RecommendationCard, RecommendationSummary } from '@/domain/content/views';
import { ROUTES } from '@/domain/routes';
import './placeholder.css';

/**
 * Minimal placeholder kit (swarm C). Structure and accessibility only; Swarm B's theme kit
 * (Shell, Section, Card, Badge, MapHandoff, ...) replaces these with the real expressions.
 */

export const NAV = [
  { href: '/', label: 'Home' },
  { href: ROUTES.story, label: 'Our Story' },
  { href: ROUTES.adventures, label: 'Our Adventures' },
  { href: ROUTES.share, label: 'Share an Adventure' },
  { href: ROUTES.wedding, label: 'The Wedding' },
  { href: ROUTES.exploreCaa, label: 'Explore CAA' },
  { href: ROUTES.ask, label: 'Ask Us' },
] as const;

export function Shell({ current, children }: { current: string; children: ReactNode }) {
  return (
    <>
      <a className="wp-skip" href="#main">
        Skip to content
      </a>
      <header className="wp-header">
        <p className="wp-brand">
          <Link href="/">Sara + Tyler</Link>
        </p>
        <nav aria-label="Site">
          <ul className="wp-nav">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link href={n.href} aria-current={n.href === current ? 'page' : undefined}>
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main" className="wp-main">
        {children}
      </main>
      <footer className="wp-footer">
        <p>Sara + Tyler · Saturday, July 17, 2027 · Chicago Athletic Association Hotel, 12 S Michigan Ave, Chicago, IL 60603</p>
      </footer>
    </>
  );
}

export function PageIntro({ eyebrow, title, lede, children }: { eyebrow: string; title: string; lede?: ReactNode; children?: ReactNode }) {
  return (
    <header className="wp-intro">
      <p className="wp-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {lede ? <p className="wp-lede">{lede}</p> : null}
      {children}
    </header>
  );
}

export function Section({ id, number, title, children }: { id: string; number?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="wp-section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>
        {number ? (
          <span className="wp-section__num" aria-hidden="true">
            {number}
          </span>
        ) : null}
        {title}
      </h2>
      {children}
    </section>
  );
}

export function DraftBadge({ draft, placeholder }: { draft?: boolean; placeholder?: boolean }) {
  if (!draft && !placeholder) return null;
  return (
    <ul className="wp-badges" aria-label="Status">
      {draft ? <li className="wp-badge wp-badge--draft">Draft — not yet curated</li> : null}
      {placeholder ? <li className="wp-badge">Details to come</li> : null}
    </ul>
  );
}

export function ChipLinks({ items, label }: { items: { href: string; label: string; active?: boolean }[]; label: string }) {
  return (
    <ul className="wp-chips" aria-label={label}>
      {items.map((i) => (
        <li key={i.href}>
          <Link className="wp-chip" href={i.href} aria-current={i.active ? 'true' : undefined}>
            {i.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** An explicit external handoff: provider named, new tab, disclosure printed. */
export function Handoff({ handoff }: { handoff: HandoffView }) {
  return (
    <li>
      <a className="wp-handoff" href={handoff.url} target={handoff.opensNewTab ? '_blank' : undefined} rel="noopener noreferrer external">
        {handoff.label}
      </a>
      <p className="wp-handoff__disclosure">{handoff.disclosure}</p>
    </li>
  );
}

export function Handoffs({ handoffs }: { handoffs: RecommendationCard['handoffs'] }) {
  const list = [handoffs.directions, handoffs.booking, handoffs.official].filter((h): h is HandoffView => !!h);
  if (!list.length) return null;
  return (
    <ul className="wp-handoffs" aria-label="Go there">
      {list.map((h) => (
        <Handoff key={h.url} handoff={h} />
      ))}
    </ul>
  );
}

export function OperationalRow({ field }: { field: OperationalFieldView }) {
  return (
    <li className="wp-card" data-expired={field.expired ? 'true' : undefined} data-key={field.key}>
      <h3>
        {field.url && !field.expired ? (
          <a href={field.url} rel="noopener noreferrer external" target="_blank">
            {field.label}
          </a>
        ) : (
          field.label
        )}
      </h3>
      {field.value ? <p>{field.value}</p> : null}
      {field.note ? (
        <p className="wp-muted">
          <Text block={field.note} inline />
        </p>
      ) : null}
      <ProvenanceLine provenance={field.provenance}>
        <FreshnessBadge provenance={field.provenance} />
      </ProvenanceLine>
    </li>
  );
}

export function RecommendationCardView({ card, headingLevel = 3 }: { card: RecommendationCard; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <article className="wp-card" data-recommendation={card.slug}>
      <H>
        <Link href={card.href}>{card.title}</Link>
      </H>
      <DraftBadge draft={card.draft} placeholder={card.placeholder} />
      <p>
        <Text block={card.what} inline />
      </p>
      <dl className="wp-meta">
        <dt>Kind</dt>
        <dd>{humanize(card.category)}</dd>
        {card.place ? (
          <>
            <dt>Where</dt>
            <dd>
              {card.place.name}
              {card.place.address ? (
                <>
                  {', '}
                  <Text block={card.place.address} inline />
                </>
              ) : card.place.city ? `, ${card.place.city}` : null}
            </dd>
          </>
        ) : null}
        {card.durationMinutes ? (
          <>
            <dt>Plan on</dt>
            <dd>{formatMinutes(card.durationMinutes)}</dd>
          </>
        ) : null}
        {card.distanceFromCaa ? (
          <>
            <dt>From the CAA</dt>
            <dd>
              <Text block={card.distanceFromCaa} inline />
            </dd>
          </>
        ) : null}
        {card.cost ? (
          <>
            <dt>Cost</dt>
            <dd>
              <Text block={card.cost} inline />
            </dd>
          </>
        ) : null}
        {card.accessibility ? (
          <>
            <dt>Accessibility</dt>
            <dd>
              <Text block={card.accessibility} inline />
            </dd>
          </>
        ) : null}
        {card.kidFriendly !== null ? (
          <>
            <dt>With kids</dt>
            <dd>{card.kidFriendly ? 'Yes' : 'Better without'}</dd>
          </>
        ) : null}
      </dl>
      {card.operational ? (
        <p>
          Hours and menus:{' '}
          {card.operational.url ? (
            <a href={card.operational.url} rel="noopener noreferrer external" target="_blank">
              {card.operational.label} on the official page
            </a>
          ) : (
            card.operational.label
          )}{' '}
          <FreshnessBadge provenance={card.operational.provenance} />
        </p>
      ) : null}
      <Handoffs handoffs={card.handoffs} />
      {card.why ? (
        <details className="wp-why">
          <summary>Why we&rsquo;re sharing this →</summary>
          <p>
            <Text block={card.why.text} inline />
          </p>
          <p>
            <Link href={card.why.experienceHref}>Read the memory: {card.why.experienceTitle}</Link>
          </p>
        </details>
      ) : null}
      <ProvenanceLine provenance={card.provenance}>{card.provenance.external ? <FreshnessBadge provenance={card.provenance} /> : null}</ProvenanceLine>
    </article>
  );
}

export function StopLine({ recommendation, minutes, note }: { recommendation: RecommendationSummary; minutes?: number; note?: string }) {
  return (
    <li>
      <Link href={recommendation.href}>{recommendation.title}</Link>
      {recommendation.placeName ? <span className="wp-muted"> · {recommendation.placeName}</span> : null}
      {minutes ?? recommendation.durationMinutes ? <span className="wp-muted"> · {formatMinutes(minutes ?? recommendation.durationMinutes!)}</span> : null}
      {note ? <span className="wp-muted"> · {note}</span> : null}
      {recommendation.placeholder ? <span className="wp-badge"> details to come</span> : null}
    </li>
  );
}

export function Provenance({ provenance, freshness = false }: { provenance: ProvenanceViewData; freshness?: boolean }) {
  return <ProvenanceLine provenance={provenance}>{freshness ? <FreshnessBadge provenance={provenance} /> : null}</ProvenanceLine>;
}
