import type { CSSProperties, ReactNode } from 'react';
import { FreshnessBadge, Paragraphs, Placeholder as PlaceholderBlock, ProvenanceLine, Text as Block, placeholderHint } from '@/components/provenance';
import { formatMinutes } from '@/domain/adventures/itineraries';
import { formatDate, humanize } from '@/domain/content/format';
import { guestText } from '@/domain/content/text';
import type { HandoffView, ItineraryView, OperationalFieldView, ProvenanceViewData, RecommendationCard as RecommendationCardData, TextBlockView } from '@/domain/content/views';
import type { ContentKit, StopItem } from '@/themes/content-types';
import { CONTENT_COPY, OFFICIAL_LINK_ATTRS, chapterLabel, destinationLabel, handoffAttrs, handoffList, providerLabel, stopMeta } from '@/themes/shared/content';

/*
 * Conservatory content primitives. Everything is mounted on the herbarium sheet: a dashed stem
 * with leaves for sequences, pressed cards (tilted, flower-stamped) for records, kraft tags for
 * filters and labels, jar labels for the operational rows, field notes for cited statements.
 */

const FLOWERS = ['a', 'b', 'c'] as const;
const flowerAt = (i: number) => FLOWERS[i % FLOWERS.length];
const tilt = (i: number): CSSProperties => ({ ['--i' as string]: i } as CSSProperties);

