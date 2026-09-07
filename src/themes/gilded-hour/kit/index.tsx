import type { ReactNode } from 'react';
import { PLACEHOLDER_LABEL, stripBacklogRefs } from '@/components/provenance';
import { providerLabel } from '@/themes/shared/content';
import { DesignSwitcher } from '@/components/switcher/DesignSwitcher';
import { homeLabelFor } from '@/domain/lifecycle/nav';
import { listThemes } from '@/themes/registry';
import { renderCopy } from '@/themes/shared/copy';
import { ThemeSync } from '@/themes/shared/ThemeSync';
import { DialogBase } from '@/themes/shared/DialogBase';
import { formatTimeIn } from '@/themes/shared/format';
import { Icon, iconForHref } from '@/themes/shared/icons';
import { allItems, bottomCells, isCurrent, shortLabel } from '@/themes/shared/nav-utils';
import type {
  BadgeProps, ButtonProps, CardProps, DialogProps, DividerProps, ErrorSummaryProps, EyebrowProps, FieldProps, FieldsetProps, FooterProps, GalleryProps, HeroProps, ImageFrameProps,
  InputProps, LinkProps, MapHandoffProps, NavItem, NavProps, PlaceholderProps, ProseProps, SectionHeadingProps, SectionProps, SelectProps, ShellProps, SkeletonProps, StatProps,
  TextareaProps, ChoiceProps, ThemeComponentKit, TimelineProps, Copy,
} from '@/themes/types';
import { content } from './content';
import { Countdown } from './Countdown';

/*
 * Gilded Hour kit: one centered axis, mirrored margins, numbered acts, gold geometry.
 * Every colour and font is a token from theme.css; the markup is this theme's own.
 */

const DIALOG_CLASSES = {
  trigger: 'gh-nav__menu',
  dialog: 'gh-dialog',
  panel: 'gh-dialog__panel',
  header: 'gh-dialog__header',
  title: 'gh-dialog__title',
  close: 'gh-btn gh-btn--ghost gh-dialog__close',
  body: 'gh-dialog__body',
};

const THEME_OPTIONS = listThemes().map((t) => ({ id: t.id, name: t.name, tagline: t.tagline }));

/** Curtain rise once per session: runs before the hero paints; the attribute is outside React's props. */
const CURTAIN_SCRIPT = "(function(){try{var s=document.currentScript,e=s&&s.parentElement;if(!e)return;if(sessionStorage.getItem('gh-curtain'))e.setAttribute('data-curtain','done');else sessionStorage.setItem('gh-curtain','1')}catch(_){}})()";

const RIGHTS_NOTE = 'Photographs by Brooke Alaina Photography and films by Oakhouse Visuals are shared here for personal, non-commercial viewing.';

