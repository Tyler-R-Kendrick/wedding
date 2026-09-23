import type { ReactNode } from 'react';
import { PLACEHOLDER_LABEL, stripBacklogRefs } from '@/components/provenance';
import { DesignSwitcher } from '@/components/switcher/DesignSwitcher';
import { homeLabelFor, SIGN_IN } from '@/domain/lifecycle/nav';
import { listThemes } from '@/themes/registry';
import { providerLabel } from '@/themes/shared/content';
import { renderCopy } from '@/themes/shared/copy';
import { DialogBase } from '@/themes/shared/DialogBase';
import { formatTimeIn } from '@/themes/shared/format';
import { Icon, iconForHref } from '@/themes/shared/icons';
import { allItems, bottomCells, isCurrent, shortLabel } from '@/themes/shared/nav-utils';
import { ThemeSync } from '@/themes/shared/ThemeSync';
import type {
  BadgeProps, ButtonProps, CardProps, ChoiceProps, Copy, DialogProps, DividerProps, ErrorSummaryProps, EyebrowProps, FieldProps, FieldsetProps, FooterProps, GalleryProps, HeroProps,
  ImageFrameProps, InputProps, LinkProps, MapHandoffProps, NavItem, NavProps, PlaceholderProps, ProseProps, SectionHeadingProps, SectionProps, SelectProps, ShellProps, SkeletonProps,
  StatProps, TextareaProps, ThemeComponentKit, TimelineProps,
} from '@/themes/types';
import { Botanical, Photo } from '../media';
import { content, withTail } from './content';
import { Countdown } from './Countdown';

/*
 * Botanical–Deco kit: the design Sara and Tyler approved (docs/design/approved-botanical-deco/).
 * A light monogram masthead, portrait-led editorial splits, ivory sheets, a moss band and a Chicago
 * blue band, painted botanicals entering from the page edges, and fine gold Deco rules. Every colour
 * and face is a token from theme.css; the markup is this design's own.
 */

const DIALOG_CLASSES = {
  trigger: 'bd-menu-trigger',
  dialog: 'bd-sheet',
  panel: 'bd-sheet__panel',
  header: 'bd-sheet__header',
  title: 'bd-sheet__title',
  close: 'bd-btn bd-btn--secondary bd-sheet__close',
  body: 'bd-sheet__body',
};

const THEME_OPTIONS = listThemes().map((t) => ({ id: t.id, name: t.name, tagline: t.tagline }));

const RIGHTS_NOTE = 'Photographs by Brooke Alaina Photography and films by Oakhouse Visuals are shared here for personal, non-commercial viewing.';

/** The most pages the masthead ever shows inline (at 1440px and up); the rest live in the Menu sheet. */
const MASTHEAD_MAX = 8;

/**
 * An unwritten fact, marked as one: the editorial label the rest of the site uses, never the
 * authoring marker (see gilded-hour/kit for the history of that defect).
 */
function Placeholder({ todo, block }: PlaceholderProps) {
  return (
    <span className={block ? 'todo todo--block' : 'todo'} role="note" data-placeholder="true">
      <span className="todo__label">{PLACEHOLDER_LABEL}:</span> {stripBacklogRefs(todo)}
    </span>
  );
}

function Text({ copy }: { copy: Copy }) {
  return <>{renderCopy(copy, Placeholder)}</>;
}

export function ExternalMark({ provider }: { provider?: string }) {
  return (
    <>
      <Icon name="external" className="bd-external" />
      <span className="sr-only">{`, opens ${provider ? providerLabel(provider) : 'in a new tab'}`}</span>
    </>
  );
}

/** The S|T monogram: two Bodoni capitals either side of a fine gold stem. Sara and Tyler's own mark. */
export function Monogram({ className }: { className?: string }) {
  return (
    <span className={`bd-monogram${className ? ` ${className}` : ''}`} aria-hidden="true">
      <span className="bd-monogram__s">S</span>
      <span className="bd-monogram__stem" />
      <span className="bd-monogram__t">T</span>
    </span>
  );
}

/**
 * The stepped Deco frame around the monogram at the edge of the moss and journey panels: an
 * elongated hexagon drawn twice, one stroke inside the other, stretching to whatever height the
 * panel's real content gives it.
 */
