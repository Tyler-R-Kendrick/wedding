import Link from 'next/link';
import type { ReactNode } from 'react';
import type { MyItinerary } from '@/capabilities/rsvp';
import { Placeholder } from '@/components/provenance/Placeholder';
import { Badge } from '@/components/rsvp/fields';
import { replyLabel, RsvpTaskList } from '@/components/rsvp/RsvpTaskList';
import { TableCard } from '@/components/weekend/TableCard';
import type { LifecycleState } from '@/contracts/lifecycle';
import { formatDeadline } from '@/domain/events/format';
import { GUEST_PATHS, type DashboardPlan, type ExploreCard, type TaskCard } from '@/domain/lifecycle/guest-actions';
import { blockNights, CAA_BOOKING_PHONE, CAA_BOOKING_PHONE_REFERENCE, CAA_BOOKING_TEL } from '@/domain/travel/stay-copy';
import type { RoomBlock } from '@/db/schema/travel';

/**
 * The guest dashboard (`/guests`): what to do now, then what is next, then the reading.
 *
 * It replaces "Your Weekend" and the portal landing, which were the same page twice: a photograph
 * of the couple across the top, a row of tabs repeating the navigation above them, an RSVP box that
 * said replies were not open, three events with no times, and five modules each pointing at another
 * page. A guest holding a save-the-date had to read all of it to find the one thing they could do.
 *
 * Here the order IS the message. `plan` (domain/lifecycle/guest-actions.ts) puts the state's action
 * first — the room block when the save-the-dates go out, the RSVP once replies open — and that card
 * is the only large thing on the page, with the facts needed to act on it and one button. Under it,
 * the other things worth doing, each a card with its own next step. Nothing a guest cannot use yet
 * is here at all: no table before seating is published, no photos before the day.
 *
 * Every fact is the guest's own or the site's record: the block's rate and book-by date from the
 * room-block record, the events and the reply from `get_my_itinerary`. Anything not settled is
 * either left out or marked as still being written, never filled in.
 */
export interface DashboardData {
  firstName: string | null;
  state: LifecycleState;
  plan: DashboardPlan;
  /** "Saturday, July 17, 2027" and the venue, for the line under the greeting. */
  when: string;
  where: { name: string; city: string };
  /** Whole days until the wedding; null on the day and after. */
  daysToGo: number | null;
  itinerary: MyItinerary | null;
  hotel: { name: string; block: RoomBlock | null };
  /** The block has a booking link and its book-by date has not passed. */
  blockOpen: boolean;
}

/**
 * One sentence under the greeting, in the couple's voice — only when no card leads. With a lead, the
 * card says what to do and this line would say it a second time, on the first phone screen, above it.
 */
function statusLine(data: DashboardData): string {
  switch (data.state) {
    case 'TEASER':
    case 'SAVE_THE_DATE':
      return 'Please save the date. More will appear here as we settle it.';
    case 'INVITATIONS_OPEN':
      return 'Your invitation is here. RSVPs open soon.';
    case 'RSVP_OPEN':
      return 'Thank you! Here is everything for the weekend.';
    case 'RSVP_CLOSED':
      return 'RSVPs are in and we cannot wait. Here is everything for the weekend.';
    case 'WEDDING_WEEK':
      return 'It is wedding week. Here is where to be and how to get there.';
    case 'WEDDING_DAY':
      return 'Today is the day. Here is what is happening and where.';
    case 'POST_WEDDING':
      return 'Thank you for travelling, for dancing, for being there.';
    case 'ARCHIVE':
      return 'The weekend, kept for the people who shared it.';
  }
}

/** "June 15, 2027": a deadline short enough to sit on one line above a title on a phone. */
const shortDate = (iso: string): string => new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="dash-facts__item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** What a card says. The lead card and the grid cards share it; only the scale differs. */
interface CardContent {
  kicker: string;
  title: string;
  body: ReactNode;
  /** Facts worth a glance before acting (a rate, a date). Lead card and wide cards only. */
  facts?: ReactNode;
  /** The one thing to do from this card. */
  action: ReactNode;
  /** A quieter second way through. */
  more?: ReactNode;
  /** An anchor other pages and the phone bar can point at. */
  id?: string;
}