/**
 * The label is the editorial one the rest of the site uses, not the authoring marker.
 *
 * This printed `TODO(Tyler & Sara):` verbatim — on the home page, four times, since level 04. The
 * marker is how a content record says "not a fact yet"; a guest should read that a person is still
 * writing, which is what `PLACEHOLDER_LABEL` says and what level 05's content kit and level 07's
 * guest pages already said. The level-07 regression test covers the guest routes only, so this
 * path was never asserted; `tests/e2e/themes.spec.ts` now covers the themed public pages.
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

function ExternalMark({ provider }: { provider?: string }) {
  return (
    <>
      <Icon name="external" className="gh-external" />
      <span className="sr-only">{`, opens ${provider ? providerLabel(provider) : 'in a new tab'}`}</span>
    </>
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
    <ul className="gh-menu">
      {items.map((item) => (
        <li key={item.href}>
          <NavLink item={item} nav={nav} className="gh-menu__link" />
        </li>
      ))}
    </ul>
  );
}

function Nav({ nav, siteName, homeLabel, switcherEnabled }: NavProps) {
  // Up to six links sit mirrored around the plaque in one row; longer states put `more` on an architrave line.
  const inline = nav.primary.length + nav.more.length <= 6;
  const sideItems = inline ? allItems(nav) : nav.primary;
  const architrave = inline ? [] : nav.more;
  const half = Math.ceil(sideItems.length / 2);
  const left = sideItems.slice(0, half);
  const right = sideItems.slice(half);
  return (
    <>
      <nav className="gh-frieze" aria-label="Site">
        <ul className="gh-frieze__side gh-frieze__side--left">
          {left.map((item) => (
            <li key={item.href}>
              <NavLink item={item} nav={nav} className="gh-nav__link" />
            </li>
          ))}
        </ul>
        <a className="gh-plaque-link" href="/" aria-current={nav.currentPath === '/' ? 'page' : undefined}>
          <span className="gh-plaque gh-plaque--mono" aria-hidden="true">
            S+T
          </span>
          <span className="sr-only">
            {siteName}: {homeLabel}
          </span>
        </a>
        <ul className="gh-frieze__side gh-frieze__side--right">
          {right.map((item) => (
            <li key={item.href}>
              <NavLink item={item} nav={nav} className="gh-nav__link" />
            </li>
          ))}
          {switcherEnabled ? (
            <li className="gh-frieze__switcher">
              <DesignSwitcher variant="trigger" id="design-switcher-nav" current="gilded-hour" themes={THEME_OPTIONS} />
            </li>
          ) : null}
        </ul>
        <div className="gh-frieze__menu">
          <DialogBase id="site-menu" title="Menu" trigger={<><Icon name="menu" /><span>Menu</span></>} classNames={DIALOG_CLASSES}>
            <MenuList nav={nav} homeLabel={homeLabel} />
            {switcherEnabled ? <DesignSwitcher variant="menu" id="design-switcher-menu" current="gilded-hour" themes={THEME_OPTIONS} /> : null}
          </DialogBase>
        </div>
        {architrave.length ? (
          <ul className="gh-frieze__more">
            {architrave.map((item) => (
              <li key={item.href}>
                <NavLink item={item} nav={nav} className="gh-nav__link gh-nav__link--more" />
              </li>
            ))}
          </ul>
        ) : null}
      </nav>
    </>
  );
}

/**
 * The elevator panel: fixed to the bottom of the viewport, so it is emitted after `</main>`. A
 * keyboard or screen-reader user reaches the page in three stops instead of walking the whole bar.
 */
function Panel({ nav }: { nav: NavProps['nav'] }) {
  const cells = bottomCells(nav, 4);
  if (!cells.length) return null;
  return (
    <nav className="gh-panel" aria-label="Quick actions" style={{ ['--cells' as string]: cells.length }}>
      {cells.map((item) => (
        <NavLink key={item.href} item={item} nav={nav} className={`gh-panel__cell${item.label === 'RSVP' || item.label === 'Add photos' ? ' gh-panel__cell--accent' : ''}`} short />
      ))}
    </nav>
  );
}

function Footer({ site, switcher, rightsNote, printUrls }: FooterProps) {
  return (
    <footer className="gh-footer">
      <div className="gh-footer__inner">
        <p className="gh-footer__names">{site.coupleDisplayName}</p>
        <p className="gh-footer__date">
          <span className="gh-numeral">{site.date.motif}</span>
        </p>
        <p className="gh-footer__place">
          {site.venue.name}
          <br />
          <a className="gh-link" href={site.venue.mapsUrl} rel="noopener">
            {site.venue.address}
            <ExternalMark provider={site.venue.mapsProvider} />
          </a>
        </p>
        <p className="gh-footer__rights">{rightsNote}</p>
        <ul className="gh-footer__print">
          {printUrls.map((p) => (
            <li key={p.url}>
              {p.label}: {p.url}
            </li>
          ))}
        </ul>
        {switcher ? <div className="gh-footer__switcher">{switcher}</div> : null}
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
  return (
    <div className="site gh" data-theme="gilded-hour" data-bottom-bar="" data-lifecycle={frame.lifecycle.state} suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: CURTAIN_SCRIPT }} />
      <ThemeSync theme="gilded-hour" />
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {banner}
      <header className="gh-header">
        <Nav nav={frame.nav} siteName={frame.site.coupleDisplayName} homeLabel={homeLabel} switcherEnabled={frame.switcherEnabled} />
      </header>
      <main id="main" className="gh-main" tabIndex={-1}>
        {children}
      </main>
      <Panel nav={frame.nav} />
      <Footer
        site={frame.site}
        switcher={frame.switcherEnabled ? <DesignSwitcher variant="trigger" id="design-switcher-footer" current="gilded-hour" themes={THEME_OPTIONS} /> : null}
        rightsNote={RIGHTS_NOTE}
        printUrls={printUrls}
      />
    </div>
  );
}

