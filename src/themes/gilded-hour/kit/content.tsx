import type { ReactNode } from 'react';
import { FreshnessBadge, Paragraphs, Placeholder as PlaceholderBlock, ProvenanceLine, Text as Block, placeholderHint } from '@/components/provenance';
import { formatMinutes } from '@/domain/adventures/itineraries';
import { formatDate, humanize } from '@/domain/content/format';
import type { HandoffView, ItineraryView, OperationalFieldView, ProvenanceViewData, RecommendationCard as RecommendationCardData, TextBlockView } from '@/domain/content/views';
import type { ContentKit, StopItem } from '@/themes/content-types';
import { CONTENT_COPY, OFFICIAL_LINK_ATTRS, chapterLabel, handoffAttrs, handoffList, stopMeta } from '@/themes/shared/content';

/*
 * Gilded Hour content primitives. Everything sits on the one centred axis: title plaques, a gold
 * spine for the story, ledgers (ruled rows) for archives and links, a diptych for the two voices,
 * a floor plan with corner brackets for the rooms, docent numerals for "look for this".
 */

const ExternalMark = ({ provider }: { provider?: string }) => (
  <>
    <svg className="gh-external" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M14 4h6v6M20 4l-9 9M18 13v7H4V6h7" />
    </svg>
    <span className="sr-only">{provider ? `, opens ${provider}` : ', opens in a new site'}</span>
  </>
);

const pad = (n: number) => String(n).padStart(2, '0');

function PageHead({ eyebrow, title, lede, children }: { eyebrow: string; title: ReactNode; lede?: ReactNode; children?: ReactNode }) {
  return (
    <header className="gh-pagehead">
      <div className="gh-pagehead__inner">
        <p className="gh-eyebrow">{eyebrow}</p>
        <hr className="gh-divider" />
        <h1 className="gh-h gh-h--1 gh-pagehead__title">{title}</h1>
        {lede ? <p className="gh-lede gh-pagehead__lede">{lede}</p> : null}
        {children ? <div className="gh-pagehead__facts">{children}</div> : null}
      </div>
    </header>
  );
}

function ProseBlock({ blocks, lead, children }: { blocks: readonly TextBlockView[]; lead?: boolean; children?: ReactNode }) {
  return (
    <div className={`gh-prose${lead ? ' gh-prose--lead' : ''}`}>
      <Paragraphs blocks={blocks} />
      {children}
    </div>
  );
}

function Provenance({ provenance, freshness = false }: { provenance: ProvenanceViewData; freshness?: boolean }) {
  return (
    <div className="gh-prov">
      <ProvenanceLine provenance={provenance}>{freshness ? <FreshnessBadge provenance={provenance} /> : null}</ProvenanceLine>
    </div>
  );
}

function StoryTimeline({ sections }: Parameters<ContentKit['StoryTimeline']>[0]) {
  return (
    <ol className="gh-spine" aria-label="Chapters">
      {sections.map((s, i) => (
        <li key={s.id} id={s.slug} className="gh-spine__act">
          <span className="gh-plaque gh-plaque--act gh-spine__plaque" aria-hidden="true">
            {pad(i + 1)}
          </span>
          <span className="sr-only">Chapter {i + 1}.</span>
          <p className="gh-eyebrow">{chapterLabel(s.chapter)}</p>
          <h2 className="gh-h gh-h--2 gh-spine__title">{s.title}</h2>
          <StatusFlags placeholder={s.placeholder} />
          <ProseBlock blocks={s.paragraphs} lead={i === 0} />
          <Provenance provenance={s.provenance} />
        </li>
      ))}
    </ol>
  );
}

