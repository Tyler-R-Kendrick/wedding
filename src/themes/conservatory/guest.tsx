import type { GuestCardProps, GuestNoticeProps, GuestSectionProps } from '../guest';

/**
 * Conservatory's guest-recipe section: a fern divider growing from the left margin and stopping at
 * 12rem, a Gloock heading, and a ground that ALTERNATES — DESIGN.md § Layout,
 * "sections are separated by *washes* (sky, moss, parchment) and by fern dividers that grow from the
 * left margin and stop at 12rem, not by full-width rules and not by identical whitespace".
 *
 * The shared `.sec` this replaces was a 1px full-width rule and the same padding above every
 * section: both halves of what that sentence forbids, on the four routes a claimed guest lives on.
 *
 * No eyebrow. DESIGN.md § Components still lists one ("moss small caps above a section title") and
 * `PageIntro` still sets one above the `<h1>` on the nine public pages, but impeccable's craft floor
 * bans a kicker above a heading outright — "a ban, not a default: no brief earns it back. The
 * heading carries its own weight" (`reference/craft-floor.md`). The first version of this file put
 * one above every guest `<h2>` and `impeccable detect http://localhost:3316/transportation` returned
 * `[kicker-above-heading] kicker "For you" above h2 "Your ride home"`. See PR-20 § carried debt for
 * the `PageIntro` half, which is older than this level and outside it.
 */
const GROUNDS = ['plain', 'wash', 'plain', 'alt'] as const;

export function GuestSection({ id, title, index = 0, children }: GuestSectionProps) {
  const ground = GROUNDS[index % GROUNDS.length];
  return (
    <section id={id} className={`cv-gsec cv-gsec--${ground}`} aria-labelledby={`${id}-title`}>
      <hr className="cv-fern cv-gsec__fern" />
      <h2 id={`${id}-title`} className="cv-h cv-h--2 cv-gsec__title">
        {title}
      </h2>
      <div className="cv-gsec__body">{children}</div>
    </section>
  );
}

/** A pressed card on the sheet: hairline frame, a kraft thread at the top edge, left-weighted. */
export function GuestCard({ title, titleId, level = 3, children }: GuestCardProps) {
  const H = `h${level}` as const;
  return (
    <article className="cv-card cv-gcard">
      {title ? (
        <H id={titleId} className="cv-h cv-h--3 cv-gcard__title">
          {title}
        </H>
      ) : null}
      {children}
    </article>
  );
}

/** A kraft tag pinned to a wash: the herbarium way to set something apart is a ground, not a rule. */
export function GuestNotice({ tone = 'info', title, children }: GuestNoticeProps) {
  return (
    <div className={`cv-gnotice cv-gnotice--${tone}`} role={tone === 'urgent' ? 'alert' : 'status'}>
      {title ? <p className="cv-gnotice__title">{title}</p> : null}
      <div className="cv-gnotice__body">{children}</div>
    </div>
  );
}
