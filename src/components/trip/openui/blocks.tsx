'use client';

import { defineAction, defineComponent, useIsStreaming, useTriggerAction, type ActionPlan } from '@openuidev/react-lang';
import { useState } from 'react';
import { z } from 'zod/v4';
import { aboutHowLong, blockDateLines, DAY_NAME, TIME_TBA, type Day, type Part } from '@/domain/trip-planner';
import { Icon, type IconName } from '@/themes/shared/icons';
import { useTripPlanner } from './context';

/**
 * The wedding's own blocks: a place from the couple's list with the heart that saves it, the room
 * block, getting here, one question with tappable answers, follow-up requests, and the weekend as a
 * calendar. Facts come from the provider (the page's data); a block never retypes them.
 */

export const AddToWeekend = defineAction({
  name: 'AddToWeekend',
  description: 'Save one place from the couple\'s list to the guest\'s weekend. day is "fri", "sat" or "sun"; part is "morning", "afternoon" or "evening".',
  params: z.object({ id: z.string(), day: z.string().optional(), part: z.string().optional() }),
});
export const RemoveFromWeekend = defineAction({
  name: 'RemoveFromWeekend',
  description: 'Take one place out of the guest\'s weekend.',
  params: z.object({ id: z.string() }),
});
export const SetWeekend = defineAction({
  name: 'SetWeekend',
  description: 'Replace the guest\'s weekend with an arranged plan: a list of {id, day, part}.',
  params: z.object({ items: z.array(z.object({ id: z.string(), day: z.string(), part: z.string() })) }),
});
export const ConfirmWeekend = defineAction({
  name: 'ConfirmWeekend',
  description: 'The guest says their weekend is set; the page shows it as a calendar.',
  params: z.object({}),
});
export const ExportCalendar = defineAction({
  name: 'ExportCalendar',
  description: 'Save the guest\'s weekend, with the wedding events, as a calendar file.',
  params: z.object({}),
});

export const tripActions = [AddToWeekend, RemoveFromWeekend, SetWeekend, ConfirmWeekend, ExportCalendar];

const custom = (name: string, params: Record<string, unknown> = {}): ActionPlan => ({ steps: [{ type: 'custom_action', name, params }] });

const AREA: Record<string, string> = {
  'stay-inside-caa': 'In the hotel',
  architecture: 'Architecture',
  'food-drink': 'Food and drink',
  outdoors: 'Outdoors',
  culture: 'Culture',
  'with-kids': 'With kids',
  'day-trip': 'Day trip',
  neighborhood: 'Neighborhood',
};
const isDay = (v: unknown): v is Day => v === 'fri' || v === 'sat' || v === 'sun';
const isPart = (v: unknown): v is Part => v === 'morning' || v === 'afternoon' || v === 'evening';

/** A fact with the small mark that says what kind of fact it is. */
function Fact({ icon, children }: { icon: IconName; children: string }) {
  return (
    <li className="trip-fact">
      <Icon name={icon} className="trip-icon trip-fact__icon" />
      <span>{children}</span>
    </li>
  );
}

/** A place from the couple's list, by id: photo or a plain ground, what it is, our note, the heart and a link to its page. */
export const Place = defineComponent({
  name: 'Place',
  props: z.object({ id: z.string(), note: z.string().optional(), day: z.string().optional(), part: z.string().optional() }),
  description: "A place from the couple's list, by id, with a heart that saves it to the guest's weekend at day and part.",
  component: ({ props }) => <PlaceView id={props.id} note={props.note} day={props.day} part={props.part} />,
});

/**
 * A place's card. `inRoute` leaves out how long it takes, which the route says above the card, and
 * lets the route lay the card out beside its photo where there is room.
 */