function MemoryCard({ memory, sara, tyler, accessibility, provenance }: Parameters<ContentKit['MemoryCard']>[0]) {
  return (
    <div className="gh-memory">
      <div className="gh-prose gh-prose--lead">{memory.length ? <Paragraphs blocks={memory} /> : <PlaceholderBlock>{placeholderHint(`TODO(Tyler & Sara): ${CONTENT_COPY.adventureDetail.notWritten}`)}</PlaceholderBlock>}</div>
      {sara || tyler ? (
        <div className="gh-diptych">
          {sara ? (
            <section className="gh-diptych__leaf" aria-labelledby="sara-remembers">
              <h3 id="sara-remembers" className="gh-diptych__voice">
                Sara remembers
              </h3>
              <p>
                <Block block={sara} inline />
              </p>
            </section>
          ) : null}
          {tyler ? (
            <section className="gh-diptych__leaf" aria-labelledby="tyler-remembers">
              <h3 id="tyler-remembers" className="gh-diptych__voice">
                Tyler remembers
              </h3>
              <p>
                <Block block={tyler} inline />
              </p>
            </section>
          ) : null}
        </div>
      ) : null}
      {accessibility ? (
        <p className="gh-prose gh-memory__access">
          <strong>Accessibility:</strong> <Block block={accessibility} inline />
        </p>
      ) : null}
      <Provenance provenance={provenance} />
    </div>
  );
}

