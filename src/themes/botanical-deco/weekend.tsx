import Link from 'next/link';
import type { ReactNode } from 'react';
import type { MyItinerary, MyRsvp } from '@/capabilities/rsvp';
import { highlightIdFor } from '@/capabilities/seating/show_my_table_on_floorplan';
import { FloorPlan } from '@/components/floorplan/FloorPlan';
import { Placeholder } from '@/components/provenance/Placeholder';
import { Badge } from '@/components/rsvp/fields';
import { RsvpForm, type RsvpFormProps } from '@/components/rsvp/RsvpForm';
import { replyLabel, RsvpTaskList } from '@/components/rsvp/RsvpTaskList';
import { formatDeadline } from '@/domain/events/format';
import { GuestNotice } from './guest';
import { DateTile } from './kit/content';
import { Botanical, Photo } from './media';

/**
 * Your Weekend, as approved (REF-WEEKEND): a compact couple header, the utility tabs, and a warm
 * three-column workspace — the itinerary on the left, the reply in the middle (the dominant action),
 * and the stay / getting-around / table / photos modules on the right. On a phone it is one column
 * in priority order: an unanswered reply first, then the events, then the modules.
 *
 * Everything in it is the guest's own, from `get_my_itinerary` and `get_my_rsvp`, and nothing else:
 * the approved image's "Sarah & Tyler" household, its Wednesday–Friday labels, its May 20 deadline,
 * its "reserved room block", "Ride home on us" and "Table 7" were all generated. Here the household is
 * the signed-in guest's, the weekdays come from the dates, a missing deadline is said to be missing,
 * and each module keeps its slot with what is actually true today.
 *
 * The reply is the real RSVP form — the same server action, draft/review/confirm handshake and
 * idempotency key as /rsvp — not a decorative copy of it.
 */

export interface WeekendReply {
  data: MyRsvp;
  action: RsvpFormProps['action'];
  idempotencyKey: string;
}

const EVENT_PHOTOS = ['venue.exterior', 'venue.facade', 'venue.exterior-green'] as const;

function RsvpStatus({ rsvp }: { rsvp: MyItinerary['rsvp'] }) {
  // "for everyone" only when the counts cover more than one person (see WeekendPage for the history).
  if (rsvp.status === 'complete') return <Badge tone="yes">{rsvp.scope === 'household' ? 'Answered for everyone' : 'Answered'}</Badge>;
  if (rsvp.status === 'partial')
    return (
      <Badge tone="pending">
        {rsvp.answered} of {rsvp.expected} answered
      </Badge>
    );
  return <Badge tone="pending">Not answered yet</Badge>;
}

function Reply({ data, reply }: { data: MyItinerary; reply?: WeekendReply }) {
  const w = data.rsvp.window;
  return (
    <section id="reply" className="bd-reply" aria-labelledby="reply-title">
      <header className="bd-reply__head">
        <h2 id="reply-title" className="bd-reply__title">
          RSVP
        </h2>
        <p className="bd-reply__by">
          {w.deadlineAt ? (
            <>
              <span className="bd-kicker">Kindly reply by</span>
              <span className="bd-reply__date">{formatDeadline(w.deadlineAt)}</span>
            </>
          ) : w.open ? (
            <Placeholder inline>the date answers are needed by</Placeholder>
          ) : null}
        </p>
      </header>
      {/* The task list below says where each part stands; a count beside the name as well said it twice. */}
      <p className="bd-reply__status">
        <span className="bd-reply__household">{data.greeting.householdName}</span>
        {!reply && w.open && data.rsvp.canAnswer ? null : <> <RsvpStatus rsvp={data.rsvp} /></>}
      </p>
      {reply ? (
        <>
          <p className="bd-reply__intro">We would be honored to have you with us. Please tell us your plans for each event below.</p>
          {/* Not interactive (the form is right here), but it shows a first-time guest every part of
              the reply — including the ones that open later — before they start. */}
          <RsvpTaskList parts={data.rsvp.parts} interactive={false} idPrefix="reply-task" labelledBy="reply-title" />
          <RsvpForm data={reply.data} action={reply.action} idempotencyKey={reply.idempotencyKey} theme="botanical-deco" />
        </>
      ) : w.open && data.rsvp.canAnswer ? (
        <>
          {/* The profile's view of the reply: each part of it, what is done and what opens later.
              The event-by-event answers are in the itinerary beside it. */}
          <RsvpTaskList parts={data.rsvp.parts} interactive idPrefix="reply-task" labelledBy="reply-title" />
          <p>
            <Link className="bd-btn bd-btn--primary bd-reply__submit" href="/rsvp">
              {replyLabel(data.rsvp)}
            </Link>
          </p>
        </>
      ) : w.reason === 'lifecycle' ? (
        <p className="bd-reply__closed">RSVPs are not open yet — Sara and Tyler will send word when it is time to reply.</p>
      ) : (
        <p className="bd-reply__closed">
          RSVPs are closed. If something changed, reach Sara and Tyler. <Placeholder inline>their contact details</Placeholder>
        </p>
      )}
      <p className="bd-reply__thanks">We can’t wait to celebrate with you.</p>
    </section>
  );
}