function PlaceView({ id, note, day: dayProp, part: partProp, inRoute = false }: { id: unknown; note?: unknown; day?: unknown; part?: unknown; inRoute?: boolean }) {
  const props = { id, note: typeof note === 'string' && note.trim() ? note : undefined, day: dayProp, part: partProp };
  const ctx = useTripPlanner();
  const streaming = useIsStreaming();
  const trigger = useTriggerAction();
  const place = typeof props.id === 'string' ? ctx?.places.get(props.id) : undefined;
  if (!ctx || !place) return null;
  const saved = ctx.saved.some((s) => s.id === place.id);
  const day = isDay(props.day) ? props.day : undefined;
  const part = isPart(props.part) ? props.part : undefined;
  const toggle = () => {
    if (saved) void trigger(`Take ${place.name} out of my weekend`, undefined, custom(RemoveFromWeekend.name, { id: place.id }));
    else void trigger(`Add ${place.name} to my weekend`, undefined, custom(AddToWeekend.name, { id: place.id, ...(day ? { day } : {}), ...(part ? { part } : {}) }));
  };
  const when = day && part ? `${DAY_NAME[day]} ${part}` : null;
  const label = saved ? `Remove ${place.name} from my weekend` : `Add ${place.name} to my weekend`;
  const howLong = inRoute ? null : aboutHowLong(place.minutes);
  return (
    // Seven rows, always all seven (an empty one where a card has nothing to say), so a row of
    // cards can share them through a subgrid and every card's name, text, facts and links line up.
    <article className={`trip-place${inRoute ? ' trip-place--route' : ''}`}>
      {place.image ? (
        // A CC BY or BY-SA photograph carries its credit wherever it is shown (docs/ops/asset-licensing.md);
        // the full record, licence link included, is on /credits.
        // eslint-disable-next-line @next/next/no-img-element -- a place's own photo, already sized by the site's media pipeline
        <img className="trip-place__photo" src={place.image.src} alt={place.image.alt} loading="lazy" decoding="async" />
      ) : (
        <div className="trip-place__ground" aria-hidden="true" />
      )}
      <p className="trip-place__credit">
        {place.image?.credit ? (
          <>
            <a className="bd-link" href={place.image.credit.href} target="_blank" rel="noopener noreferrer">
              {place.image.credit.text}
              <External />
            </a>
            {', '}
            <a className="bd-link" href={place.image.credit.license.href} target="_blank" rel="license noopener noreferrer">
              {place.image.credit.license.name}
              <External />
            </a>
          </>
        ) : null}
      </p>
      <div className="trip-place__head">
        <p className="bd-eyebrow">{AREA[place.category] ?? place.category}</p>
        <h4 className="trip-place__name">{place.name}</h4>
        <button type="button" className={`trip-round trip-heart${saved ? ' is-on' : ''}`} aria-pressed={saved} aria-label={label} title={label} disabled={streaming} onClick={toggle}>
          <Icon name="heart" filled={saved} className="trip-icon" />
        </button>
      </div>
      <p className="trip-place__what">{place.what}</p>
      <ul className="trip-facts trip-place__facts">
        {howLong ? <Fact icon="clock">{howLong}</Fact> : null}
        {place.address ? <Fact icon="pin">{place.address}</Fact> : null}
      </ul>
      <div className="trip-place__extra">
        {props.note ? <p className="trip-place__note">{props.note}</p> : null}
        {place.why ? <p className="trip-place__why">{place.why}</p> : null}
      </div>
      <div className="trip-place__actions">
        {saved ? (
          <p className="trip-caption trip-place__when is-saved">
            <Icon name="heart" filled className="trip-icon" />
            In my weekend
          </p>
        ) : when ? (
          <p className="trip-caption trip-place__when">
            <Icon name="calendar" className="trip-icon trip-icon--accent" />
            <span className="sr-only">Saves to </span>
            {when[0]!.toUpperCase() + when.slice(1)}
          </p>
        ) : null}
        <a className="bd-link trip-place__details" href={place.href}>
          Details<span className="sr-only">{`: ${place.name}`}</span>
          <Icon name="chevron" className="trip-icon trip-icon--sm" />
        </a>
      </div>
    </article>
  );
}

function External() {
  return (
    <>
      <svg className="bd-external" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M14 4h6v6M20 4l-9 9M18 13v7H4V6h7" />
      </svg>
      <span className="sr-only">, opens in a new tab</span>
    </>
  );
}

