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
export const metadata: Metadata = { title: 'Your Weekend', robots: { index: false, follow: false } };

export default async function YourWeekendPage() {
  const { ctx, principal } = await uiContext();
  if (principal.kind !== 'guest') return <GuestsOnly what="Your Weekend" returnTo="/your-weekend" />;
  const result = await invoke(getMyItinerary, ctx, {});
  if (!result.ok) {
    if (result.error.code === 'unauthenticated' || result.error.code === 'forbidden') return <GuestsOnly what="Your Weekend" signedIn />;
    return <FriendlyFailure what="Your Weekend" />;
  }
  // The recipe renders the ACTIVE DESIGN's sections and cards, so it needs the theme the layout
  // resolved. Same request, same resolution — `getRequestTheme` reads the header the proxy set.
  const theme = await getRequestTheme();
  const data = result.value.data;
  // The approved design answers the invitation on this page: before a guest has replied at all, the
  // real form (the same capability and server action as /rsvp) sits in the centre of the workspace.
  // Once anything is on file, the centre shows what is on file and links to /rsvp to review or change
  // it — a half-finished household is finished there, with its answers in front of it.
  let reply: WeekendReply | undefined;
  if (theme === 'botanical-deco' && data.rsvp.window.open && data.rsvp.canAnswer && data.rsvp.status === 'not_started') {
    const rsvp = await loadRsvp(ctx);
    if (rsvp) reply = { data: rsvp, action: rsvpAction, idempotencyKey: newId() };
  }
  return <WeekendPage data={data} theme={theme} reply={reply} />;
}

async function loadRsvp(ctx: Awaited<ReturnType<typeof uiContext>>['ctx']) {
  const r = await invoke(getMyRsvp, ctx, {});
  return r.ok ? r.value.data : null;
}
