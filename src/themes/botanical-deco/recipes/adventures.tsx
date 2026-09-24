import { Text as Block } from '@/components/provenance';
import type { AdventureCard } from '@/domain/content/views';
import { ROUTES } from '@/domain/routes';
import type { AdventuresProps, ContentRecipe } from '@/themes/content-types';
import { CONTENT_COPY, adventureChips } from '@/themes/shared/content';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { photoSrcSet } from '@/themes/shared/photos';
import type { PageFrame } from '@/themes/types';
import { kit } from '../kit';
import { AdventureAtlas, type AtlasPin } from '../kit/AdventureAtlas';
import { adventureNumber } from '../kit/content';
import { Arrow } from '../kit/index';

const { Shell, Section, Prose, Link, content } = kit;
const { PageHead, Chips, AdventureList, StatusFlags } = content;
const COPY = CONTENT_COPY.adventures.atlas;

/**
 * Where a guest goes from here: an adventure's own page (a postcard's button, a ledger row) or a
 * filter chip. The links are plain <a>s, so Chrome's speculation rules warm them: a hover or a press
 * starts rendering that page in the background, and the click that follows lands on it at once.
 * Browsers without them ignore the tag. Read-only pages only; nothing here books or submits.
 */
const SPECULATION = JSON.stringify({
  prerender: [{ where: { or: [{ href_matches: '/our-adventures/*' }, { href_matches: '/our-adventures?*' }] }, eagerness: 'moderate' }],
});

/**
 * The hotel's doorstep, the same point the Chicago map on Explore marks. The wedding is always on
 * the atlas, whatever the filter: it is where every pin is heading.
 */
const VENUE = { id: 'venue', lat: 41.8815, lng: -87.6246 };

/**
 * Our Adventures as an atlas over a ledger. The map (a stylized Equal Earth world with numbered gold
 * pins) sits beside a postcard panel; below it, the same adventures as ruled, numbered rows — the
 * complete version, which is all a guest without JavaScript or with a screen reader needs.
 */
export const BotanicalAdventuresPage: ContentRecipe<AdventuresProps> = ({ data, active, frame }) => {
  const chips = adventureChips(data, active);
  const numbered = data.items.map((a, i) => ({ card: a, number: adventureNumber(i) }));
  const pinned = numbered.filter((n): n is { card: AdventureCard & { coordinates: NonNullable<AdventureCard['coordinates']> }; number: string } => !!n.card.coordinates);
  const pins: AtlasPin[] = pinned.map(({ card, number }) => ({ id: card.id, title: card.title, number, lat: card.coordinates.lat, lng: card.coordinates.lng }));
  const onMap = new Set(pins.map((p) => p.id));
  return (
    <Shell frame={frame} banner={<PreviewBanner lifecycle={frame.lifecycle} />}>
      <PageHead eyebrow={CONTENT_COPY.adventures.eyebrow} title={CONTENT_COPY.adventures.title} lede={CONTENT_COPY.adventures.lede}>
        {chips.length > 1 ? <Chips items={chips} label={CONTENT_COPY.adventures.filter} /> : null}
      </PageHead>
      <script type="speculationrules" dangerouslySetInnerHTML={{ __html: SPECULATION }} />
      <Section id="archive">
        <AdventureAtlas
          pins={pins}
          venue={{ ...VENUE, name: frame.site.venue.name }}
          overview={<Overview pinned={pins.length} total={data.items.length} venue={frame.site.venue.name} />}
          postcards={
            <>
              {pinned.map(({ card, number }) => (
                <Postcard key={card.id} card={card} number={number} />
              ))}
              <VenuePostcard site={frame.site} />
            </>
          }
        >
          {data.items.length === 0 ? (
            <Prose>
              <p>{CONTENT_COPY.adventures.empty}</p>
            </Prose>
          ) : (
            <AdventureList items={data.items} onMap={onMap} />
          )}
          <Prose>
            <p className="bd-muted bd-ledger__foot">
              {data.total} {data.total === 1 ? 'adventure' : 'adventures'} shared so far. {CONTENT_COPY.adventures.borrow} <Link href={ROUTES.share}>Share an Adventure</Link>.
            </p>
          </Prose>
        </AdventureAtlas>
      </Section>
    </Shell>
  );
};