/** Our room block, with the facts from the travel domain and the booking button. `dates` adds the block's check-in and check-out days. */
export const Stay = defineComponent({
  name: 'Stay',
  props: z.object({ note: z.string().optional(), dates: z.boolean().optional() }),
  description: "The couple's room block at the wedding hotel: address, rate, book-by date, nights, group code and the booking button; dates shows the block's check-in and check-out days.",
  component: function StayCard({ props }) {
    const ctx = useTripPlanner();
    if (!ctx) return null;
    const s = ctx.stay;
    const lines = props.dates ? blockDateLines(s) : { checkIn: null, checkOut: null };
    const terms: [string, string | null, IconName][] = [
      ['Group rate', s.rate, 'tag'],
      ['Book by', s.bookBy, 'calendar'],
      ['Nights', s.nights, 'moon'],
      ['Group code', s.code, 'key'],
    ];
    return (
      <section className="trip-stay" aria-label="Our room block">
        <p className="bd-eyebrow trip-eyebrow">
          <Icon name="bed" className="trip-icon trip-icon--caps trip-icon--accent" />
          Our room block
        </p>
        <h4 className="trip-place__name">{s.hotelName}</h4>
        <ul className="trip-facts">
          {s.address ? <Fact icon="pin">{s.address}</Fact> : null}
          {lines.checkIn ? <Fact icon="calendar">{lines.checkIn}</Fact> : null}
          {lines.checkOut ? <Fact icon="calendar">{lines.checkOut}</Fact> : null}
        </ul>
        <p className="trip-text trip-text--md">{s.intro}</p>
        {props.note ? <p className="trip-place__note">{props.note}</p> : null}
        <dl className="trip-stay__terms">
          {terms
            .filter(([, v]) => v)
            .map(([k, v, icon]) => (
              <div key={k}>
                <dt className="bd-eyebrow trip-eyebrow">
                  <Icon name={icon} className="trip-icon trip-icon--caps trip-icon--accent" />
                  {k}
                </dt>
                <dd>{v}</dd>
              </div>
            ))}
        </dl>
        {s.bookUrl ? (
          <a className="bd-btn bd-btn--primary trip-button" href={s.bookUrl} target="_blank" rel="noopener noreferrer">
            <span>Book your room</span>
            <External />
          </a>
        ) : null}
        <p className="trip-text trip-text--sm">
          Prefer the phone? <a className="bd-link" href={s.phoneHref}>{s.phoneSentence}</a>
        </p>
      </section>
    );
  },
});

/** Getting here: the airports and the parking, in the travel domain's words. */
export const Arrive = defineComponent({
  name: 'Arrive',
  props: z.object({}),
  description: 'How to get to the hotel: the airports and parking.',
  component: function ArriveCard() {
    const ctx = useTripPlanner();
    if (!ctx) return null;
    const a = ctx.arrival;
    return (
      <div className="trip-arrive">
        {a.airports.map((ap, i) => (
          <section key={ap.code} className="trip-card">
            <p className="bd-eyebrow trip-eyebrow">
              <Icon name="plane" className="trip-icon trip-icon--caps trip-icon--accent" />
              {i === 0 ? 'We recommend' : 'Also works'}
            </p>
            <h4 className="trip-title trip-title--md">{`${ap.name} (${ap.code})`}</h4>
            <p className="trip-text trip-text--md">{ap.note}</p>
          </section>
        ))}
        <section className="trip-card">
          <p className="bd-eyebrow trip-eyebrow">
            <Icon name="parking" className="trip-icon trip-icon--caps trip-icon--accent" />
            Driving
          </p>
          <h4 className="trip-title trip-title--md">Parking at the hotel</h4>
          <p className="trip-text trip-text--md">{a.parking}</p>
        </section>
      </div>
    );
  },
});

export const Option = defineComponent({
  name: 'Option',
  props: z.object({ label: z.string(), note: z.string().optional() }),
  description: 'One answer to a Choice.',
  component: () => null,
});

type OptionNode = { props?: { label?: unknown; note?: unknown } } | null;

