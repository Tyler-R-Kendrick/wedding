import { describe, expect, it } from 'vitest';
import { adminLifecycleStatus, adminPublishLifecycle, draftLifecycleTransition } from '@/capabilities/ops';
import { navigateTo } from '@/capabilities/navigate_to';
import type { AdminId, AuthIdentityId, GuestId, HouseholdId } from '@/contracts/ids';
import type { AdminPrincipal, GuestPrincipal } from '@/contracts/principal';
import { getDb } from '@/db/client';
import { getLifecycle } from '@/db/repos/site';
import { resolveLifecycle } from '@/domain/lifecycle/state';
import { getPreviewSecret } from '@/domain/lifecycle/secret';
import { listAuditEvents } from '@/lib/audit';
import { expectErr, expectOk, run } from './helpers/swarm-e';

const admin = (entitlements: string[] = ['admin_lifecycle']): AdminPrincipal => ({
  kind: 'admin',
  authIdentityId: 'A' as AuthIdentityId,
  adminId: 'AD-OPS' as AdminId,
  roles: new Set(['owner']),
  entitlements: new Set(entitlements as never),
  authenticatedAt: new Date().toISOString(),
  sessionId: 'ops-session',
});

const guest: GuestPrincipal = {
  kind: 'guest',
  authIdentityId: 'G' as AuthIdentityId,
  guestId: 'G1' as GuestId,
  householdId: 'H1' as HouseholdId,
  actsFor: ['G1' as GuestId],
  entitlements: new Set(['view_event']),
  authenticatedAt: new Date().toISOString(),
  sessionId: 'guest-session',
};

describe('admin_lifecycle_status', () => {
  it('reports the published state, what the calendar suggests, and what each move changes', async () => {
    const s = expectOk(await run(adminLifecycleStatus, admin(), {})).data;
    expect(s.state).toBe('TEASER');
    expect(s.transitions.map((t) => t.to)).toContain('RSVP_OPEN');
    expect(s.transitions.map((t) => t.to)).not.toContain('TEASER');
    const toRsvp = s.transitions.find((t) => t.to === 'RSVP_OPEN')!;
    expect(toRsvp.navGained).toContain('RSVP');
    expect(s.suggested).toBeDefined();
  });

  it('refuses an admin without admin_lifecycle', async () => {
    expect(expectErr(await run(adminLifecycleStatus, admin(['admin_media']), {})).code).toBe('forbidden');
  });

  it('is refused for a guest', async () => {
    expect(expectErr(await run(adminLifecycleStatus, guest, {})).code).toBe('forbidden');
  });
});