function Button({ variant = 'primary', href, type = 'button', loading, provider, children, className, ...rest }: ButtonProps) {
  const cls = `gh-btn gh-btn--${variant}${className ? ` ${className}` : ''}`;
  const inner = (
    <>
      <span>{children}</span>
      {variant === 'external' ? <ExternalMark provider={provider} /> : null}
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

function Link({ href, external, children, className, ...rest }: LinkProps) {
  const ext = external ?? /^https?:/.test(href);
  return (
    <a className={`gh-link${className ? ` ${className}` : ''}`} href={href} rel={ext ? 'noopener' : undefined} {...rest}>
      {children}
      {ext ? <ExternalMark /> : null}
    </a>
  );
}

function Eyebrow({ children, tone = 'default' }: EyebrowProps) {
  return <p className={`gh-eyebrow${tone === 'moss' ? ' gh-eyebrow--moss' : ''}`}>{children}</p>;
}

function Divider({ ornament = true }: DividerProps) {
  return <hr className={ornament ? 'gh-divider' : 'gh-rule'} />;
}

function SectionHeading({ level, title, eyebrow, lede, id }: SectionHeadingProps) {
  const H = `h${level}` as 'h1' | 'h2' | 'h3';
  return (
    <div className="gh-section__head">
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <Divider />
      <H id={id} className={`gh-h gh-h--${level}`}>
        {title}
      </H>
      {lede ? <p className="gh-lede">{lede}</p> : null}
    </div>
  );
}

function Section({ id, number, ground = 'default', children, labelledBy }: SectionProps) {
  return (
    <section id={id} className={`gh-section gh-section--${ground}`} aria-labelledby={labelledBy} data-number={number}>
      <div className="gh-section__inner">
        {number ? (
          <span className="gh-plaque gh-plaque--act" aria-hidden="true">
            {String(number).padStart(2, '0')}
          </span>
        ) : null}
        {number ? <span className="sr-only">Part {number}.</span> : null}
        {children}
      </div>
    </section>
  );
}

function Prose({ children, lead }: ProseProps) {
  return <div className={`gh-prose${lead ? ' gh-prose--lead' : ''}`}>{children}</div>;
}

function Card({ title, headingLevel = 3, children, media, actions, label, featured, id }: CardProps) {
  const H = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  const body = (
    <div className="gh-card__inner">
      {label ? (
        <span className="gh-plaque gh-plaque--label" aria-hidden="true">
          {label}
        </span>
      ) : null}
      {media ? <div className="gh-card__media">{media}</div> : null}
      {title ? <H className="gh-card__title">{title}</H> : null}
      <div className="gh-card__body">{children}</div>
      {actions ? <div className="gh-card__actions">{actions}</div> : null}
    </div>
  );
  return (
    <article id={id} className={`gh-card${featured ? ' gh-card--featured' : ''}`}>
      {body}
    </article>
  );
}

function ImageFrame({ src, alt, width, height, caption, credit, sizes, priority }: ImageFrameProps) {
  return (
    <figure className="gh-frame">
      <div className="gh-frame__mat">
        {/* eslint-disable-next-line @next/next/no-img-element -- kits stay framework-light; srcset/sizes are explicit */}
        <img src={src} alt={alt} width={width} height={height} sizes={sizes} loading={priority ? 'eager' : 'lazy'} decoding="async" fetchPriority={priority ? 'high' : undefined} />
      </div>
      {caption || credit ? (
        <figcaption className="gh-frame__caption">
          {caption}
          {credit ? <span className="gh-frame__credit"> {credit}</span> : null}
        </figcaption>
      ) : null}
    </figure>
  );
}

function Gallery({ items, label }: GalleryProps) {
  return (
    <ul className="gh-gallery" aria-label={label}>
      {items.map((item) => (
        <li key={item.id} className="gh-gallery__item">
          <DialogBase
            id={`lightbox-${item.id}`}
            title={item.caption ?? item.alt}
            trigger={<ImageFrame {...item} />}
            triggerLabel={`Open ${item.caption ?? item.alt}`}
            classNames={{ ...DIALOG_CLASSES, trigger: 'gh-gallery__trigger', dialog: 'gh-dialog gh-dialog--lightbox' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- lightbox image at natural size */}
            <img src={item.src} alt={item.alt} width={item.width} height={item.height} />
            {item.downloadable ? (
              <p>
                <a className="gh-btn gh-btn--ghost" href={item.src} download>
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
    <ol className="gh-timeline" aria-label={label}>
      {events.map((e) => (
        <li key={e.id} className="gh-timeline__item" aria-current={nowId === e.id ? 'step' : undefined}>
          <span className="gh-timeline__time">
            {e.start ? <time dateTime={e.start}>{formatTimeIn(e.start, timezone)}</time> : null}
            {e.end ? <> to <time dateTime={e.end}>{formatTimeIn(e.end, timezone)}</time></> : null}
          </span>
          <div className="gh-timeline__detail">
            <h3 className="gh-timeline__name">{e.name}</h3>
            <p className="gh-timeline__place">{e.place ? e.place : <Placeholder todo={e.start ? 'room' : 'time and room'} />}</p>
            {e.description ? (
              <p className="gh-timeline__desc">
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
    <div className="gh-stat">
      <dt className="gh-stat__label">{label}</dt>
      <dd className="gh-stat__value">
        {placeholder ? <Placeholder todo={label.toLowerCase()} /> : value}
        {provenance?.stale ? <Badge status="stale">Needs re-checking</Badge> : null}
        {provenance?.verifiedAt ? <span className="gh-stat__meta">Verified {provenance.verifiedAt.slice(0, 10)}</span> : null}
      </dd>
    </div>
  );
}

function Badge({ status, children }: BadgeProps) {
  return <span className={`gh-badge gh-badge--${status}`}>{children}</span>;
}

function MapHandoff({ venue, note }: MapHandoffProps) {
  return (
    <div className="gh-map">
      <p className="gh-map__name">{venue.name}</p>
      <p className="gh-map__address">{venue.address}</p>
      {note ? <p className="gh-map__note">{note}</p> : null}
      <a className="gh-btn gh-btn--external" href={venue.mapsUrl} rel="noopener">
        <span>Open in {venue.mapsProvider}</span>
        <ExternalMark provider={venue.mapsProvider} />
      </a>
      <p className="gh-map__url">{venue.mapsUrl}</p>
    </div>
  );
}

function Skeleton({ lines = 3, width = '100%', height, label = 'Loading' }: SkeletonProps) {
  return (
    <div className="gh-skeleton" role="status" aria-busy="true" style={{ width }}>
      <span className="sr-only">{label}</span>
      {height ? (
        <span className="gh-skeleton__block" style={{ height }} aria-hidden="true" />
      ) : (
        Array.from({ length: lines }).map((_, i) => <span key={i} className="gh-skeleton__line" aria-hidden="true" />)
      )}
    </div>
  );
}

function Dialog({ id, title, trigger, triggerLabel, children, closeLabel }: DialogProps) {
  return (
    <DialogBase id={id} title={title} trigger={trigger} triggerLabel={triggerLabel} closeLabel={closeLabel} classNames={{ ...DIALOG_CLASSES, trigger: 'gh-btn gh-btn--ghost' }}>
      {children}
    </DialogBase>
  );
}

function Field({ id, label, hint, error, required, children }: FieldProps) {
  return (
    <div className="gh-field">
      <label className="gh-label" htmlFor={id}>
        {label}
        {required ? <span className="gh-label__required"> (required)</span> : null}
      </label>
      {hint ? (
        <p className="gh-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p className="gh-error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
const describedBy = (id: string, invalid?: boolean, hint?: boolean) => [hint ? `${id}-hint` : null, invalid ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;

function Input({ id, invalid, className, ...rest }: InputProps) {
  return <input id={id} className={`gh-input${className ? ` ${className}` : ''}`} aria-invalid={invalid || undefined} aria-describedby={describedBy(id, invalid, rest['aria-describedby'] !== undefined)} {...rest} />;
}
function Select({ id, invalid, className, children, ...rest }: SelectProps) {
  return (
    <select id={id} className={`gh-input gh-select${className ? ` ${className}` : ''}`} aria-invalid={invalid || undefined} aria-describedby={describedBy(id, invalid)} {...rest}>
      {children}
    </select>
  );
}
function Textarea({ id, invalid, className, ...rest }: TextareaProps) {
  return <textarea id={id} className={`gh-input gh-textarea${className ? ` ${className}` : ''}`} aria-invalid={invalid || undefined} aria-describedby={describedBy(id, invalid)} {...rest} />;
}
function Choice({ kind, id, label, className, ...rest }: ChoiceProps & { kind: 'radio' | 'checkbox' }) {
  return (
    <label className={`gh-choice${className ? ` ${className}` : ''}`} htmlFor={id}>
      <input id={id} type={kind} className="gh-choice__input" {...rest} />
      <span className="gh-choice__label">{label}</span>
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
    <fieldset className="gh-fieldset" aria-invalid={error ? true : undefined}>
      <legend className="gh-legend">{legend}</legend>
      {hint ? <p className="gh-hint">{hint}</p> : null}
      {children}
      {error ? <p className="gh-error">{error}</p> : null}
    </fieldset>
  );
}
function ErrorSummary({ title = 'Please check the highlighted fields', errors }: ErrorSummaryProps) {
  if (!errors.length) return null;
  return (
    <div className="gh-error-summary" role="alert" tabIndex={-1}>
      <h2 className="gh-error-summary__title">{title}</h2>
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

function Hero({ content, site, countdown, state }: HeroProps) {
  const isToday = state === 'WEDDING_DAY';
  return (
    <section className="gh-hero" aria-labelledby="hero-title">
      <div className="gh-hero__curtain" aria-hidden="true" />
      <div className="gh-hero__sunburst" aria-hidden="true" />
      <div className="gh-hero__inner">
        <h1 id="hero-title" className="gh-hero__title">
          {content.title}
        </h1>
        <p className="gh-hero__date">
          <time dateTime={site.date.iso} className="gh-numeral gh-hero__motif">
            {site.date.motif}
          </time>
          <span className="gh-hero__long">{isToday ? `${site.date.weekday}, ${site.date.long.split(', ').slice(1).join(', ')}` : site.date.long}</span>
        </p>
        <p className="gh-hero__place">
          {site.venue.name}, {site.venue.city}
        </p>
        <p className="gh-hero__status">{content.eyebrow}.</p>
        <p className="gh-hero__lede">
          <Text copy={content.lede} />
        </p>
        {content.showCountdown ? (
          <div className="gh-hero__countdown-slot">
            <Countdown {...countdown} />
          </div>
        ) : null}
        <div className="gh-hero__actions">
          <Button variant={content.primary.variant ?? 'primary'} href={content.primary.href} provider={content.primary.provider}>
            {content.primary.label}
          </Button>
          {content.secondary ? (
            <Button variant={content.secondary.variant ?? 'ghost'} href={content.secondary.href} provider={content.secondary.provider}>
              {content.secondary.label}
            </Button>
          ) : null}
        </div>
        {content.deadline ? (
          <p className="gh-hero__deadline">
            <Text copy={content.deadline} />
          </p>
        ) : null}
        {content.note ? (
          <p className="gh-hero__note">
            <Text copy={content.note} />
          </p>
        ) : null}
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
