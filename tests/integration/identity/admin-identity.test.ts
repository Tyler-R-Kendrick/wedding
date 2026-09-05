import { describe, expect, it } from 'vitest';
import { like } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { auditEvents, idempotencyKeys } from '@/db/schema';
import { listAuditEvents } from '@/lib/audit';
import { ageSession, call, claim, expectErr, expectOk, grantAdmin, principalFor, seed, signIn } from './harness';

describe('admin reset, rebind, roles, CSV', () => {
  it('reset ends sessions and lets the guest claim again; rebind moves access and audits both', async () => {
    const f = await seed('ad1');
    await grantAdmin(f.emails.admin, 'owner');
    const admin = await signIn(f.emails.admin, {}, 'admin_sign_in');
    expect(admin.outcome.isAdmin).toBe(true);
    const ap = await principalFor({ cookie: admin.cookie });
    expect(ap.kind).toBe('admin');
    if (ap.kind !== 'admin') return;
    expect(ap.roles.has('owner')).toBe(true);
    expect(ap.entitlements.has('admin_guest_ops')).toBe(true);

    const chidi = await claim(f.invitations.okafor.token, f.guests.chidi, f.emails.chidi);
    const reset = expectOk(await call<{ revoked: number; sessionsEnded: number }>('admin_reset_identity', { guestId: f.guests.chidi, reason: 'lost phone' }, { cookie: admin.cookie }));
    expect(reset.data).toEqual({ revoked: 1, sessionsEnded: 1 });
    expect((await principalFor({ cookie: chidi.cookie })).kind).toBe('anonymous'); // revocation ends sessions
    const db = await getDb();
    expect(await listAuditEvents(db, { action: 'identity.reset', targetId: f.guests.chidi })).toHaveLength(1);

    const newEmail = `chidi.new+ad1@example.test`;
    const rebound = expectOk(await call<{ email: string }>('admin_rebind_identity', { guestId: f.guests.chidi, email: newEmail, reason: 'new address' }, { cookie: admin.cookie }));
    expect(rebound.data.email).toBe(newEmail);
    expect(await listAuditEvents(db, { action: 'identity.rebound', targetId: f.guests.chidi })).toHaveLength(1);
    const back = await signIn(newEmail);
    expect(back.outcome.guestId).toBe(f.guests.chidi);
    // Old email no longer reaches Chidi.
    const old = expectOk(await call<{ sent: boolean; challenge: string }>('request_otp', { purpose: 'sign_in', email: f.emails.chidi }));
    expectErr(await call('verify_otp', { challenge: old.data.challenge, code: '111111' }), 'validation');
  });

  it('admin capabilities deny guests and anonymous callers; planners cannot manage roles', async () => {
    const f = await seed('ad2');
    const ana = await claim(f.invitations.ruiz.token, f.guests.ana, f.emails.ana);
    for (const name of ['admin_list_guests', 'admin_list_households', 'admin_list_invitations', 'admin_export_guests_csv']) {
      expectErr(await call(name, {}, { cookie: ana.cookie }), 'forbidden');
      expectErr(await call(name, {}), 'unauthenticated');
    }
    expectErr(await call('admin_reset_identity', { guestId: f.guests.ana, reason: 'x' }, { cookie: ana.cookie }), 'forbidden');
    await grantAdmin(`planner+ad2@example.test`, 'planner');
    const planner = await signIn(`planner+ad2@example.test`, {}, 'admin_sign_in');
    expectErr(await call('admin_set_admin_role', { email: 'x@example.test', role: 'owner' }, { cookie: planner.cookie }), 'forbidden');
    const list = expectOk(await call<{ guests: { id: string }[] }>('admin_list_guests', { householdId: f.households.ruiz }, { cookie: planner.cookie }));
    expect(list.data.guests.map((g) => g.id).sort()).toEqual([f.guests.ana, f.guests.anaPlusOne].sort());
  });

  it('CSV export excludes notes and addresses by default; import round-trips and is idempotent', async () => {
    const f = await seed('ad3');
    await grantAdmin(`owner+ad3@example.test`, 'owner');
    const admin = await signIn(`owner+ad3@example.test`, {}, 'admin_sign_in');
    await call('admin_upsert_guest', { id: f.guests.ana, householdId: f.households.ruiz, firstName: 'Ana', lastName: 'Ruiz', email: f.emails.ana, notes: 'SECRET NOTE' }, { cookie: admin.cookie });
    const plain = expectOk(await call<{ csv: string; columns: string[] }>('admin_export_guests_csv', {}, { cookie: admin.cookie }));
    expect(plain.data.csv).not.toContain('SECRET NOTE');
    expect(plain.data.columns).not.toContain('notes');
    expect(plain.data.columns).not.toContain('dietary');
    const full = expectOk(await call<{ csv: string; columns: string[] }>('admin_export_guests_csv', { includeNotes: true, includeAddress: true }, { cookie: admin.cookie }));
    expect(full.data.csv).toContain('SECRET NOTE');
    const csv = `household,first_name,last_name,email,kind,manager,event_keys\nThe Imported ad3,Ivy,Import,ivy+ad3@example.test,adult,yes,ceremony\nThe Imported ad3,Kid,Import,,child,,\n`;
    const dry = expectOk(await call<{ dryRun: boolean; householdsCreated: number; guestsCreated: number }>('admin_import_guests_csv', { csv, dryRun: true }, { cookie: admin.cookie }));
    expect(dry.data).toMatchObject({ dryRun: true, householdsCreated: 1, guestsCreated: 2 });
    const first = expectOk(await call<{ householdsCreated: number; guestsCreated: number; guestsUpdated: number }>('admin_import_guests_csv', { csv }, { cookie: admin.cookie }));
    expect(first.data).toMatchObject({ householdsCreated: 1, guestsCreated: 2, guestsUpdated: 0 });
    const second = expectOk(await call<{ householdsCreated: number; guestsCreated: number; guestsUpdated: number }>('admin_import_guests_csv', { csv }, { cookie: admin.cookie }));
    expect(second.data).toMatchObject({ householdsCreated: 0, guestsCreated: 0, guestsUpdated: 2 });
    const issued = expectOk(await call<{ token: string; url: string; qrSvg: string }>('admin_issue_invitation', { householdId: f.households.ruiz, eventKeys: ['ceremony'] }, { cookie: admin.cookie }));
    expect(issued.data.url).toContain(`/invite/${issued.data.token}`);
    expect(issued.data.qrSvg).toContain('<svg');
    const listed = expectOk(await call<{ invitations: { id: string }[] }>('admin_list_invitations', { householdId: f.households.ruiz }, { cookie: admin.cookie }));
    expect(JSON.stringify(listed.data)).not.toContain(issued.data.token);
    // Review S4: the plaintext token is shown once and persisted nowhere — not in idempotency replays, not in audit rows.
    const rotated = expectOk(await call<{ token: string }>('admin_rotate_invitation', { invitationId: f.invitations.ruiz.id }, { cookie: admin.cookie }));
    const db = await getDb();
    const idem = JSON.stringify(await db.select().from(idempotencyKeys).where(like(idempotencyKeys.scope, 'admin_%')));
    const audit = JSON.stringify(await db.select().from(auditEvents));
    for (const token of [issued.data.token, rotated.data.token]) {
      expect(idem).not.toContain(token);
      expect(audit).not.toContain(token);
      expect(audit).not.toContain(issued.data.url.split('/invite/')[1]!);
    }
  });

  it('admin reset / rebind / roles require a fresh admin session (step-up)', async () => {
    const f = await seed('ad4');
    await grantAdmin(f.emails.admin, 'owner');
    const admin = await signIn(f.emails.admin, {}, 'admin_sign_in');
    await ageSession(admin.cookie, 6);
    expect((await principalFor({ cookie: admin.cookie })).kind).toBe('admin');
    expectErr(await call('admin_reset_identity', { guestId: f.guests.chidi, reason: 'x' }, { cookie: admin.cookie }), 'step_up_required');
    expectErr(await call('admin_rebind_identity', { guestId: f.guests.chidi, email: 'new+ad4@example.test', reason: 'x' }, { cookie: admin.cookie }), 'step_up_required');
    expectErr(await call('admin_set_admin_role', { email: 'p+ad4@example.test', role: 'planner' }, { cookie: admin.cookie }), 'step_up_required');
    expectErr(await call('admin_issue_invitation', { householdId: f.households.ruiz }, { cookie: admin.cookie }), 'step_up_required');
    // Reads still work on the aged session.
    expect((await call('admin_list_guests', {}, { cookie: admin.cookie })).ok).toBe(true);
  });

  it('N1: audit rows for role changes, identity resets, and revocations carry no email address', async () => {
    const f = await seed('ad5');
    await grantAdmin(f.emails.admin, 'owner');
    const admin = await signIn(f.emails.admin, {}, 'admin_sign_in');
    await claim(f.invitations.okafor.token, f.guests.chidi, f.emails.chidi);
    expectOk(await call('admin_set_admin_role', { email: 'planner+ad5@example.test', role: 'planner' }, { cookie: admin.cookie }));
    expectOk(await call('admin_reset_identity', { guestId: f.guests.chidi, reason: `asked by chidi ${f.emails.chidi} by phone` }, { cookie: admin.cookie }));
    expectOk(await call('admin_revoke_invitation', { invitationId: f.invitations.okafor.id, reason: `leaked to leak+ad5@example.test` }, { cookie: admin.cookie }));
    expectOk(await call('admin_rebind_identity', { guestId: f.guests.chidi, email: `chidi.rebound+ad5@example.test`, reason: `moved from ${f.emails.chidi}` }, { cookie: admin.cookie }));
    const db = await getDb();
    for (const action of ['admin.role_changed', 'identity.reset', 'invitation.revoked', 'identity.rebound', 'session.revoked'] as const) {
      const rows = await listAuditEvents(db, { action });
      expect(rows.length, action).toBeGreaterThan(0);
      for (const r of rows) expect(JSON.stringify({ target: r.targetId, metadata: r.metadata, actor: r.actor }), action).not.toContain('@');
    }
  });
});
