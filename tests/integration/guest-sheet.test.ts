import { describe, expect, it } from 'vitest';
import { adminAddHouseholdFromSheet, adminGuestSheet, adminGuestSheetSync, adminLinkSheetLine, adminUploadGuestSheet } from '@/capabilities/admin_guest_sheet';
import type { AdminId, AuthIdentityId } from '@/contracts/ids';
import type { AdminPrincipal, Principal } from '@/contracts/principal';
import { getDb } from '@/db/client';
import { eq } from 'drizzle-orm';
import { guestSheetCopies, guests, households } from '@/db/schema';
import { expectErr, expectOk, run } from './helpers/swarm-e';

const admin = (entitlements: string[] = ['admin_guest_ops']): AdminPrincipal => ({
  kind: 'admin',
  authIdentityId: 'A' as AuthIdentityId,
  adminId: 'AD-SHEET' as AdminId,
  roles: new Set(['owner']),
  entitlements: new Set(entitlements as never),
  authenticatedAt: new Date().toISOString(),
  sessionId: 'sheet-session',
});

// The Guests tab as it is copied out of Google Sheets: tab-separated, the names under a header that
// is not a name ("roung"), contact columns beside the planning ones, and tallies below a blank row.
const TAB = [
  ['roung', 'Total Adults', 'Total Kids', 'Plus 1', 'Guest Of', 'Group', 'Priority', 'Address street', 'City', 'State', 'Zip', 'Email', 'Phone', 'Save the Date Sent', 'Invite Sent', 'RSVP', 'Table Number', 'Menu Choice', 'Dietary Restrictions', 'Notes'],
  ['Test household A', '2', '', '', 'Bride', 'Friend', '1', '1 Test St', 'Testville', 'IL', '60000', 'a@example.test', '555-0100', 'Yes', '', '', '', '', 'Peanuts', 'Secret note'],
  ['Test household B', '1', '2', 'Yes', 'Groom', 'Work', '2', '2 Test St', 'Testville', 'IL', '60000', 'b@example.test', '555-0101', '', '', '', '', '', '', ''],
  [],
  ['', '', '', '', '', '', '53760'],
]
  .map((r) => r.join('\t'))
  .join('\n');

const copies = async () => (await getDb()).select().from(guestSheetCopies);

describe('the planning sheet copy', () => {
  it('is for administrators with guest operations only, and never offered to the concierge or WebMCP', async () => {
    expect(expectErr(await run(adminGuestSheet, admin(['admin_content']), {})).code).toBe('forbidden');
    expect(expectErr(await run(adminUploadGuestSheet, admin(['admin_content']), { text: TAB })).code).toBe('forbidden');
    expect(['forbidden', 'unauthenticated']).toContain(expectErr(await run(adminGuestSheet, { kind: 'anonymous' } as Principal, {})).code);
    expect(adminGuestSheet.exposure).toEqual({ ui: true, ai: false, webmcp: false });
    expect(adminUploadGuestSheet.exposure).toEqual({ ui: true, ai: false, webmcp: false });
  });

  it('checks a pasted tab without saving it, then saves only the planning columns and shows the newest copy', async () => {
    const before = (await copies()).length;
    const dry = expectOk(await run(adminUploadGuestSheet, admin(), { text: TAB, source: 'Guests tab', dryRun: true })).data;
    expect(dry).toMatchObject({ dryRun: true, lines: 2, people: 6 });
    expect(dry.withheldColumns).toEqual(['Address street', 'City', 'State', 'Zip', 'Email', 'Phone', 'Dietary Restrictions', 'Notes']);
    expect((await copies()).length).toBe(before);

    expectOk(await run(adminUploadGuestSheet, admin(), { text: TAB, source: 'Guests tab' }));
    const stored = await copies();
    expect(stored.length).toBe(before + 1);
    // Nothing personal was kept: no address, email, phone, dietary need or note.
    expect(JSON.stringify(stored)).not.toMatch(/Test St|Testville|60000|example\.test|555-01|Peanuts|Secret note/);

    const view = expectOk(await run(adminGuestSheet, admin(), {})).data;
    expect(view.copy?.source).toBe('Guests tab');
    expect(view.copy?.rows.map((r) => r.name)).toEqual(['Test household A', 'Test household B']);
    expect(view.copy?.totals).toMatchObject({ households: 2, adults: 3, kids: 2, plusOnes: 1, people: 6 });
  });

  it('refuses a paste with no guest lines in it', async () => {
    expect(expectErr(await run(adminUploadGuestSheet, admin(), { text: 'roung\tTotal Adults\n' })).code).toBe('validation');
  });
});

