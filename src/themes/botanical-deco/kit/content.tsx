import type { ReactNode } from 'react';
import { FreshnessBadge, Paragraphs, Placeholder as PlaceholderBlock, ProvenanceLine, Text as Block, placeholderHint } from '@/components/provenance';
import { formatMinutes } from '@/domain/adventures/itineraries';
import { formatDate, humanize } from '@/domain/content/format';
import { guestText } from '@/domain/content/text';
import type { HandoffView, ItineraryView, OperationalFieldView, ProvenanceViewData, RecommendationCard as RecommendationCardData, TextBlockView } from '@/domain/content/views';
import type { ContentKit, StopItem } from '@/themes/content-types';
import { Botanical } from '../media';
import { CONTENT_COPY, OFFICIAL_LINK_ATTRS, chapterLabel, destinationLabel, handoffAttrs, handoffList, providerLabel, stopMeta } from '@/themes/shared/content';

/*
 * Botanical–Deco content primitives. Ivory sheets with a hairline edge, fine gold rules under
 * headings, a moss journey line for the story, calendar date tiles for the day, and the two voices
 * as facing leaves. Numerals appear only where order is information (itinerary stops, the day's
 * running order, the docent's walk); rooms, adventures and facts are not a sequence and are not
 * numbered.
 */

/**
 * A link's last word and its trailing mark, kept on one line: an arrow alone at the start of a line
 * reads as a stray glyph (review N7). A word joiner does not hold an inline SVG to its word in
 * Chromium, so the two share a no-wrap span.
 */
export function withTail(children: ReactNode, mark: ReactNode): ReactNode {
  if (typeof children !== 'string') {
    return (
      <>
        {children}
        {mark}
      </>
    );
  }
  const text = children.trimEnd();
  const i = text.lastIndexOf(' ');
  // One span around the whole label: several links are flex boxes (for their 44px target), and a
  // bare text node beside the no-wrap span would become a column of its own and lose its space.
  return (
    <span>
      {i > 0 ? text.slice(0, i + 1) : null}
      <span className="bd-nowrap">
        {i > 0 ? text.slice(i + 1) : text}
        {mark}
      </span>
    </span>
  );
}

/**
 * The visible link text names the destination ("… on chicagoathletichotel.com", "Open directions in
 * Google Maps"), so the mark only announces that the link leaves the site. `opens` is a display
 * name for the cases where the text cannot carry it — never a raw provider slug.
 */
const ExternalMark = ({ opens }: { opens?: string }) => (
  <>
    <svg className="bd-external" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M14 4h6v6M20 4l-9 9M18 13v7H4V6h7" />
    </svg>
    <span className="sr-only">{`, opens ${opens ?? 'in a new tab'}`}</span>
  </>
);

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Month, day and weekday of a calendar date, all derived from the date itself. The approved image
 * printed Wednesday/Thursday/Friday beside July 16/17/18; in 2027 those are Friday/Saturday/Sunday,
 * so no weekday is ever typed by hand. A bare `YYYY-MM-DD` is a calendar date, not an instant, and
 * is read in UTC so no timezone can move it to the day before.
 */
export function dateParts(iso: string, timeZone = 'America/Chicago'): { month: string; day: string; weekday: string; long: string } {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(dateOnly ? `${iso}T12:00:00Z` : iso);
  const tz = dateOnly ? 'UTC' : timeZone;
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { ...o, timeZone: tz }).format(d);
  return { month: f({ month: 'short' }), day: f({ day: 'numeric' }), weekday: f({ weekday: 'short' }), long: f({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) };
}

