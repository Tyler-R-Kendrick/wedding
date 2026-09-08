import { Placeholder } from '@/components/provenance/Placeholder';
import Link from 'next/link';
import type { MyItinerary } from '@/capabilities/rsvp';
import { highlightIdFor } from '@/capabilities/seating/show_my_table_on_floorplan';
import { FloorPlan } from '@/components/floorplan/FloorPlan';
import { Badge } from '@/components/rsvp/fields';
import { formatDeadline } from '@/domain/events/format';
import { GuestCard, GuestNotice, GuestSection } from '@/themes/guest';
import type { ThemeId } from '@/themes/types';

/**
 * Your Weekend recipe: renders what get_my_itinerary returned, nothing more.
 *
 * The sections and cards are the ACTIVE DESIGN'S (`themes/<id>/guest.tsx`), not the shared `.sec` /
 * `.card` pair — see `src/themes/guest.tsx` for why one shared recipe wearing two palettes was a
 * blocker rather than a shortcut.
 */
export function WeekendPage({ data, theme }: { data: MyItinerary; theme: ThemeId }) {
  const notices = [...data.notices].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'urgent' ? -1 : 1));
  const table = data.seating.table;
  return (
    <div className="page">
      <h1 className="page__title">Your weekend, {data.greeting.firstName}</h1>
      <p className="page__lede">Saturday, July 17, 2027 · Chicago Athletic Association Hotel, 12 S Michigan Ave, Chicago, IL 60603.</p>

      {notices.map((n) => (
        <GuestNotice key={n.id} theme={theme} tone={n.severity === 'urgent' ? 'urgent' : 'info'} title={n.title}>
          <p>{n.body}</p>
        </GuestNotice>
      ))}

      <GuestSection theme={theme} id="rsvp" index={0} title="RSVP">
        <p>
          {/* "for everyone" is only true when the counts cover more than one person. They are built
              from `actsFor`, so a non-manager who answers for themselves alone used to read that
              their whole household was done. */}
          {data.rsvp.status === 'complete' ? (
            <Badge tone="yes">{data.rsvp.scope === 'household' ? 'Answered for everyone' : 'Answered'}</Badge>
          ) : data.rsvp.status === 'partial' ? (
            <Badge tone="pending">
              {data.rsvp.answered} of {data.rsvp.expected} answered
            </Badge>
          ) : (
            <Badge tone="pending">Not answered yet</Badge>
          )}
        </p>
        {/* A delegate may not answer, and `derive.ts` strips `rsvp_self` from exactly that role, so
            offering the primary button on the window alone put a 403 behind it. */}
        {data.rsvp.window.open && data.rsvp.canAnswer ? (
          <p>
            <Link className="btn btn--primary" href="/rsvp">
              {data.rsvp.status === 'not_started' ? 'RSVP now' : 'Review or change your RSVP'}
            </Link>
          </p>
        ) : (
          // Says the same thing /rsvp says, for the same reason — including the case that matters:
          // `lifecycle` means RSVPs have not opened yet, and telling a guest they are "closed"
          // during the teaser is false. Keeping the two pages in step is why this branches on the
          // same field rather than on `open` alone.
          data.rsvp.window.reason === 'lifecycle' ? (
            <p className="card__meta">RSVPs are not open yet — Sara and Tyler will send word when it is time to reply.</p>
          ) : (
            <p className="card__meta">RSVPs are closed. If something changed, reach Sara and Tyler. <Placeholder inline>their contact details</Placeholder></p>
          )
        )}
        {/* Says the same thing /rsvp says, including when there is no deadline yet: a guest who reads
            one page and not the other should not come away with a different understanding. */}
        {data.rsvp.window.deadlineAt ? (
          <p className="card__meta">Deadline: {formatDeadline(data.rsvp.window.deadlineAt)}.</p>
        ) : data.rsvp.window.open ? (
          // Every other unknown on this page is named; the deadline was the one being papered over.
          <p className="card__meta">
            <Placeholder inline>the date answers are needed by</Placeholder>
          </p>
        ) : null}
      </GuestSection>

      <GuestSection theme={theme} id="events" index={1} title="Your events">
        <ol className="list list--plain">
          {data.events.map((e) => (
            <li key={e.id}>
              <GuestCard theme={theme} title={e.name}>
              <p className="card__meta">
                {e.dateText} · {e.whenText}
              </p>
              {/* One fact per line rather than joined by a middot: when either side is a placeholder
                  the run is long enough to wrap at 390px, and the separator was landing alone on a
                  line of its own between them. */}
              <p className="card__meta">
                Where: {e.venueSpaceRef ? e.venueSpaceRef.replace(/-/g, ' ') : <Placeholder inline>the room</Placeholder>}
              </p>
              <p className="card__meta">Dress: {e.dressCode ?? <Placeholder inline>the dress code</Placeholder>}</p>
              {e.accessibilityNote ? <p>{e.accessibilityNote}</p> : null}
              <ul className="list list--plain">
                {e.household.map((h) => (
                  <li key={h.guestId}>
                    {h.displayName}
                    {h.isSelf ? ' (you)' : ''}: {h.status === 'accepted' ? <Badge tone="yes">attending</Badge> : h.status === 'declined' ? <Badge tone="no">not attending</Badge> : <Badge tone="pending">no answer yet</Badge>}
                  </li>
                ))}
              </ul>
              </GuestCard>
            </li>
          ))}
        </ol>
      </GuestSection>

      <GuestSection theme={theme} id="table" index={2} title="Your table">
        {table ? (
          <div>
            <p>
              <strong>{table.table.name}</strong>
              {table.table.seatNumber ? `, seat ${table.table.seatNumber}` : ''}
              {table.floorPlan ? ` in the ${table.floorPlan.name}` : ''}.
            </p>
            {table.table.tablemates.length ? <p className="card__meta">With {table.table.tablemates.join(', ')}.</p> : null}
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
          </div>
        ) : (
          <p className="card__meta">{data.seating.message}</p>
        )}
      </GuestSection>

      <GuestSection theme={theme} id="slots" index={3} title="Getting around and your trip">
        <div className="grid-2">
          {[data.slots.transport, data.slots.trip].map((slot) => (
            <GuestCard theme={theme} key={slot.kind} title={slot.title}>
              {slot.status === 'ready' ? (
                <ul className="list">
                  {slot.items.map((i, idx) => (
                    <li key={idx}>
                      {i.href ? <a href={i.href}>{i.label}</a> : i.label}
                      {i.detail ? ` — ${i.detail}` : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                slot.status === 'placeholder' ? <Placeholder>{slot.body}</Placeholder> : <p className="card__meta">{slot.body}</p>
              )}
            </GuestCard>
          ))}
        </div>
      </GuestSection>
    </div>
  );
}
