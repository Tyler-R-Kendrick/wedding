import Link from 'next/link';

export interface UnavailableCardProps {
  heading: string;
  /** What exactly is unavailable, in plain words. */
  message: string;
  contactRoute?: string;
  note?: string | null;
  placeholder?: boolean;
}

/** The honest last rung of the ladder (ADR-0004 §3): says what is unavailable and offers the couple's contact route. Never a fake button. */
export function UnavailableCard({ heading, message, contactRoute = '/ask-us', note, placeholder }: UnavailableCardProps) {
  return (
    <article className="border-t border-primary/20 py-6" data-handoff-rung="unavailable">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h3 className="text-xl">{heading}</h3>
        <p className="text-[0.75rem] uppercase tracking-[0.14em] text-primary/70">not bookable here yet</p>
      </div>
      {note ? <p className="mt-2 max-w-[65ch] text-primary/80">{note}</p> : null}
      {placeholder ? (
        <p className="mt-2 max-w-[65ch] italic text-primary/70">
          <span className="sr-only">Placeholder: </span>Sara and Tyler still have to add this one.
        </p>
      ) : null}
      <p className="mt-3 max-w-[65ch]">{message}</p>
      <p className="mt-3">
        <Link className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" href={contactRoute}>
          Ask us
        </Link>
      </p>
    </article>
  );
}
