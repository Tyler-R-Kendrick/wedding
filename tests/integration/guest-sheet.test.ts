import { describe, expect, it } from 'vitest';
import { adminGuestSheet, adminUploadGuestSheet } from '@/capabilities/admin_guest_sheet';
import type { AdminId, AuthIdentityId } from '@/contracts/ids';
import type { AdminPrincipal, Principal } from '@/contracts/principal';
import { getDb } from '@/db/client';
import { guestSheetCopies } from '@/db/schema';
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
