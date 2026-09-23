import Link from 'next/link';
import type { MyRsvp } from '@/capabilities/rsvp';
import type { RsvpPart } from '@/domain/rsvp/parts';
import { Badge } from './fields';

type Part = MyRsvp['parts'][number];

/** Each part has its own page under /rsvp, for changing it on its own; /rsvp asks whatever is still open. */
export const PART_STEP: Record<RsvpPart, string> = { attendance: 'attending', plusOne: 'guest', meal: 'meals', notes: 'notes' };
export const STEP_PART: Readonly<Record<string, RsvpPart>> = { attending: 'attendance', guest: 'plusOne', meals: 'meal', notes: 'notes' };

export const PART_LEDE: Record<RsvpPart, string> = {
  attendance: 'Tell us who is coming to each event on your invitation.',
  plusOne: 'Your invitation includes a guest. Let us know whether you are bringing one.',
  meal: 'Choose a meal for each person who is coming.',
  notes: 'Allergies, dietary needs, mobility or seating needs. Only the caterer and the planner see these.',
};

export const PART_TITLE: Record<RsvpPart, string> = {
  attendance: 'Who is coming',
  plusOne: 'Bringing a guest',
  meal: 'Meals',
  notes: 'Dietary and access needs',
};

const PART_HINT: Record<RsvpPart, string> = {
  attendance: 'Yes or no for each event on your invitation.',
  plusOne: 'Your invitation includes a guest. Tell us if you are bringing one.',
  meal: 'A meal for each person who is coming.',
  notes: 'Optional. Only the caterer and the planner see these.',
};

/**
 * The status word, never colour alone. A part that is not open says why in the guest's terms — a
 * menu not set yet is a different wait from a part not released — and never promises a date.
 */
function statusOf(p: Part): { tone: 'yes' | 'no' | 'pending' | 'stale' | 'info'; text: string } {
  switch (p.status) {
    case 'done':
      return { tone: 'yes', text: p.part === 'notes' ? 'Added' : 'Done' };
    case 'in_progress':
      return { tone: 'pending', text: `${p.answered} of ${p.expected} done` };
    case 'not_started':
      return { tone: 'pending', text: 'Not started' };
    case 'needs_attention':
      return { tone: 'stale', text: 'The menu changed — choose again' };
    case 'waiting':
      return { tone: 'info', text: 'After you say who is coming' };
    case 'not_needed':
      return { tone: 'no', text: 'Not needed' };
    case 'optional':
      return { tone: 'info', text: 'Optional' };
    case 'later':
      return { tone: 'info', text: p.reason === 'menu_pending' ? 'Opens once the menu is set' : 'Opens later' };
  }
}

/** The reply button's words: "Continue" only while something open is still unanswered; otherwise the reply is there to change. */
export function replyLabel(rsvp: { status: 'not_started' | 'partial' | 'complete'; next: readonly RsvpPart[] }): string {
  if (rsvp.status === 'not_started') return 'RSVP now';
  return rsvp.next.length ? 'Continue your RSVP' : 'Review or change your RSVP';
}

/** A row links only when there is something to do or change there. */
export function isActionable(p: Part): boolean {
  return p.state === 'open' && p.status !== 'waiting' && p.status !== 'not_needed';
}

/**
 * The RSVP as a task list (GOV.UK Design System › Task list): every part of the invitation, what is
 * done, what is next, and what opens later — so a part released a month from now has a place today
 * and the guest knows to come back for it. Parts not on this invitation are not listed at all.
 *
 * `interactive` is false when the window is shut or the caller may not answer: the list still says
 * where things stand, but offers no link that would end in "you cannot do that".
 */
export function RsvpTaskList({ parts, interactive, idPrefix = 'rsvp-task', labelledBy }: { parts: readonly Part[]; interactive: boolean; idPrefix?: string; labelledBy?: string }) {
  const shown = parts.filter((p) => p.state !== 'not_applicable');
  if (!shown.length) return null;
  return (
    <ul className="tasks" {...(labelledBy ? { 'aria-labelledby': labelledBy } : { 'aria-label': 'Your RSVP, part by part' })}>
      {shown.map((p) => {
        const status = statusOf(p);
        const statusId = `${idPrefix}-${p.part}-status`;
        const hintId = `${idPrefix}-${p.part}-hint`;
        const link = interactive && isActionable(p);
        return (
          <li key={p.part} className={link ? 'tasks__item tasks__item--link' : 'tasks__item'}>
            <div className="tasks__name">
              {link ? (
                <Link className="tasks__link" href={`/rsvp/${PART_STEP[p.part]}`} aria-describedby={`${hintId} ${statusId}`}>
                  {PART_TITLE[p.part]}
                </Link>
              ) : (
                <span className="tasks__label">{PART_TITLE[p.part]}</span>
              )}
              <p className="tasks__hint" id={hintId}>
                {PART_HINT[p.part]}
              </p>
            </div>
            <span className="tasks__status" id={statusId}>
              <Badge tone={status.tone}>{status.text}</Badge>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
