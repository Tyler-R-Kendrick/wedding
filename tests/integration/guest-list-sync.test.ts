import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { guestAccessBindings, guestContacts, guestSheetCopies, guests, households, invitations, socialAuthReviews } from '@/db/schema';
import { applyGuestListUpload, readUpload, type GuestListUpload } from '@/db/seed/sync-guest-list';
import { ensurePlannerGuest, PLANNER_GUEST, plannerGuestStatus } from '@/domain/guests/planner-guest';
import { sealGuestList, sealKeyFromSecret } from '@/domain/guests/sealed-list';
import { sheetSyncLines, syncGuestsFromSheet } from '@/domain/guests/sheet-sync';
import { upsertGuest } from '@/domain/guests/repo';
import { upsertHousehold } from '@/domain/households/repo';
import { completeSocialSignIn, GUEST_SIGN_IN_FAIL_PATH } from '@/domain/identity/social/complete';
import { issueInvitation } from '@/domain/invitations/repo';
import { getAuditSink } from '@/lib/audit';
import type { CookieSink } from '@/lib/auth/cookies';

/**
 * A planning sheet shaped like the couple's, with invented names (and surnames no other test uses):
 * loaded into the guest records, loaded again, changed and loaded again; then signed in to, by
 * either person on a line, under the names people actually use online.
 */
const HEADER = ['roung', 'Total Adults', 'Total Kids', 'Plus 1', 'Guest Of', 'Group', 'Priority', 'Address street', 'City', 'State', 'Zip', 'Email', 'Phone', 'Save the Date Sent', 'Invite Sent', 'RSVP', 'Table Number', 'Menu Choice', 'Dietary Restrictions', 'Notes'];
const row = (name: string, adults: number | '', kids: number | '' = '', plus: number | '' = '', email = '') => [name, String(adults), String(kids), String(plus), 'Bride', 'Friend', '1', '1 Secret St', 'Hiddenville', 'IL', '60000', email, '555-0100', '', '', '', '', '', 'Peanuts', 'A private note'];
const tab = (rows: string[][]) => [HEADER, ...rows, [], ['', '', '', '', '', '', '53760']].map((r) => r.join('\t')).join('\n');

const SHEET = [
  row("Alma Quilljar and Jody O'Brennagh", 2),
  row('Bram and Nora Fitzquill', 2),
  row('Neal Kendquill and Tilly', 2, '', '', 'neal.k@example.test'),
  row('Sara Foxquill', 2, 2),
  row('Barton and Mara Barnquill', 2),
  row('Barton Barnquill and Corin Le Quillard', 2),
  row('Alex Fitzquill and Janet Marlowquill', 1, '', 1),
  row('Mick and Christa', 2),
  row('Edgarquill', 1, '', 1, 'edgarquill22@example.test'),
  row('Zeke Fitzquill and Lindy Fitz...', 2, 2, '', 'someone.else@example.test'),
];
const OURS = /quill|brennagh|^Mick$|^Christa$|^Tilly$/i;

const db = () => getDb();
const ourGuests = async () => (await (await db()).select().from(guests).where(isNull(guests.mergedIntoGuestId))).filter((g) => OURS.test(`${g.firstName} ${g.lastName}`) || /^Guest$/.test(g.firstName));
const guestNamed = async (first: string, last: string) => (await (await db()).select().from(guests).where(and(eq(guests.firstName, first), eq(guests.lastName, last), isNull(guests.mergedIntoGuestId))));
const householdOf = async (first: string, last: string) => {
  const [g] = await guestNamed(first, last);
  return (await (await db()).select().from(guests).where(and(eq(guests.householdId, g!.householdId), isNull(guests.mergedIntoGuestId))));
};
const sync = async (rows: string[][]) => syncGuestsFromSheet(await db(), sheetSyncLines(tab(rows)).lines);