/** The approved calendar tile: month, a large Bodoni day, weekday. One accessible date, not three words. */
export function DateTile({ iso, className }: { iso: string; className?: string }) {
  if (!iso) return null;
  const p = dateParts(iso);
  return (
    <time className={`bd-date${className ? ` ${className}` : ''}`} dateTime={iso.slice(0, 10)}>
      <span className="sr-only">{p.long}</span>
      <span className="bd-date__month" aria-hidden="true">{p.month}</span>
      <span className="bd-date__day" aria-hidden="true">{p.day}</span>
      <span className="bd-date__weekday" aria-hidden="true">{p.weekday}</span>
    </time>
  );
}

/**
 * A companion page's opening: the same ivory title panel as the approved heroes — tracked label,
 * a high-contrast Bodoni title, a short gold rule, the lede — with a painted spray entering from
 * the left edge and the fine skyline drawn along the right. No photograph: the couple's portrait is
 * reserved for the pages the approved images give one to, so it is not repeated on every entry.
 */
function PageHead({ eyebrow, title, lede, children }: { eyebrow?: string; title: ReactNode; lede?: ReactNode; children?: ReactNode }) {
  return (
    <header className="bd-pagehead">
      <Botanical id="botanical.corner-tl" className="bd-bloom--pagehead" priority />
      <span className="bd-pagehead__skyline" aria-hidden="true" />
      <div className="bd-pagehead__inner">
        {eyebrow ? <p className="bd-eyebrow">{eyebrow}</p> : null}
        <h1 className="bd-h bd-h--1 bd-pagehead__title">{title}</h1>
        <span className="bd-head__rule" aria-hidden="true" />
        {lede ? <p className="bd-lede bd-pagehead__lede">{lede}</p> : null}
        {children ? <div className="bd-pagehead__facts">{children}</div> : null}
      </div>
    </header>
  );
}

function ProseBlock({ blocks, lead, children }: { blocks: readonly TextBlockView[]; lead?: boolean; children?: ReactNode }) {
  return (
    <div className={`bd-prose${lead ? ' bd-prose--lead' : ''}`}>
      <Paragraphs blocks={blocks} />
      {children}
    </div>
  );
}

/**
 * Where a fact came from. External sources keep the full labelled line with their freshness
 * (ADR-0011: external data is always labelled and dated). The couple's own words are signed as
 * theirs, and that is all: the name of the internal brief they were taken from and its ISO date
 * told a guest nothing and read as an editor's note.
 */
function Provenance({ provenance, freshness = false }: { provenance: ProvenanceViewData; freshness?: boolean }) {
  if (provenance.trustClass === 'TRUSTED_WEDDING' && !provenance.external && !provenance.url?.startsWith('https://')) {
    return <p className="bd-prov bd-prov--own">From Sara + Tyler</p>;
  }
  return (
    <div className="bd-prov">
      <ProvenanceLine provenance={provenance}>{freshness ? <FreshnessBadge provenance={provenance} /> : null}</ProvenanceLine>
    </div>
  );
}

/**
 * The chapters in order along a fine gold line with a bead for each. Undated: the approved image
 * printed years, and those years were generated, so each bead carries its chapter's name instead.
 */