/** One question the planner needs answered; tapping an answer sends it as the guest's next request. */
export const Choice = defineComponent({
  name: 'Choice',
  props: z.object({ question: z.string(), options: z.array(Option.ref) }),
  description: 'Ask the guest ONE question, with two to four Options.',
  component: function ChoiceCard({ props }) {
    const streaming = useIsStreaming();
    const trigger = useTriggerAction();
    const [picked, setPicked] = useState<string | null>(null);
    const options = (Array.isArray(props.options) ? props.options : []).flatMap((o) => {
      const p = (o as OptionNode)?.props;
      return typeof p?.label === 'string' && p.label.trim() ? [{ label: p.label, note: typeof p.note === 'string' ? p.note : '' }] : [];
    });
    if (!options.length) return null;
    return (
      <fieldset className="trip-choice">
        <legend className="trip-title trip-title--md">{props.question}</legend>
        <div className="trip-choice__options">
          {options.map((o) => (
            <button
              key={o.label}
              type="button"
              className={`trip-option${picked === o.label ? ' is-picked' : ''}`}
              aria-pressed={picked === o.label}
              // Not `disabled`: that would drop the guest's focus to the page. Further taps are ignored.
              aria-disabled={streaming || picked !== null ? true : undefined}
              onClick={() => {
                if (streaming || picked !== null) return;
                setPicked(o.label);
                void trigger(o.label, undefined, { steps: [{ type: 'continue_conversation', message: o.label, context: { answering: props.question } }] });
              }}
            >
              <span className="trip-option__label">{o.label}</span>
              {o.note ? <span className="trip-option__note">{o.note}</span> : null}
            </button>
          ))}
        </div>
      </fieldset>
    );
  },
});

/** Follow-up requests in the guest's own voice; the last block of an answer. */
export const Next = defineComponent({
  name: 'Next',
  props: z.object({ suggestions: z.array(z.string()) }),
  description: 'Two or three short follow-up requests in the guest\'s own voice.',
  component: function NextChips({ props }) {
    const streaming = useIsStreaming();
    const trigger = useTriggerAction();
    const items = (Array.isArray(props.suggestions) ? props.suggestions : []).filter((s): s is string => typeof s === 'string' && !!s.trim()).slice(0, 4);
    if (!items.length) return null;
    return (
      <div className="trip-next" role="group" aria-label="Ask next">
        {items.map((s) => (
          <button key={s} type="button" className="trip-chip" disabled={streaming} onClick={() => void trigger(s, undefined, { steps: [{ type: 'continue_conversation', message: s }] })}>
            {s}
          </button>
        ))}
      </div>
    );
  },
});

type Node = { props?: Record<string, unknown> } | null;
const text = (v: unknown) => (typeof v === 'string' ? v : '');

export const WeddingEvent = defineComponent({
  name: 'WeddingEvent',
  props: z.object({
    name: z.string(),
    day: z.string(),
    time: z.string().optional(),
    room: z.string().optional(),
    dress: z.string().optional(),
    access: z.string().optional(),
    about: z.string().optional(),
    note: z.string().optional(),
  }),
  description: "One of the wedding's own events. time is null while it is not announced; room, dress, access and about only when the couple have set them.",
  component: () => null,
});