function Leaf({ className = 'cv-leaf' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      <path d="M4 20C4 10 10 4 20 4c0 10-6 16-16 16z" fill="var(--color-leaf)" stroke="var(--color-leaf-deep)" strokeWidth="1.25" strokeLinejoin="round" />
      <path d="M4 20 20 4" fill="none" stroke="var(--color-leaf-deep)" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The visible link text names the destination ("… on chicagoathletichotel.com", "Open directions in
 * Google Maps"), so the mark only announces that the link leaves the site. `opens` is a display
 * name for the cases where the text cannot carry it — never a raw provider slug.
 */
const ExternalMark = ({ opens }: { opens?: string }) => (
  <>
    <svg className="cv-external" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M14 4h6v6M20 4l-9 9M18 13v7H4V6h7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    <span className="sr-only">{`, opens ${opens ?? 'in a new tab'}`}</span>
  </>
);

function PageHead({ eyebrow, title, lede, children }: { eyebrow: string; title: ReactNode; lede?: ReactNode; children?: ReactNode }) {
  return (
    <header className="cv-pagehead">
      <p className="cv-pagehead__tag">
        <span className="cv-specimen cv-specimen--static">{eyebrow}</span>
      </p>
      <h1 className="cv-h cv-h--1 cv-pagehead__title">{title}</h1>
      {lede ? <p className="cv-lede">{lede}</p> : null}
      {children ? <div className="cv-pagehead__facts">{children}</div> : null}
    </header>
  );
}

function ProseBlock({ blocks, lead, children }: { blocks: readonly TextBlockView[]; lead?: boolean; children?: ReactNode }) {
  return (
    <div className={`cv-prose${lead ? ' cv-prose--lead' : ''}`}>
      <Paragraphs blocks={blocks} />
      {children}
    </div>
  );
}

function Provenance({ provenance, freshness = false }: { provenance: ProvenanceViewData; freshness?: boolean }) {
  return (
    <div className="cv-prov">
      <ProvenanceLine provenance={provenance}>{freshness ? <FreshnessBadge provenance={provenance} /> : null}</ProvenanceLine>
    </div>
  );
}

function StoryTimeline({ sections }: Parameters<ContentKit['StoryTimeline']>[0]) {
  return (
    <ol className="cv-stem" aria-label="Chapters">
      {sections.map((s, i) => (
        <li key={s.id} id={s.slug} className="cv-stem__node">
          <Leaf className="cv-leaf cv-stem__leaf" />
          <div className="cv-stem__body">
            <span className="cv-specimen cv-specimen--static">{chapterLabel(s.chapter)}</span>
            <h2 className="cv-h cv-h--2 cv-stem__title">{s.title}</h2>
            <StatusFlags placeholder={s.placeholder} />
            <ProseBlock blocks={s.paragraphs} lead={i === 0} />
            <Provenance provenance={s.provenance} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function MemoryCard({ memory, sara, tyler, accessibility, provenance }: Parameters<ContentKit['MemoryCard']>[0]) {
  return (
    <div className="cv-memory">
      <div className="cv-prose cv-prose--lead">{memory.length ? <Paragraphs blocks={memory} /> : <PlaceholderBlock>{placeholderHint(`TODO(Tyler & Sara): ${CONTENT_COPY.adventureDetail.notWritten}`)}</PlaceholderBlock>}</div>
      {sara || tyler ? (
        <div className="cv-voices">
          {sara ? (
            <section className="cv-card cv-pressed cv-voice" data-flower="a" style={tilt(0)} aria-labelledby="sara-remembers">
              <span className="cv-specimen">Sara</span>
              <h3 id="sara-remembers" className="cv-voice__name">
                Sara remembers
              </h3>
              <p className="cv-voice__text">
                <Block block={sara} inline />
              </p>
            </section>
          ) : null}
          {tyler ? (
            <section className="cv-card cv-pressed cv-voice cv-voice--second" data-flower="c" style={tilt(1)} aria-labelledby="tyler-remembers">
              <span className="cv-specimen">Tyler</span>
              <h3 id="tyler-remembers" className="cv-voice__name">
                Tyler remembers
              </h3>
              <p className="cv-voice__text">
                <Block block={tyler} inline />
              </p>
            </section>
          ) : null}
        </div>
      ) : null}
      {accessibility ? (
        <p className="cv-prose cv-memory__access">
          <strong>Accessibility:</strong> <Block block={accessibility} inline />
        </p>
      ) : null}
      <Provenance provenance={provenance} />
    </div>
  );
}

function Chips({ items, label }: Parameters<ContentKit['Chips']>[0]) {
  return (
    <ul className="cv-tags" aria-label={label}>
      {items.map((i) => (
        <li key={i.href}>
          <a className={`cv-tag${i.active ? ' is-current' : ''}`} href={i.href} aria-current={i.active ? 'true' : undefined}>
            <span>{i.label}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function StatusFlags({ draft, placeholder }: { draft?: boolean; placeholder?: boolean }) {
  if (!draft && !placeholder) return null;
  return (
    <ul className="cv-flags" aria-label="Status">
      {draft ? <li className="cv-chip cv-chip--pending">{CONTENT_COPY.flags.draft}</li> : null}
      {placeholder ? <li className="cv-chip cv-chip--info">{CONTENT_COPY.flags.placeholder}</li> : null}
    </ul>
  );
}

function MetaList({ items }: Parameters<ContentKit['MetaList']>[0]) {
  if (!items.length) return null;
  return (
    <dl className="cv-stats cv-meta">
      {items.map((i, n) => (
        <div key={`${i.label}-${n}`} className="cv-stat">
          <dt className="cv-stat__label">{i.label}</dt>
          <dd className="cv-stat__value">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function AdventureList({ items }: Parameters<ContentKit['AdventureList']>[0]) {
  return (
    <ul className="cv-mount" aria-label="Adventures">
      {items.map((a, i) => (
        <li key={a.id} className="cv-mount__item">
          <article className="cv-card cv-pressed cv-specimen-card" data-adventure={a.slug} data-flower={flowerAt(i)} style={tilt(i)}>
            <span className="cv-specimen">{a.season ? humanize(a.season) : a.placeName ?? 'Adventure'}</span>
            <h2 className="cv-card__title">
              <a className="cv-link" href={a.href}>
                {a.title}
              </a>
            </h2>
            <div className="cv-card__body">
              <StatusFlags placeholder={a.placeholder} />
              <p>
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
    <ul className="cv-handoffs" aria-label={label}>
      {handoffs.map((h) => (
        <li key={h.url} className="cv-handoffs__item">
          <a className="cv-btn cv-btn--external" {...handoffAttrs(h)}>
            <span>{h.label}</span>
            <ExternalMark opens={providerLabel(h.provider)} />
          </a>
          <p className="cv-handoffs__disclosure">{h.disclosure}</p>
        </li>
      ))}
    </ul>
  );
}

function RecommendationCard({ card, headingLevel = 3 }: { card: RecommendationCardData; headingLevel?: 2 | 3 | 4 }) {
  const H = headingLevel === 2 ? 'h2' : headingLevel === 4 ? 'h4' : 'h3';
  // On the recommendation's own page the card is the page: the way there comes before the details.
  const leads = headingLevel === 2;
  const handoffs = <Handoffs handoffs={handoffList(card.handoffs)} label="Go there" />;
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
    <article className="cv-card cv-rec" data-recommendation={card.slug}>
      <span className="cv-specimen">{humanize(card.category)}</span>
      {leads ? (
        <H className="sr-only">{card.title}</H>
      ) : (
        <H className="cv-card__title">
          <a className="cv-link" href={card.href}>
            {card.title}
          </a>
        </H>
      )}
      <div className="cv-card__body">
        <StatusFlags draft={card.draft} placeholder={card.placeholder} />
        <p className="cv-rec__what">
          <Block block={card.what} inline />
        </p>
        {leads ? handoffs : null}
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
          <p className="cv-rec__hours">
            Hours and menus:{' '}
            {card.operational.url ? (
              <a className="cv-link" href={card.operational.url} {...OFFICIAL_LINK_ATTRS}>
                {`${card.operational.label} on ${destinationLabel(card.operational.url)}`}
                <ExternalMark />
              </a>
            ) : (
              card.operational.label
            )}{' '}
            <FreshnessBadge provenance={card.operational.provenance} />
          </p>
        ) : null}
        {leads ? null : handoffs}
        {card.why ? (
          <details className="cv-why">
            <summary className="cv-why__summary">{CONTENT_COPY.why.summary} →</summary>
            <p>
              <Block block={card.why.text} inline />
            </p>
            <p>
              <a className="cv-link" href={card.why.experienceHref}>
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
    <ol className="cv-vine cv-vine--stops" aria-label={label}>
      {stops.map((s, i) => (
        <li key={`${s.recommendation.id}-${i}`} className="cv-vine__stop">
          <Leaf />
          <div className="cv-vine__detail">
            <a className="cv-link" href={s.recommendation.href}>
              {s.recommendation.title}
            </a>
            {stopMeta(s).length ? <p className="cv-vine__meta">{stopMeta(s).join(' · ')}</p> : null}
            {s.recommendation.placeholder ? <span className="cv-chip cv-chip--info">{CONTENT_COPY.flags.placeholder}</span> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function ItineraryCard({ itinerary: it, index }: { itinerary: ItineraryView; index: number }) {
  return (
    <article className="cv-card cv-pressed cv-itinerary" data-itinerary={it.slug} id={it.slug} data-flower={flowerAt(index)} style={tilt(index)}>
      <span className="cv-specimen">{humanize(it.bucket)}</span>
      <h3 className="cv-card__title">{it.title}</h3>
      <div className="cv-card__body">
        <StatusFlags draft={it.draft} placeholder={it.placeholder} />
        {it.intro ? (
          <p>
            <Block block={it.intro} inline />
          </p>
        ) : null}
        {it.stops.length ? <StopList stops={it.stops} label={`${it.title}: stops`} /> : null}
        {it.stops.length ? <p className="cv-muted">About {formatMinutes(it.totalMinutes)} in total.</p> : null}
        <ProvenanceLine provenance={it.provenance} />
      </div>
    </article>
  );
}

function LookForList({ items, label }: Parameters<ContentKit['LookForList']>[0]) {
  return (
    <ol className="cv-lookfor" aria-label={label}>
      {items.map((i) => (
        <li key={i.id} className="cv-lookfor__item">
          <Leaf className="cv-leaf cv-lookfor__leaf" />
          <span className="cv-lookfor__text">{guestText(i.text)}</span>
        </li>
      ))}
    </ol>
  );
}

function RoomGrid({ spaces }: Parameters<ContentKit['RoomGrid']>[0]) {
  return (
    <ul className="cv-mount cv-mount--rooms" aria-label="Event spaces">
      {spaces.map((s, i) => (
        <li key={s.id} className="cv-mount__item">
          <article className="cv-card cv-pressed cv-room" data-space={s.slug} data-flower={flowerAt(i)} style={tilt(i)}>
            <span className="cv-specimen">{s.capacities.reception ? `Up to ${s.capacities.reception}` : 'Event space'}</span>
            <h3 className="cv-card__title">
              <a className="cv-link" href={s.href}>
                {s.name}
              </a>
            </h3>
            <div className="cv-card__body">
              <p>{guestText(s.character)}</p>
              <p className="cv-muted">{guestText(s.capacities.note)}</p>
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}

function CapacityTable({ capacities }: Parameters<ContentKit['CapacityTable']>[0]) {
  return (
    <div className="cv-scroll" role="region" aria-label="Capacity figures" tabIndex={0}>
      <table className="cv-table">
        <caption className="cv-table__caption">{guestText(capacities.note)}</caption>
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

function JarRow({ field }: { field: OperationalFieldView }) {
  const open = field.url && !field.expired ? field.url : null;
  return (
    <li className="cv-jar" data-key={field.key} data-expired={field.expired ? 'true' : undefined}>
      <div className="cv-jar__label">
        {/* The heading is the name. The link is its own control, so "opens …" never enters a heading's accessible name. */}
        <h3 className="cv-jar__name">{guestText(field.label)}</h3>
        {field.value ? <p className="cv-jar__value">{guestText(field.value)}</p> : null}
      </div>
      <div className="cv-jar__body">
        {field.note ? (
          <p className="cv-muted">
            <Block block={field.note} inline />
          </p>
        ) : null}
        {open ? (
          <p className="cv-jar__link">
            <a className="cv-link" href={open} {...OFFICIAL_LINK_ATTRS}>
              {`${field.label} on ${destinationLabel(open)}`}
              <ExternalMark />
            </a>
          </p>
        ) : null}
        <ProvenanceLine provenance={field.provenance}>
          <FreshnessBadge provenance={field.provenance} />
        </ProvenanceLine>
      </div>
    </li>
  );
}

function OutletList({ fields, label }: Parameters<ContentKit['OutletList']>[0]) {
  return (
    <ul className="cv-jars" aria-label={label}>
      {fields.map((f) => (
        <JarRow key={f.id} field={f} />
      ))}
    </ul>
  );
}

function FactList({ facts, label }: Parameters<ContentKit['FactList']>[0]) {
  return (
    <ol className="cv-notes" aria-label={label}>
      {facts.map((f) => (
        <li key={f.id} id={`fact-${f.slug}`} className="cv-notes__item">
          <span className="cv-notes__cat">{humanize(f.category)}</span>
          <span className="cv-notes__text">
            {guestText(f.statement)}
            {f.note ? <span className="cv-notes__note"> {guestText(f.note)}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Programme({ events, venueName }: Parameters<ContentKit['Programme']>[0]) {
  return (
    <ol className="cv-vine cv-programme" aria-label="Order of the day">
      {events.map((e) => (
        <li key={e.id} id={e.id} className="cv-vine__stop cv-programme__stop">
          <Leaf />
          <div className="cv-vine__detail">
            <h2 className="cv-h cv-h--2 cv-programme__name">{e.name}</h2>
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
          </div>
        </li>
      ))}
    </ol>
  );
}

function FaqList({ entries, labelFor }: Parameters<ContentKit['FaqList']>[0]) {
  return (
    <div className="cv-faq">
      {entries.map((e) => (
        <article key={e.id} id={e.slug} className="cv-faq__entry" aria-labelledby={`faq-${e.slug}`}>
          <h3 id={`faq-${e.slug}`} className="cv-faq__q">
            {guestText(e.question)}
          </h3>
          <StatusFlags placeholder={e.placeholder} />
          <div className="cv-prose cv-faq__a">
            <Block block={e.answer} />
            {e.route ? (
              <p>
                <a className="cv-link" href={e.route}>
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
    <div id="search-results" className="cv-results" aria-live="polite">
      {search.results.length === 0 ? (
        <p className="cv-prose">
          {CONTENT_COPY.ask.none}{' '}
          <a className="cv-link" href="#contact">
            {CONTENT_COPY.ask.reach}
          </a>{' '}
          {CONTENT_COPY.ask.noneTail}
        </p>
      ) : (
        <ul className="cv-results__list" aria-label="Search results">
          {search.results.map((r, i) => (
            <li key={r.id} className="cv-card cv-pressed cv-result" data-flower={flowerAt(i)} style={tilt(i)}>
              <h3 className="cv-card__title cv-result__title">
                <a className="cv-link" href={r.route}>
                  {r.title}
                </a>
              </h3>
              <div className="cv-card__body">
                <p>{guestText(r.snippet)}</p>
                <p className="cv-muted">
                  {humanize(r.kind)} · checked <time dateTime={r.verifiedAt}>{formatDate(r.verifiedAt)}</time>
                  {r.caveat ? ` · ${r.caveat}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <p className="cv-back">
      <a className="cv-tag cv-tag--hang" href={href}>
        <span>← {children}</span>
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