export function DecoFrame({ className }: { className?: string }) {
  return (
    <span className={`bd-decoframe${className ? ` ${className}` : ''}`} aria-hidden="true">
      <svg viewBox="0 0 64 240" preserveAspectRatio="none" focusable="false">
        <path d="M32 1L63 20V220L32 239L1 220V20Z" fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <path d="M32 9L56 24V216L32 231L8 216V24Z" fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      </svg>
      <Monogram />
    </span>
  );
}

function NavLink({ item, nav, className, short = false }: { item: NavItem; nav: NavProps['nav']; className: string; short?: boolean }) {
  const current = isCurrent(item, nav);
  const label = short ? shortLabel(item.label) : item.label;
  if (item.external) {
    return (
      <a className={className} href={item.href} rel="noopener">
        {short ? <Icon name={iconForHref(item.href)} /> : null}
        <span>{label}</span>
        <ExternalMark provider={item.provider} />
      </a>
    );
  }
  return (
    <a className={className} href={item.href} aria-current={current ? 'page' : undefined}>
      {short ? <Icon name={iconForHref(item.href)} /> : null}
      <span>{label}</span>
    </a>
  );
}

function MenuList({ nav, homeLabel }: { nav: NavProps['nav']; homeLabel: string }) {
  const items: NavItem[] = [{ label: homeLabel, href: '/' }, ...allItems(nav)];
  return (
    <ul className="bd-menu">
      {items.map((item) => (
        <li key={item.href}>
          <NavLink item={item} nav={nav} className="bd-menu__link" />
        </li>
      ))}
    </ul>
  );
}

/**
 * The masthead: monogram left, the site's pages spaced across the middle in tracked capitals with a
 * gold underline on the current one, and the couple's line in script at the right. On a phone the
 * pages move into a labelled "Menu" sheet and the monogram stays; the words never shrink below 17px.
 */
function Nav({ nav, siteName, homeLabel, switcherEnabled }: NavProps) {
  const items: NavItem[] = [{ label: homeLabel, href: '/' }, ...allItems(nav)];
  const inline = items.slice(0, MASTHEAD_MAX);
  // How many pages the state has decides, per breakpoint, whether the Menu sheet is still needed.
  const over = [6, 7, 8].filter((n) => items.length > n).map((n) => ` bd-masthead__inner--gt${n}`).join('');
  return (
    <div className={`bd-masthead__inner${over}`}>
      <a className="bd-masthead__home" href="/" aria-current={nav.currentPath === '/' ? 'page' : undefined}>
        <Monogram />
        <span className="sr-only">
          {siteName}: {homeLabel}
        </span>
      </a>
      {/* One "Site" landmark at every width: the inline list on a desktop, the labelled Menu
          button (and its sheet) on a phone. Hiding the whole <nav> on a phone took the landmark
          out of the accessibility tree with it. */}
      <nav className="bd-nav" aria-label="Site">
        <ul className="bd-nav__list">
          {inline.map((item) => (
            <li key={item.href}>
              <NavLink item={item} nav={nav} className="bd-nav__link" />
            </li>
          ))}
        </ul>
        <div className="bd-masthead__menu">
          <DialogBase
            id="site-menu"
            title="Menu"
            trigger={
              <>
                <Icon name="menu" />
                <span>Menu</span>
              </>
            }
            classNames={DIALOG_CLASSES}
            ornament={<Botanical id="botanical.sprig-right" className="bd-bloom--sheet" />}
          >
            <MenuList nav={nav} homeLabel={homeLabel} />
            {switcherEnabled ? <DesignSwitcher variant="menu" id="design-switcher-menu" current="botanical-deco" themes={THEME_OPTIONS} /> : null}
          </DialogBase>
        </div>
      </nav>
      <p className="bd-masthead__motto" aria-hidden="true">
        <span className="bd-masthead__rule" />
        <span className="bd-script">Brighter together</span>
      </p>
    </div>
  );
}

/**
 * The personal action bar on a phone: the state's quick actions (RSVP, directions, now), fixed to
 * the bottom edge and emitted after `</main>`. The page reserves its height so it never covers the
 * last line of content or a control. Every action here is also in the Menu sheet.
 */
function ActionBar({ nav }: { nav: NavProps['nav'] }) {
  // Three cells: at 390px a fourth would cut its 17px label short.
  const cells = bottomCells(nav, 3);
  if (!cells.length) return null;
  return (
    <nav className="bd-bar" aria-label="Quick actions" style={{ ['--cells' as string]: cells.length }}>
      {cells.map((item) => (
        <NavLink key={item.href} item={item} nav={nav} className={`bd-bar__cell${item.label === 'RSVP' || item.label === 'Add photos' ? ' bd-bar__cell--accent' : ''}`} short />
      ))}
    </nav>
  );
}