describe('the planning sheet against the guest list', () => {
  const sync = async () => expectOk(await run(adminGuestSheetSync, admin(), {})).data;

  it('needs the guest entitlement and is never offered to the concierge or WebMCP', async () => {
    for (const cap of [adminGuestSheetSync, adminLinkSheetLine, adminAddHouseholdFromSheet]) expect(cap.exposure).toEqual({ ui: true, ai: false, webmcp: false });
    expect(expectErr(await run(adminGuestSheetSync, admin(['admin_content']), {})).code).toBe('forbidden');
    expect(expectErr(await run(adminLinkSheetLine, admin(['admin_content']), { householdId: 'x', label: 'y' })).code).toBe('forbidden');
    expect(expectErr(await run(adminAddHouseholdFromSheet, admin(['admin_content']), { label: 'y' })).code).toBe('forbidden');
  });

  it('a dry run says what the copy changes and how it stands against the site, and saves nothing', async () => {
    expectOk(await run(adminUploadGuestSheet, admin(), { text: TAB, source: 'Guests tab' }));
    const next = TAB.replace('Test household B\t1\t2', 'Test household B\t2\t2').replace('\n\n', '\nTest household C\t3\n\n');
    const before = (await copies()).length;
    const dry = expectOk(await run(adminUploadGuestSheet, admin(), { text: next, dryRun: true })).data;
    expect((await copies()).length).toBe(before);
    expect(dry.changes).toEqual({
      added: [{ label: 'Test household C', people: 3 }],
      removed: [],
      changed: [{ label: 'Test household B', before: { adults: 1, kids: 2, plusOnes: 1 }, after: { adults: 2, kids: 2, plusOnes: 1 } }],
    });
    expect(dry.site).toMatchObject({ lines: 3, matched: 0, onlyOnSheet: 3 });
  });

  it('adds a line as an empty, linked household once, and then matches it', async () => {
    expectOk(await run(adminUploadGuestSheet, admin(), { text: TAB, source: 'Guests tab' }));
    expect((await sync()).onlyOnSheet.map((l) => l.label)).toEqual(expect.arrayContaining(['Test household A', 'Test household B']));

    const made = expectOk(await run(adminAddHouseholdFromSheet, admin(), { label: 'Test household A' })).data;
    expect(made).toMatchObject({ name: 'Test household A', created: true });
    // Asked again, it finds the household it made instead of making a second.
    expect(expectOk(await run(adminAddHouseholdFromSheet, admin(), { label: 'test household a' })).data).toMatchObject({ householdId: made.householdId, created: false });
    const db = await getDb();
    expect(await db.select().from(guests).where(eq(guests.householdId, made.householdId))).toEqual([]);

    const after = await sync();
    const match = after.matched.find((m) => m.household.id === made.householdId)!;
    // The sheet says two adults; the new household has nobody in it yet, and the screen says so.
    expect(match).toMatchObject({ label: 'Test household A', how: 'linked', differs: true, sheet: { adults: 2 }, site: { adults: 0 } });
    expect(after.onlyOnSheet.map((l) => l.label)).not.toContain('Test household A');
  });

  it('links a line to a household with another name, keeps one household per line, and unlinks', async () => {
    expectOk(await run(adminUploadGuestSheet, admin(), { text: TAB, source: 'Guests tab' }));
    const db = await getDb();
    const [one] = await db.insert(households).values({ id: 'HH-SHEET-1', name: 'The Bee Family' }).returning();
    await db.insert(households).values({ id: 'HH-SHEET-2', name: 'Someone Else' });

    expectOk(await run(adminLinkSheetLine, admin(), { householdId: one!.id, label: 'Test household B' }));
    expect((await sync()).matched.find((m) => m.household.id === one!.id)).toMatchObject({ label: 'Test household B', how: 'linked' });
    // A second household cannot claim the same line.
    expect(expectErr(await run(adminLinkSheetLine, admin(), { householdId: 'HH-SHEET-2', label: 'test household b' })).code).toBe('conflict');
    expect(expectErr(await run(adminLinkSheetLine, admin(), { householdId: 'HH-NOPE', label: 'Anything' })).code).toBe('not_found');

    expectOk(await run(adminLinkSheetLine, admin(), { householdId: one!.id, label: null }));
    const after = await sync();
    expect(after.matched.some((m) => m.household.id === one!.id)).toBe(false);
    expect(after.onlyOnSite.map((h) => h.id)).toEqual(expect.arrayContaining(['HH-SHEET-1', 'HH-SHEET-2']));
  });

  it('a line whose namesake household is already another line gets its own household', async () => {
    expectOk(await run(adminUploadGuestSheet, admin(), { text: TAB, source: 'Guests tab' }));
    const db = await getDb();
    // A household named like line A, but linked to line B.
    await db.insert(households).values({ id: 'HH-SHEET-3', name: 'Test household A', sheetLabel: 'Test household B' });
    expect((await sync()).onlyOnSheet.map((l) => l.label)).toContain('Test household A');

    const made = expectOk(await run(adminAddHouseholdFromSheet, admin(), { label: 'Test household A' })).data;
    expect(made.created).toBe(true);
    expect(made.householdId).not.toBe('HH-SHEET-3');
    const after = await sync();
    expect(after.onlyOnSheet.map((l) => l.label)).not.toContain('Test household A');
    expect(after.matched.find((m) => m.label === 'Test household A')).toMatchObject({ household: { id: made.householdId }, how: 'linked' });
  });
});