function Itinerary({ data }: { data: MyItinerary }) {
  return (
    <section id="itinerary" className="bd-itin" aria-labelledby="page-title">
      <div className="bd-itin__head">
        <h1 id="page-title" className="bd-itin__title">
          Your weekend, {data.greeting.firstName}
        </h1>
        <p className="bd-itin__script" aria-hidden="true">
          So glad you’re here
        </p>
      </div>
      <p className="bd-itin__lede">Saturday, July 17, 2027 · Chicago Athletic Association Hotel, 12 S Michigan Ave, Chicago, IL 60603. Here is everything on your invitation.</p>
      <ol className="bd-itin__events" aria-label="Your events">
        {data.events.map((e, i) => (
          <li key={e.id} id={`event-${e.slug}`} className="bd-event">
            <details className="bd-event__details">
              <summary className="bd-event__summary">
                <DateTile iso={e.dateIso} />
                <Photo id={EVENT_PHOTOS[i % EVENT_PHOTOS.length]!} sizes="140px" className="bd-event__photo" alt="" />
                <span className="bd-event__main">
                  <span className="bd-event__name">{e.name}</span>
                  <span className="bd-event__when">{e.whenText}</span>
                  <span className="bd-event__where">{e.venueSpaceRef ? e.venueSpaceRef.replace(/-/g, ' ') : 'Chicago Athletic Association Hotel'}</span>
                </span>
                <span className="bd-event__chev" aria-hidden="true" />
              </summary>
              <div className="bd-event__more">
                <p>
                  <span className="bd-event__label">Date</span> {e.dateText}
                </p>
                <p>
                  <span className="bd-event__label">Room</span> {e.venueSpaceRef ? e.venueSpaceRef.replace(/-/g, ' ') : <Placeholder inline>the room</Placeholder>}
                </p>
                <p>
                  <span className="bd-event__label">Dress</span> {e.dressCode ?? <Placeholder inline>the dress code</Placeholder>}
                </p>
                {e.accessibilityNote ? <p>{e.accessibilityNote}</p> : null}
                <ul className="bd-event__household">
                  {e.household.map((h) => (
                    <li key={h.guestId}>
                      {h.displayName}
                      {h.isSelf ? ' (you)' : ''}:{' '}
                      {h.status === 'accepted' ? <Badge tone="yes">attending</Badge> : h.status === 'declined' ? <Badge tone="no">not attending</Badge> : <Badge tone="pending">no answer yet</Badge>}
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}

type Slot = MyItinerary['slots']['transport'];

function SlotBody({ slot }: { slot: Slot }) {
  if (slot.status === 'ready')
    return (
      <ul className="bd-module__items">
        {slot.items.map((i, idx) => (
          <li key={idx}>
            {i.href ? <a className="bd-link" href={i.href}>{i.label}</a> : i.label}
            {i.detail ? ` — ${i.detail}` : ''}
          </li>
        ))}
      </ul>
    );
  if (slot.status === 'placeholder') return <Placeholder>{slot.body}</Placeholder>;
  return <p className="bd-module__text">{slot.body}</p>;
}

function Modules({ data }: { data: MyItinerary }) {
  const table = data.seating.table;
  return (
    <aside className="bd-modules" aria-label="Stay, getting around, your table and photos">
      <article className="bd-module bd-module--wide">
        <Photo id="venue.exterior-green" sizes="(min-width: 1100px) 26vw, 100vw" className="bd-module__photo" alt="" />
        <div className="bd-module__body">
          <p className="bd-kicker">Travel + stay</p>
          <h2 className="bd-module__title">{data.slots.trip.title}</h2>
          <SlotBody slot={data.slots.trip} />
          <Link className="bd-more" href="/travel">
            <span>Where to stay</span>
          </Link>
        </div>
      </article>
      <article className="bd-module">
        <Photo id="city.river" sizes="(min-width: 1100px) 13vw, 50vw" className="bd-module__photo" alt="" />
        <div className="bd-module__body">
          <p className="bd-kicker">Getting around</p>
          <h2 className="bd-module__title">{data.slots.transport.title}</h2>
          <SlotBody slot={data.slots.transport} />
          <Link className="bd-more" href="/transportation">
            <span>Getting there</span>
          </Link>
        </div>
      </article>
      <article className="bd-module">
        <Photo id="city.lakefront-adler" sizes="(min-width: 1100px) 13vw, 50vw" className="bd-module__photo" alt="" />
        <div className="bd-module__body">
          <p className="bd-kicker">Explore Chicago</p>
          <h2 className="bd-module__title">Make a weekend of it</h2>
          <p className="bd-module__text">Our favorite spots, things to do, and places to eat nearby.</p>
          <Link className="bd-more" href="/share-an-adventure">
            <span>Our guide</span>
          </Link>
        </div>
      </article>
      <article className="bd-module" id="table">
        <div className="bd-module__body">
          <p className="bd-kicker">Seating</p>
          <h2 className="bd-module__title">Your table</h2>
          {table ? (
            <>
              <p className="bd-module__text">
                <strong className="bd-module__strong">
                  {table.table.name}
                  {table.table.seatNumber ? `, seat ${table.table.seatNumber}` : ''}
                </strong>
                {table.floorPlan ? ` in the ${table.floorPlan.name}` : ''}.
                {table.table.tablemates.length ? ` With ${table.table.tablemates.join(', ')}.` : ''}
              </p>
              {table.floorPlan ? (
                <FloorPlan
                  name={table.floorPlan.name}
                  viewBox={table.floorPlan.viewBox}
                  outline={table.floorPlan.outline}
                  anchors={table.floorPlan.anchors}
                  highlightAnchorId={table.table.anchorId}
                  highlightLabel={`${table.table.name}${table.table.seatNumber ? `, seat ${table.table.seatNumber}` : ''}`}
                  highlightDomId={highlightIdFor(table.table.anchorId, table.table.id)}
                  placeholder={table.floorPlan.placeholder}
                />
              ) : null}
            </>
          ) : (
            <p className="bd-module__text">{data.seating.message}</p>
          )}
        </div>
        <Botanical id="botanical.sprig-right" className="bd-bloom--module" />
      </article>
      <article className="bd-module">
        <div className="bd-module__body">
          <p className="bd-kicker">Photos + video</p>
          <h2 className="bd-module__title">Help us capture the weekend</h2>
          <p className="bd-module__text">The professional galleries and the pictures you take will all live in one place.</p>
          <Link className="bd-more" href="/photos">
            <span>Photos + video</span>
          </Link>
        </div>
      </article>
    </aside>
  );
}

/** Line icons for the utility tabs, drawn on one 20px grid in the tabs' own ink. Decoration: each tab is named by its text. */
const TAB_ICONS: Record<string, ReactNode> = {
  calendar: <path d="M3.5 5.5h13v11h-13zM3.5 8.5h13M7 3.5v3M13 3.5v3" />,
  envelope: <path d="M3 5.5h14v9H3zM3 5.5l7 5.5 7-5.5" />,
  suitcase: <path d="M3 7h14v9H3zM7.5 7V4.5h5V7M3 11h14" />,
  pin: <path d="M10 17.5s5.5-5.2 5.5-9.3a5.5 5.5 0 1 0-11 0c0 4.1 5.5 9.3 5.5 9.3zM10 10.2a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />,
  question: <path d="M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM7.8 7.8a2.3 2.3 0 1 1 3 2.2c-.6.2-.8.7-.8 1.3v.5M10 14.2v.3" />,
};

const TABS = [
  { href: '#itinerary', label: 'Your weekend', icon: 'calendar', current: true },
  { href: '#reply', label: 'RSVP', icon: 'envelope' },
  { href: '/travel', label: 'Travel + stay', icon: 'suitcase' },
  { href: '/share-an-adventure', label: 'Things to do', icon: 'pin' },
  { href: '/ask-us', label: 'FAQ', icon: 'question' },
];

export function BotanicalWeekendPage({ data, reply }: { data: MyItinerary; reply?: WeekendReply }) {
  const notices = [...data.notices].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'urgent' ? -1 : 1));
  const pending = data.rsvp.window.open && data.rsvp.canAnswer && data.rsvp.status === 'not_started';
  return (
    <div className="page bd-weekend" data-reply-pending={pending ? 'true' : undefined}>
      <section className="bd-wkhero" aria-label="Sara and Tyler">
        <div className="bd-wkhero__media">
          <Photo id="couple.hero.weekend" mobileId="couple.hero.weekend.mobile" sizes="(min-width: 768px) 60vw, 100vw" priority />
          <p className="bd-wkhero__script" aria-hidden="true">
            Same people. A bigger chapter.
          </p>
        </div>
        <p className="bd-wkhero__words" aria-hidden="true">
          <span>Good</span> <span>people</span> <span>beautiful</span> <span>places</span> <span>great</span> <span>love</span>
        </p>
        <Botanical id="botanical.corner-tl" className="bd-bloom--pagehero" priority />
        <div className="bd-wkhero__copy">
          <p className="bd-eyebrow">You’re invited to a weekend of</p>
          <p className="bd-wkhero__title">
            Celebration <br />
            in Chicago
          </p>
          <span className="bd-head__rule" aria-hidden="true" />
          <p className="bd-wkhero__sub">Great people. Beautiful places. Brighter together.</p>
        </div>
      </section>

      <nav className="bd-tabs" aria-label="Your weekend">
        <ul>
          {TABS.map((t) => (
            <li key={t.href}>
              <a href={t.href} aria-current={t.current ? 'location' : undefined}>
                <svg className="bd-tabs__icon" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
                  {TAB_ICONS[t.icon]}
                </svg>
                {t.label}
              </a>
            </li>
          ))}
        </ul>
        <p className="bd-tabs__words" aria-hidden="true">
          Chicago <span>+</span> People <span>+</span> Love <span>+</span> Brighter together
        </p>
      </nav>

      {notices.length ? (
        <div className="bd-weekend__notices">
          {notices.map((n) => (
            <GuestNotice key={n.id} tone={n.severity === 'urgent' ? 'urgent' : 'info'} title={n.title}>
              <p>{n.body}</p>
            </GuestNotice>
          ))}
        </div>
      ) : null}

      <div className="bd-workspace">
        <Botanical id="botanical.edge-left" className="bd-bloom--ws-left" />
        <Botanical id="botanical.vine-right" className="bd-bloom--ws-right" />
        <Itinerary data={data} />
        <Reply data={data} reply={reply} />
        <Modules data={data} />
        <span className="bd-workspace__skyline" aria-hidden="true" />
      </div>
    </div>
  );
}
