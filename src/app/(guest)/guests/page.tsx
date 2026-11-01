import type { Metadata } from 'next';
import { invoke } from '@/capabilities';
import { getMyItinerary, getMyRsvp } from '@/capabilities/rsvp';
import { newId } from '@/contracts/ids';
import { FriendlyFailure, GuestsOnly } from '@/components/rsvp/GuestsOnly';
import { WeekendPage } from '@/components/weekend/WeekendPage';
import type { WeekendReply } from '@/themes/botanical-deco/weekend';
import { getRequestTheme } from '@/themes/server';
import { uiContext } from '../_shared/principal';
import { rsvpAction } from '../rsvp/actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Guest Portal', robots: { index: false, follow: false } };

/** Signed-in landing: RSVP, schedule, and links — the same itinerary data as Your Weekend, portal-first. */
export default async function GuestPortalPage() {
  const { ctx, principal } = await uiContext();
  if (principal.kind !== 'guest') return <GuestsOnly admin={principal.kind === 'admin'} what="Guest portal" returnTo="/guests" />;
  const result = await invoke(getMyItinerary, ctx, {});
  if (!result.ok) {
    if (result.error.code === 'unauthenticated' || result.error.code === 'forbidden') return <GuestsOnly what="Guest portal" signedIn />;
    return <FriendlyFailure what="Guest portal" />;
  }
  const theme = await getRequestTheme();
  const data = result.value.data;
  let reply: WeekendReply | undefined;
  if (theme === 'botanical-deco' && data.rsvp.window.open && data.rsvp.canAnswer && data.rsvp.status === 'not_started' && data.rsvp.next.includes('attendance')) {
    const rsvp = await loadRsvp(ctx);
    if (rsvp) reply = { data: rsvp, action: rsvpAction, idempotencyKey: newId() };
  }
  return <WeekendPage data={data} theme={theme} reply={reply} heading="Guest portal" />;
}

async function loadRsvp(ctx: Awaited<ReturnType<typeof uiContext>>['ctx']) {
  const r = await invoke(getMyRsvp, ctx, {});
  return r.ok ? r.value.data : null;
}