/**
 * A link that leaves the site says so, and says where: the mark for the eye, the words for a reader.
 * It opens in a new tab, as the mark promises, so the dashboard is still there when they come back.
 */
function External({ href, children, primary = false, to }: { href: string; children: ReactNode; primary?: boolean; to: string }) {
  return (
    <a className={primary ? 'btn btn--primary' : 'dash-link'} href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <span className="dash-external" aria-hidden="true">
        ↗
      </span>
      <span className="sr-only"> (opens {to} in a new tab)</span>
    </a>
  );
}

function stayCard(data: DashboardData, bookable: boolean): CardContent {
  const block = data.hotel.block;
  if (block && bookable && block.url) {
    return {
      id: 'stay',
      // The one fact with a deadline goes where the eye lands first, above the title.
      kicker: block.cutoff ? `Book by ${shortDate(block.cutoff)}` : 'Where to stay',
      title: 'Our room block',
      body: (
        <p>
          We have a block of rooms at the {data.hotel.name}, where the wedding is. Rooms in the block are limited.
        </p>
      ),
      facts: (
        <dl className="dash-facts">
          <Fact label="Group rate">{block.rateText ?? <Placeholder inline>the group rate</Placeholder>}</Fact>
          <Fact label="Nights">{blockNights(block) ?? <Placeholder inline>the block dates</Placeholder>}</Fact>
          {block.code ? <Fact label="Group code">{block.code}</Fact> : null}
        </dl>
      ),
      action: (
        <External href={block.url} primary to="the hotel’s booking page">
          Book your room
        </External>
      ),
      more: (
        <>
          <span className="dash-card__aside">
            Or call{' '}
            <a className="dash-tel" href={CAA_BOOKING_TEL}>
              {CAA_BOOKING_PHONE}
            </a>{' '}
            and mention “{CAA_BOOKING_PHONE_REFERENCE}”.
          </span>
          <Link className="dash-link" href={GUEST_PATHS.stay}>
            Room details
          </Link>
        </>
      ),
    };
  }
  return {
    id: 'stay',
    kicker: 'Where to stay',
    title: block && !block.placeholder ? 'Rooms at the hotel' : 'Where to stay',
    body:
      block && !block.placeholder ? (
        <p>The book-by date for our room block has passed. The {data.hotel.name} may still have rooms, and we list other places close by.</p>
      ) : (
        <p>The wedding is at the {data.hotel.name}. Room-block details are being confirmed and will appear here first.</p>
      ),
    action: (
      <Link className="dash-link" href={GUEST_PATHS.stay}>
        Where to stay
      </Link>
    ),
  };
}

function rsvpCard(it: MyItinerary): CardContent {
  const w = it.rsvp.window;
  return {
    id: 'rsvp',
    kicker: w.deadlineAt ? `Kindly reply by ${formatDeadline(w.deadlineAt)}` : 'Your reply',
    title: 'RSVP',
    body: (
      <>
        <p>Tell us who is coming for the {it.greeting.householdName}. Each part saves on its own, and you can come back to change it.</p>
        <RsvpTaskList parts={it.rsvp.parts} interactive idPrefix="dash-task" labelledBy="dash-lead-title" />
      </>
    ),
    action: (
      <Link className="btn btn--primary" href={GUEST_PATHS.rsvp}>
        {replyLabel(it.rsvp)}
      </Link>
    ),
  };
}