/** The wedding's events in order: each with its time or "Time to be announced", and what the couple have set about it. */
export const Schedule = defineComponent({
  name: 'Schedule',
  props: z.object({ events: z.array(WeddingEvent.ref) }),
  description: "The wedding's own events, in order.",
  component: function ScheduleList({ props }) {
    const events = (Array.isArray(props.events) ? props.events : []).flatMap((e) => {
      const q = (e as Node)?.props;
      if (!q || !text(q.name)) return [];
      return [{ name: text(q.name), day: text(q.day), time: text(q.time), room: text(q.room), dress: text(q.dress), access: text(q.access), about: text(q.about), note: text(q.note) }];
    });
    if (!events.length) return null;
    const days = [...new Set(events.map((e) => e.day))];
    return (
      <section className="trip-sched" aria-label="The wedding day">
        {days.map((day) => (
          <div key={day} className="trip-sched__day">
            {days.length > 1 ? <h4 className="trip-title trip-title--md">{day}</h4> : null}
            <ol className="trip-sched__events">
              {events
                .filter((e) => e.day === day)
                .map((e, i) => (
                  <li key={`${e.name}-${i}`} className="trip-sched__event">
                    <span className="trip-sched__time">
                      <Icon name="clock" className="trip-icon trip-icon--caps" />
                      {e.time || TIME_TBA}
                    </span>
                    <span className="trip-sched__what">
                      <span className="trip-sched__name">{e.name}</span>
                      {e.room || e.dress || e.access || e.note ? (
                        <ul className="trip-facts">
                          {e.room ? <Fact icon="pin">{e.room}</Fact> : null}
                          {e.dress ? <Fact icon="hanger">{`Dress code: ${e.dress}`}</Fact> : null}
                          {e.access ? <Fact icon="check">{e.access}</Fact> : null}
                          {e.note ? <Fact icon="calendar">{e.note}</Fact> : null}
                        </ul>
                      ) : null}
                      {e.about ? <span className="trip-text trip-text--sm">{e.about}</span> : null}
                    </span>
                  </li>
                ))}
            </ol>
          </div>
        ))}
      </section>
    );
  },
});

export const CalendarEvent = defineComponent({
  name: 'CalendarEvent',
  props: z.object({ title: z.string(), time: z.string().optional(), kind: z.enum(['wedding', 'plan', 'trip']).optional(), note: z.string().optional() }),
  description: 'One entry on a CalendarDay. time is null when it is not announced yet.',
  component: () => null,
});

export const CalendarDay = defineComponent({
  name: 'CalendarDay',
  props: z.object({ label: z.string(), date: z.string(), events: z.array(CalendarEvent.ref) }),
  description: 'One day of the Calendar.',
  component: () => null,
});

const KIND_LABEL: Record<string, string> = { wedding: 'Wedding', plan: 'Your plan', trip: 'Your travel' };
const KIND_ICON: Record<string, IconName> = { wedding: 'rings', plan: 'heart', trip: 'suitcase' };