function Overview({ pinned, total, venue }: { pinned: number; total: number; venue: string }) {
  return (
    <div className="bd-atlas__intro">
      <p className="bd-eyebrow">{COPY.eyebrow}</p>
      <h2 className="bd-atlas__heading">{COPY.title}</h2>
      <p className="bd-atlas__lede">{COPY.pinned(pinned, total)}</p>
      <ul className="bd-atlas__legend" aria-label="Map key">
        <li>
          <svg className="bd-atlas__key bd-atlas__key--pin" viewBox="-15 -30 30 34" aria-hidden="true" focusable="false">
            <path d="M0 4C-3-3-14-9-14-19a14 14 0 0 1 28 0c0 10-11 16-14 23Z" />
            <text className="bd-atlas__key-num" y="-19" dy="0.36em" textAnchor="middle">
              01
            </text>
          </svg>
          {COPY.keyPin}
        </li>
        <li>
          <span className="bd-atlas__key bd-atlas__key--cluster" aria-hidden="true">
            3
          </span>
          {COPY.keyCluster}
        </li>
        <li>
          <span className="bd-atlas__key bd-atlas__key--venue" aria-hidden="true" />
          {COPY.keyVenue}: {venue}
        </li>
      </ul>
    </div>
  );
}

function CloseButton({ title }: { title: string }) {
  return (
    <button type="button" className="bd-postcard__close" data-atlas-close aria-label={`${COPY.close} (closes ${title})`}>
      <svg className="bd-atlas__icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <path d="M5 5l10 10M15 5L5 15" />
      </svg>
    </button>
  );
}

/** One adventure, as the panel beside the map shows it once its pin is chosen. */
function Postcard({ card, number }: { card: AdventureCard; number: string }) {
  const titleId = `postcard-${card.id}`;
  return (
    <article className="bd-postcard" data-atlas-entry={card.id} aria-labelledby={titleId}>
      <div className="bd-postcard__top">
        <p className="bd-eyebrow">
          No. {number}
          {card.where ? ` · ${card.where}` : ''}
        </p>
        <CloseButton title={card.title} />
      </div>
      {card.cover ? (
        <figure className="bd-postcard__photo">
          {/* eslint-disable-next-line @next/next/no-img-element -- couple-supplied photo of unknown size; the kit draws every photo with <img> */}
          <img className="bd-postcard__img" src={card.cover.src} srcSet={photoSrcSet(card.cover.src)} sizes="(width >= 1000px) 22rem, 92vw" alt={card.cover.alt} loading="lazy" decoding="async" />
          {card.cover.caption ? <figcaption>{card.cover.caption}</figcaption> : null}
        </figure>
      ) : null}
      <h2 id={titleId} className="bd-postcard__title" tabIndex={-1} data-atlas-focus>
        {card.title}
      </h2>
      <StatusFlags placeholder={card.placeholder} />
      {card.dateLabel ? (
        <p className="bd-postcard__when">
          <Block block={card.dateLabel} inline />
        </p>
      ) : null}
      <p className="bd-postcard__summary">
        <Block block={card.summary} inline />
      </p>
      <p className="bd-postcard__counts">{COPY.counts(card.counts?.photos ?? 0, card.counts?.paragraphs ?? 0)}</p>
      <a className="bd-btn bd-btn--secondary bd-postcard__go" href={card.href}>
        <span>{COPY.open}</span>
        <Arrow />
      </a>
    </article>
  );
}

/** The wedding's own postcard: the diamond on the map opens it. */
function VenuePostcard({ site }: { site: PageFrame['site'] }) {
  const titleId = 'postcard-venue';
  return (
    <article className="bd-postcard bd-postcard--venue" data-atlas-entry={VENUE.id} aria-labelledby={titleId}>
      <div className="bd-postcard__top">
        <p className="bd-eyebrow">
          {COPY.venueEyebrow} · {site.date.motif}
        </p>
        <CloseButton title={site.venue.name} />
      </div>
      <h2 id={titleId} className="bd-postcard__title" tabIndex={-1} data-atlas-focus>
        {site.venue.name}
      </h2>
      <p className="bd-postcard__when">{site.date.long}</p>
      <p className="bd-postcard__summary">{site.venue.address}</p>
      <div className="bd-postcard__actions">
        <a className="bd-btn bd-btn--secondary bd-postcard__go" href={ROUTES.wedding}>
          <span>The wedding</span>
          <Arrow />
        </a>
        <Link href={ROUTES.exploreCaa} standalone>
          {COPY.venueMore}
        </Link>
      </div>
    </article>
  );
}
