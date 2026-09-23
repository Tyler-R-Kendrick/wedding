import type { Metadata } from 'next';
import Link from 'next/link';
import { invoke } from '@/capabilities';
import { getMyRsvp } from '@/capabilities/rsvp';
import { newId } from '@/contracts/ids';
import { FriendlyFailure, GuestsOnly } from '@/components/rsvp/GuestsOnly';
import { Placeholder } from '@/components/provenance/Placeholder';
import { RsvpClosed, RsvpForm } from '@/components/rsvp/RsvpForm';
import { RsvpTaskList } from '@/components/rsvp/RsvpTaskList';
import { formatDeadline } from '@/domain/events/format';
import { GuestNotice, GuestSection } from '@/themes/guest';
import { getRequestTheme } from '@/themes/server';
import { uiContext } from '../_shared/principal';
import { rsvpAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'RSVP', robots: { index: false, follow: false } };

/**
 * The guest's RSVP, whole: where each part stands, and — below it, on the same page — one form for
 * everything still open. Route only: resolve the principal, call the capability, render recipes.
 *
 * The parts (attendance, plus-one, meal, notes) open at different times, so this page never assumes
 * which are live. With everything released, a first reply is one form, one review, one confirmation,
 * as it always was; when meals open a month later, the same address shows the meals and nothing
 * else. Each part also has its own page (/rsvp/attending, /guest, /meals, /notes) for changing it.
 */
export default async function RsvpPage() {
  const { ctx, principal } = await uiContext();
  // `RsvpForm` is a client island and cannot read the request, so the design is handed to it here.
  const theme = await getRequestTheme();
  if (principal.kind !== 'guest') return <GuestsOnly what="RSVP" returnTo="/rsvp" />;
  const result = await invoke(getMyRsvp, ctx, {});
  if (!result.ok) {
    if (result.error.code === 'unauthenticated' || result.error.code === 'forbidden') return <GuestsOnly what="RSVP" signedIn />;
    return <FriendlyFailure what="RSVP" />;
  }
  const data = result.value.data;
  const self = data.guests.find((g) => g.isSelf);
  const household = data.guests.length > 1;
  const anyOpen = data.parts.some((p) => p.state === 'open');
  const anyLater = data.parts.some((p) => p.state === 'later');
  const answering = data.window.open && data.next.length > 0;
  return (
    <div className="page">
      {/* A closed window — or a first reply that cannot be given yet — must not be asked a question.
          "Ada, will you join us?" above "RSVPs are closed" invites an answer the page will not take. */}
      <h1 className="page__title">
        {answering && data.next.includes('attendance')
          ? household
            ? `${data.household.name}, will you join us?`
            : `${self?.firstName ?? 'Hello'}, will you join us?`
          : household
            ? `${data.household.name}, your RSVP`
            : self
              ? `${self.firstName}, your RSVP`
              : 'Your RSVP'}
      </h1>
      <p className="page__lede">Saturday, July 17, 2027, at the Chicago Athletic Association Hotel.</p>
      {/* Branches the same way /your-weekend does, and on the same field: a closed window with no
          deadline is the seeded default, so "…while RSVPs are open" above a closed notice was the
          first thing a guest read. */}
      {data.window.deadlineAt ? (
        <p className="card__meta">Please answer by {formatDeadline(data.window.deadlineAt)}.</p>
      ) : data.window.open ? (
        <p className="card__meta">
          <Placeholder inline>the date answers are needed by</Placeholder>
        </p>
      ) : null}

      {!data.window.open ? (
        <RsvpClosed data={data} theme={theme} />
      ) : !anyOpen ? (
        <>
          <GuestNotice theme={theme} tone="info" title="Replies are not open yet">
            <p>Sara and Tyler will send word when it is time to reply, and this page is where you will do it. Nothing is needed from you today.</p>
          </GuestNotice>
          <RsvpTaskList parts={data.parts} interactive={false} />
        </>
      ) : (
        <>
          <GuestSection theme={theme} id="where" index={0} title="Where things stand">
            <RsvpTaskList parts={data.parts} interactive labelledBy="where-title" />
            {!answering ? (
              <p className="card__meta">
                {anyLater
                  ? 'That is everything open for now. The rest will appear on this page when it opens — nothing else is needed from you today.'
                  : 'You have answered everything. Choose any part above to change it.'}
              </p>
            ) : null}
          </GuestSection>
          {answering ? (
            <RsvpForm data={data} action={rsvpAction} idempotencyKey={newId()} theme={theme} parts={data.next} />
          ) : (
            <p>
              <Link className="btn btn--secondary" href="/your-weekend">
                See your weekend
              </Link>
            </p>
          )}
        </>
      )}
    </div>
  );
}
