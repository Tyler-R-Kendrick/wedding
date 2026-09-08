import type { GuestCardProps, GuestNoticeProps, GuestSectionProps } from '../guest';

/**
 * Gilded Hour's guest-recipe section: chevron divider, Cinzel heading on the page axis, and a
 * plinth of space beneath — DESIGN.md § Layout, "each section opens with an eyebrow, a chevron
 * divider, a Cinzel heading, and a clear plinth of space beneath". The shared `.sec` this replaces
 * opened with a 1px full-width rule and left-aligned everything, which is the opposite instruction.
 *
 * The chevron is skipped above the first section: it would sit directly under the page title, where
 * the title is already the divider.
 *
 * The eyebrow that sentence asks for is NOT here, and this is the one place a theme kit knowingly
 * departs from its own DESIGN.md. impeccable's craft floor bans a kicker above a heading outright —
 * "a ban, not a default: no brief earns it back. The heading carries its own weight; delete the
 * label and let the heading speak" (`reference/craft-floor.md`) — and the first version of this file
 * shipped one above every guest `<h2>`, which `impeccable detect http://localhost:3316/transportation`
 * caught as `[kicker-above-heading] kicker "For you" above h2 "Your ride home"`. Reconciling the two
 * documents is a DESIGN.md change, which is not this level's to make; PR-20 § carried debt records
 * it together with the nine public pages where `PageIntro` still sets one above the `<h1>`.
 */
export function GuestSection({ id, title, index = 0, children }: GuestSectionProps) {
  return (
    <section id={id} className="gh-gsec" aria-labelledby={`${id}-title`}>
      {index > 0 ? <hr className="gh-divider gh-gsec__rule" /> : null}
      <h2 id={`${id}-title`} className="gh-h gh-h--2 gh-gsec__title">
        {title}
      </h2>
      <div className="gh-gsec__body">{children}</div>
    </section>
  );
}

/**
 * A stepped frame on the axis. `.gh-card__title` is Cinzel at `h2`, which DESIGN.md reserves for
 * 24px and up ("Cinzel never appears below 24px and never in running text") — a guest card's title
 * is a person's name or an event, so it takes the Josefin `h3` step instead.
 */
export function GuestCard({ title, titleId, level = 3, children }: GuestCardProps) {
  const H = `h${level}` as const;
  return (
    <article className="gh-card gh-gcard">
      <div className="gh-card__inner">
        {title ? (
          <H id={titleId} className="gh-h gh-h--3 gh-gcard__title">
            {title}
          </H>
        ) : null}
        {children}
      </div>
    </article>
  );
}

/** A gold-ruled plinth on the axis: the Deco way to set something apart is ornament, not a tint. */
export function GuestNotice({ tone = 'info', title, children }: GuestNoticeProps) {
  return (
    <div className={`gh-gnotice gh-gnotice--${tone}`} role={tone === 'urgent' ? 'alert' : 'status'}>
      {title ? <p className="gh-gnotice__title">{title}</p> : null}
      <div className="gh-gnotice__body">{children}</div>
    </div>
  );
}