/** The household's invitation, marked as sent: what makes its people able to sign in. */
async function markSent(first: string, last: string): Promise<void> {
  const d = await db();
  const [g] = await guestNamed(first, last);
  const issued = await issueInvitation(d, { householdId: g!.householdId, eventKeys: ['ceremony'], plusOneAllowance: 0, childrenAllowance: 0, issuedBy: { kind: 'system', component: 'test' }, requestId: 'req-sync-test', audit: await getAuditSink(), now: new Date() });
  if (!issued.ok) throw issued.error;
  await d.update(invitations).set({ sentAt: new Date() }).where(eq(invitations.id, issued.value.invitation.id));
}

let n = 0;
async function signIn(profile: { givenName?: string; familyName?: string; name?: string; email?: string; emailVerified?: boolean }, provider: 'google' | 'facebook' = 'google') {
  const sink: CookieSink = { setCookies: [] };
  const accountId = `acct-sync-${Date.now()}-${++n}`;
  const r = await completeSocialSignIn(await db(), sink, {
    provider,
    profile: { providerAccountId: accountId, ...profile },
    accessToken: 't',
    next: null,
    ipHash: 'iphash',
    requestId: `req-sync-${n}`,
    audit: await getAuditSink(),
  });
  return { r, sink, accountId };
}
const boundGuestOf = async (accountId: string) => {
  const d = await db();
  const rows = await d.select({ guestId: guestAccessBindings.guestId }).from(guestAccessBindings).where(isNull(guestAccessBindings.revokedAt));
  const reviewsFor = await d.select().from(socialAuthReviews).where(eq(socialAuthReviews.providerAccountId, accountId));
  return { bindings: rows, reviews: reviewsFor };
};

