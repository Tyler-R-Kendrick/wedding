import { DesignSwitcher } from '@/components/switcher/DesignSwitcher';
import { homeLabelFor } from '@/domain/lifecycle/nav';
import { listThemes } from '@/themes/registry';
import { renderCopy } from '@/themes/shared/copy';
import { ThemeSync } from '@/themes/shared/ThemeSync';
import { DialogBase } from '@/themes/shared/DialogBase';
import { formatTimeIn } from '@/themes/shared/format';
import { allItems, isCurrent } from '@/themes/shared/nav-utils';
import type {
  BadgeProps, ButtonProps, CardProps, ChoiceProps, Copy, DialogProps, DividerProps, ErrorSummaryProps, EyebrowProps, FieldProps, FieldsetProps, FooterProps, GalleryProps, HeroProps,
  ImageFrameProps, InputProps, LinkProps, MapHandoffProps, NavItem, NavProps, PlaceholderProps, ProseProps, SectionHeadingProps, SectionProps, SelectProps, ShellProps, SkeletonProps,
  StatProps, TextareaProps, ThemeComponentKit, TimelineProps,
} from '@/themes/types';
import { Countdown } from './Countdown';

/*
 * Conservatory kit: the herbarium sheet. Left-weighted text, a mounting area where pressed cards
 * and kraft tags hang, washes instead of rules, line-art foliage. Tokens only; markup is its own.
 */

const DIALOG_CLASSES = {
  trigger: 'cv-tag cv-tag--button',
  dialog: 'cv-dialog',
  panel: 'cv-dialog__panel',
  header: 'cv-dialog__header',
  title: 'cv-dialog__title',
  close: 'cv-btn cv-btn--ghost cv-dialog__close',
  body: 'cv-dialog__body',
};

const THEME_OPTIONS = listThemes().map((t) => ({ id: t.id, name: t.name, tagline: t.tagline }));
const RIGHTS_NOTE = 'Photographs by Brooke Alaina Photography and films by Oakhouse Visuals are shared here for personal, non-commercial viewing.';
const FLOWERS = ['a', 'b', 'c'] as const;

function Placeholder({ todo }: PlaceholderProps) {
  return (
    <span className="placeholder">
      <span className="placeholder__tag">TODO(Tyler &amp; Sara):</span> {todo}
    </span>
  );
}

function Text({ copy }: { copy: Copy }) {
  return <>{renderCopy(copy, Placeholder)}</>;
}