function Chips({ items, label }: Parameters<ContentKit['Chips']>[0]) {
  return (
    <ul className="gh-chips" aria-label={label}>
      {items.map((i) => (
        <li key={i.href}>
          <a className="gh-chip" href={i.href} aria-current={i.active ? 'true' : undefined}>
            {i.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

function StatusFlags({ draft, placeholder }: { draft?: boolean; placeholder?: boolean }) {
  if (!draft && !placeholder) return null;
  return (
    <ul className="gh-flags" aria-label="Status">
      {draft ? <li className="gh-badge gh-badge--pending">{CONTENT_COPY.flags.draft}</li> : null}
      {placeholder ? <li className="gh-badge gh-badge--info">{CONTENT_COPY.flags.placeholder}</li> : null}
    </ul>
  );
}

function MetaList({ items }: Parameters<ContentKit['MetaList']>[0]) {
  if (!items.length) return null;
  return (
    <dl className="gh-meta">
      {items.map((i, n) => (
        <div key={`${i.label}-${n}`} className="gh-meta__row">
          <dt className="gh-meta__label">{i.label}</dt>
          <dd className="gh-meta__value">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function AdventureList({ items }: Parameters<ContentKit['AdventureList']>[0]) {
  return (
    <ul className="gh-ledger" aria-label="Adventures">
      {items.map((a, i) => (
        <li key={a.id} className="gh-ledger__row">
          <article className="gh-entry" data-adventure={a.slug}>
            <span className="gh-entry__num" aria-hidden="true">
              {pad(i + 1)}
            </span>
            <div className="gh-entry__body">
              <h2 className="gh-entry__title">
                <a className="gh-link" href={a.href}>
                  {a.title}
                </a>
              </h2>
              <StatusFlags placeholder={a.placeholder} />
              <p className="gh-entry__summary">
                <Block block={a.summary} inline />
              </p>
              <MetaList
                items={[
                  ...(a.placeName ? [{ label: 'Where', value: a.placeName }] : []),
                  ...(a.dateLabel ? [{ label: 'When', value: <Block block={a.dateLabel} inline /> }] : []),
                  ...(a.tags.length ? [{ label: 'Motifs', value: a.tags.map(humanize).join(', ') }] : []),
                ]}
              />
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}

function Handoffs({ handoffs, label }: { handoffs: HandoffView[]; label: string }) {
  if (!handoffs.length) return null;
  return (
    <ul className="gh-handoffs" aria-label={label}>
      {handoffs.map((h) => (
        <li key={h.url} className="gh-handoffs__item">
          <a className="gh-btn gh-btn--external" {...handoffAttrs(h)}>
            <span>{h.label}</span>
            <ExternalMark provider={h.provider} />
          </a>
          <p className="gh-handoffs__disclosure">{h.disclosure}</p>
        </li>
      ))}
    </ul>
  );
}

function RecommendationCard({ card, headingLevel = 3 }: { card: RecommendationCardData; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? 'h2' : 'h3';
  const place = card.place ? (
    <>
      {card.place.name}
      {card.place.address ? (
        <>
          {', '}
          <Block block={card.place.address} inline />
        </>
      ) : card.place.city ? (
        `, ${card.place.city}`
      ) : null}
    </>
  ) : null;
  return (
    <article className="gh-rec" data-recommendation={card.slug}>
      <div className="gh-rec__inner">
        <p className="gh-eyebrow">{humanize(card.category)}</p>
        <H className="gh-rec__title">
          <a className="gh-link" href={card.href}>
            {card.title}
          </a>
        </H>
        <StatusFlags draft={card.draft} placeholder={card.placeholder} />
        <p className="gh-rec__what">
          <Block block={card.what} inline />
        </p>
        <MetaList
          items={[
            ...(place ? [{ label: 'Where', value: place }] : []),
            ...(card.durationMinutes ? [{ label: 'Plan on', value: formatMinutes(card.durationMinutes) }] : []),
            ...(card.distanceFromCaa ? [{ label: 'From the CAA', value: <Block block={card.distanceFromCaa} inline /> }] : []),
            ...(card.cost ? [{ label: 'Cost', value: <Block block={card.cost} inline /> }] : []),
            ...(card.accessibility ? [{ label: 'Accessibility', value: <Block block={card.accessibility} inline /> }] : []),
            ...(card.kidFriendly !== null ? [{ label: 'With kids', value: card.kidFriendly ? 'Yes' : 'Better without' }] : []),
          ]}
        />
        {card.operational ? (
          <p className="gh-rec__hours">
            Hours and menus:{' '}
            {card.operational.url ? (
              <a className="gh-link" href={card.operational.url} {...OFFICIAL_LINK_ATTRS}>
                {card.operational.label} on the official page
                <ExternalMark />
              </a>
            ) : (
              card.operational.label
            )}{' '}
            <FreshnessBadge provenance={card.operational.provenance} />
          </p>
        ) : null}
        <Handoffs handoffs={handoffList(card.handoffs)} label="Go there" />
        {card.why ? (
          <details className="gh-why">
            <summary className="gh-why__summary">{CONTENT_COPY.why.summary} →</summary>
            <p>
              <Block block={card.why.text} inline />
            </p>
            <p>
              <a className="gh-link" href={card.why.experienceHref}>
                {CONTENT_COPY.why.read}: {card.why.experienceTitle}
              </a>
            </p>
          </details>
        ) : null}
        <ProvenanceLine provenance={card.provenance}>{card.provenance.external ? <FreshnessBadge provenance={card.provenance} /> : null}</ProvenanceLine>
      </div>
    </article>
  );
}

function StopList({ stops, label }: { stops: StopItem[]; label: string }) {
  return (
    <ol className="gh-stops" aria-label={label}>
      {stops.map((s, i) => (
        <li key={`${s.recommendation.id}-${i}`} className="gh-stops__stop">
          <span className="gh-stops__num" aria-hidden="true">
            {pad(i + 1)}
          </span>
          <span className="gh-stops__body">
            <a className="gh-link" href={s.recommendation.href}>
              {s.recommendation.title}
            </a>
            {stopMeta(s).map((m) => (
              <span key={m} className="gh-stops__meta">
                {' · '}
                {m}
              </span>
            ))}
            {s.recommendation.placeholder ? <span className="gh-badge gh-badge--info">{CONTENT_COPY.flags.placeholder}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

function ItineraryCard({ itinerary: it }: { itinerary: ItineraryView; index: number }) {
  return (
    <article className="gh-card gh-itinerary" data-itinerary={it.slug} id={it.slug}>
      <div className="gh-card__inner">
        <span className="gh-plaque gh-plaque--label" aria-hidden="true">
          {humanize(it.bucket)}
        </span>
        <h3 className="gh-card__title">{it.title}</h3>
        <StatusFlags draft={it.draft} placeholder={it.placeholder} />
        {it.intro ? (
          <p>
            <Block block={it.intro} inline />
          </p>
        ) : null}
        {it.stops.length ? <StopList stops={it.stops} label={`${it.title}: stops`} /> : null}
        {it.stops.length ? <p className="gh-muted">About {formatMinutes(it.totalMinutes)} in total.</p> : null}
        <ProvenanceLine provenance={it.provenance} />
      </div>
    </article>
  );
}

function LookForList({ items, label }: Parameters<ContentKit['LookForList']>[0]) {
  return (
    <ol className="gh-docent" aria-label={label}>
      {items.map((i, n) => (
        <li key={i.id} className="gh-docent__item">
          <span className="gh-docent__num" aria-hidden="true">
            {pad(n + 1)}
          </span>
          <span className="gh-docent__text">{i.text}</span>
        </li>
      ))}
    </ol>
  );
}

function RoomGrid({ spaces }: Parameters<ContentKit['RoomGrid']>[0]) {
  return (
    <ul className="gh-floorplan" aria-label="Event spaces">
      {spaces.map((s, i) => (
        <li key={s.id} className="gh-floorplan__cell">
          <article className="gh-room" data-space={s.slug}>
            <span className="gh-room__num" aria-hidden="true">
              {pad(i + 1)}
            </span>
            <h3 className="gh-room__name">
              <a className="gh-link" href={s.href}>
                {s.name}
              </a>
            </h3>
            <p className="gh-room__character">{s.character}</p>
            <p className="gh-room__capacity">
              {s.capacities.ceremony ? `Ceremony ${s.capacities.ceremony}` : null}
              {s.capacities.dinnerDance ? ` · Dinner ${s.capacities.dinnerDance}` : null}
              {s.capacities.reception ? ` · Reception ${s.capacities.reception}` : null}
            </p>
            <p className="gh-room__note">{s.capacities.note}</p>
          </article>
        </li>
      ))}
    </ul>
  );
}

function CapacityTable({ capacities }: Parameters<ContentKit['CapacityTable']>[0]) {
  return (
    <div className="gh-scroll">
      <table className="gh-table">
        <caption className="gh-table__caption">{capacities.note}</caption>
        <thead>
          <tr>
            <th scope="col">Ceremony</th>
            <th scope="col">Dinner and dancing</th>
            <th scope="col">Reception</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{capacities.ceremony ?? '—'}</td>
            <td>{capacities.dinnerDance ?? '—'}</td>
            <td>{capacities.reception ?? '—'}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function OutletRow({ field }: { field: OperationalFieldView }) {
  return (
    <li className="gh-ledger__row gh-outlet" data-key={field.key} data-expired={field.expired ? 'true' : undefined}>
      <h3 className="gh-outlet__label">
        {field.url && !field.expired ? (
          <a className="gh-link" href={field.url} {...OFFICIAL_LINK_ATTRS}>
            {field.label}
            <ExternalMark />
          </a>
        ) : (
          field.label
        )}
      </h3>
      {field.value ? <p className="gh-outlet__value">{field.value}</p> : null}
      {field.note ? (
        <p className="gh-muted">
          <Block block={field.note} inline />
        </p>
      ) : null}
      <ProvenanceLine provenance={field.provenance}>
        <FreshnessBadge provenance={field.provenance} />
      </ProvenanceLine>
    </li>
  );
}

function OutletList({ fields, label }: Parameters<ContentKit['OutletList']>[0]) {
  return (
    <ul className="gh-ledger gh-ledger--outlets" aria-label={label}>
      {fields.map((f) => (
        <OutletRow key={f.id} field={f} />
      ))}
    </ul>
  );
}

function FactList({ facts, label }: Parameters<ContentKit['FactList']>[0]) {
  return (
    <ol className="gh-facts" aria-label={label}>
      {facts.map((f, i) => (
        <li key={f.id} id={`fact-${f.slug}`} className="gh-facts__item">
          <span className="gh-facts__num" aria-hidden="true">
            {pad(i + 1)}
          </span>
          <span className="gh-facts__text">
            {f.statement}
            {f.note ? <span className="gh-facts__note"> {f.note}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Programme({ events, venueName, startNumber }: Parameters<ContentKit['Programme']>[0]) {
  return (
    <ol className="gh-programme" aria-label="Order of the day">
      {events.map((e, i) => (
        <li key={e.id} id={e.id} className="gh-programme__act">
          <span className="gh-plaque gh-plaque--act" aria-hidden="true">
            {pad(startNumber + i)}
          </span>
          <span className="sr-only">Part {startNumber + i}.</span>
          <h2 className="gh-h gh-h--2">{e.name}</h2>
          <MetaList
            items={[
              {
                label: 'When',
                value: (
                  <>
                    <time dateTime={e.dateIso}>{e.weekdayLabel}</time>
                    {' · '}
                    <Block block={e.timeLabel} inline />
                  </>
                ),
              },
              {
                label: 'Where',
                value: (
                  <>
                    {venueName}
                    {' · '}
                    <Block block={e.room} inline />
                  </>
                ),
              },
            ]}
          />
          <ProseBlock blocks={e.whatHappens} />
        </li>
      ))}
    </ol>
  );
}

function FaqList({ entries, labelFor }: Parameters<ContentKit['FaqList']>[0]) {
  return (
    <div className="gh-faq">
      {entries.map((e) => (
        <article key={e.id} id={e.slug} className="gh-faq__entry" aria-labelledby={`faq-${e.slug}`}>
          <h3 id={`faq-${e.slug}`} className="gh-faq__q">
            {e.question}
          </h3>
          <StatusFlags placeholder={e.placeholder} />
          <div className="gh-prose gh-faq__a">
            <Block block={e.answer} />
            {e.route ? (
              <p>
                <a className="gh-link" href={e.route}>
                  See {labelFor(e.route)} →
                </a>
              </p>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function SearchResults({ search }: Parameters<ContentKit['SearchResults']>[0]) {
  return (
    <div id="search-results" className="gh-results" aria-live="polite">
      {search.results.length === 0 ? (
        <p className="gh-prose">
          {CONTENT_COPY.ask.none}{' '}
          <a className="gh-link" href="#contact">
            {CONTENT_COPY.ask.reach}
          </a>{' '}
          {CONTENT_COPY.ask.noneTail}
        </p>
      ) : (
        <ul className="gh-ledger" aria-label="Search results">
          {search.results.map((r) => (
            <li key={r.id} className="gh-ledger__row gh-result">
              <h3 className="gh-result__title">
                <a className="gh-link" href={r.route}>
                  {r.title}
                </a>
              </h3>
              <p>{r.snippet}</p>
              <p className="gh-muted">
                {humanize(r.kind)} · checked <time dateTime={r.verifiedAt}>{formatDate(r.verifiedAt)}</time>
                {r.caveat ? ` · ${r.caveat}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <p className="gh-back">
      <a className="gh-link" href={href}>
        ← {children}
      </a>
    </p>
  );
}

export const content: ContentKit = {
  PageHead,
  StoryTimeline,
  ProseBlock,
  MemoryCard,
  Chips,
  StatusFlags,
  MetaList,
  AdventureList,
  RecommendationCard,
  Handoffs,
  StopList,
  ItineraryCard,
  LookForList,
  RoomGrid,
  CapacityTable,
  OutletList,
  FactList,
  Programme,
  FaqList,
  SearchResults,
  Provenance,
  BackLink,
};