describe('loading the planning sheet into the guest records', () => {
  let first: Awaited<ReturnType<typeof sync>>;
  beforeAll(async () => {
    first = await sync(SHEET);
  });

  it('makes a household for each line and a guest of everyone a line names', async () => {
    expect(first).toMatchObject({ lines: 10, households: { created: 10, found: 0 }, skipped: [] });
    // 18 people are named; the heads only counted are guests of the first person on their line.
    expect(first.guests).toEqual({ created: 18, found: 0, completed: 0, unnamedCreated: 2 });
    const alma = await householdOf('Alma', 'Quilljar');
    expect(alma.map((g) => `${g.firstName} ${g.lastName}`).sort()).toEqual(['Alma Quilljar', "Jody O'Brennagh"]);
    expect((await householdOf('Bram', 'Fitzquill')).map((g) => g.firstName).sort()).toEqual(['Bram', 'Nora']);
    // "Neal Kendquill and Tilly": Tilly is a guest with no surname, never given her partner's.
    expect((await guestNamed('Tilly', ''))).toHaveLength(1);
    // "Sara Foxquill", 2 adults and 2 children: Sara, and one counted adult. Children are not made up.
    const sara = await householdOf('Sara', 'Foxquill');
    expect(sara.map((g) => [g.firstName, g.kind, g.isNamed])).toEqual(expect.arrayContaining([['Sara', 'adult', true], ['Guest', 'plus_one', false]]));
    expect(sara).toHaveLength(2);
    // A second name on a line with one adult and a plus-one is that plus-one, by name.
    const [janet] = await guestNamed('Janet', 'Marlowquill');
    expect(janet).toMatchObject({ kind: 'plus_one', isNamed: true });
    // A surname the sheet cut short is completed from the line.
    expect(await guestNamed('Lindy', 'Fitzquill')).toHaveLength(1);
  });

  it('keeps two people of one name in their own households', async () => {
    const bartons = await guestNamed('Barton', 'Barnquill');
    expect(bartons).toHaveLength(2);
    expect(new Set(bartons.map((b) => b.householdId)).size).toBe(2);
    const withMara = await householdOf('Mara', 'Barnquill');
    const withCorin = await householdOf('Corin', 'Le Quillard');
    expect(withMara.map((g) => g.firstName).sort()).toEqual(['Barton', 'Mara']);
    expect(withCorin.map((g) => g.firstName).sort()).toEqual(['Barton', 'Corin']);
  });

  it('gives each household someone to answer for it, and each email to the person it is plainly for', async () => {
    const d = await db();
    const [neal] = await guestNamed('Neal', 'Kendquill');
    const [home] = await d.select().from(households).where(eq(households.id, neal!.householdId));
    expect(home).toMatchObject({ name: 'Neal Kendquill and Tilly', managerGuestId: neal!.id });
    // "neal.k@" is Neal's, not Tilly's; a lone person's address is theirs.
    expect(neal!.email).toBe('neal.k@example.test');
    expect((await guestNamed('Tilly', ''))[0]!.email).toBeNull();
    expect((await guestNamed('Edgarquill', ''))[0]!.email).toBe('edgarquill22@example.test');
    // An address that could be either person's on a couple's line is nobody's.
    expect((await guestNamed('Zeke', 'Fitzquill'))[0]!.email).toBeNull();
    expect((await guestNamed('Lindy', 'Fitzquill'))[0]!.email).toBeNull();
    expect(first.emailsAdded).toBe(2);
    // Nothing else of the tab reached the guest records: no phone, no address, no notes.
    const ours = await ourGuests();
    expect(ours.every((g) => g.phone === null && g.notes === null)).toBe(true);
    const homes = await d.select().from(households).where(inArray(households.id, [...new Set(ours.map((g) => g.householdId))]));
    expect(homes.every((h) => h.mailingAddress === null && h.notes === null)).toBe(true);
    const contacts = await d.select().from(guestContacts).where(inArray(guestContacts.guestId, ours.map((g) => g.id)));
    expect(contacts.map((c) => c.kind)).toEqual(['email', 'email']);
  });

  it('says which lines cannot be found by name, in counts', () => {
    expect(first.notes).toEqual({ no_surname: 2 });
  });

  it('S-28: changes nothing when the same sheet is loaded again', async () => {
    const before = (await ourGuests()).map((g) => `${g.id}|${g.firstName}|${g.lastName}|${g.householdId}|${g.email}`).sort();
    const again = await sync(SHEET);
    expect(again).toMatchObject({ households: { created: 0, found: 10 }, guests: { created: 0, found: 18, completed: 0, unnamedCreated: 0 }, emailsAdded: 0 });
    expect((await ourGuests()).map((g) => `${g.id}|${g.firstName}|${g.lastName}|${g.householdId}|${g.email}`).sort()).toEqual(before);
  });

  it('picks up what the sheet has since filled in, without making anyone twice', async () => {
    const [tillyBefore] = await guestNamed('Tilly', '');
    const [countedBefore] = (await householdOf('Sara', 'Foxquill')).filter((g) => !g.isNamed);
    const changed = SHEET.map((r) => {
      if (r[0] === 'Neal Kendquill and Tilly') return row('Neal and Tilly Kendquill', 2, '', '', 'neal.k@example.test');
      if (r[0] === 'Sara Foxquill') return row('Sara and Tom Foxquill', 2, 2);
      return r;
    });
    const r = await sync(changed);
    // Tilly has her surname now; Tom is the head that was only counted. Same records, completed.
    expect(r.guests).toMatchObject({ created: 0, completed: 2, unnamedCreated: 0 });
    expect(r.households).toEqual({ created: 0, found: 10 });
    const [tilly] = await guestNamed('Tilly', 'Kendquill');
    expect(tilly!.id).toBe(tillyBefore!.id);
    const [tom] = await guestNamed('Tom', 'Foxquill');
    expect(tom).toMatchObject({ id: countedBefore!.id, isNamed: true });
    expect(await householdOf('Sara', 'Foxquill')).toHaveLength(2);
  });

  it('finds people the couple already added by hand, under whatever the household is called', async () => {
    const d = await db();
    const home = await upsertHousehold(d, { name: 'The Handquill Family' });
    if (!home.ok) throw home.error;
    const pat = await upsertGuest(d, { householdId: home.value.id, firstName: 'Pat', lastName: 'Handquill', email: 'pat.handquill@example.test' });
    const lou = await upsertGuest(d, { householdId: home.value.id, firstName: 'Lou', lastName: 'Handquill' });
    if (!pat.ok || !lou.ok) throw new Error('guests');
    const r = await syncGuestsFromSheet(d, sheetSyncLines(tab([row('Pat and Lou Handquill', 2, '', '', 'other.address@example.test')])).lines);
    expect(r).toMatchObject({ households: { created: 0, found: 1 }, guests: { created: 0, found: 2, completed: 0, unnamedCreated: 0 }, emailsAdded: 0 });
    // Nothing of theirs was touched: the household's name, the address they already had.
    expect((await d.select().from(households).where(eq(households.id, home.value.id)))[0]!.name).toBe('The Handquill Family');
    expect((await guestNamed('Pat', 'Handquill'))[0]).toMatchObject({ id: pat.value.id, email: 'pat.handquill@example.test' });
    expect(await guestNamed('Lou', 'Handquill')).toHaveLength(1);
  });

  it('S-28: leaves alone anyone who is not on the sheet', async () => {
    const d = await db();
    const home = await upsertHousehold(d, { name: 'Wedding planner (test)' });
    if (!home.ok) throw home.error;
    const her = await upsertGuest(d, { householdId: home.value.id, firstName: 'Mirelle Elaine', lastName: 'Sunderquill', alternateNames: ['Bustle & Quill'] });
    if (!her.ok) throw her.error;
    await sync(SHEET);
    const [after] = await d.select().from(guests).where(eq(guests.id, her.value.id));
    expect(after).toMatchObject({ firstName: 'Mirelle Elaine', lastName: 'Sunderquill', alternateNames: ['Bustle & Quill'], householdId: home.value.id, mergedIntoGuestId: null });
  });

  it('skips a line whose people two existing guests already answer to, and says so', async () => {
    const d = await db();
    for (const name of ['One', 'Two']) {
      const home = await upsertHousehold(d, { name: `Twinquill ${name}` });
      if (!home.ok) throw home.error;
      const g = await upsertGuest(d, { householdId: home.value.id, firstName: 'Tam', lastName: 'Twinquill' });
      if (!g.ok) throw g.error;
    }
    const r = await syncGuestsFromSheet(d, sheetSyncLines(tab([row('Tam Twinquill', 1)])).lines);
    expect(r.skipped).toEqual([{ sheetRow: 2, reason: 'ambiguous_existing' }]);
    expect(await guestNamed('Tam', 'Twinquill')).toHaveLength(2);
  });
});