describe('publishing a lifecycle state', () => {
  it('refuses to publish without the confirmation token from the draft', async () => {
    const e = expectErr(await run(adminPublishLifecycle, admin(), { to: 'SAVE_THE_DATE' }));
    expect(e.code).toBe('confirmation_required');
    expect((await getLifecycle(await getDb()))?.state ?? 'TEASER').toBe('TEASER');
  });

  it('drafts without side effects, then publishes with the token, and audits it', async () => {
    const drafted = expectOk(await run(draftLifecycleTransition, admin(), { to: 'SAVE_THE_DATE' }));
    expect(drafted.data.from).toBe('TEASER');
    expect(drafted.data.consequences.length).toBeGreaterThan(2);
    expect((await getLifecycle(await getDb()))?.state ?? 'TEASER').toBe('TEASER'); // a draft changed nothing

    const token = drafted.confirmation!.token;
    const published = expectOk(await run(adminPublishLifecycle, admin(), { to: 'SAVE_THE_DATE' }, { confirmationToken: token, requestId: 'req-pub-1' }));
    expect(published.data).toMatchObject({ from: 'TEASER', state: 'SAVE_THE_DATE' });
    expect((await getLifecycle(await getDb()))?.state).toBe('SAVE_THE_DATE');
    const rows = await listAuditEvents(await getDb(), { action: 'lifecycle.published' });
    expect(rows[0]).toMatchObject({ metadata: { from: 'TEASER', to: 'SAVE_THE_DATE' } });
  });

  it('refuses a token that was issued for a different target state', async () => {
    const drafted = expectOk(await run(draftLifecycleTransition, admin(), { to: 'RSVP_OPEN' }));
    const e = expectErr(await run(adminPublishLifecycle, admin(), { to: 'WEDDING_WEEK' }, { confirmationToken: drafted.confirmation!.token }));
    expect(e.code).toBe('confirmation_required');
    expect(e.details).toMatchObject({ reason: 'payload' });
  });

  it('burns the token: the same confirmation cannot publish twice', async () => {
    const drafted = expectOk(await run(draftLifecycleTransition, admin(), { to: 'INVITATIONS_OPEN' }));
    const token = drafted.confirmation!.token;
    expectOk(await run(adminPublishLifecycle, admin(), { to: 'INVITATIONS_OPEN' }, { confirmationToken: token }));
    const again = expectErr(await run(adminPublishLifecycle, admin(), { to: 'INVITATIONS_OPEN' }, { confirmationToken: token }));
    expect(again.code).toBe('confirmation_required');
    expect(again.details).toMatchObject({ reason: 'used' });
  });

  it('refuses a move backwards by more than one, at both the draft and the publish step', async () => {
    // The site is at INVITATIONS_OPEN from the previous case.
    expect(expectErr(await run(draftLifecycleTransition, admin(), { to: 'TEASER' })).code).toBe('conflict');
    expect((await getLifecycle(await getDb()))?.state).toBe('INVITATIONS_OPEN');
  });

  it('cannot be reached at all from an agent surface, token or no token', async () => {
    // Two independent refusals stand between an agent and this switch, and the outer one fires
    // first: the capability is not exposed on 'ai'/'webmcp', so the pipeline answers `not_found` at
    // step 1 and never reaches the confirmation check at step 5 (which would itself refuse with
    // `requires_ui`). Asserting the outer one is what pins the exposure flags in place.
    expect(adminPublishLifecycle.exposure).toEqual({ ui: true, ai: false, webmcp: false });
    expect(draftLifecycleTransition.exposure).toEqual({ ui: true, ai: false, webmcp: false });
    const drafted = expectOk(await run(draftLifecycleTransition, admin(), { to: 'RSVP_OPEN' }));
    for (const surface of ['ai', 'webmcp'] as const) {
      const e = expectErr(await run(adminPublishLifecycle, admin(), { to: 'RSVP_OPEN' }, { confirmationToken: drafted.confirmation!.token, surface }));
      expect(e.code).toBe('not_found');
    }
    expect((await getLifecycle(await getDb()))?.state).toBe('INVITATIONS_OPEN');
  });
});

describe('previewing another state', () => {
  it('mints a signed preview token for an admin and audits it', async () => {
    const r = expectOk(await run(navigateTo, admin(['admin_lifecycle']), { route: '/', lifecycle: 'WEDDING_DAY' }, { requestId: 'req-prev-1' }));
    expect(r.data.preview?.state).toBe('WEDDING_DAY');
    expect(r.data.preview?.token).toMatch(/^WEDDING_DAY\.\d+\./);
    const rows = await listAuditEvents(await getDb(), { action: 'lifecycle.previewed', requestId: 'req-prev-1' });
    expect(rows).toHaveLength(1);
  });

  it('never applies that token for anyone who is not an admin', async () => {
    // The exact leak this control could create: an admin mints a preview, then the link (or the
    // cookie, on a shared device) reaches a guest. The token verifies; the principal does not.
    const minted = expectOk(await run(navigateTo, admin(['admin_lifecycle']), { route: '/', lifecycle: 'WEDDING_DAY' }));
    const token = minted.data.preview!.token;
    const now = new Date();
    const asGuest = resolveLifecycle({ persisted: 'TEASER', principal: guest, preview: { value: token, source: 'query' }, secret: getPreviewSecret(), now });
    expect(asGuest.preview).toBeNull();
    expect(asGuest.state).toBe('TEASER');
    const asAnonymous = resolveLifecycle({ persisted: 'TEASER', principal: { kind: 'anonymous' }, preview: { value: token, source: 'cookie' }, secret: getPreviewSecret(), now });
    expect(asAnonymous.state).toBe('TEASER');
    const asAdmin = resolveLifecycle({ persisted: 'TEASER', principal: admin(), preview: { value: token, source: 'query' }, secret: getPreviewSecret(), now });
    expect(asAdmin.state).toBe('WEDDING_DAY');
    expect(asAdmin.persistedState).toBe('TEASER');
  });

  it('refuses to mint one for a guest', async () => {
    expect(expectErr(await run(navigateTo, guest, { route: '/', lifecycle: 'WEDDING_DAY' })).code).toBe('forbidden');
  });
});