/**
 * The light architectural footer: the fine skyline at the left, the couple's facts as one tracked
 * line, the monogram at the right. The skyline is decoration (schematic, not surveyed).
 */
/** The professional photographs and films live on these pages; their rights note belongs there. */
const PRO_MEDIA_PATHS = /^\/(?:photos|media)(?:\/|$)/;

function Footer({ site, switcher, rightsNote, printUrls, account = SIGN_IN }: FooterProps & { account?: NavItem }) {
  return (
    <footer className="bd-footer">
      <div className="bd-footer__inner">
        <span className="bd-footer__skyline" aria-hidden="true" />
        <p className="bd-footer__motto">
          Chicago <span aria-hidden="true">+</span> people <span aria-hidden="true">+</span> love <span aria-hidden="true">+</span> brighter together
        </p>
        <p className="bd-footer__mark" aria-hidden="true">
          <span className="bd-footer__rule" />
          <Monogram />
        </p>
        <p className="bd-footer__facts">
          <span>{site.coupleDisplayName}</span>
          <span className="bd-footer__sep" aria-hidden="true" />
          <time dateTime={site.date.iso}>{site.date.long}</time>
          <span className="bd-footer__sep" aria-hidden="true" />
          <span>{site.venue.city}</span>
        </p>
        <p className="bd-footer__place">
          {site.venue.name},{' '}
          <a className="bd-link" href={site.venue.mapsUrl} rel="noopener">
            <span className="bd-nowrap">
              {site.venue.address}
              <ExternalMark provider={site.venue.mapsProvider} />
            </span>
          </a>
        </p>
        <p className="bd-footer__credits">
          <a className="bd-link bd-link--standalone" href="/credits">
            Photo credits
          </a>
        </p>
        <p className="bd-footer__credits">
          <a className="bd-link bd-link--standalone" href={account.href}>
            {account.label}
          </a>
        </p>
        {rightsNote ? <p className="bd-footer__rights">{rightsNote}</p> : null}
        <ul className="bd-footer__print">
          {printUrls.map((p) => (
            <li key={p.url}>
              {p.label}: {p.url}
            </li>
          ))}
        </ul>
        {switcher ? <div className="bd-footer__switcher">{switcher}</div> : null}
      </div>
    </footer>
  );
}

function Shell({ frame, children, banner }: ShellProps) {
  const homeLabel = homeLabelFor(frame.lifecycle.state);
  const printUrls = [
    { label: 'Directions', url: frame.site.venue.mapsUrl },
    ...(frame.site.venue.url ? [{ label: frame.site.venue.name, url: frame.site.venue.url }] : []),
  ];
  const hasBar = bottomCells(frame.nav, 3).length > 0;
  return (
    <div className="site bd" data-theme="botanical-deco" data-bottom-bar={hasBar ? '' : undefined} data-lifecycle={frame.lifecycle.state} suppressHydrationWarning>
      <ThemeSync theme="botanical-deco" />
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {banner}
      <header className="bd-masthead">
        <Nav nav={frame.nav} siteName={frame.site.coupleDisplayName} homeLabel={homeLabel} switcherEnabled={frame.switcherEnabled} />
      </header>
      <main id="main" className="bd-main" tabIndex={-1}>
        {children}
      </main>
      <ActionBar nav={frame.nav} />
      <Footer
        site={frame.site}
        switcher={frame.switcherEnabled ? <DesignSwitcher variant="trigger" id="design-switcher-footer" current="botanical-deco" themes={THEME_OPTIONS} /> : null}
        account={frame.nav.account}
        rightsNote={PRO_MEDIA_PATHS.test(frame.nav.currentPath) ? RIGHTS_NOTE : ''}
        printUrls={printUrls}
      />
    </div>
  );
}

/** Squared, invitation-style buttons: gold fill for the one action, a gold outline for the next. */
function Button({ variant = 'primary', href, type = 'button', loading, provider, children, className, ...rest }: ButtonProps) {
  const cls = `bd-btn bd-btn--${variant}${className ? ` ${className}` : ''}`;
  const inner = (
    <>
      <span>{children}</span>
      {variant === 'external' ? <ExternalMark provider={provider} /> : variant === 'primary' || variant === 'accent' ? <Arrow /> : null}
    </>
  );
  if (href) {
    const external = variant === 'external' || /^https?:/.test(href);
    return (
      <a className={cls} href={href} rel={external ? 'noopener' : undefined}>
        {inner}
      </a>
    );
  }
  return (
    <button className={cls} type={type} aria-busy={loading || undefined} data-loading={loading || undefined} disabled={rest.disabled || loading} {...rest}>
      {inner}
    </button>
  );
}