describe('the sealed upload a deploy loads', () => {
  const SECRET = 'an-integration-test-secret-0123456789';
  const upload = (rows: string[][]): GuestListUpload => ({ v: 1, readAt: '2026-11-16T00:00:00.000Z', source: 'Test sheet, Guests tab', text: tab(rows) });
  const copies = async () => (await db()).select().from(guestSheetCopies);

  it('opens with the deployment’s secret, and with no other', () => {
    const sealed = JSON.stringify(sealGuestList(JSON.stringify(upload(SHEET)), sealKeyFromSecret(SECRET).publicKey));
    expect(sealed).not.toMatch(/quill|example\.test/i);
    const read = readUpload(sealed, SECRET);
    expect(read.ok && read.upload.source).toBe('Test sheet, Guests tab');
    expect(readUpload(sealed, 'a-different-secret-of-good-length')).toEqual({ ok: false, status: 'other_key' });
    expect(readUpload('not json', SECRET)).toEqual({ ok: false, status: 'not_sealed' });
    expect(readUpload(JSON.stringify(sealGuestList('not an upload', sealKeyFromSecret(SECRET).publicKey)), SECRET)).toEqual({ ok: false, status: 'unreadable' });
  });

  it('saves the sheet as the newest copy once, with no contact detail in it, and syncs the guests', async () => {
    const rows = [row('Copy Copyquill and Carbon Paperquill', 2, '', '', 'copyquill@example.test')];
    const before = (await copies()).length;
    const one = await applyGuestListUpload(await db(), upload(rows));
    expect(one, JSON.stringify(one)).toMatchObject({ status: 'synced', lines: 1, copySaved: true, result: { guests: { created: 2 }, emailsAdded: 1 } });
    const all = await copies();
    expect(all).toHaveLength(before + 1);
    const newest = all.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())[0]!;
    expect(newest).toMatchObject({ source: 'Test sheet, Guests tab', uploadedBy: null });
    expect(JSON.stringify(newest.rows)).not.toMatch(/example\.test|Secret St|555-0100|Peanuts|private note/);
    // The same list on the next deploy saves no second copy and makes nobody twice.
    const two = await applyGuestListUpload(await db(), upload(rows));
    expect(two).toMatchObject({ status: 'synced', copySaved: false, result: { guests: { created: 0, found: 2 } } });
    expect(await copies()).toHaveLength(before + 1);
    expect(await applyGuestListUpload(await db(), { ...upload([]), text: HEADER.join('\t') })).toEqual({ status: 'empty' });
  });

  it('S-26 S-28: keeps the wedding planner able to sign in as a guest, whatever an upload did, adding only what is missing', async () => {
    const d = await db();
    const audit = await getAuditSink();
    expect(await plannerGuestStatus(d)).toEqual({ records: 0, invitationSent: false, hasSignedIn: false });
    // Nothing of hers yet: a guest record, her other names, and an invitation marked as sent.
    const first = await ensurePlannerGuest(d, { audit });
    expect(first).toEqual({ records: 1, invitationSent: true, hasSignedIn: false, added: ['record', 'invitation'] });
    const [her] = await guestNamed(PLANNER_GUEST.firstName, PLANNER_GUEST.lastName);
    expect(her).toMatchObject({ kind: 'adult', isNamed: true, alternateNames: ['Bustle & Lace'], email: null, phone: null });
    // Again, and after an upload: nothing more is added, and she is the same record.
    expect(await ensurePlannerGuest(d, { audit })).toEqual({ records: 1, invitationSent: true, hasSignedIn: false, added: [] });
    await applyGuestListUpload(d, upload(SHEET));
    expect((await guestNamed(PLANNER_GUEST.firstName, PLANNER_GUEST.lastName)).map((g) => g.id)).toEqual([her!.id]);

    // She signs in with Google under the name she uses there...
    const google = await signIn({ givenName: 'Michelle', familyName: 'Sunder', name: 'Michelle Sunder' });
    expect(google.r.ok).toBe(true);
    expect(google.sink.setCookies.length).toBeGreaterThan(0);
    expect(await ensurePlannerGuest(d, { audit })).toEqual({ records: 1, invitationSent: true, hasSignedIn: true, added: [] });
    // ...and stays signed in to the same record on every later deploy.
    await applyGuestListUpload(d, upload(SHEET));
    expect(await plannerGuestStatus(d)).toEqual({ records: 1, invitationSent: true, hasSignedIn: true });
    await d.delete(guests).where(eq(guests.id, her!.id));
  });

  it('a record the couple made for her by hand is hers: completed, never duplicated or renamed', async () => {
    const d = await db();
    const audit = await getAuditSink();
    const home = await upsertHousehold(d, { name: 'Our planner' });
    if (!home.ok) throw home.error;
    const mine = await upsertGuest(d, { householdId: home.value.id, firstName: 'Michelle', lastName: 'Sunder', email: 'planner@example.test', alternateNames: ['Shell'] });
    if (!mine.ok) throw mine.error;
    expect(await ensurePlannerGuest(d, { audit })).toEqual({ records: 1, invitationSent: true, hasSignedIn: false, added: ['names', 'invitation'] });
    const [after] = await d.select().from(guests).where(eq(guests.id, mine.value.id));
    expect(after).toMatchObject({ firstName: 'Michelle', lastName: 'Sunder', email: 'planner@example.test', householdId: home.value.id, alternateNames: ['Shell', 'Bustle & Lace'] });
    // Her business's Facebook page signs her in too.
    const fb = await signIn({ name: 'Bustle & Lace' }, 'facebook');
    expect(fb.r.ok).toBe(true);
    // Two records of her are left for the couple: nothing is added to either.
    const twin = await upsertGuest(d, { householdId: home.value.id, firstName: 'Michelle E.', lastName: 'Sunder' });
    if (!twin.ok) throw twin.error;
    expect(await ensurePlannerGuest(d, { audit })).toMatchObject({ records: 2, added: [] });
    await d.delete(guests).where(inArray(guests.id, [mine.value.id, twin.value.id]));
  });
});

