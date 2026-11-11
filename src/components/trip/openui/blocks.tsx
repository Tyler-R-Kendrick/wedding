'use client';

import { defineAction, defineComponent, useIsStreaming, useTriggerAction, type ActionPlan } from '@openuidev/react-lang';
import { useState } from 'react';
import { z } from 'zod/v4';
import { DAY_NAME, TIME_TBA, type Day, type Part } from '@/domain/trip-planner';
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

function HeartIcon({ on }: { on: boolean }) {
  return (
    <svg className="trip-heart__icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/** A place from the couple's list, by id: photo or a plain ground, what it is, our note, the heart and a link to its page. */
export const Place = defineComponent({
  name: 'Place',
  props: z.object({ id: z.string(), note: z.string().optional(), day: z.string().optional(), part: z.string().optional() }),
  description: "A place from the couple's list, by id, with a heart that saves it to the guest's weekend at day and part.",
  component: function PlaceCard({ props }) {
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
    return (
      <article className="trip-place">
        {place.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- a place's own photo, already sized by the site's media pipeline
          <img className="trip-place__photo" src={place.image.src} alt={place.image.alt} loading="lazy" decoding="async" />
        ) : (
          <div className="trip-place__ground" aria-hidden="true" />
        )}
        <div className="trip-place__body">
          <p className="bd-eyebrow">{AREA[place.category] ?? place.category}</p>
          <h4 className="trip-place__name">{place.name}</h4>
          <p className="trip-place__what">{place.what}</p>
          {props.note ? <p className="trip-place__note">{props.note}</p> : null}
          {place.why ? <p className="trip-place__why">{place.why}</p> : null}
          <div className="trip-place__actions">
            <button type="button" className={`trip-heart${saved ? ' is-on' : ''}`} aria-pressed={saved} disabled={streaming} onClick={toggle}>
              <HeartIcon on={saved} />
              <span>{saved ? 'In my weekend' : 'Add to my weekend'}</span>
            </button>
            <a className="bd-link trip-place__details" href={place.href}>
              Details<span className="sr-only">{`: ${place.name}`}</span>
            </a>
          </div>
          {when && !saved ? <p className="trip-caption">{`Saves to ${when}.`}</p> : null}
        </div>
      </article>
    );
  },
});

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

/** Our room block, with the facts from the travel domain and the booking button. */
export const Stay = defineComponent({
  name: 'Stay',
  props: z.object({ note: z.string().optional() }),
  description: "The couple's room block at the wedding hotel: rate, book-by date, nights, group code and the booking button.",
  component: function StayCard({ props }) {
    const ctx = useTripPlanner();
    if (!ctx) return null;
    const s = ctx.stay;
    const terms: [string, string | null][] = [
      ['Group rate', s.rate],
      ['Book by', s.bookBy],
      ['Nights', s.nights],
      ['Group code', s.code],
    ];
    return (
      <section className="trip-stay" aria-label="Our room block">
        <p className="bd-eyebrow">Our room block</p>
        <h4 className="trip-place__name">{s.hotelName}</h4>
        <p className="trip-text trip-text--md">{s.intro}</p>
        {props.note ? <p className="trip-place__note">{props.note}</p> : null}
        <dl className="trip-stay__terms">
          {terms
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k}>
                <dt className="bd-eyebrow">{k}</dt>
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
            <p className="bd-eyebrow">{i === 0 ? 'We recommend' : 'Also works'}</p>
            <h4 className="trip-title trip-title--md">{`${ap.name} (${ap.code})`}</h4>
            <p className="trip-text trip-text--md">{ap.note}</p>
          </section>
        ))}
        <section className="trip-card">
          <p className="bd-eyebrow">Driving</p>
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

type Node = { props?: Record<string, unknown> } | null;
const text = (v: unknown) => (typeof v === 'string' ? v : '');
const KIND_LABEL: Record<string, string> = { wedding: 'Wedding', plan: 'Your plan', trip: 'Your travel' };

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
                      <span className="trip-cal__time">{e.time ?? TIME_TBA}</span>
                      <span className="trip-cal__what">
                        <span className="trip-cal__kind">{KIND_LABEL[e.kind] ?? KIND_LABEL.plan}</span>
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
        <button type="button" className="bd-btn bd-btn--primary trip-button" disabled={streaming} onClick={() => void trigger('Add my weekend to my calendar', undefined, custom(ExportCalendar.name))}>
          <span>Add to my calendar</span>
        </button>
      </section>
    );
  },
});

export const blocks = [Place, Stay, Arrive, Option, Choice, Next, Calendar, CalendarDay, CalendarEvent];