/** The fine arrow the approved design sets after every "Read our story" style link. */
export function Arrow() {
  return (
    <svg className="bd-arrow" viewBox="0 0 20 10" width="20" height="10" aria-hidden="true" focusable="false">
      <path d="M0 5H18M14 1L18 5L14 9" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function Link({ href, external, standalone, children, className, ...rest }: LinkProps) {
  const ext = external ?? /^https?:/.test(href);
  return (
    <a className={`bd-link${standalone ? ' bd-link--standalone' : ''}${className ? ` ${className}` : ''}`} href={href} rel={ext ? 'noopener' : undefined} {...rest}>
      {ext ? withTail(children, <ExternalMark />) : children}
    </a>
  );
}

/**
 * "Read our story →": tracked capitals with a gold underline, the approved design's way into a
 * page. A standalone line, so it carries the 44px target.
 */
export function More({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const ext = /^https?:/.test(href);
  return (
    <a className={`bd-more${className ? ` ${className}` : ''}`} href={href} rel={ext ? 'noopener' : undefined}>
      <span>{children}</span>
      {ext ? <ExternalMark /> : <Arrow />}
    </a>
  );
}

function Eyebrow({ children, tone = 'default' }: EyebrowProps) {
  return <p className={`bd-eyebrow${tone === 'moss' ? ' bd-eyebrow--moss' : ''}`}>{children}</p>;
}

function Divider({ ornament = true }: DividerProps) {
  return <hr className={ornament ? 'bd-rule bd-rule--lozenge' : 'bd-rule'} />;
}

function SectionHeading({ level, title, eyebrow, lede, id }: SectionHeadingProps) {
  const H = `h${level}` as 'h1' | 'h2' | 'h3';
  return (
    <div className="bd-head">
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <H id={id} className={`bd-h bd-h--${level}`}>
        {title}
      </H>
      <span className="bd-head__rule" aria-hidden="true" />
      {lede ? <p className="bd-lede">{lede}</p> : null}
    </div>
  );
}

const GROUND: Record<NonNullable<SectionProps['ground']>, string> = { default: 'paper', alt: 'sheet', wash: 'wash', inverse: 'moss' };

function Section({ id, number, ground = 'default', children, labelledBy }: SectionProps) {
  return (
    <section id={id} className={`bd-section bd-section--${GROUND[ground]}`} aria-labelledby={labelledBy} data-number={number}>
      <div className="bd-section__inner">
        {number ? <span className="sr-only">Part {number}.</span> : null}
        {children}
      </div>
    </section>
  );
}

function Prose({ children, lead }: ProseProps) {
  return <div className={`bd-prose${lead ? ' bd-prose--lead' : ''}`}>{children}</div>;
}

function Card({ title, headingLevel = 3, children, media, actions, label, featured, id }: CardProps) {
  const H = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  return (
    <article id={id} className={`bd-card${featured ? ' bd-card--featured' : ''}`}>
      {media ? <div className="bd-card__media">{media}</div> : null}
      <div className="bd-card__inner">
        {label ? <span className="bd-card__label">{label}</span> : null}
        {title ? <H className="bd-card__title">{title}</H> : null}
        <div className="bd-card__body">{children}</div>
        {actions ? <div className="bd-card__actions">{actions}</div> : null}
      </div>
    </article>
  );
}

function ImageFrame({ src, alt, width, height, caption, credit, sizes, priority }: ImageFrameProps) {
  return (
    <figure className="bd-frame">
      {/* eslint-disable-next-line @next/next/no-img-element -- kits stay framework-light; srcset/sizes are explicit */}
      <img src={src} alt={alt} width={width} height={height} sizes={sizes} loading={priority ? 'eager' : 'lazy'} decoding="async" fetchPriority={priority ? 'high' : undefined} />
      {caption || credit ? (
        <figcaption className="bd-frame__caption">
          {caption}
          {credit ? <span className="bd-frame__credit"> {credit}</span> : null}
        </figcaption>
      ) : null}
    </figure>
  );
}

function Gallery({ items, label }: GalleryProps) {
  return (
    <ul className="bd-gallery" aria-label={label}>
      {items.map((item) => (
        <li key={item.id} className="bd-gallery__item">
          <DialogBase
            id={`lightbox-${item.id}`}
            title={item.caption ?? item.alt}
            trigger={<ImageFrame {...item} />}
            triggerLabel={`Open ${item.caption ?? item.alt}`}
            classNames={{ ...DIALOG_CLASSES, trigger: 'bd-gallery__trigger', dialog: 'bd-sheet bd-sheet--lightbox' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- lightbox image at natural size */}
            <img src={item.src} alt={item.alt} width={item.width} height={item.height} />
            {item.downloadable ? (
              <p>
                <a className="bd-btn bd-btn--secondary" href={item.src} download>
                  Download
                </a>
              </p>
            ) : null}
          </DialogBase>
        </li>
      ))}
    </ul>
  );
}

function Timeline({ events, timezone, nowId, label }: TimelineProps) {
  return (
    <ol className="bd-timeline" aria-label={label}>
      {events.map((e) => (
        <li key={e.id} className="bd-timeline__item" aria-current={nowId === e.id ? 'step' : undefined}>
          <span className="bd-timeline__bead" aria-hidden="true" />
          <span className="bd-timeline__time">
            {e.start ? <time dateTime={e.start}>{formatTimeIn(e.start, timezone)}</time> : null}
            {e.end ? (
              <>
                {' '}
                to <time dateTime={e.end}>{formatTimeIn(e.end, timezone)}</time>
              </>
            ) : null}
          </span>
          <div className="bd-timeline__detail">
            <h3 className="bd-timeline__name">{e.name}</h3>
            <p className="bd-timeline__place">{e.place ? e.place : <Placeholder todo={e.start ? 'room' : 'time and room'} />}</p>
            {e.description ? (
              <p className="bd-timeline__desc">
                <Text copy={e.description} />
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Stat({ label, value, provenance, placeholder }: StatProps) {
  return (
    <div className="bd-stat">
      <dt className="bd-stat__label">{label}</dt>
      <dd className="bd-stat__value">
        {placeholder ? <Placeholder todo={label.toLowerCase()} /> : value}
        {provenance?.stale ? <Badge status="stale">Needs re-checking</Badge> : null}
        {provenance?.verifiedAt ? <span className="bd-stat__meta">Verified {provenance.verifiedAt.slice(0, 10)}</span> : null}
      </dd>
    </div>
  );
}

function Badge({ status, children }: BadgeProps) {
  return <span className={`bd-badge bd-badge--${status}`}>{children}</span>;
}

function MapHandoff({ venue, note }: MapHandoffProps) {
  return (
    <div className="bd-map">
      <p className="bd-map__name">{venue.name}</p>
      <p className="bd-map__address">{venue.address}</p>
      {note ? <p className="bd-map__note">{note}</p> : null}
      <a className="bd-btn bd-btn--external" href={venue.mapsUrl} rel="noopener">
        <span>Open in {venue.mapsProvider}</span>
        <ExternalMark provider={venue.mapsProvider} />
      </a>
      <p className="bd-map__url">{venue.mapsUrl}</p>
    </div>
  );
}

function Skeleton({ lines = 3, width = '100%', height, label = 'Loading' }: SkeletonProps) {
  return (
    <div className="bd-skeleton" role="status" aria-busy="true" style={{ width }}>
      <span className="sr-only">{label}</span>
      {height ? (
        <span className="bd-skeleton__block" style={{ height }} aria-hidden="true" />
      ) : (
        Array.from({ length: lines }).map((_, i) => <span key={i} className="bd-skeleton__line" aria-hidden="true" />)
      )}
    </div>
  );
}

function Dialog({ id, title, trigger, triggerLabel, children, closeLabel }: DialogProps) {
  return (
    <DialogBase id={id} title={title} trigger={trigger} triggerLabel={triggerLabel} closeLabel={closeLabel} classNames={{ ...DIALOG_CLASSES, trigger: 'bd-btn bd-btn--secondary' }}>
      {children}
    </DialogBase>
  );
}

function Field({ id, label, hint, error, required, children }: FieldProps) {
  return (
    <div className="bd-field">
      <label className="bd-label" htmlFor={id}>
        {label}
        {required ? <span className="bd-label__required"> (required)</span> : null}
      </label>
      {hint ? (
        <p className="bd-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p className="bd-error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
const describedBy = (id: string, invalid?: boolean, hint?: boolean) => [hint ? `${id}-hint` : null, invalid ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;

function Input({ id, invalid, className, ...rest }: InputProps) {
  return <input id={id} className={`bd-input${className ? ` ${className}` : ''}`} aria-invalid={invalid || undefined} aria-describedby={describedBy(id, invalid, rest['aria-describedby'] !== undefined)} {...rest} />;
}
function Select({ id, invalid, className, children, ...rest }: SelectProps) {
  return (
    <select id={id} className={`bd-input bd-select${className ? ` ${className}` : ''}`} aria-invalid={invalid || undefined} aria-describedby={describedBy(id, invalid)} {...rest}>
      {children}
    </select>
  );
}
function Textarea({ id, invalid, className, ...rest }: TextareaProps) {
  return <textarea id={id} className={`bd-input bd-textarea${className ? ` ${className}` : ''}`} aria-invalid={invalid || undefined} aria-describedby={describedBy(id, invalid)} {...rest} />;
}
function Choice({ kind, id, label, className, ...rest }: ChoiceProps & { kind: 'radio' | 'checkbox' }) {
  return (
    <label className={`bd-choice${className ? ` ${className}` : ''}`} htmlFor={id}>
      <input id={id} type={kind} className="bd-choice__input" {...rest} />
      <span className="bd-choice__label">{label}</span>
    </label>
  );
}
function Radio(p: ChoiceProps) {
  return <Choice kind="radio" {...p} />;
}
function Checkbox(p: ChoiceProps) {
  return <Choice kind="checkbox" {...p} />;
}
function Fieldset({ legend, hint, error, children }: FieldsetProps) {
  return (
    <fieldset className="bd-fieldset" aria-invalid={error ? true : undefined}>
      <legend className="bd-legend">{legend}</legend>
      {hint ? <p className="bd-hint">{hint}</p> : null}
      {children}
      {error ? <p className="bd-error">{error}</p> : null}
    </fieldset>
  );
}
function ErrorSummary({ title = 'Please check the highlighted fields', errors }: ErrorSummaryProps) {
  if (!errors.length) return null;
  return (
    <div className="bd-error-summary" role="alert" tabIndex={-1}>
      <h2 className="bd-error-summary__title">{title}</h2>
      <ul>
        {errors.map((e) => (
          <li key={e.id}>
            <a href={`#${e.id}`}>{e.message}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Sara + Tyler" with the plus set as a fine gold glyph, as in the approved hero. */
export function Names({ names }: { names: string }) {
  const parts = names.split(/\s*[+&]\s*/);
  if (parts.length !== 2) return <>{names}</>;
  return (
    <>
      {parts[0]}
      <span className="bd-plus"> + </span>
      {parts[1]}
    </>
  );
}

/**
 * Home's opening: the invitation on quiet ivory across the left two-fifths, Sara and Tyler on the
 * riverfront across the centre-right, the words from the bridge pillar on their own panel at the
 * right edge, flowers entering from both outer edges. Names, the wedding wording, the date, the
 * venue and the state's two actions are all live text; none of it sits on a face. On a phone the
 * portrait comes first in its own crop and the invitation directly under it, in the first screen.
 * The countdown and the state's travel note live in the schedule band below (see recipes/home).
 */
function Hero({ content, site, state }: HeroProps) {
  const isToday = state === 'WEDDING_DAY';
  return (
    <section className="bd-hero" aria-labelledby="hero-title">
      <div className="bd-hero__media">
        <Photo id="couple.hero.formal" mobileId="couple.hero.formal.mobile" sizes="(min-width: 768px) 52vw, 100vw" priority />
      </div>
      {/* The approved image carved these words into a bridge pillar. Real architecture is not
          relettered here: they are live type on a stone-coloured panel of their own. */}
      <p className="bd-hero__words" aria-hidden="true">
        <span>Good</span> <span>people</span> <span>beautiful</span> <span>places</span> <span>great</span> <span>love</span>
      </p>
      <Botanical id="botanical.corner-tl" className="bd-bloom--hero-left" priority />
      <Botanical id="botanical.edge-right" className="bd-bloom--hero-right" />
      <div className="bd-hero__copy">
        {/* The approved hero opens with a short tracked line above the names; here it is the one the
            handoff asks for near the names. See docs/design/approved-botanical-deco/detector-waivers.md. */}
        <p className="bd-eyebrow bd-hero__kicker">Join us for our wedding</p>
        <h1 id="hero-title" className="bd-hero__title">
          {isToday ? content.title : <Names names={content.title} />}
        </h1>
        <span className="bd-head__rule" aria-hidden="true" />
        <p className="bd-hero__date">
          <time dateTime={site.date.iso}>{site.date.long}</time>
        </p>
        <span className="bd-head__rule" aria-hidden="true" />
        <p className="bd-hero__place">
          <span>{site.venue.name}</span>
          <span>{/,\s*IL\b/.test(site.venue.address) ? `${site.venue.city}, Illinois` : site.venue.city}</span>
        </p>
        <div className="bd-hero__actions">
          <Button variant={content.primary.variant === 'accent' ? 'accent' : 'primary'} href={content.primary.href} provider={content.primary.provider}>
            {content.primary.label}
          </Button>
          {content.secondary ? (
            <Button variant={content.secondary.variant === 'external' ? 'external' : 'secondary'} href={content.secondary.href} provider={content.secondary.provider}>
              {content.secondary.label}
            </Button>
          ) : null}
        </div>
        <p className="bd-hero__lede">
          <span className="bd-hero__status">{content.eyebrow}.</span> <Text copy={content.lede} />
          {content.deadline ? (
            <>
              {' '}
              <Text copy={content.deadline} />
            </>
          ) : null}
        </p>
      </div>
    </section>
  );
}

export interface PageHeroProps {
  eyebrow?: string;
  /** The page's one H1. */
  title: ReactNode;
  /** Tracked lines under the gold rule ("Sara + Tyler", "Same people. A bigger chapter."). */
  sub?: string[];
  lede?: ReactNode;
  photo: string;
  mobilePhoto?: string;
  /** The bridge-pillar words, set as live type on a panel at the right edge. */
  words?: string[];
  actions?: ReactNode;
  /** A single decorative handwritten line over the photograph; the words also appear as text. */
  script?: string;
  className?: string;
}

/**
 * The shorter panoramic opening the approved Story, Explore and Weekend pages share: a left ivory
 * title panel, the couple across the centre-right, flowers at the outer edges, and optionally the
 * words panel. The same composition, not the same picture: each page has its own portrait.
 */
export function PageHero({ eyebrow, title, sub, lede, photo, mobilePhoto, words, actions, script, className }: PageHeroProps) {
  return (
    <section className={`bd-pagehero${words ? ' bd-pagehero--words' : ''}${className ? ` ${className}` : ''}`} aria-labelledby="page-title">
      <div className="bd-pagehero__media">
        <Photo id={photo} mobileId={mobilePhoto} sizes="(min-width: 768px) 56vw, 100vw" priority />
        {script ? (
          <p className="bd-pagehero__script" aria-hidden="true">
            {script}
          </p>
        ) : null}
      </div>
      {words ? (
        <p className="bd-pagehero__words" aria-hidden="true">
          {words.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </p>
      ) : null}
      <Botanical id="botanical.corner-tl" className="bd-bloom--pagehero" priority />
      <Botanical id="botanical.edge-right" className="bd-bloom--pagehero-right" />
      <div className="bd-pagehero__copy">
        {eyebrow ? <p className="bd-eyebrow">{eyebrow}</p> : null}
        <h1 id="page-title" className="bd-pagehero__title">
          {title}
        </h1>
        <span className="bd-head__rule" aria-hidden="true" />
        {sub?.length ? (
          <p className="bd-pagehero__sub">
            {sub.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </p>
        ) : null}
        {lede ? <p className="bd-pagehero__lede">{lede}</p> : null}
        {actions ? <div className="bd-pagehero__actions">{actions}</div> : null}
      </div>
    </section>
  );
}

export const kit: ThemeComponentKit = {
  Shell,
  Nav,
  Footer,
  Hero,
  Section,
  SectionHeading,
  Eyebrow,
  Prose,
  Card,
  ImageFrame,
  Gallery,
  Button,
  Link,
  Divider,
  Countdown,
  Timeline,
  Stat,
  Form: { Field, Input, Select, Textarea, Radio, Checkbox, Fieldset, ErrorSummary },
  Dialog,
  Badge,
  MapHandoff,
  Skeleton,
  Placeholder,
  Text,
  content,
};

export type { ReactNode };