describe('signing in with Google or Facebook, by name, as either person on a line', () => {
  beforeAll(async () => {
    await sync([
      row("Ines Vantquill and Rory O'Dellquill", 2),
      row('Otto Marquill and Petra', 2),
      row('Gus and Wren Haloquill', 2),
      row('Uma Solquill', 1),
    ]);
    for (const [f, l] of [['Ines', 'Vantquill'], ['Otto', 'Marquill'], ['Gus', 'Haloquill']] as const) await markSent(f, l);
  });
  let before = 0;
  beforeEach(async () => {
    before = (await (await db()).select().from(socialAuthReviews)).length;
  });
  const whoIs = async (first: string, last: string) => {
    const [g] = await guestNamed(first, last);
    const bound = await (await db()).select().from(guestAccessBindings).where(and(eq(guestAccessBindings.guestId, g!.id), isNull(guestAccessBindings.revokedAt)));
    return bound.length;
  };

  it('S-18: under their partner’s surname (Facebook, given and family fields)', async () => {
    const { r, sink } = await signIn({ givenName: 'Ines', familyName: "O'Dellquill", name: "Ines O'Dellquill" }, 'facebook');
    expect(r.ok).toBe(true);
    expect(sink.setCookies.length).toBeGreaterThan(0);
    expect(await whoIs('Ines', 'Vantquill')).toBe(1);
    expect(await whoIs('Rory', "O'Dellquill")).toBe(0);
  });

  it('S-17 S-18: the other person on the line, under a hyphenated pair (Google, display name only)', async () => {
    const { r } = await signIn({ name: 'Rory Vantquill-O’Dellquill' });
    expect(r.ok).toBe(true);
    expect(await whoIs('Rory', "O'Dellquill")).toBe(1);
  });

  it('S-20: a partner the sheet lists by first name, through the household’s surname', async () => {
    const { r } = await signIn({ givenName: 'Petra', familyName: 'Marquill' });
    expect(r.ok).toBe(true);
    expect(await whoIs('Petra', '')).toBe(1);
    expect(await whoIs('Otto', 'Marquill')).toBe(0);
  });

  it('each of a couple under one surname is themselves, never the other', async () => {
    expect((await signIn({ name: 'Wren Haloquill' })).r.ok).toBe(true);
    expect(await whoIs('Wren', 'Haloquill')).toBe(1);
    expect(await whoIs('Gus', 'Haloquill')).toBe(0);
    expect((await signIn({ name: 'Gus Haloquill' })).r.ok).toBe(true);
    expect(await whoIs('Gus', 'Haloquill')).toBe(1);
  });

  it('a name from another household, a first name alone, or a stranger signs in nobody and is told nothing', async () => {
    for (const profile of [{ name: 'Ines Haloquill' }, { name: 'Petra' }, { givenName: 'Petra', familyName: 'Somebodyelse' }, { name: 'Nobody Atall' }]) {
      const { r, sink } = await signIn(profile);
      expect(r, JSON.stringify(profile)).toEqual({ ok: false, redirectTo: GUEST_SIGN_IN_FAIL_PATH });
      expect(sink.setCookies).toHaveLength(0);
    }
    // Each is kept for the couple to look at.
    expect((await (await db()).select().from(socialAuthReviews)).length).toBe(before + 4);
  });

  it('someone whose save-the-date has not gone out is not signed in, whichever name they use', async () => {
    const { r, sink, accountId } = await signIn({ name: 'Uma Solquill' });
    expect(r).toEqual({ ok: false, redirectTo: GUEST_SIGN_IN_FAIL_PATH });
    expect(sink.setCookies).toHaveLength(0);
    expect((await boundGuestOf(accountId)).reviews.map((x) => x.reason)).toEqual(['not_sent']);
  });
});
