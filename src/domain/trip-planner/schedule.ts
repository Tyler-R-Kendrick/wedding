import { DETAILS_TBC, eventTime, settledText, TIME_TBA } from './ics';
import { dateLabel, type StayFacts } from './facts';
import type { WeddingEventInput } from './types';

/**
 * The wedding's own events as the guest reads them: in the couple's order, each with its time or
 * "Time to be announced", and the room, dress code, access note and words only when the couple have
 * set them. Nothing here is a default or a guess; an unset field is simply not said.
 */
export type ScheduleItem = {
  id: string;
  name: string;
  dateIso: string;
  /** "Saturday, July 17". */
  day: string;
  /** "4:30 pm – 5:00 pm", or null while the time is not announced. */
  time: string | null;
  room: string | null;
  dressCode: string | null;
  accessibilityNote: string | null;
  about: string | null;
  /** A line for an event whose time is set but whose details the couple still mark as not confirmed. */
  note: string | null;
};

export function scheduleOf(events: readonly WeddingEventInput[]): ScheduleItem[] {
  return events
    .map((e, i) => ({ e, i }))
    // By day; within a day, the couple's own order (the order the invitation lists them in).
    .sort((a, b) => a.e.dateIso.localeCompare(b.e.dateIso) || a.i - b.i)
    .map(({ e }) => {
      const time = eventTime(e.startsAt, e.endsAt);
      return {
        id: e.id,
        name: e.name,
        dateIso: e.dateIso,
        day: dateLabel(e.dateIso),
        time,
        room: settledText(e.room) || null,
        dressCode: settledText(e.dressCode) || null,
        accessibilityNote: settledText(e.accessibilityNote) || null,
        about: settledText(e.description) || null,
        note: time && e.unconfirmed ? DETAILS_TBC : null,
      };
    });
}

/** How an event's time reads on the page. */
export const timeText = (item: Pick<ScheduleItem, 'time'>) => item.time ?? TIME_TBA;

/** The room block's check-in and check-out, as plain lines about the block (never about a guest's own booking). */
export function blockDateLines(stay: Pick<StayFacts, 'checkIn' | 'checkOut'>): { checkIn: string | null; checkOut: string | null } {
  return {
    checkIn: stay.checkIn ? `Our room block: check-in ${dateLabel(stay.checkIn)}` : null,
    checkOut: stay.checkOut ? `Our room block: check-out ${dateLabel(stay.checkOut)}` : null,
  };
}
