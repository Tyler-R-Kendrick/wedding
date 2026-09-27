import { z } from 'zod';
import { appServices } from '@/capabilities/context';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, ok } from '@/contracts/result';
import { getGuest, guestDisplayName } from '@/domain/guests/repo';
import { getHousehold } from '@/domain/households/repo';
import { mintGuestViewToken } from '@/domain/identity/guest-view';
import { buildGuestViewPrincipal } from '@/domain/identity/principal';
import { getPreviewSecret } from '@/domain/lifecycle/secret';
import { actorOf, adminOf } from './shared';

const output = z.object({
  guestId: z.string(),
  displayName: z.string(),
  householdName: z.string(),
  /** False only when the guest is the administrator's own guest record. */
  readOnly: z.boolean(),
  token: z.string(),
  expiresAt: z.string(),
});

/**
 * Starts "Browse as a guest" for this administrator's session (`domain/identity/guest-view.ts`):
 * checks the administrator may view this guest, mints the session-bound token the console's action
 * puts in a cookie, and audits it. Changes nothing a guest can see, so it is `navigate`, as the
 * lifecycle preview `navigate_to` mints is.
 */
export const adminBrowseAsGuest = defineCapability<{ guestId: string }, z.infer<typeof output>>({
  name: 'admin_browse_as_guest',
  title: 'Admin: browse the site as a guest',
  description:
    'Lets an administrator see the site as one guest sees it, in this browser session only: their account menu, their weekend, their RSVP and table. ' +
    'Read-only — nothing can be submitted in the guest’s name — unless the guest is the administrator’s own guest record. ' +
    'Viewing anyone else is for owners, and never a child. Audited. Admin only.',
  kind: 'navigate',
  auth: 'admin',
  // Any administrator may browse as their OWN guest record; anyone else's is for owners, which the
  // handler checks (through `buildGuestViewPrincipal`) once it knows whose record it is.
  requires: [],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input: z.object({ guestId: z.string().min(1).max(64) }),
  output,
  async handler(ctx, { guestId }) {
    const guard = adminOf(ctx);
    if (!guard.ok) return err(guard.error);
    const admin = guard.value;
    const { db } = appServices(ctx);
    const guest = await getGuest(db, guestId);
    if (!guest || guest.mergedIntoGuestId) return err(new CapabilityError('not_found', 'That guest does not exist.'));
    const session = { authIdentityId: admin.authIdentityId, sessionId: admin.sessionId, authenticatedAt: new Date(admin.authenticatedAt), activeGuestId: null, email: '' };
    const view = await buildGuestViewPrincipal(db, session, admin, guest.id, ctx.flags, ctx.now);
    if (!view?.viewedBy) return err(new CapabilityError('forbidden', guest.kind === 'child' || guest.isMinor ? 'Children have no access of their own, so there is nothing to browse as them.' : 'You can browse as your own guest record; browsing as someone else is for the site’s owners.'));
    const household = await getHousehold(db, guest.householdId);
    const minted = mintGuestViewToken(guest.id, admin.sessionId, getPreviewSecret(), ctx.now);
    await ctx.audit.record({
      actor: actorOf(ctx),
      action: 'guest_view.started',
      target: { type: 'guest', id: guest.id },
      outcome: 'success',
      requestId: ctx.requestId,
      metadata: { readOnly: view.viewedBy.readOnly, expiresAt: minted.expiresAt },
    });
    return ok({
      data: { guestId: guest.id, displayName: guestDisplayName(guest), householdName: household?.name ?? '', readOnly: view.viewedBy.readOnly, token: minted.token, expiresAt: minted.expiresAt },
      sources: [],
    });
  },
});
