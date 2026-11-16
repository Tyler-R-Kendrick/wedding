/**
 * The facts that appear in more than one place on the site, in one list: what each one says, where
 * it is kept, every page it shows on, and how it is changed.
 *
 * The site grew several homes for the same fact. The wedding date is a row in `site_settings`, a
 * constant the trip planner reads, and a day on each event; the valet rate is a content record and
 * a sentence in two constants. This module does not hide that: each fact names the one place an
 * administrator changes, lists the pages that follow it, and, where a copy in the code does not
 * follow, says so and flags the two as different the moment they are. Pure: the capability
 * (`admin_site_details`) reads the records and hands them in.
 */

export type DetailGroup = 'day' | 'replies' | 'schedule' | 'stay' | 'arrival';

export const DETAIL_GROUPS: readonly { id: DetailGroup; label: string }[] = [
  { id: 'day', label: 'The day and the place' },
  { id: 'replies', label: 'Replies' },
  { id: 'schedule', label: 'The schedule' },
  { id: 'stay', label: 'The room block' },
  { id: 'arrival', label: 'Arriving' },
];

export interface ShownOn {
  label: string;
  href: string;
}

/** How a fact is changed: here in one step, on the screen that owns it, or only in the code. */
export type DetailEdit =
  | {
      kind: 'here';
      input: 'date' | 'datetime' | 'text' | 'url';
      capability: string;
      /** The capability's other arguments; the new value is set at `field` (a dotted path). */
      base: Record<string, unknown>;
      field: string;
      /** The value as the field takes it: an ISO day, an ISO instant, or text. */
      raw: string;
      /** May be left empty (saved as null). */
      optional: boolean;
    }
  | { kind: 'screen'; href: string; label: string }
  | { kind: 'code'; where: string };

export interface DetailFact {
  key: string;
  group: DetailGroup;
  label: string;
  /** What it says now, as a person reads it. Null when nothing has been decided. */
  value: string | null;
  /** `todo`: not decided yet. `differs`: a copy in the code says something else. */
  state: 'set' | 'todo' | 'differs';
  shownOn: ShownOn[];
  edit: DetailEdit;
  /** Copies that do not follow an edit made here: where each is, and what it says. */
  copies: { where: string; value: string; follows: false }[];
}

export interface SiteDetailsInput {
  site: { weddingDate: string; venueName: string; venueAddress: string; venueUrl: string | null };
  rsvp: { mode: string; deadlineAt: string | null; note: string | null };
  events: { id: string; name: string; dateIso: string; startsAt: string | null; endsAt: string | null; room: string | null; dressCode: string | null }[];
  block: { rateText: string | null; checkIn: string | null; checkOut: string | null; cutoff: string | null; code: string | null; placeholder: boolean } | null;
  /** The operational-field rows that are edited here, by key. */
  fields: Record<string, { id: string; value: string | null } | undefined>;
  /** What the code itself says, where it keeps its own copy. */
  code: { weddingDate: string; venueName: string; venueAddress: string; valetEntrance: string; valetNote: string; blockCheckIn: string; blockCheckOut: string; blockCutoff: string | null; blockRate: string | null };
  format: { day: (iso: string) => string; instant: (iso: string) => string; window: (startsAt: string | null, endsAt: string | null) => string };
}

const PAGES = {
  frame: { label: 'The footer of every guest page', href: '/guests' },
  dashboard: { label: 'Dashboard', href: '/guests' },
  story: { label: 'Our Story', href: '/our-story' },
  adventures: { label: 'Our Adventures', href: '/our-adventures' },
  venue: { label: 'Our Venue', href: '/our-venue' },
  rsvp: { label: 'RSVP', href: '/rsvp' },
  trip: { label: 'Your Trip', href: '/guests/travel' },
  calendar: { label: 'The calendar file guests download', href: '/guests/travel' },
  concierge: { label: 'Ask Us answers', href: '/guests/ask-us' },
  transport: { label: 'Your ride', href: '/transportation' },
  adminRsvp: { label: 'RSVPs (admin)', href: '/admin/rsvp' },
} satisfies Record<string, ShownOn>;

/** Addresses and names compared the way a reader would: "12 S. Michigan Avenue" is "12 S Michigan Ave". */
export function sameText(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\bavenue\b/g, 'ave')
      .replace(/\bstreet\b/g, 'st')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  return norm(a) === norm(b);
}

const copy = (where: string, value: string) => ({ where, value, follows: false as const });

