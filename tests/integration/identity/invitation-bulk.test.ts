import { describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { guests, households, invitations } from '@/db/schema';
import { upsertGuest } from '@/domain/guests/repo';
import { upsertHousehold } from '@/domain/households/repo';
import { listAuditEvents } from '@/lib/audit';
import { call, claim, expectErr, expectOk, grantAdmin, seed, signIn } from './harness';

type Row = { id: string; name: string; people: number; inGroup: boolean; link: 'none' | 'active' | 'claimed'; sentAt: string | null };

/**
 * The bulk group on /admin/invitations: households are put in it and taken out, it is saved, and
 * the bulk actions act on exactly the households they are given. "Sent" is what lets a household's
 * guests sign in with Google or Facebook by name, so the tests are as much about what is NOT
 * touched as about what is.
 */
async function setUp(suffix: string) {
  const f = await seed(suffix);
  await grantAdmin(`owner+${suffix}@example.test`, 'owner');
  const admin = await signIn(`owner+${suffix}@example.test`, {}, 'admin_sign_in');
  const db = await getDb();
  // Three households of our own with no link at all, as a freshly loaded guest list has them.
  const fresh: string[] = [];
  for (const name of ['Bulkquill One', 'Bulkquill Two', 'Bulkquill Three']) {
    const home = await upsertHousehold(db, { name: `${name} ${suffix}` });
    if (!home.ok) throw home.error;
    const g = await upsertGuest(db, { householdId: home.value.id, firstName: 'Pat', lastName: `${name.replace(' ', '')}${suffix}` });
    if (!g.ok) throw g.error;
    fresh.push(home.value.id);
  }
  const list = async () => expectOk(await call<{ households: Row[] }>('admin_list_invitation_households', {}, { cookie: admin.cookie })).data.households;
  const mine = async (ids: string[]) => (await list()).filter((h) => ids.includes(h.id));
  return { f, admin, db, fresh, list, mine };
}

describe('the bulk group of households', () => {
  it('is saved: a household put in it is still in it for the next request, and for another administrator', async () => {
    const { f, admin, fresh, mine } = await setUp('bg1');
    expect((await mine(fresh)).map((h) => h.inGroup)).toEqual([false, false, false]);
    expect(expectOk(await call<{ changed: number }>('admin_set_bulk_group', { householdIds: fresh.slice(0, 2), inGroup: true }, { cookie: admin.cookie })).data.changed).toBe(2);
    // Again: nothing changes, and nothing fails.
    expect(expectOk(await call<{ changed: number }>('admin_set_bulk_group', { householdIds: fresh.slice(0, 2), inGroup: true }, { cookie: admin.cookie })).data.changed).toBe(0);
    await grantAdmin(`planner+bg1@example.test`, 'planner');
    const other = await signIn(`planner+bg1@example.test`, {}, 'admin_sign_in');
    const seen = expectOk(await call<{ households: Row[] }>('admin_list_invitation_households', {}, { cookie: other.cookie })).data.households.filter((h) => fresh.includes(h.id));
    expect(seen.map((h) => [h.name.replace(' bg1', ''), h.inGroup, h.people])).toEqual([['Bulkquill One', true, 1], ['Bulkquill Three', false, 1], ['Bulkquill Two', true, 1]]);
    // Taking one out leaves the other in. Nobody else's household was touched either way.
    await call('admin_set_bulk_group', { householdIds: [fresh[0]!], inGroup: false }, { cookie: admin.cookie });
    expect((await mine(fresh)).filter((h) => h.inGroup).map((h) => h.id)).toEqual([fresh[1]]);
    expect((await mine([f.households.ruiz, f.households.okafor])).every((h) => !h.inGroup)).toBe(true);
  });

  it('says where each household’s invitation stands: no link, a link, claimed, sent', async () => {
    const { f, admin, fresh, mine } = await setUp('bg2');
    expect((await mine(fresh)).map((h) => [h.link, h.sentAt])).toEqual([['none', null], ['none', null], ['none', null]]);
    const before = (await mine([f.households.okafor]))[0]!;
    expect(before).toMatchObject({ link: 'active', sentAt: null });
    await claim(f.invitations.okafor.token, f.guests.chidi, f.emails.chidi);
    expect((await mine([f.households.okafor]))[0]).toMatchObject({ link: 'claimed', sentAt: null });
    await call('admin_mark_households_sent', { householdIds: [f.households.okafor], sent: true }, { cookie: admin.cookie });
    expect((await mine([f.households.okafor]))[0]!.sentAt).toMatch(/^\d{4}-/);
  });

  it('marks as sent only the households it is given, skips and names one with no link, and can be undone', async () => {
    const { f, admin, db, fresh, mine } = await setUp('bg3');
    const ids = [f.households.ruiz, f.households.okafor, fresh[0]!];
    const r = expectOk(await call<{ sent: boolean; changed: number; already: number; noLink: string[] }>('admin_mark_households_sent', { householdIds: ids, sent: true }, { cookie: admin.cookie }));
    expect(r.data).toEqual({ sent: true, changed: 2, already: 0, noLink: ['Bulkquill One bg3'] });
    // The household with no link was not given one, and is not sent.
    expect((await mine([fresh[0]!]))[0]).toMatchObject({ link: 'none', sentAt: null });
    expect(await db.select().from(invitations).where(inArray(invitations.householdId, fresh))).toHaveLength(0);
    // Every other household in the database is exactly as it was: not sent.
    const others = (await db.select({ householdId: invitations.householdId, sentAt: invitations.sentAt }).from(invitations)).filter((i) => !ids.includes(i.householdId));
    expect(others.filter((i) => i.sentAt !== null && /bg3/.test(i.householdId))).toEqual([]);
    const [ruizLink] = await db.select().from(invitations).where(eq(invitations.householdId, f.households.ruiz));
    expect(await listAuditEvents(db, { action: 'invitation.issued', targetId: ruizLink!.id })).toEqual(expect.arrayContaining([expect.objectContaining({ metadata: expect.objectContaining({ markedSent: true, bulk: true }) })]));
    // Again: already so.
    expect(expectOk(await call<{ changed: number; already: number }>('admin_mark_households_sent', { householdIds: ids, sent: true }, { cookie: admin.cookie })).data).toMatchObject({ changed: 0, already: 2 });
    // And undone, for one of them only.
    expect(expectOk(await call<{ changed: number }>('admin_mark_households_sent', { householdIds: [f.households.ruiz], sent: false }, { cookie: admin.cookie })).data.changed).toBe(1);
    expect((await mine([f.households.ruiz, f.households.okafor])).map((h) => h.sentAt !== null).sort()).toEqual([false, true]);
  });

  it('makes a link for each household that has none, shows each once, and leaves a household that has one alone', async () => {
    const { f, admin, db, fresh, mine } = await setUp('bg4');
    const [okaforBefore] = await db.select().from(invitations).where(eq(invitations.householdId, f.households.okafor));
    const r = expectOk(
      await call<{ links: { householdId: string; householdName: string; url: string; tokenPrefix: string; expiresAt: string }[]; hadLink: number }>(
        'admin_issue_invitations',
        { householdIds: [...fresh, f.households.okafor], eventKeys: ['ceremony', 'reception'], plusOneAllowance: 0, childrenAllowance: 0 },
        { cookie: admin.cookie },
      ),
    );
    expect(r.data.hadLink).toBe(1);
    expect(r.data.links.map((l) => l.householdName)).toEqual(['Bulkquill One bg4', 'Bulkquill Three bg4', 'Bulkquill Two bg4']);
    expect(new Set(r.data.links.map((l) => l.url)).size).toBe(3);
    for (const l of r.data.links) expect(l.url).toMatch(/^https?:\/\/.+\/i\/|^https?:\/\/.+/);
    // Okafor's own link is the same link; the new ones work, cover the events asked for, and are NOT marked as sent.
    expect((await db.select().from(invitations).where(eq(invitations.householdId, f.households.okafor))).map((i) => i.id)).toEqual([okaforBefore!.id]);
    const made = await db.select().from(invitations).where(inArray(invitations.householdId, fresh));
    expect(made).toHaveLength(3);
    expect(made.every((i) => i.sentAt === null && i.status === 'issued' && i.eventKeys.join() === 'ceremony,reception')).toBe(true);
    expect((await mine(fresh)).map((h) => h.link)).toEqual(['active', 'active', 'active']);
    // The tokens are stored nowhere: only their hashes.
    for (const l of r.data.links) expect(JSON.stringify(made)).not.toContain(l.url.split('/').pop()!);
    // Asked again, there is nothing to make.
    const again = expectOk(await call<{ links: unknown[]; hadLink: number }>('admin_issue_invitations', { householdIds: fresh }, { cookie: admin.cookie }));
    expect(again.data).toEqual({ links: [], hadLink: 3 });
  });

  it('is for administrators only, and refuses an empty or oversized group', async () => {
    const { f, admin, fresh } = await setUp('bg5');
    const ana = await claim(f.invitations.ruiz.token, f.guests.ana, f.emails.ana);
    for (const [name, input] of [
      ['admin_list_invitation_households', {}],
      ['admin_set_bulk_group', { householdIds: fresh, inGroup: true }],
      ['admin_mark_households_sent', { householdIds: fresh, sent: true }],
      ['admin_issue_invitations', { householdIds: fresh }],
    ] as const) {
      expectErr(await call(name, input, { cookie: ana.cookie }), 'forbidden');
      expectErr(await call(name, input), 'unauthenticated');
    }
    expectErr(await call('admin_mark_households_sent', { householdIds: [], sent: true }, { cookie: admin.cookie }), 'validation');
    expectErr(await call('admin_set_bulk_group', { householdIds: Array.from({ length: 1001 }, (_v, i) => `h${i}`), inGroup: true }, { cookie: admin.cookie }), 'validation');
    // Nothing a guest tried reached the database.
    const db = await getDb();
    expect((await db.select({ inGroup: households.inBulkGroup }).from(households).where(inArray(households.id, fresh))).every((h) => !h.inGroup)).toBe(true);
    expect(await db.select().from(guests).where(inArray(guests.householdId, fresh))).toHaveLength(3);
  });
});