function Leaf() {
  return (
    <svg className="cv-leaf" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      <path d="M4 20C4 10 10 4 20 4c0 10-6 16-16 16z" fill="var(--color-leaf)" stroke="var(--color-leaf-deep)" strokeWidth="1.25" strokeLinejoin="round" />
      <path d="M4 20 20 4" fill="none" stroke="var(--color-leaf-deep)" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

function ExternalMark({ provider }: { provider?: string }) {
  return (
    <>
      <svg className="cv-external" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
        <path d="M14 4h6v6M20 4l-9 9M18 13v7H4V6h7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="sr-only">{provider ? `, opens ${provider}` : ', opens in a new site'}</span>
    </>
  );
}

function Tag({ item, nav, className = 'cv-tag' }: { item: NavItem; nav: NavProps['nav']; className?: string }) {
  const current = isCurrent(item, nav);
  return (
    <a className={`${className}${current ? ' is-current' : ''}`} href={item.href} aria-current={current ? 'page' : undefined} rel={item.external ? 'noopener' : undefined}>
      <span>{item.label}</span>
      {item.external ? <ExternalMark provider={item.provider} /> : null}
    </a>
  );
}

function Nav({ nav, siteName, homeLabel, switcherEnabled }: NavProps) {
  const items: NavItem[] = [{ label: homeLabel, href: '/' }, ...allItems(nav)];
  const bar = nav.sticky.slice(0, 2);
  return (
    <>
      <nav className="cv-rail" aria-label="Site">
        <a className="cv-rail__home" href="/" aria-current={nav.currentPath === '/' ? 'page' : undefined}>
          <span className="cv-rail__names">{siteName}</span>
          <span className="sr-only">: {homeLabel}</span>
        </a>
        <ul className="cv-rail__list">
          {items.slice(1).map((item) => (
            <li key={item.href}>
              <Tag item={item} nav={nav} />
            </li>
          ))}
        </ul>
        {switcherEnabled ? (
          <div className="cv-rail__switcher">
            <DesignSwitcher variant="trigger" id="design-switcher-rail" current="conservatory" themes={THEME_OPTIONS} />
          </div>
        ) : null}
      </nav>
      <div className="cv-menu">
        <DialogBase id="site-menu" title="Menu" trigger={<span>Menu</span>} classNames={DIALOG_CLASSES}>
          <ul className="cv-menu__list">
            {items.map((item) => (
              <li key={item.href}>
                <Tag item={item} nav={nav} className="cv-menu__link" />
              </li>
            ))}
          </ul>
          {switcherEnabled ? <DesignSwitcher variant="menu" id="design-switcher-menu" current="conservatory" themes={THEME_OPTIONS} /> : null}
        </DialogBase>
      </div>
      {bar.length ? (
        <nav className="cv-bar" aria-label="Quick actions">
          {bar.map((item, i) => (
            <a key={item.href} className={`cv-btn ${i === 0 ? 'cv-btn--accent' : 'cv-btn--ghost'} cv-bar__action`} href={item.href} rel={item.external ? 'noopener' : undefined}>
              <span>{item.label}</span>
              {item.external ? <ExternalMark provider={item.provider} /> : null}
            </a>
          ))}
        </nav>
      ) : null}
    </>
  );
}

function Footer({ site, switcher, rightsNote, printUrls }: FooterProps) {
  return (
    <footer className="cv-footer">
      <div className="cv-footer__inner">
        <p className="cv-footer__names">{site.coupleDisplayName}</p>
        <p className="cv-footer__specimen">
          <span>{site.date.long}</span>
          <br />
          {site.venue.name},{' '}
          <a className="cv-link" href={site.venue.mapsUrl} rel="noopener">
            {site.venue.address}
            <ExternalMark provider={site.venue.mapsProvider} />
          </a>
        </p>
        <p className="cv-footer__rights">{rightsNote}</p>
        <ul className="cv-footer__print">
          {printUrls.map((p) => (
            <li key={p.url}>
              {p.label}: {p.url}
            </li>
          ))}
        </ul>
        {switcher ? <div className="cv-footer__switcher">{switcher}</div> : null}
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
    <div className="site cv" data-theme="conservatory" data-bottom-bar={frame.nav.sticky.length ? '' : undefined} data-lifecycle={frame.lifecycle.state}>
      <ThemeSync theme={"conservatory"} />
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {banner}
      <div className="cv-sheet">
        <header className="cv-header">
          <Nav nav={frame.nav} siteName={frame.site.coupleDisplayName} homeLabel={homeLabel} switcherEnabled={frame.switcherEnabled} />
        </header>
        <main id="main" className="cv-main" tabIndex={-1}>
          {children}
        </main>
      </div>
      <Footer
        site={frame.site}
        switcher={frame.switcherEnabled ? <DesignSwitcher variant="trigger" id="design-switcher-footer" current="conservatory" themes={THEME_OPTIONS} /> : null}
        rightsNote={RIGHTS_NOTE}
        printUrls={printUrls}
      />
    </div>
  );
}

function Button({ variant = 'primary', href, type = 'button', loading, provider, children, className, ...rest }: ButtonProps) {
  const cls = `cv-btn cv-btn--${variant}${className ? ` ${className}` : ''}`;
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
    <a className={`cv-link${className ? ` ${className}` : ''}`} href={href} rel={ext ? 'noopener' : undefined} {...rest}>
      {children}
      {ext ? <ExternalMark /> : null}
    </a>
  );
}

function Eyebrow({ children, tone = 'default' }: EyebrowProps) {
  return <p className={`cv-eyebrow${tone === 'moss' ? ' cv-eyebrow--moss' : ''}`}>{children}</p>;
}

function Divider({ ornament = true }: DividerProps) {
  return <hr className={ornament ? 'cv-fern' : 'cv-rule'} />;
}

function SectionHeading({ level, title, eyebrow, lede, id }: SectionHeadingProps) {
  const H = `h${level}` as 'h1' | 'h2' | 'h3';
  return (
    <div className="cv-section__head">
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <H id={id} className={`cv-h cv-h--${level}`}>
        {title}
      </H>
      {lede ? <p className="cv-lede">{lede}</p> : null}
    </div>
  );
}

function Section({ id, number, ground = 'default', children, labelledBy }: SectionProps) {
  return (
    <section id={id} className={`cv-section cv-section--${ground}`} aria-labelledby={labelledBy} data-number={number}>
      <Divider />
      <div className="cv-section__grid">{children}</div>
    </section>
  );
}

function Prose({ children, lead }: ProseProps) {
  return <div className={`cv-prose${lead ? ' cv-prose--lead' : ''}`}>{children}</div>;
}

function Card({ title, headingLevel = 3, children, media, actions, label, featured, index = 0, id }: CardProps) {
  const H = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  const flower = FLOWERS[index % FLOWERS.length];
  return (
    <article id={id} className={`cv-card${featured ? ' cv-pressed' : ''}`} data-flower={featured ? flower : undefined} style={featured ? ({ ['--i' as string]: index } as React.CSSProperties) : undefined}>
      {label ? <span className="cv-specimen">{label}</span> : null}
      {media ? <div className="cv-card__media">{media}</div> : null}
      {title ? <H className="cv-card__title">{title}</H> : null}
      <div className="cv-card__body">{children}</div>
      {actions ? <div className="cv-card__actions">{actions}</div> : null}
    </article>
  );
}

function ImageFrame({ src, alt, width, height, caption, credit, sizes, priority }: ImageFrameProps) {
  return (
    <figure className="cv-frame">
      {/* eslint-disable-next-line @next/next/no-img-element -- kits stay framework-light; srcset/sizes are explicit */}
      <img src={src} alt={alt} width={width} height={height} sizes={sizes} loading={priority ? 'eager' : 'lazy'} decoding="async" fetchPriority={priority ? 'high' : undefined} />
      {caption || credit ? (
        <figcaption className="cv-frame__caption">
          {caption}
          {credit ? <span className="cv-frame__credit"> {credit}</span> : null}
        </figcaption>
      ) : null}
    </figure>
  );
}

function Gallery({ items, label }: GalleryProps) {
  return (
    <ul className="cv-gallery" aria-label={label}>
      {items.map((item, i) => (
        <li key={item.id} className="cv-gallery__item" style={{ ['--i' as string]: i } as React.CSSProperties}>
          <DialogBase
            id={`lightbox-${item.id}`}
            title={item.caption ?? item.alt}
            trigger={<ImageFrame {...item} />}
            triggerLabel={`Open ${item.caption ?? item.alt}`}
            classNames={{ ...DIALOG_CLASSES, trigger: 'cv-gallery__trigger', dialog: 'cv-dialog cv-dialog--lightbox' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- lightbox image at natural size */}
            <img src={item.src} alt={item.alt} width={item.width} height={item.height} />
            {item.downloadable ? (
              <p>
                <a className="cv-btn cv-btn--ghost" href={item.src} download>
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
    <ol className="cv-vine" aria-label={label}>
      {events.map((e) => (
        <li key={e.id} className="cv-vine__stop" aria-current={nowId === e.id ? 'step' : undefined}>
          <Leaf />
          <div className="cv-vine__detail">
            <h3 className="cv-vine__name">{e.name}</h3>
            {e.start ? (
              <p className="cv-vine__time">
                <time dateTime={e.start}>{formatTimeIn(e.start, timezone)}</time>
                {e.end ? <> to <time dateTime={e.end}>{formatTimeIn(e.end, timezone)}</time></> : null}
              </p>
            ) : null}
            <p className="cv-vine__place">{e.place ? e.place : <Placeholder todo={e.start ? 'room' : 'time and room'} />}</p>
            {e.description ? (
              <p className="cv-vine__desc">
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
    <div className="cv-stat">
      <dt className="cv-stat__label">{label}</dt>
      <dd className="cv-stat__value">
        {placeholder ? <Placeholder todo={label.toLowerCase()} /> : value}
        {provenance?.stale ? <Badge status="stale">Needs re-checking</Badge> : null}
        {provenance?.verifiedAt ? <span className="cv-stat__meta">Verified {provenance.verifiedAt.slice(0, 10)}</span> : null}
      </dd>
    </div>
  );
}

function Badge({ status, children }: BadgeProps) {
  return <span className={`cv-chip cv-chip--${status}`}>{children}</span>;
}

function MapHandoff({ venue, note }: MapHandoffProps) {
  return (
    <div className="cv-map">
      <p className="cv-map__name">{venue.name}</p>
      <p className="cv-map__address">{venue.address}</p>
      {note ? <p className="cv-map__note">{note}</p> : null}
      <a className="cv-btn cv-btn--external" href={venue.mapsUrl} rel="noopener">
        <span>Open in {venue.mapsProvider}</span>
        <ExternalMark provider={venue.mapsProvider} />
      </a>
      <p className="cv-map__url">{venue.mapsUrl}</p>
    </div>
  );
}

function Skeleton({ lines = 3, width = '100%', height, label = 'Loading' }: SkeletonProps) {
  return (
    <div className="cv-skeleton" role="status" aria-busy="true" style={{ width }}>
      <span className="sr-only">{label}</span>
      {height ? (
        <span className="cv-skeleton__block" style={{ height }} aria-hidden="true" />
      ) : (
        Array.from({ length: lines }).map((_, i) => <span key={i} className="cv-skeleton__line" aria-hidden="true" />)
      )}
    </div>
  );
}

function Dialog({ id, title, trigger, triggerLabel, children, closeLabel }: DialogProps) {
  return (
    <DialogBase id={id} title={title} trigger={trigger} triggerLabel={triggerLabel} closeLabel={closeLabel} classNames={{ ...DIALOG_CLASSES, trigger: 'cv-btn cv-btn--ghost' }}>
      {children}
    </DialogBase>
  );
}

function Field({ id, label, hint, error, required, children }: FieldProps) {
  return (
    <div className="cv-field">
      <label className="cv-label" htmlFor={id}>
        {label}
        {required ? <span className="cv-label__required"> (required)</span> : null}
      </label>
      {hint ? (
        <p className="cv-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p className="cv-error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
const describedBy = (id: string, invalid?: boolean) => (invalid ? `${id}-error` : undefined);

function Input({ id, invalid, className, ...rest }: InputProps) {
  return <input id={id} className={`cv-input${className ? ` ${className}` : ''}`} aria-invalid={invalid || undefined} aria-describedby={describedBy(id, invalid)} {...rest} />;
}
function Select({ id, invalid, className, children, ...rest }: SelectProps) {
  return (
    <select id={id} className={`cv-input cv-select${className ? ` ${className}` : ''}`} aria-invalid={invalid || undefined} aria-describedby={describedBy(id, invalid)} {...rest}>
      {children}
    </select>
  );
}
function Textarea({ id, invalid, className, ...rest }: TextareaProps) {
  return <textarea id={id} className={`cv-input cv-textarea${className ? ` ${className}` : ''}`} aria-invalid={invalid || undefined} aria-describedby={describedBy(id, invalid)} {...rest} />;
}
function Choice({ kind, id, label, className, ...rest }: ChoiceProps & { kind: 'radio' | 'checkbox' }) {
  return (
    <label className={`cv-choice${className ? ` ${className}` : ''}`} htmlFor={id}>
      <input id={id} type={kind} className="cv-choice__input" {...rest} />
      <span className="cv-choice__label">{label}</span>
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
    <fieldset className="cv-fieldset" aria-invalid={error ? true : undefined}>
      <legend className="cv-legend">{legend}</legend>
      {hint ? <p className="cv-hint">{hint}</p> : null}
      {children}
      {error ? <p className="cv-error">{error}</p> : null}
    </fieldset>
  );
}
function ErrorSummary({ title = 'Please check the highlighted fields', errors }: ErrorSummaryProps) {
  if (!errors.length) return null;
  return (
    <div className="cv-error-summary" role="alert" tabIndex={-1}>
      <h2 className="cv-error-summary__title">{title}</h2>
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

/** Names with the "+" drawn in pollen; the accessible name stays "Sara + Tyler". */
function Names({ text }: { text: string }) {
  const [a, b] = text.split(' + ');
  if (!b) return <>{text}</>;
  return (
    <>
      {a}
      <span className="sr-only"> + </span>
      <svg className="cv-plus" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
        <path d="M12 4v16M4 12h16" fill="none" stroke="var(--color-tertiary)" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {b}
    </>
  );
}

function Hero({ content, site, countdown, state }: HeroProps) {
  const isToday = state === 'WEDDING_DAY';
  return (
    <section className="cv-hero" aria-labelledby="hero-title">
      <div className="cv-hero__names">
        <h1 id="hero-title" className="cv-hero__title">
          {isToday ? content.title : <Names text={content.title} />}
        </h1>
        <p className="cv-hero__status">{content.eyebrow}.</p>
      </div>
      <p className="cv-hero__tag">
        <time dateTime={site.date.iso} className="cv-hero__date">
          {site.date.long}
        </time>
        <span className="cv-hero__motif">{site.date.motif}</span>
        <span className="cv-hero__place">
          {site.venue.name}, {site.venue.city}
        </span>
      </p>
      <div className="cv-hero__rest">
        <p className="cv-hero__lede">
          <Text copy={content.lede} />
        </p>
        {content.showCountdown ? <Countdown {...countdown} /> : null}
        <div className="cv-hero__actions">
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
          <p className="cv-hero__deadline">
            <Text copy={content.deadline} />
          </p>
        ) : null}
        {content.note ? (
          <p className="cv-hero__note">
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
};
