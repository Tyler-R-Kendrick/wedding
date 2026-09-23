import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { invoke } from '@/capabilities';
import { getMyRsvp } from '@/capabilities/rsvp';
import { newId } from '@/contracts/ids';
import { FriendlyFailure, GuestsOnly } from '@/components/rsvp/GuestsOnly';
import { RsvpClosed, RsvpForm } from '@/components/rsvp/RsvpForm';
import { PART_LEDE, PART_STEP, PART_TITLE, STEP_PART } from '@/components/rsvp/RsvpTaskList';
import { GuestNotice } from '@/themes/guest';
import { getRequestTheme } from '@/themes/server';
import { uiContext } from '../../_shared/principal';
import { rsvpAction } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'RSVP', robots: { index: false, follow: false } };

type Params = Promise<{ step: string }>;

/**
 * One part of the RSVP on its own — who is coming, bringing a guest, meals, notes — for changing it
 * without walking through the rest. Whatever is not asked here stays exactly as it is on file.
 *
 * A part that is not on this invitation is a 404, not an empty page: a guest with no plus-one has no
 * /rsvp/guest. A part that is on it but not open yet says so, and why, and sends them back.
 */
export default async function RsvpStepPage({ params }: { params: Params }) {
  const { step } = await params;
  const part = Object.hasOwn(STEP_PART, step) ? STEP_PART[step]! : null;
  if (!part) notFound();
  const { ctx, principal } = await uiContext();
  const theme = await getRequestTheme();
  if (principal.kind !== 'guest') return <GuestsOnly what="RSVP" returnTo={`/rsvp/${PART_STEP[part]}`} />;
  const result = await invoke(getMyRsvp, ctx, {});
  if (!result.ok) {
    if (result.error.code === 'unauthenticated' || result.error.code === 'forbidden') return <GuestsOnly what="RSVP" signedIn />;
    return <FriendlyFailure what="RSVP" />;
  }
  const data = result.value.data;
  const progress = data.parts.find((p) => p.part === part);
  if (!progress || progress.state === 'not_applicable') notFound();

  return (
    <div className="page">
      <p>
        <Link className="link-block" href="/rsvp">
          Back to your RSVP
        </Link>
      </p>
      <h1 className="page__title">{PART_TITLE[part]}</h1>
      <p className="page__lede">{PART_LEDE[part]}</p>
      {!data.window.open ? (
        <RsvpClosed data={data} theme={theme} />
      ) : progress.state === 'later' ? (
        <GuestNotice theme={theme} tone="info" title="This part is not open yet">
          <p>
            {progress.reason === 'menu_pending' ? 'Meal choices open once the menu is set.' : 'Sara and Tyler will send word when it opens.'} Nothing is needed from you today —
            your other answers are saved.
          </p>
        </GuestNotice>
      ) : progress.status === 'waiting' || progress.status === 'not_needed' ? (
        <GuestNotice theme={theme} tone="info" title={progress.status === 'waiting' ? 'Tell us who is coming first' : 'Nothing to answer here'}>
          <p>
            {progress.status === 'waiting' ? (
              <>
                This is asked about the people who are coming. <Link href="/rsvp/attending">Tell us who is coming</Link>, then come back.
              </>
            ) : (
              'Nobody this applies to is coming, so there is nothing to choose.'
            )}
          </p>
        </GuestNotice>
      ) : (
        <RsvpForm data={data} action={rsvpAction} idempotencyKey={newId()} theme={theme} parts={[part]} />
      )}
    </div>
  );
}
