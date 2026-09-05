import Link from 'next/link';
import type { MyItinerary } from '@/capabilities/rsvp';
import { highlightIdFor } from '@/capabilities/seating/show_my_table_on_floorplan';
import { FloorPlan } from '@/components/floorplan/FloorPlan';
import { Badge, Notice } from '@/components/rsvp/fields';
import { formatDeadline } from '@/domain/events/format';

/** Your Weekend recipe: renders what get_my_itinerary returned, nothing more. */
export function WeekendPage({ data }: { data: MyItinerary }) {
  const notices = [...data.notices].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'urgent' ? -1 : 1));
  const table = data.seating.table;
  return (
    <main id="main" className="page">
      <p className="page__eyebrow">Your Weekend</p>
      <h1 className="page__title">Your weekend, {data.greeting.firstName}</h1>
      <p className="page__lede">Saturday, July 17, 2027 · Chicago Athletic Association Hotel, 12 S Michigan Ave, Chicago, IL 60603.</p>

      {notices.map((n) => (
        <Notice key={n.id} tone={n.severity === 'urgent' ? 'urgent' : 'info'} title={n.title}>
          <p>{n.body}</p>
        </Notice>
      ))}

      <section className="sec" aria-labelledby="rsvp-title">
        <h2 className="sec__title" id="rsvp-title">
          RSVP
        </h2>
        <p>
          {data.rsvp.status === 'complete' ? <Badge tone="yes">Answered for everyone</Badge> : data.rsvp.status === 'partial' ? <Badge tone="pending">{data.rsvp.answered} of {data.rsvp.expected} answered</Badge> : <Badge tone="pending">Not answered yet</Badge>}
        </p>
        {data.rsvp.window.open ? (
          <p>
            <Link className="btn btn--primary" href="/rsvp">
              {data.rsvp.status === 'not_started' ? 'RSVP now' : 'Review or change your RSVP'}
            </Link>
          </p>
        ) : (
          <p className="card__meta">RSVPs are closed. If something changed, reach Sara and Tyler. TODO(Tyler &amp; Sara): contact details.</p>
        )}
        {data.rsvp.window.deadlineAt ? <p className="card__meta">Deadline: {formatDeadline(data.rsvp.window.deadlineAt)}.</p> : null}
      </section>

      <section className="sec" aria-labelledby="events-title">
        <h2 className="sec__title" id="events-title">
          Your events
        </h2>
        <ol className="list list--plain">
          {data.events.map((e) => (
            <li key={e.id} className="card">
              <h3 className="card__title">{e.name}</h3>
              <p className="card__meta">
                {e.dateText} · {e.whenText}
              </p>
              <p className="card__meta">
                Where: {e.venueSpaceRef ? e.venueSpaceRef.replace(/-/g, ' ') : <span className="placeholder">room to be confirmed — TODO(Tyler &amp; Sara)</span>}
                {' · '}
                Dress: {e.dressCode ?? <span className="placeholder">to be confirmed — TODO(Tyler &amp; Sara)</span>}
              </p>
              {e.accessibilityNote ? <p>{e.accessibilityNote}</p> : null}
              <ul className="list list--plain">
                {e.household.map((h) => (
                  <li key={h.guestId}>
                    {h.displayName}
                    {h.isSelf ? ' (you)' : ''}: {h.status === 'accepted' ? <Badge tone="yes">attending</Badge> : h.status === 'declined' ? <Badge tone="no">not attending</Badge> : <Badge tone="pending">no answer yet</Badge>}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>

      <section className="sec" aria-labelledby="table-title">
        <h2 className="sec__title" id="table-title">
          Your table
        </h2>
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
          <p className="card__meta">Your table will appear here once seating is published.</p>
        )}
      </section>

      <section className="sec" aria-labelledby="slots-title">
        <h2 className="sec__title" id="slots-title">
          Getting around and your trip
        </h2>
        <div className="grid-2">
          {[data.slots.transport, data.slots.trip].map((slot) => (
            <div key={slot.kind} className="card">
              <h3 className="card__title">{slot.title}</h3>
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
                <p className={slot.status === 'placeholder' ? 'placeholder' : 'card__meta'}>{slot.body}</p>
              )}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