function StoryTimeline({ sections }: Parameters<ContentKit['StoryTimeline']>[0]) {
  return (
    <ol className="bd-chapters" aria-label="Chapters">
      {sections.map((s, i) => (
        <li key={s.id} id={s.slug} className="bd-chapters__chapter">
          <span className="bd-chapters__bead" aria-hidden="true" />
          <span className="sr-only">Chapter {i + 1}.</span>
          <p className="bd-eyebrow">{chapterLabel(s.chapter)}</p>
          <h2 className="bd-h bd-h--3 bd-chapters__title">{s.title}</h2>
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
    <div className="bd-memory">
      <div className="bd-prose bd-prose--lead">{memory.length ? <Paragraphs blocks={memory} /> : <PlaceholderBlock>{placeholderHint(`TODO(Tyler & Sara): ${CONTENT_COPY.adventureDetail.notWritten}`)}</PlaceholderBlock>}</div>
      {sara || tyler ? (
        <div className="bd-diptych">
          {sara ? (
            <section className="bd-diptych__leaf" aria-labelledby="sara-remembers">
              <h3 id="sara-remembers" className="bd-diptych__voice">
                Sara remembers
              </h3>
              <p>
                <Block block={sara} inline />
              </p>
            </section>
          ) : null}
          {tyler ? (
            <section className="bd-diptych__leaf" aria-labelledby="tyler-remembers">
              <h3 id="tyler-remembers" className="bd-diptych__voice">
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
        <p className="bd-prose bd-memory__access">
          <strong>Accessibility:</strong> <Block block={accessibility} inline />
        </p>
      ) : null}
      <Provenance provenance={provenance} />
    </div>
  );
}

function Chips({ items, label }: Parameters<ContentKit['Chips']>[0]) {
  return (
    <ul className="bd-chips" aria-label={label}>
      {items.map((i) => (
        <li key={i.href}>
          <a className="bd-chip" href={i.href} aria-current={i.active ? 'true' : undefined}>
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
    <ul className="bd-flags" aria-label="Status">
      {draft ? <li className="bd-badge bd-badge--pending">{CONTENT_COPY.flags.draft}</li> : null}
      {placeholder ? <li className="bd-badge bd-badge--info">{CONTENT_COPY.flags.placeholder}</li> : null}
    </ul>
  );
}

function MetaList({ items }: Parameters<ContentKit['MetaList']>[0]) {
  if (!items.length) return null;
  return (
    <dl className="bd-meta">
      {items.map((i, n) => (
        <div key={`${i.label}-${n}`} className="bd-meta__row">
          <dt className="bd-meta__label">{i.label}</dt>
          <dd className="bd-meta__value">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function AdventureList({ items }: Parameters<ContentKit['AdventureList']>[0]) {
  return (
    <ul className="bd-ledger" aria-label="Adventures">
      {items.map((a, i) => (
        <li key={a.id} className="bd-ledger__row">
          <article className="bd-entry" data-adventure={a.slug} data-index={i}>
            <div className="bd-entry__body">
              <h2 className="bd-entry__title">
                <a className="bd-link" href={a.href}>
                  {a.title}
                </a>
              </h2>
              <StatusFlags placeholder={a.placeholder} />
              <p className="bd-entry__summary">
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
    <ul className="bd-handoffs" aria-label={label}>
      {handoffs.map((h) => (
        <li key={h.url} className="bd-handoffs__item">
          <a className="bd-btn bd-btn--external" {...handoffAttrs(h)}>
            <span>{h.label}</span>
            <ExternalMark opens={providerLabel(h.provider)} />
          </a>
          <p className="bd-handoffs__disclosure">{h.disclosure}</p>
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
    <article className="bd-rec" data-recommendation={card.slug}>
      <div className="bd-rec__inner">
        <p className="bd-eyebrow">{humanize(card.category)}</p>
        {leads ? (
          <H className="sr-only">{card.title}</H>
        ) : (
          <H className="bd-rec__title">
            <a className="bd-link" href={card.href}>
              {card.title}
            </a>
          </H>
        )}
        <StatusFlags draft={card.draft} placeholder={card.placeholder} />
        <p className="bd-rec__what">
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
          <p className="bd-rec__hours">
            Hours and menus:{' '}
            {card.operational.url ? (
              <a className="bd-link" href={card.operational.url} {...OFFICIAL_LINK_ATTRS}>
                {withTail(`${guestText(card.operational.label)} on ${destinationLabel(card.operational.url)}`, <ExternalMark />)}
              </a>
            ) : (
              card.operational.label
            )}{' '}
            <FreshnessBadge provenance={card.operational.provenance} />
          </p>
        ) : null}
        {leads ? null : handoffs}
        {card.why ? (
          <details className="bd-why">
            <summary className="bd-why__summary">{CONTENT_COPY.why.summary} →</summary>
            <p>
              <Block block={card.why.text} inline />
            </p>
            <p>
              <a className="bd-link bd-link--standalone" href={card.why.experienceHref}>
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
    <ol className="bd-stops" aria-label={label}>
      {stops.map((s, i) => (
        <li key={`${s.recommendation.id}-${i}`} className="bd-stops__stop">
          <span className="bd-stops__num" aria-hidden="true">
            {pad(i + 1)}
          </span>
          <span className="bd-stops__body">
            <a className="bd-link" href={s.recommendation.href}>
              {s.recommendation.title}
            </a>
            {stopMeta(s).map((m) => (
              <span key={m} className="bd-stops__meta">
                {' · '}
                {m}
              </span>
            ))}
            {s.recommendation.placeholder ? <span className="bd-badge bd-badge--info">{CONTENT_COPY.flags.placeholder}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

function ItineraryCard({ itinerary: it }: { itinerary: ItineraryView; index: number }) {
  return (
    <article className="bd-card bd-itinerary" data-itinerary={it.slug} id={it.slug}>
      <div className="bd-card__inner">
        <p className="bd-card__label">{humanize(it.bucket)}</p>
        <h3 className="bd-card__title">{it.title}</h3>
        <StatusFlags draft={it.draft} placeholder={it.placeholder} />
        {it.intro ? (
          <p>
            <Block block={it.intro} inline />
          </p>
        ) : null}
        {it.stops.length ? <StopList stops={it.stops} label={`${it.title}: stops`} /> : null}
        {it.stops.length ? <p className="bd-muted">About {formatMinutes(it.totalMinutes)} in total.</p> : null}
        <ProvenanceLine provenance={it.provenance} />
      </div>
    </article>
  );
}

function LookForList({ items, label }: Parameters<ContentKit['LookForList']>[0]) {
  return (
    <ol className="bd-docent" aria-label={label}>
      {items.map((i, n) => (
        <li key={i.id} className="bd-docent__item">
          <span className="bd-docent__num" aria-hidden="true">
            {pad(n + 1)}
          </span>
          <span className="bd-docent__text">{guestText(i.text)}</span>
        </li>
      ))}
    </ol>
  );
}

function RoomGrid({ spaces }: Parameters<ContentKit['RoomGrid']>[0]) {
  return (
    <ul className="bd-rooms" aria-label="Event spaces">
      {spaces.map((s, i) => (
        <li key={s.id} className="bd-rooms__cell">
          <article className="bd-room" data-space={s.slug} data-index={i}>
            <h3 className="bd-room__name">
              <a className="bd-link" href={s.href}>
                {s.name}
              </a>
            </h3>
            <p className="bd-room__character">{guestText(s.character)}</p>
            <p className="bd-room__capacity">
              {s.capacities.ceremony ? `Ceremony ${s.capacities.ceremony}` : null}
              {s.capacities.dinnerDance ? ` · Dinner ${s.capacities.dinnerDance}` : null}
              {s.capacities.reception ? ` · Reception ${s.capacities.reception}` : null}
            </p>
            <p className="bd-room__note">{guestText(s.capacities.note)}</p>
          </article>
        </li>
      ))}
    </ul>
  );
}

function CapacityTable({ capacities }: Parameters<ContentKit['CapacityTable']>[0]) {
  return (
    <div className="bd-scroll" role="region" aria-label="Capacity figures" tabIndex={0}>
      <table className="bd-table">
        <caption className="bd-table__caption">{guestText(capacities.note)}</caption>
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
  const open = field.url && !field.expired ? field.url : null;
  return (
    <li className="bd-ledger__row bd-outlet" data-key={field.key} data-expired={field.expired ? 'true' : undefined}>
      {/* The heading is the name. The link is its own control, so "opens …" never enters a heading's accessible name. */}
      <h3 className="bd-outlet__label">{guestText(field.label)}</h3>
      {field.value ? <p className="bd-outlet__value">{guestText(field.value)}</p> : null}
      {field.note ? (
        <p className="bd-muted">
          <Block block={field.note} inline />
        </p>
      ) : null}
      {open ? (
        <p className="bd-outlet__link">
          <a className="bd-link" href={open} {...OFFICIAL_LINK_ATTRS}>
            {withTail(`${guestText(field.label)} on ${destinationLabel(open)}`, <ExternalMark />)}
          </a>
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
    <ul className="bd-ledger bd-ledger--outlets" aria-label={label}>
      {fields.map((f) => (
        <OutletRow key={f.id} field={f} />
      ))}
    </ul>
  );
}

function FactList({ facts, label }: Parameters<ContentKit['FactList']>[0]) {
  return (
    <ol className="bd-facts" aria-label={label}>
      {facts.map((f, i) => (
        <li key={f.id} id={`fact-${f.slug}`} className="bd-facts__item" data-index={i}>
          <span className="bd-facts__text">
            {guestText(f.statement)}
            {f.note ? <span className="bd-facts__note"> {guestText(f.note)}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Programme({ events, venueName, startNumber }: Parameters<ContentKit['Programme']>[0]) {
  return (
    <ol className="bd-programme" aria-label="Order of the day">
      {events.map((e, i) => (
        <li key={e.id} id={e.id} className="bd-programme__act">
          <DateTile iso={e.dateIso} />
          <span className="sr-only">Part {startNumber + i}.</span>
          <div className="bd-programme__body">
          <h2 className="bd-h bd-h--2">{e.name}</h2>
          <MetaList
            items={[
              {
                /*
                 * One fact per line when the other half is a placeholder, never joined by a middot.
                 * `Chicago Athletic Association Hotel · Sara + Tyler are still writing this: which
                 * room` reads as one run-on claim, and at 390 the separator lands alone on a line
                 * between them. `WeekendPage` fixed the same defect at level 09; this is the themed
                 * copy of it, on the page that carries the wedding's own facts.
                 */
                label: 'When',
                value: e.timeLabel.placeholder ? (
                  <>
                    <time dateTime={e.dateIso}>{e.weekdayLabel}</time>
                    <Block block={e.timeLabel} />
                  </>
                ) : (
                  <>
                    <time dateTime={e.dateIso}>{e.weekdayLabel}</time>
                    {' · '}
                    <Block block={e.timeLabel} inline />
                  </>
                ),
              },
              {
                label: 'Where',
                value: e.room.placeholder ? (
                  <>
                    {venueName}
                    <Block block={e.room} />
                  </>
                ) : (
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
    <div className="bd-faq">
      {entries.map((e) => (
        <article key={e.id} id={e.slug} className="bd-faq__entry" aria-labelledby={`faq-${e.slug}`}>
          <h3 id={`faq-${e.slug}`} className="bd-faq__q">
            {guestText(e.question)}
          </h3>
          <StatusFlags placeholder={e.placeholder} />
          <div className="bd-prose bd-faq__a">
            <Block block={e.answer} />
            {e.route ? (
              <p>
                <a className="bd-link bd-link--standalone" href={e.route}>
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
    <div id="search-results" className="bd-results" aria-live="polite">
      {search.results.length === 0 ? (
        <p className="bd-prose">
          {CONTENT_COPY.ask.none}{' '}
          <a className="bd-link" href="#contact">
            {CONTENT_COPY.ask.reach}
          </a>{' '}
          {CONTENT_COPY.ask.noneTail}
        </p>
      ) : (
        <ul className="bd-ledger" aria-label="Search results">
          {search.results.map((r) => (
            <li key={r.id} className="bd-ledger__row bd-result">
              <h3 className="bd-result__title">
                <a className="bd-link" href={r.route}>
                  {r.title}
                </a>
              </h3>
              <p>{guestText(r.snippet)}</p>
              <p className="bd-muted">
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
    <p className="bd-back">
      <a className="bd-link" href={href}>
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