export function buildSiteDetails(i: SiteDetailsInput): DetailFact[] {
  const facts: DetailFact[] = [];
  const site = (field: string, input: 'date' | 'text' | 'url', raw: string, optional = false): DetailEdit => ({ kind: 'here', input, capability: 'admin_update_site_details', base: {}, field, raw, optional });

  // ---- The day and the place
  const dateCopies = i.code.weddingDate === i.site.weddingDate ? [] : [copy('The trip planner’s weekend days and the lifecycle calendar (src/contracts/lifecycle.ts)', i.format.day(i.code.weddingDate))];
  const offDay = i.events.filter((e) => e.dateIso !== i.site.weddingDate);
  facts.push({
    key: 'wedding.date',
    group: 'day',
    label: 'Wedding date',
    value: i.format.day(i.site.weddingDate),
    state: dateCopies.length ? 'differs' : 'set',
    shownOn: [PAGES.frame, PAGES.dashboard, PAGES.story, PAGES.adventures, PAGES.rsvp, PAGES.concierge],
    edit: site('weddingDate', 'date', i.site.weddingDate),
    // Each event keeps its own day (a welcome dinner is the night before), so they are listed, not moved.
    copies: [...dateCopies, ...offDay.map((e) => copy(`${e.name} is on its own day (Schedule)`, i.format.day(e.dateIso)))],
  });
  facts.push({
    key: 'venue.name',
    group: 'day',
    label: 'Venue name',
    value: i.site.venueName,
    state: sameText(i.code.venueName, i.site.venueName) ? 'set' : 'differs',
    shownOn: [PAGES.frame, PAGES.story, PAGES.adventures, PAGES.venue, PAGES.rsvp, PAGES.concierge],
    edit: site('venueName', 'text', i.site.venueName),
    copies: sameText(i.code.venueName, i.site.venueName) ? [] : [copy('Your Trip and the hotel search (src/domain/travel/facts.ts)', i.code.venueName)],
  });
  facts.push({
    key: 'venue.address',
    group: 'day',
    label: 'Venue address',
    value: i.site.venueAddress,
    state: sameText(i.code.venueAddress, i.site.venueAddress) ? 'set' : 'differs',
    shownOn: [PAGES.frame, PAGES.story, PAGES.adventures, PAGES.venue, { label: 'Every “Get directions” link', href: '/our-venue' }],
    edit: site('venueAddress', 'text', i.site.venueAddress),
    copies: sameText(i.code.venueAddress, i.site.venueAddress) ? [] : [copy('Your Trip, the calendar file and ride directions (src/domain/travel/facts.ts)', i.code.venueAddress)],
  });
  facts.push({
    key: 'venue.url',
    group: 'day',
    label: 'Venue website',
    value: i.site.venueUrl,
    state: i.site.venueUrl ? 'set' : 'todo',
    shownOn: [PAGES.frame, PAGES.venue],
    edit: site('venueUrl', 'url', i.site.venueUrl ?? '', true),
    copies: [],
  });

  // ---- Replies
  facts.push({
    key: 'rsvp.deadline',
    group: 'replies',
    label: 'Reply by',
    value: i.rsvp.deadlineAt ? i.format.instant(i.rsvp.deadlineAt) : null,
    state: i.rsvp.deadlineAt ? 'set' : 'todo',
    shownOn: [PAGES.rsvp, PAGES.dashboard, PAGES.adminRsvp],
    edit: { kind: 'here', input: 'datetime', capability: 'admin_set_rsvp_window', base: { mode: i.rsvp.mode, note: i.rsvp.note }, field: 'deadlineAt', raw: i.rsvp.deadlineAt ?? '', optional: true },
    copies: [],
  });
  facts.push({
    key: 'rsvp.window',
    group: 'replies',
    label: 'Replies are',
    value: i.rsvp.mode === 'open' ? 'Open now' : i.rsvp.mode === 'closed' ? 'Closed now' : 'Open while the site is at RSVPs open, until the reply-by time',
    state: 'set',
    shownOn: [PAGES.rsvp, PAGES.dashboard],
    edit: { kind: 'screen', href: '/admin/events#window', label: 'Change on Schedule' },
    copies: [],
  });

  // ---- The schedule: one line per event, decided or not.
  for (const e of i.events) {
    const missing = [e.startsAt ? '' : 'time', e.room ? '' : 'room', e.dressCode ? '' : 'dress code'].filter(Boolean);
    const said = [e.startsAt ? `${i.format.day(e.dateIso)}, ${i.format.window(e.startsAt, e.endsAt)}` : i.format.day(e.dateIso), e.room, e.dressCode].filter(Boolean).join(' · ');
    facts.push({
      key: `event.${e.id}`,
      group: 'schedule',
      label: e.name,
      value: missing.length ? `${said}. Still to decide: ${missing.join(', ')}` : said,
      state: missing.length ? 'todo' : 'set',
      shownOn: [PAGES.dashboard, PAGES.rsvp, PAGES.trip, PAGES.calendar],
      edit: { kind: 'screen', href: '/admin/events#events', label: 'Change on Schedule' },
      copies: [],
    });
  }

  // ---- The room block
  const b = i.block;
  const blockEdit: DetailEdit = { kind: 'screen', href: '/admin/travel', label: 'Change on Travel & stay' };
  const nights = b?.checkIn && b.checkOut ? `${i.format.day(b.checkIn)} to ${i.format.day(b.checkOut)}` : null;
  const nightsDiffer = !!b?.checkIn && !!b.checkOut && (b.checkIn !== i.code.blockCheckIn || b.checkOut !== i.code.blockCheckOut);
  facts.push({
    key: 'block.nights',
    group: 'stay',
    label: 'Block nights',
    value: nights,
    state: !nights || b?.placeholder ? 'todo' : nightsDiffer ? 'differs' : 'set',
    shownOn: [PAGES.trip, PAGES.dashboard],
    edit: blockEdit,
    copies: nightsDiffer ? [copy('The stay search’s default dates and the “Nights of …” line (src/domain/travel/stay-copy.ts)', `${i.format.day(i.code.blockCheckIn)} to ${i.format.day(i.code.blockCheckOut)}`)] : [],
  });
  const rateDiffers = !!b?.rateText && !!i.code.blockRate && b.rateText !== i.code.blockRate;
  facts.push({
    key: 'block.rate',
    group: 'stay',
    label: 'Block rate',
    value: b?.rateText ?? null,
    state: !b?.rateText || b.placeholder ? 'todo' : rateDiffers ? 'differs' : 'set',
    shownOn: [PAGES.trip, PAGES.dashboard],
    edit: blockEdit,
    copies: rateDiffers ? [copy('The trip planner’s own room-block answer (src/domain/travel/facts.ts)', i.code.blockRate!)] : [],
  });
  const cutoffDiffers = !!b?.cutoff && !!i.code.blockCutoff && b.cutoff !== i.code.blockCutoff;
  facts.push({
    key: 'block.cutoff',
    group: 'stay',
    label: 'Book the block by',
    value: b?.cutoff ? i.format.day(b.cutoff) : null,
    state: !b?.cutoff || b.placeholder ? 'todo' : cutoffDiffers ? 'differs' : 'set',
    shownOn: [PAGES.trip, PAGES.dashboard],
    edit: blockEdit,
    copies: cutoffDiffers ? [copy('The trip planner’s own room-block answer (src/domain/travel/facts.ts)', i.format.day(i.code.blockCutoff!))] : [],
  });
  facts.push({ key: 'block.code', group: 'stay', label: 'Group code', value: b?.code ?? null, state: b?.code ? 'set' : 'todo', shownOn: [PAGES.trip], edit: blockEdit, copies: [] });

  // ---- Arriving: content records, changed here; the travel pages keep their own sentence.
  const field = (key: string, label: string, codeCopy: { where: string; value: string } | null, shownOn: ShownOn[]) => {
    const row = i.fields[key];
    // "$84/night" and "$84 per vehicle, per night" agree; "$90/night" and "$84 …" do not.
    const figure = row?.value?.match(/\$?\d+(?:\.\d+)?|\d+\s+\w+/)?.[0];
    const differs = !!row?.value && !!codeCopy && !(figure ? codeCopy.value.includes(figure) : sameText(codeCopy.value, row.value));
    facts.push({
      key,
      group: 'arrival',
      label,
      value: row?.value ?? null,
      state: !row?.value ? 'todo' : differs ? 'differs' : 'set',
      shownOn,
      edit: row ? { kind: 'here', input: 'text', capability: 'save_content_record', base: { table: 'operational_fields', id: row.id, merge: true, data: {} }, field: 'data.value', raw: row.value ?? '', optional: true } : { kind: 'screen', href: '/admin/content/operational_fields', label: 'Add on Content' },
      copies: differs && codeCopy ? [copy(codeCopy.where, codeCopy.value)] : [],
    });
  };
  field('valet.entrance', 'Valet entrance', { where: 'Your Trip and ride directions (src/domain/travel/facts.ts)', value: i.code.valetEntrance }, [PAGES.venue, PAGES.concierge]);
  field('valet.event-rate', 'Valet rate', { where: 'Your Trip and Your ride (src/domain/travel/facts.ts)', value: i.code.valetNote }, [PAGES.venue, PAGES.concierge]);

  return facts;
}

/** Set a value at a dotted path in a copy of `base` ("data.value"). */
export function withValue(base: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = structuredClone(base);
  const keys = path.split('.');
  let at = out;
  for (const key of keys.slice(0, -1)) {
    const next = at[key];
    at = at[key] = next && typeof next === 'object' ? (next as Record<string, unknown>) : {};
  }
  at[keys[keys.length - 1]!] = value;
  return out;
}
