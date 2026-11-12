'use client';

import { defineAction, defineComponent, useIsStreaming, useTriggerAction, type ActionPlan } from '@openuidev/react-lang';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod/v4';
import { aboutHowLong, blockDateLines, DIETS, knowBeforeYouGo, MEALS, safeSlot, savedDate, slotName, stopMinutes, TIME_TBA, weekendDate, type Day, type Diet, type Meal, type Part, type PlannerPlace } from '@/domain/trip-planner';
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

/** A place from the couple's list, by id: its picture, what it is, our note, and the button that puts it in the guest's plans. */
export const Place = defineComponent({
  name: 'Place',
  props: z.object({ id: z.string(), note: z.string().optional(), day: z.string().optional(), part: z.string().optional() }),
  description: "A place from the couple's list, by id, with a button that adds it to the guest's plans at day and part.",
  component: ({ props }) => <PlaceView id={props.id} note={props.note} day={props.day} part={props.part} />,
});

/**
 * A place as one row: a small picture, then its name (the link to its page), what it is, how long it
 * takes and where, our note, and what the guest can do with it. The button always says where the
 * place will go ("Add to Saturday morning"); once it is in the plans the row says so, with the two
 * things that can be done next. `inRoute` leaves out how long it takes, which the route says above.
 */
function PlaceView({ id, note, day: dayProp, part: partProp, inRoute = false }: { id: unknown; note?: unknown; day?: unknown; part?: unknown; inRoute?: boolean }) {
  const ctx = useTripPlanner();
  const streaming = useIsStreaming();
  const trigger = useTriggerAction();
  const place = typeof id === 'string' ? ctx?.places.get(id) : undefined;
  if (!ctx || !place) return null;
  const words = typeof note === 'string' && note.trim() ? note : null;
  const mine = ctx.saved.find((s) => s.id === place.id);
  const day = isDay(dayProp) ? dayProp : undefined;
  const part = isPart(partProp) ? partProp : undefined;
  // Where "Add" puts it: the time the guest is filling, else the answer's own time for it, else a free part of the weekend.
  const slot = safeSlot(day ?? 'sat', part ?? 'morning');
  const going = ctx.target ? slotName(ctx.target.date, ctx.target.part) : slotName(weekendDate(slot.day), slot.part);
  const add = () => void trigger(`Add ${place.name} to my plans`, undefined, custom(AddToWeekend.name, { id: place.id, day: slot.day, part: slot.part }));
  const remove = () => void trigger(`Take ${place.name} out of my plans`, undefined, custom(RemoveFromWeekend.name, { id: place.id }));
  const howLong = inRoute ? null : aboutHowLong(stopMinutes(place).minutes);
  // What to know before going, for the time this place is in the plans for, or would be added to.
  const when = mine ? { date: savedDate(mine), part: mine.part } : ctx.target ? ctx.target : { date: weekendDate(slot.day), part: slot.part };
  const know = knowBeforeYouGo(place, when, ctx.profile ?? undefined);
  const credit = place.image?.credit;
  return (
    <article className={`trip-place${inRoute ? ' trip-place--route' : ''}${mine ? ' is-saved' : ''}`}>
      <PlaceMedia place={place} />
      <div className="trip-place__head">
        <h4 className="trip-place__name">
          <a className="bd-link" href={place.href}>
            {place.name}
          </a>
        </h4>
        <p className="trip-place__what">{place.what}</p>
        {words ? <p className="trip-place__note">{words}</p> : null}
        {place.why ? <p className="trip-place__why">{place.why}</p> : null}
      </div>
      <div className="trip-place__foot">
        <ul className="trip-facts trip-place__facts">
          <Fact icon={AREA_ICON[place.category] ?? 'compass'}>{AREA[place.category] ?? place.category}</Fact>
          {howLong ? <Fact icon="clock">{howLong}</Fact> : null}
          {place.address ? <Fact icon="pin">{place.address}</Fact> : null}
        </ul>
        {know.items.length ? (
          <ul className="trip-summary trip-place__know" aria-label="Good to know">
            {know.items.map((k) => (
              <li key={k.key}>
                {k.say ? (
                  <>
                    <span aria-hidden="true">{k.text}</span>
                    <span className="sr-only">{k.say}</span>
                  </>
                ) : (
                  k.text
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {know.shut ? (
          <p className="trip-place__shut">
            <Icon name="clock" className="trip-icon trip-icon--sm" />
            {know.shut}
          </p>
        ) : null}
        <div className="trip-place__actions">
          {mine ? (
            <>
              <p className="trip-place__in">
                <Icon name="check" className="trip-icon trip-icon--sm" />
                {`In your plans: ${slotName(savedDate(mine), mine.part)}`}
              </p>
              <button type="button" className="trip-link" disabled={streaming} aria-label={`Change the time for ${place.name}`} onClick={() => ctx.onAction({ type: 'MovePlan', id: place.id })}>
                Change the time
              </button>
              <button type="button" className="trip-link" disabled={streaming} aria-label={`Remove ${place.name} from my plans`} onClick={remove}>
                Remove
              </button>
            </>
          ) : (
            <button type="button" className="trip-add" disabled={streaming} aria-label={`Add ${place.name} to ${going}`} onClick={add}>
              <Icon name="plus" className="trip-icon trip-icon--sm" />
              {`Add to ${going}`}
            </button>
          )}
        </div>
        {credit ? (
          <p className="trip-place__credit">
            <a href={credit.href} target="_blank" rel="noopener noreferrer">
              {credit.text}
              <External />
            </a>
            {', '}
            <a href={credit.license.href} target="_blank" rel="license noopener noreferrer">
              {credit.license.name}
              <External />
            </a>
          </p>
        ) : null}
      </div>
    </article>
  );
}

/** What kind of place it is, as a mark: beside its kind in the facts, and in place of a photograph we do not have. */
const AREA_ICON: Record<string, IconName> = {
  'stay-inside-caa': 'building',
  architecture: 'landmark',
  'food-drink': 'dinner',
  outdoors: 'sun',
  culture: 'book',
  'with-kids': 'balloon',
  'day-trip': 'car',
  neighborhood: 'compass',
};

/**
 * The row's picture, always the same size so every row starts at the same edge before anything has
 * loaded: a licensed photograph, faded in over a plain ground as it arrives, else the mark for the
 * kind of place. Never a blank box. A CC BY or BY-SA photograph's credit is the row's last line
 * (docs/ops/asset-licensing.md).
 */
function PlaceMedia({ place }: { place: PlannerPlace }) {
  const img = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  // A photo already in the browser's cache can finish before React listens for it.
  useEffect(() => {
    if (img.current?.complete && img.current.naturalWidth > 0) setLoaded(true);
  }, [place.image?.src]);
  if (place.image) {
    return (
      <div className={`trip-place__media${loaded ? ' is-loaded' : ''}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a place's own photo, already sized by the site's media pipeline */}
        <img ref={img} className="trip-place__photo" src={place.image.src} alt={place.image.alt} loading="lazy" decoding="async" onLoad={() => setLoaded(true)} />
      </div>
    );
  }
  return (
    <div className="trip-place__media trip-place__media--mark is-loaded" aria-hidden="true">
      <Icon name={AREA_ICON[place.category] ?? 'compass'} className="trip-place__mark" />
    </div>
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

/** The button that writes something of the guest's own into a part of a weekend day, or, once it is there, says so with the way out. */
function OwnAdd({ title, day, part }: { title: string; day: Day; part: Part }) {
  const ctx = useTripPlanner();
  const streaming = useIsStreaming();
  if (!ctx) return null;
  // The time the guest is filling wins, as it does for our own places.
  const date = ctx.target?.date ?? weekendDate(day);
  const at = ctx.target?.part ?? part;
  const when = slotName(date, at);
  const mine = ctx.saved.find((s) => s.own && s.name === title && savedDate(s) === date && s.part === at);
  return (
    <div className="trip-own">
      {mine ? (
        <>
          <p className="trip-place__in">
            <Icon name="check" className="trip-icon trip-icon--sm" />
            {`In your plans: ${when}`}
          </p>
          <button type="button" className="trip-link" disabled={streaming} aria-label={`Remove ${title} from ${when}`} onClick={() => ctx.onAction({ type: 'RemoveFromWeekend', id: mine.id })}>
            Remove
          </button>
        </>
      ) : (
        <button type="button" className="trip-add" disabled={streaming} aria-label={`Add ${title} to ${when}`} onClick={() => ctx.onAction({ type: 'AddOwn', title, day, part, ...(ctx.target ? { date: ctx.target.date, part: ctx.target.part } : {}) })}>
          <Icon name="plus" className="trip-icon trip-icon--sm" />
          {`Add to ${when}`}
        </button>
      )}
    </div>
  );
}

export const OwnPlan = defineComponent({
  name: 'OwnPlan',
  props: z.object({ title: z.string(), day: z.string(), part: z.string() }),
  description: "A plan in the guest's own words (title) and the part of a weekend day (day fri|sat|sun, part morning|afternoon|evening) it can be added to.",
  component: function OwnPlanView({ props }) {
    const title = typeof props.title === 'string' ? props.title.trim() : '';
    if (!title || !isDay(props.day) || !isPart(props.part)) return null;
    if (props.day === 'sat' && props.part !== 'morning') return null;
    return <OwnAdd title={title} day={props.day} part={props.part} />;
  },
});

/** One place from outside our own list: its name, one line about it, where it is, and (once chosen) the time it would go. */
export const NearbyPlace = defineComponent({
  name: 'NearbyPlace',
  props: z.object({ name: z.string(), detail: z.string().optional(), address: z.string().optional(), website: z.string().optional(), day: z.string().optional(), part: z.string().optional() }),
  description: 'A place near the hotel that is not one of the couple\'s own: name, one line (kind and distance), address, website, and the day and part it can be added to.',
  component: () => null,
});

type NearbyNode = { props?: { name?: unknown; detail?: unknown; address?: unknown; website?: unknown; day?: unknown; part?: unknown } };

/**
 * Places from a search of the neighbourhood, after our own and under their own heading, so nobody
 * takes them for ours. Each can go into the guest's plans as a plan of their own. The source is
 * credited as its licence asks.
 */
export const Nearby = defineComponent({
  name: 'Nearby',
  props: z.object({ title: z.string(), places: z.array(NearbyPlace.ref) }),
  description: 'Places near the hotel from outside the couple\'s own list, under their own heading.',
  component: function NearbyView({ props }) {
    const rows = (Array.isArray(props.places) ? props.places : []).flatMap((n) => {
      const q = (n as NearbyNode)?.props;
      const name = text(q?.name).trim();
      if (!name) return [];
      const website = text(q?.website);
      return [{ name, detail: text(q?.detail), address: text(q?.address), website: /^https?:\/\//i.test(website) ? website : '', day: isDay(q?.day) ? q.day : null, part: isPart(q?.part) ? q.part : null }];
    });
    if (!rows.length) return null;
    return (
      <section className="trip-nearby" aria-label={props.title}>
        <h4 className="trip-title trip-title--md">{props.title}</h4>
        <p className="trip-nearby__note">Not our own picks: these come from a map of the neighbourhood. Check the hours before you go.</p>
        <ul className="trip-nearby__list">
          {rows.map((r) => (
            <li key={`${r.name}-${r.address}`} className="trip-nearby__row">
              <div className="trip-nearby__what">
                <p className="trip-nearby__name">
                  {r.website ? (
                    <a className="bd-link" href={r.website} target="_blank" rel="noopener noreferrer">
                      {r.name}
                      <External />
                    </a>
                  ) : (
                    r.name
                  )}
                </p>
                {r.detail ? <p className="trip-nearby__detail">{r.detail}</p> : null}
                {r.address ? <p className="trip-nearby__detail">{r.address}</p> : null}
              </div>
              {r.day && r.part && !(r.day === 'sat' && r.part !== 'morning') ? <OwnAdd title={r.name} day={r.day} part={r.part} /> : null}
            </li>
          ))}
        </ul>
        <p className="trip-place__credit">
          {'Places from '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="license noopener noreferrer">
            OpenStreetMap contributors
            <External />
          </a>
        </p>
      </section>
    );
  },
});

export const ClarifyOption = defineComponent({
  name: 'ClarifyOption',
  props: z.object({ value: z.string(), label: z.string() }),
  description: 'One choice in a ClarifyGroup.',
  component: () => null,
});

export const ClarifyGroup = defineComponent({
  name: 'ClarifyGroup',
  props: z.object({ id: z.string(), label: z.string(), multi: z.boolean().optional(), options: z.array(ClarifyOption.ref) }),
  description: 'One thing a Clarify asks (id diet or meal), with its choices; multi lets several be chosen.',
  component: () => null,
});

type ClarifyNode = { props?: { id?: unknown; label?: unknown; multi?: unknown; options?: unknown; value?: unknown } };
const DIET_VALUES: readonly string[] = DIETS;
const MEAL_VALUES: readonly string[] = MEALS;

/**
 * What is asked before a meal is recommended: what the guest does not eat, and the kind of meal.
 * Both can be left blank. One button answers; it is asked once a visit.
 */
export const Clarify = defineComponent({
  name: 'Clarify',
  props: z.object({ request: z.string(), groups: z.array(ClarifyGroup.ref) }),
  description: 'Asks what the guest does not eat and the kind of meal before a request for a meal (request) is answered.',
  component: function ClarifyView({ props }) {
    const ctx = useTripPlanner();
    const [picked, setPicked] = useState<Record<string, string[]>>({});
    const [done, setDone] = useState(false);
    const groups = (Array.isArray(props.groups) ? props.groups : []).flatMap((g) => {
      const q = (g as ClarifyNode)?.props;
      const id = text(q?.id);
      const options = (Array.isArray(q?.options) ? q.options : []).flatMap((o) => {
        const r = (o as ClarifyNode)?.props;
        return text(r?.value) && text(r?.label) ? [{ value: text(r?.value), label: text(r?.label) }] : [];
      });
      return (id === 'diet' || id === 'meal') && text(q?.label) && options.length ? [{ id, label: text(q?.label), multi: q?.multi === true, options }] : [];
    });
    const request = typeof props.request === 'string' ? props.request.trim() : '';
    if (!ctx || !request || !groups.length) return null;
    const toggle = (id: string, value: string, multi: boolean) => {
      if (done) return;
      setPicked((was) => {
        const now = was[id] ?? [];
        const next = now.includes(value) ? now.filter((v) => v !== value) : multi ? [...now, value] : [value];
        return { ...was, [id]: next };
      });
    };
    const answer = (skip: boolean) => {
      if (done) return;
      setDone(true);
      if (skip) setPicked({});
      const diet = skip ? [] : (picked.diet ?? []).filter((v): v is Diet => DIET_VALUES.includes(v));
      const meal = skip ? null : ((picked.meal ?? []).find((v): v is Meal => MEAL_VALUES.includes(v)) ?? null);
      ctx.onAction({ type: 'AnswerClarify', request, diet, meal });
    };
    return (
      <form
        className="trip-clarify"
        onSubmit={(e) => {
          e.preventDefault();
          answer(false);
        }}
      >
        {groups.map((g) => (
          <fieldset key={g.id} className="trip-choice">
            <legend className="trip-clarify__ask">{g.label}</legend>
            <div className="trip-clarify__options">
              {g.options.map((o) => {
                const on = (picked[g.id] ?? []).includes(o.value);
                return (
                  <button key={o.value} type="button" className={`trip-chip trip-clarify__option${on ? ' is-picked' : ''}`} aria-pressed={on} aria-disabled={done ? true : undefined} onClick={() => toggle(g.id, o.value, g.multi)}>
                    {on ? <Icon name="check" className="trip-icon trip-icon--sm" /> : null}
                    {o.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
        <div className="trip-clarify__go">
          <button type="submit" className="trip-add" aria-disabled={done ? true : undefined}>
            Show me places
          </button>
          <button type="button" className="trip-link" aria-disabled={done ? true : undefined} onClick={() => answer(true)}>
            Skip this
          </button>
        </div>
      </form>
    );
  },
});

/** A few short facts as one line ("Saturday morning · About 2 hours · All on foot"). */
export const Summary = defineComponent({
  name: 'Summary',
  props: z.object({ facts: z.array(z.string()) }),
  description: 'A few short facts, read as one line.',
  component: ({ props }) => {
    const facts = (Array.isArray(props.facts) ? props.facts : []).filter((f): f is string => typeof f === 'string' && !!f.trim());
    if (!facts.length) return null;
    return (
      <ul className="trip-summary">
        {facts.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    );
  },
});

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

const KIND_ICON: Record<string, IconName> = { wedding: 'rings', plan: 'pin', trip: 'suitcase' };

/**
 * The guest's plans day by day, to read: the wedding's events, their travel and what they have added.
 * It is a summary, drawn as plain lines so nothing in it looks like something to press; changing a
 * plan happens in My plans, which the first button opens.
 */
export const Calendar = defineComponent({
  name: 'Calendar',
  props: z.object({ days: z.array(CalendarDay.ref) }),
  description: "The guest's plans by day with the wedding's events, a button to change them and a button to add them to their calendar.",
  component: function CalendarView({ props }) {
    const ctx = useTripPlanner();
    const streaming = useIsStreaming();
    const trigger = useTriggerAction();
    // The plans as they are now when the page gives them; else the ones the answer was written with.
    const days = ctx?.calendar
      ? ctx.calendar.map((d) => ({ label: d.label, date: d.date, events: d.entries.map((e) => ({ title: e.title, time: e.time, kind: e.source as string, note: e.note ?? '' })) }))
      : (Array.isArray(props.days) ? props.days : []).flatMap((d) => {
          const p = (d as Node)?.props;
          if (!p || !text(p.label)) return [];
          const events = (Array.isArray(p.events) ? p.events : []).flatMap((e) => {
            const q = (e as Node)?.props;
            return q && text(q.title) ? [{ title: text(q.title), time: text(q.time) || null, kind: text(q.kind) || 'plan', note: text(q.note) }] : [];
          });
          return [{ label: text(p.label), date: text(p.date), events }];
        });
    return (
      <section className="trip-cal" aria-label="Your plans">
        <ol className="trip-cal__days">
          {days.map((d) => (
            <li key={d.date || d.label} className="trip-cal__day">
              <h4 className="trip-cal__date">
                <time dateTime={d.date || undefined}>{d.label}</time>
              </h4>
              {d.events.length ? (
                <ul className="trip-cal__events">
                  {d.events.map((e, i) => (
                    <li key={`${e.title}-${i}`} className={`trip-cal__event trip-cal__event--${e.kind}`}>
                      <Icon name={KIND_ICON[e.kind] ?? 'pin'} className="trip-icon trip-icon--sm trip-icon--accent" />
                      <span className="trip-cal__time">{e.time ?? TIME_TBA}</span>
                      <span className="trip-cal__title">{e.title}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="trip-cal__none">Nothing planned</p>
              )}
            </li>
          ))}
        </ol>
        <div className="trip-cal__actions">
          <button type="button" className="bd-btn bd-btn--primary trip-button trip-button--icon" disabled={streaming} onClick={() => ctx?.onAction({ type: 'OpenPlans' })}>
            <Icon name="calendar" className="trip-icon" />
            <span>Change my plans</span>
          </button>
          <button type="button" className="bd-btn bd-btn--secondary trip-button trip-button--icon" disabled={streaming} onClick={() => void trigger('Add my plans to my calendar', undefined, custom(ExportCalendar.name))}>
            <Icon name="calendar-plus" className="trip-icon" />
            <span>Add to my calendar</span>
          </button>
        </div>
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

export const blocks = [Place, OwnPlan, Nearby, NearbyPlace, Clarify, ClarifyGroup, ClarifyOption, Summary, Route, Stop, Stay, Arrive, Option, Choice, Next, Schedule, WeddingEvent, Calendar, CalendarDay, CalendarEvent];