function scheduleCard(data: DashboardData, it: MyItinerary): CardContent {
  const today = data.state === 'WEDDING_DAY';
  return {
    id: today ? 'now' : 'schedule',
    kicker: today ? 'Today' : data.when,
    title: today ? 'Today’s schedule' : 'Your schedule',
    body: (
      <ol className="dash-events" aria-label="Your events">
        {it.events.map((e) => (
          <li key={e.id} className="dash-events__item">
            <span className="dash-events__name">{e.name}</span>
            <span className="dash-events__when">{e.whenText}</span>
            <span className="dash-events__where">{e.venueSpaceRef ? e.venueSpaceRef.replace(/-/g, ' ') : data.where.name}</span>
            {e.dressCode ? <span className="dash-events__note">Dress: {e.dressCode}</span> : null}
            {e.accessibilityNote ? <span className="dash-events__note">{e.accessibilityNote}</span> : null}
            {/* What is on file, once anyone has answered: the reply stays visible after the window closes. */}
            {e.household.some((h) => h.status) ? (
              <ul className="dash-events__who" aria-label={`Replies for ${e.name}`}>
                {e.household.map((h) => (
                  <li key={h.guestId}>
                    {h.displayName}
                    {h.isSelf ? ' (you)' : ''}: {h.status === 'accepted' ? <Badge tone="yes">attending</Badge> : h.status === 'declined' ? <Badge tone="no">not attending</Badge> : <Badge tone="pending">no answer yet</Badge>}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
    ),
    action: (
      <Link className="dash-link" href={GUEST_PATHS.venue}>
        About the venue
      </Link>
    ),
  };
}

function taskCard(card: TaskCard, data: DashboardData): CardContent | null {
  const it = data.itinerary;
  switch (card) {
    case 'stay':
      return stayCard(data, data.blockOpen);
    case 'rsvp':
      return it ? rsvpCard(it) : null;
    case 'schedule':
      return it ? scheduleCard(data, it) : null;
    case 'flights':
      return {
        id: 'flights',
        kicker: 'Getting here',
        title: 'Book your flights',
        body: <p>Search from your home airport, and see which airport we recommend. Nothing is booked or charged on our site.</p>,
        action: (
          <Link className="dash-link" href={GUEST_PATHS.flights}>
            Search flights
          </Link>
        ),
      };
    case 'around':
      return {
        id: 'around',
        kicker: 'Once you land',
        title: 'Getting around',
        body: <p>From the airport to the hotel and around the city: trains, taxis, rideshare and parking.</p>,
        action: (
          <Link className="dash-link" href={GUEST_PATHS.around}>
            Trains, rides and parking
          </Link>
        ),
      };
    case 'table': {
      const table = it?.seating.table;
      if (!table) return null;
      return {
        id: 'table',
        kicker: 'Seating',
        title: 'Your table',
        body: <TableCard table={table} />,
        action: null,
      };
    }
    case 'ride':
      return {
        id: 'ride',
        kicker: 'On your invitation',
        title: 'Your ride',
        body: <p>There is a ride benefit on your invitation. It is personal to you.</p>,
        action: (
          <Link className="dash-link" href={GUEST_PATHS.ride}>
            See your ride
          </Link>
        ),
      };
    case 'photos':
      return {
        id: 'photos',
        kicker: 'Photos and video',
        title: data.state === 'WEDDING_DAY' ? 'Share what you take today' : 'The weekend in pictures',
        body: <p>Add the photos you took. The professional galleries arrive here as the photographers deliver them.</p>,
        action: (
          <Link className="dash-link" href={GUEST_PATHS.photos}>
            Photos and video
          </Link>
        ),
      };
    case 'gifts':
      return {
        id: 'gifts',
        kicker: 'Gifts',
        title: 'Help us with our next adventures',
        body: <p>Your being there is the gift. If you would like to give something more, the registry is here.</p>,
        action: (
          <Link className="dash-link" href={GUEST_PATHS.gifts}>
            Gifts
          </Link>
        ),
      };
  }
}

const EXPLORE: Record<ExploreCard, { title: string; line: string; href: string }> = {
  things: { title: 'What to do', line: 'Our favorite places, and help planning your free time.', href: GUEST_PATHS.things },
  venue: { title: 'Our venue', line: 'The building, its rooms, and what to look for.', href: GUEST_PATHS.venue },
  story: { title: 'Our story', line: 'How we met and how we got here.', href: GUEST_PATHS.story },
  ask: { title: 'Ask us', line: 'Answers to the questions we hear most.', href: GUEST_PATHS.ask },
};

/**
 * The one thing to do now. Three cells — words, facts, actions — so that on a phone the facts (a
 * rate, the nights) come before the button they inform, and on a wide screen they stand beside it.
 */
function Lead({ content }: { content: CardContent }) {
  return (
    <section className="dash-lead" id={content.id} aria-labelledby="dash-lead-title">
      <div className="dash-lead__main">
        <p className="dash-kicker">{content.kicker}</p>
        <h2 className="dash-lead__title" id="dash-lead-title">
          {content.title}
        </h2>
        <div className="dash-lead__body">{content.body}</div>
      </div>
      {/* The button, then the facts, then the quieter ways through: on a phone the one thing to do
          is inside the first screen, with its deadline already said above the title. */}
      {content.action ? <div className="dash-lead__cta">{content.action}</div> : null}
      {content.facts ? <div className="dash-lead__facts">{content.facts}</div> : null}
      {content.more ? <div className="dash-lead__actions">{content.more}</div> : null}
    </section>
  );
}

function Card({ content, wide = false }: { content: CardContent; wide?: boolean }) {
  const titleId = `dash-${content.id}-title`;
  return (
    <li className={`dash-card${wide ? ' dash-card--wide' : ''}`} id={content.id}>
      <article aria-labelledby={titleId}>
        <p className="dash-kicker">{content.kicker}</p>
        <h3 className="dash-card__title" id={titleId}>
          {content.title}
        </h3>
        <div className="dash-card__body">{content.body}</div>
        {content.facts}
        {content.action || content.more ? (
          <div className="dash-card__actions">
            {content.action}
            {content.more}
          </div>
        ) : null}
      </article>
    </li>
  );
}

export function Dashboard({ data }: { data: DashboardData }) {
  const { plan, itinerary } = data;
  const notices = itinerary ? [...itinerary.notices].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'urgent' ? -1 : 1)) : [];
  const lead = plan.lead ? taskCard(plan.lead, data) : null;
  const next = plan.next.map((card) => taskCard(card, data)).filter((c): c is CardContent => c !== null);
  // A card with a list in it (the schedule, a table with its floor plan) takes the full row.
  const isWide = (c: CardContent) => c.id === 'schedule' || c.id === 'now' || c.id === 'table' || c.id === 'rsvp';
  return (
    <div className="page page--wide dash" data-lifecycle={data.state}>
      <header className="dash-head">
        <div className="dash-head__text">
          <h1 className="page__title">{data.firstName ? `Welcome, ${data.firstName}` : 'Welcome'}</h1>
          {lead ? null : <p className="dash-head__status">{statusLine(data)}</p>}
        </div>
        <dl className="dash-head__facts">
          <div>
            <dt>When</dt>
            <dd>{data.when}</dd>
          </div>
          {data.daysToGo !== null && data.daysToGo > 0 ? (
            <div>
              <dt>Countdown</dt>
              <dd>
                {data.daysToGo} {data.daysToGo === 1 ? 'day' : 'days'} to go
              </dd>
            </div>
          ) : null}
          <div className="dash-head__where">
            <dt>Where</dt>
            <dd>
              {data.where.name}, {data.where.city}
            </dd>
          </div>
        </dl>
      </header>

      {notices.map((n) => (
        <div key={n.id} className={`dash-notice${n.severity === 'urgent' ? ' dash-notice--urgent' : ''}`} role={n.severity === 'urgent' ? 'alert' : 'status'}>
          <p className="dash-notice__title">{n.title}</p>
          <p className="dash-notice__body">{n.body}</p>
        </div>
      ))}

      {lead ? <Lead content={lead} /> : null}

      {plan.done.includes('rsvp') && itinerary ? (
        <p className="dash-done">
          <Badge tone="yes">{itinerary.rsvp.scope === 'household' ? 'RSVP answered for everyone' : 'RSVP answered'}</Badge>{' '}
          <Link className="dash-link" href={GUEST_PATHS.rsvp}>
            Review or change your RSVP
          </Link>
        </p>
      ) : null}

      {next.length ? (
        <section className="dash-next" aria-labelledby="dash-next-title">
          <h2 className="dash-section-title" id="dash-next-title">
            {lead ? 'Then' : 'For the weekend'}
          </h2>
          <ul className="dash-grid">
            {next.map((c) => (
              <Card key={c.id} content={c} wide={isWide(c)} />
            ))}
          </ul>
        </section>
      ) : null}

      {plan.explore.length ? (
        <nav className="dash-explore" aria-labelledby="dash-explore-title">
          <h2 className="dash-section-title" id="dash-explore-title">
            More to read
          </h2>
          <ul className="dash-explore__list">
            {plan.explore.map((id) => (
              <li key={id}>
                <Link className="dash-explore__link" href={EXPLORE[id].href}>
                  <span className="dash-explore__title">{EXPLORE[id].title}</span>
                  <span className="dash-explore__line">{EXPLORE[id].line}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