/** The weekend day by day, the wedding's own events set apart, and the button that saves it all as a calendar file. */
export const Calendar = defineComponent({
  name: 'Calendar',
  props: z.object({ days: z.array(CalendarDay.ref) }),
  description: "The guest's weekend by day with the wedding's events, and a button to add it to their calendar.",
  component: function CalendarView({ props }) {
    const streaming = useIsStreaming();
    const trigger = useTriggerAction();
    const days = (Array.isArray(props.days) ? props.days : []).flatMap((d) => {
      const p = (d as Node)?.props;
      if (!p || !text(p.label)) return [];
      const events = (Array.isArray(p.events) ? p.events : []).flatMap((e) => {
        const q = (e as Node)?.props;
        return q && text(q.title) ? [{ title: text(q.title), time: text(q.time) || null, kind: text(q.kind) || 'plan', note: text(q.note) }] : [];
      });
      return [{ label: text(p.label), date: text(p.date), events }];
    });
    return (
      <section className="trip-cal" aria-label="Your weekend">
        <ol className="trip-cal__days">
          {days.map((d) => (
            <li key={d.date || d.label} className="trip-cal__day">
              <h4 className="trip-title trip-title--md">
                <time dateTime={d.date || undefined}>{d.label}</time>
              </h4>
              {d.events.length ? (
                <ul className="trip-cal__events">
                  {d.events.map((e, i) => (
                    <li key={`${e.title}-${i}`} className={`trip-cal__event trip-cal__event--${e.kind}`}>
                      <span className="trip-cal__time">
                        {e.time ? <Icon name="clock" className="trip-icon trip-icon--caps" /> : null}
                        {e.time ?? TIME_TBA}
                      </span>
                      <span className="trip-cal__what">
                        <span className="trip-cal__kind">
                          <Icon name={KIND_ICON[e.kind] ?? 'heart'} className="trip-icon trip-icon--caps trip-icon--accent" />
                          {KIND_LABEL[e.kind] ?? KIND_LABEL.plan}
                        </span>
                        <span className="trip-cal__title">{e.title}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="trip-text trip-text--sm trip-text--muted">Nothing planned yet.</p>
              )}
            </li>
          ))}
        </ol>
        <button type="button" className="bd-btn bd-btn--primary trip-button trip-button--icon" disabled={streaming} onClick={() => void trigger('Add my weekend to my calendar', undefined, custom(ExportCalendar.name))}>
          <Icon name="calendar-plus" className="trip-icon" />
          <span>Add to my calendar</span>
        </button>
      </section>
    );
  },
});

/** One stop of a Route: its number, the place, its time and how long it takes, and the way to it from the stop before. */
export const Stop = defineComponent({
  name: 'Stop',
  props: z.object({
    n: z.number(),
    id: z.string(),
    when: z.string().optional(),
    long: z.string().optional(),
    way: z.string().optional(),
    mode: z.string().optional(),
    note: z.string().optional(),
    day: z.string().optional(),
    part: z.string().optional(),
  }),
  description: 'A numbered stop: a place by id, its time (when) and length (long), and the way to it from the stop before (way, by mode walk, ride, drive or same).',
  component: () => null,
});

const WAY_ICON: Record<string, IconName> = { walk: 'walk', ride: 'car', drive: 'car', same: 'pin' };

function Way({ mode, as: Tag = 'li', children }: { mode: string; as?: 'li' | 'div'; children: string }) {
  return (
    <Tag className="trip-route__way">
      <span className="trip-route__rail" aria-hidden="true">
        <Icon name={WAY_ICON[mode] ?? 'route'} className="trip-icon trip-icon--sm" />
      </span>
      <p className="trip-route__way-text">{children}</p>
    </Tag>
  );
}

/**
 * A day's stops in order, the way a good day plan reads: from the hotel, then each stop with its
 * number, time and length, the way to the next one and how long that takes, and back.
 */
export const Route = defineComponent({
  name: 'Route',
  props: z.object({ stops: z.array(Stop.ref), from: z.string().optional(), back: z.string().optional(), fromMode: z.string().optional(), backMode: z.string().optional() }),
  description: "A day's stops in order, from the hotel (from, by fromMode) and back to it (back, by backMode), with the way between each.",
  component: function RouteList({ props }) {
    const ctx = useTripPlanner();
    const stops = (Array.isArray(props.stops) ? props.stops : []).flatMap((node) => {
      const q = (node as Node)?.props;
      const id = text(q?.id);
      return q && id && ctx?.places.has(id) ? [{ n: typeof q.n === 'number' ? q.n : 0, id, when: text(q.when), long: text(q.long), way: text(q.way), mode: text(q.mode), note: text(q.note), day: text(q.day), part: text(q.part) }] : [];
    });
    if (!stops.length) return null;
    return (
      <ol className="trip-route" aria-label="The stops, in order">
        {text(props.from) ? <Way mode={text(props.fromMode) || 'walk'}>{text(props.from)}</Way> : null}
        {stops.map((s) => (
          <li key={`${s.id}-${s.n}`} className="trip-route__item">
            {s.way ? <Way mode={s.mode} as="div">{s.way}</Way> : null}
            <div className="trip-route__stop">
              <span className="trip-route__n" aria-hidden="true">{s.n}</span>
              <div className="trip-route__body">
                <p className="trip-route__when">
                  <span className="sr-only">{`Stop ${s.n}: `}</span>
                  {s.when ? <span className="trip-route__time">{s.when}</span> : null}
                  {s.long ? <span className="trip-route__long">
                    <Icon name="clock" className="trip-icon trip-icon--sm trip-icon--accent" />
                    {s.long}
                  </span> : null}
                </p>
                <PlaceView id={s.id} note={s.note} day={s.day} part={s.part} inRoute />
              </div>
            </div>
          </li>
        ))}
        {text(props.back) ? <Way mode={text(props.backMode) || 'walk'}>{text(props.back)}</Way> : null}
      </ol>
    );
  },
});

export const blocks = [Place, Route, Stop, Stay, Arrive, Option, Choice, Next, Schedule, WeddingEvent, Calendar, CalendarDay, CalendarEvent];
