import type { GuestCardProps, GuestNoticeProps, GuestSectionProps } from '../guest';

/**
 * Botanical–Deco's guest-recipe section: a Bodoni heading with the short gold rule under it, on the
 * page's left editorial edge, with the section's work on an ivory sheet below. No eyebrow above the
 * heading on these operational pages — the approved Weekend workspace titles its modules plainly.
 */
export function GuestSection({ id, title, index = 0, children }: GuestSectionProps) {
  return (
    <section id={id} className={`bd-gsec${index === 0 ? ' bd-gsec--first' : ''}`} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="bd-gsec__title">
        {title}
      </h2>
      <span className="bd-head__rule" aria-hidden="true" />
      <div className="bd-gsec__body">{children}</div>
    </section>
  );
}

/** An ivory sheet with a hairline edge — the approved workspace's module. */
export function GuestCard({ title, titleId, level = 3, children }: GuestCardProps) {
  const H = `h${level}` as const;
  return (
    <article className="bd-gcard">
      {title ? (
        <H id={titleId} className="bd-gcard__title">
          {title}
        </H>
      ) : null}
      {children}
    </article>
  );
}

/** A notice on a sheet with a gold rule down its leading edge; urgent ones take the error ink. */
export function GuestNotice({ tone = 'info', title, children }: GuestNoticeProps) {
  return (
    <div className={`bd-gnotice bd-gnotice--${tone}`} role={tone === 'urgent' ? 'alert' : 'status'}>
      {title ? <p className="bd-gnotice__title">{title}</p> : null}
      <div className="bd-gnotice__body">{children}</div>
    </div>
  );
}
