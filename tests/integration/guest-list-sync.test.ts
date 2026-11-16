import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { guestAccessBindings, guestContacts, guestSheetCopies, guests, households, invitations, socialAuthReviews } from '@/db/schema';
import { applyGuestListUpload, readUpload, type GuestListUpload } from '@/db/seed/sync-guest-list';
import { PLANNER_GUEST, plannerGuestStatus } from '@/domain/guests/planner-guest';
import { sealGuestList, sealKeyFromSecret } from '@/domain/guests/sealed-list';
import { sheetSyncLines, syncGuestsFromSheet, textForSealing } from '@/domain/guests/sheet-sync';
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

  it('S-28: is applied once: a later deploy with the same upload leaves alone whatever the couple did since', async () => {
    const d = await db();
    const rows = [row('Copy Copyquill and Carbon Paperquill', 2, '', '', 'copy.c@example.test')];
    const before = (await copies()).length;
    const mine = { ...upload(rows), readAt: new Date(Date.now() + 60_000).toISOString() };
    const one = await applyGuestListUpload(d, mine);
    expect(one, JSON.stringify(one)).toMatchObject({ status: 'synced', lines: 1, result: { guests: { created: 2 }, emailsAdded: 1 } });
    const all = await copies();
    expect(all).toHaveLength(before + 1);
    const newest = all.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())[0]!;
    expect(newest).toMatchObject({ source: 'Test sheet, Guests tab', uploadedBy: null });
    expect(newest.uploadDigest).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(newest.rows)).not.toMatch(/example\.test|Secret St|555-0100|Peanuts|private note/);
    // The couple take someone off the list. The sealed file is still in the repository, and the next deploy reads it again.
    const [carbon] = await guestNamed('Carbon', 'Paperquill');
    await d.delete(guests).where(eq(guests.id, carbon!.id));
    expect(await applyGuestListUpload(d, mine)).toEqual({ status: 'already_applied', lines: 1 });
    expect(await guestNamed('Carbon', 'Paperquill')).toHaveLength(0);
    expect(await copies()).toHaveLength(before + 1);
    expect(await applyGuestListUpload(d, { ...upload([]), text: HEADER.join('\t') })).toEqual({ status: 'empty' });
  });

  it('S-28: an upload read before the newest copy the site holds is not applied over it', async () => {
    const d = await db();
    const before = (await copies()).length;
    // The newest copy here was saved a moment ago; this upload was read from the sheet last month, or does not say when.
    const stale = { ...upload([row('Stale Stalequill', 1)]), readAt: '2026-10-01T00:00:00.000Z' };
    expect(await applyGuestListUpload(d, stale)).toEqual({ status: 'older_than_site', lines: 1 });
    expect(await applyGuestListUpload(d, { ...stale, readAt: '' })).toEqual({ status: 'older_than_site', lines: 1 });
    expect(await guestNamed('Stale', 'Stalequill')).toHaveLength(0);
    expect(await copies()).toHaveLength(before);
  });

  it('S-28: uploads apply in the order the sheet was read, whatever order they deploy in', async () => {
    const d = await db();
    const day = 24 * 60 * 60_000;
    const T = Date.now() + day; // well clear of every other copy in this database
    const at = (ms: number) => new Date(T + ms);
    const first = { ...upload([row('Order Firstquill', 1)]), readAt: at(0).toISOString() };
    const second = { ...upload([row('Order Firstquill', 1), row('Order Secondquill', 1)]), readAt: at(5 * 60_000).toISOString() };
    const earlier = { ...upload([row('Order Zeroquill', 1)]), readAt: at(-60_000).toISOString() };
    // The first is sealed at T and deploys ten minutes later; the second is read five minutes after the first, and deploys after it.
    expect((await applyGuestListUpload(d, first, at(10 * 60_000))).status).toBe('synced');
    expect((await applyGuestListUpload(d, second, at(20 * 60_000))).status).toBe('synced');
    expect(await guestNamed('Order', 'Secondquill')).toHaveLength(1);
    // One read before the newest copy was read is not laid over it, however late it deploys.
    expect(await applyGuestListUpload(d, earlier, at(30 * 60_000))).toEqual({ status: 'older_than_site', lines: 1 });
    expect(await guestNamed('Order', 'Zeroquill')).toHaveLength(0);
    // The copies are dated by when the sheet was read, not by when the deploy ran.
    const mine = (await copies()).filter((c) => c.uploadedAt.getTime() >= T - day / 2);
    expect(mine.map((c) => c.uploadedAt.getTime()).sort()).toEqual([at(0).getTime(), at(5 * 60_000).getTime()]);
    // The marker is unique: a second copy under one upload's digest cannot be saved.
    await expect(d.insert(guestSheetCopies).values({ id: 'dup-digest', rows: [], uploadDigest: mine[0]!.uploadDigest })).rejects.toThrow();
    await d.delete(guestSheetCopies).where(inArray(guestSheetCopies.id, mine.map((c) => c.id)));
  });

  it('seals only what the site reads: no address, phone, dietary need or note is in the upload at all', () => {
    const text = textForSealing(tab(SHEET));
    expect(text).not.toMatch(/Secret St|Hiddenville|60000|555-0100|Peanuts|private note|53760/);
    // The names, the counts, the planning columns and the email are; and the header still names every column.
    expect(text).toMatch(/neal\.k@example\.test/);
    expect(text.split('\n')[0]!.split('\t')).toEqual(HEADER);
    expect(text.split('\n')).toHaveLength(SHEET.length + 1);
    const a = sheetSyncLines(tab(SHEET));
    const b = sheetSyncLines(text);
    expect(b.lines).toEqual(a.lines);
    expect(b.parse).toEqual(a.parse);
    // Tallies straight under the list, with no blank line between, are not part of it either.
    const tallies = [HEADER, ...SHEET, ['', '', '', '', '', '', '', '', '', '', '', 'Adults', 'Kids'], ['', '', '', '', '', '', '53760', '', '', '', '1s', '28', '6']].map((r) => r.join('\t')).join('\n');
    expect(textForSealing(tallies)).toBe(text);
    // A CSV export comes out the same.
    const csv = [HEADER, ...SHEET].map((r) => r.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
    expect(sheetSyncLines(textForSealing(csv)).lines).toEqual(a.lines);
  });

  it('S-26 S-28: the wedding planner’s guest sign-in is the couple’s to make, is never touched by an upload, and is reported', async () => {
    const d = await db();
    // Nothing is made for her: her name is on the public site, and a record made here with its invitation
    // marked sent would let anyone who read that page sign in under it.
    expect(await plannerGuestStatus(d)).toEqual({ records: 0, invitationSent: false, hasSignedIn: false });
    await applyGuestListUpload(d, { ...upload(SHEET), readAt: new Date(Date.now() + 120_000).toISOString() });
    expect(await plannerGuestStatus(d)).toEqual({ records: 0, invitationSent: false, hasSignedIn: false });
    expect((await signIn({ name: 'Michelle Sunder' })).r).toEqual({ ok: false, redirectTo: GUEST_SIGN_IN_FAIL_PATH });

    // The couple add her (/admin/guests) and send her invitation.
    const home = await upsertHousehold(d, { name: 'Our planner' });
    if (!home.ok) throw home.error;
    const her = await upsertGuest(d, { householdId: home.value.id, firstName: PLANNER_GUEST.firstName, lastName: PLANNER_GUEST.lastName, alternateNames: ['Bustle & Lace'] });
    if (!her.ok) throw her.error;
    expect(await plannerGuestStatus(d)).toEqual({ records: 1, invitationSent: false, hasSignedIn: false });
    await markSent(PLANNER_GUEST.firstName, PLANNER_GUEST.lastName);
    expect(await plannerGuestStatus(d)).toEqual({ records: 1, invitationSent: true, hasSignedIn: false });

    // An upload of the sheet she is not on leaves her exactly as she is.
    const again = await applyGuestListUpload(d, { ...upload(SHEET), readAt: new Date(Date.now() + 180_000).toISOString() });
    expect(again.status).toBe('synced');
    const [after] = await d.select().from(guests).where(eq(guests.id, her.value.id));
    expect(after).toMatchObject({ firstName: 'Michelle Elaine', lastName: 'Sunder', alternateNames: ['Bustle & Lace'], householdId: home.value.id, mergedIntoGuestId: null });
    expect(await plannerGuestStatus(d)).toEqual({ records: 1, invitationSent: true, hasSignedIn: false });

    // She signs in with Google under the name she uses there, and stays signed in to the same record after another upload.
    const google = await signIn({ givenName: 'Michelle', familyName: 'Sunder', name: 'Michelle Sunder' });
    expect(google.r.ok).toBe(true);
    expect(google.sink.setCookies.length).toBeGreaterThan(0);
    await applyGuestListUpload(d, { ...upload(SHEET), readAt: new Date(Date.now() + 240_000).toISOString() });
    expect(await plannerGuestStatus(d)).toEqual({ records: 1, invitationSent: true, hasSignedIn: true });

    // A second record of her is said, not sorted out: which is hers is the couple's to say.
    const twin = await upsertGuest(d, { householdId: home.value.id, firstName: 'Michelle E.', lastName: 'Sunder' });
    if (!twin.ok) throw twin.error;
    expect(await plannerGuestStatus(d)).toMatchObject({ records: 2 });
    await d.delete(guests).where(inArray(guests.id, [her.value.id, twin.value.id]));
  });

  it('S-26: her business’s page, once the couple have put that name on her record, signs her in too', async () => {
    const d = await db();
    const home = await upsertHousehold(d, { name: 'Our planner, again' });
    if (!home.ok) throw home.error;
    const her = await upsertGuest(d, { householdId: home.value.id, firstName: 'Michelle', lastName: 'Sunder', email: 'planner@example.test', alternateNames: ['Bustle & Lace'] });
    if (!her.ok) throw her.error;
    await markSent('Michelle', 'Sunder');
    const fb = await signIn({ name: 'Bustle & Lace' }, 'facebook');
    expect(fb.r.ok).toBe(true);
    await d.delete(guests).where(eq(guests.id, her.value.id));
  });
});

describe('what the couple changed by hand is not undone by the next load of the sheet', () => {
  const load = async (rows: string[][]) => syncGuestsFromSheet(await db(), sheetSyncLines(tab(rows)).lines);
  const all = async (re: RegExp) => (await (await db()).select().from(guests)).filter((g) => re.test(`${g.firstName} ${g.lastName}`));

  it('a corrected spelling stands: nobody is made again under the sheet’s spelling, and no counted head is renamed', async () => {
    const d = await db();
    const sheet = [row('Jon Fixquill', 2), row('Kristofer and Amy Mendquill', 2)];
    await load(sheet);
    const [jon] = await guestNamed('Jon', 'Fixquill');
    const [kris] = await guestNamed('Kristofer', 'Mendquill');
    await upsertGuest(d, { id: jon!.id, householdId: jon!.householdId, firstName: 'John' });
    await upsertGuest(d, { id: kris!.id, householdId: kris!.householdId, firstName: 'Christopher', lastName: 'Mendquill-Hale' });
    const r = await load(sheet);
    // "Jon" corrected to "John" is plainly the same person, and John he stays.
    const fix = await all(/Fixquill/);
    expect(fix.filter((g) => g.isNamed).map((g) => g.firstName)).toEqual(['John']);
    const household = (await d.select().from(guests).where(eq(guests.householdId, jon!.householdId)));
    expect(household.map((g) => [g.firstName, g.isNamed]).sort()).toEqual([['Guest', false], ['John', true]]);
    // "Kristofer Mendquill" rewritten as "Christopher Mendquill-Hale" is not plainly anyone: it could as
    // well be a new person on the line. A load cannot tell, so it adds the sheet's person and says so in
    // its counts; two records the couple can see and merge are better than a guest silently left out.
    expect(r.guests).toEqual({ created: 1, found: 2, completed: 0, unnamedCreated: 0 });
    expect((await all(/Mendquill/)).filter((g) => g.isNamed).map((g) => g.firstName).sort()).toEqual(['Amy', 'Christopher', 'Kristofer']);
  });

  it('a name on the line is never taken for a different person who is here', async () => {
    const d = await db();
    const home = await upsertHousehold(d, { name: 'Jon and Jan Pairquill' });
    if (!home.ok) throw home.error;
    const jan = await upsertGuest(d, { householdId: home.value.id, firstName: 'Jan', lastName: 'Pairquill' });
    if (!jan.ok) throw jan.error;
    const r = await load([row('Jon and Jan Pairquill', 2)]);
    expect(r.guests).toMatchObject({ created: 1, found: 1 });
    expect((await all(/Pairquill/)).map((g) => g.firstName).sort()).toEqual(['Jan', 'Jon']);
    expect((await guestNamed('Jan', 'Pairquill'))[0]!.id).toBe(jan.value.id);
  });

  it('a head the sheet now names takes only a counted plus-one of someone on its line: never a child, never another guest’s plus-one', async () => {
    const d = await db();
    const home = await upsertHousehold(d, { name: 'Hana Headquill' });
    if (!home.ok) throw home.error;
    const hana = await upsertGuest(d, { householdId: home.value.id, firstName: 'Hana', lastName: 'Headquill' });
    const uncle = await upsertGuest(d, { householdId: home.value.id, firstName: 'Ulric', lastName: 'Otherquill' });
    if (!hana.ok || !uncle.ok) throw new Error('guests');
    const child = await upsertGuest(d, { householdId: home.value.id, firstName: 'Guest', lastName: '', kind: 'child', isNamed: false, isMinor: true });
    const his = await upsertGuest(d, { householdId: home.value.id, firstName: 'Guest', lastName: '', kind: 'plus_one', isNamed: false, plusOneOfGuestId: uncle.value.id });
    if (!child.ok || !his.ok) throw new Error('heads');
    const r = await load([row('Hana Headquill and Ivo Newquill', 2)]);
    expect(r.guests).toMatchObject({ created: 1, completed: 0 });
    const [ivo] = await guestNamed('Ivo', 'Newquill');
    expect([child.value.id, his.value.id]).not.toContain(ivo!.id);
    const after = await d.select().from(guests).where(inArray(guests.id, [child.value.id, his.value.id]));
    expect(after.map((g) => [g.kind, g.isNamed, g.firstName]).sort()).toEqual([['child', false, 'Guest'], ['plus_one', false, 'Guest']]);
  });

  it('someone the couple moved to another household, or merged into another guest, is not made again', async () => {
    const d = await db();
    const sheet = [row('Ava and Ben Movequill', 2), row('Cleo Mergequill and Dov Mergequill', 2)];
    await load(sheet);
    const elsewhere = await upsertHousehold(d, { name: 'Ben, on his own now' });
    if (!elsewhere.ok) throw elsewhere.error;
    const [ben] = await guestNamed('Ben', 'Movequill');
    await upsertGuest(d, { id: ben!.id, householdId: elsewhere.value.id, firstName: 'Ben' });
    const [cleo] = await guestNamed('Cleo', 'Mergequill');
    const [dov] = await guestNamed('Dov', 'Mergequill');
    await d.update(guests).set({ mergedIntoGuestId: cleo!.id }).where(eq(guests.id, dov!.id));
    const r = await load(sheet);
    expect(r.guests).toEqual({ created: 0, found: 4, completed: 0, unnamedCreated: 0 });
    expect(await all(/Movequill/)).toHaveLength(2);
    expect((await d.select().from(guests).where(eq(guests.id, ben!.id)))[0]!.householdId).toBe(elsewhere.value.id);
    expect(await all(/Mergequill/)).toHaveLength(2); // Cleo, and the merged-away record of Dov
    await d.update(guests).set({ mergedIntoGuestId: null }).where(eq(guests.id, dov!.id));
  });

  it('a household the couple renamed, and two lines they put in one household, are found by their people', async () => {
    const d = await db();
    await load([row('Mavis and Crispin', 2)]);
    const [mavis] = await guestNamed('Mavis', '');
    await d.update(households).set({ name: 'The neighbours' }).where(eq(households.id, mavis!.householdId));
    const again = await load([row('Mavis and Crispin', 2)]);
    expect(again).toMatchObject({ households: { created: 0, found: 1 }, guests: { created: 0, found: 2 } });

    const joint = await upsertHousehold(d, { name: 'Two lines, one roof' });
    if (!joint.ok) throw joint.error;
    for (const [f, l] of [['Pat', 'Onequill'], ['Lou', 'Twoquill']] as const) {
      const g = await upsertGuest(d, { householdId: joint.value.id, firstName: f, lastName: l });
      if (!g.ok) throw g.error;
    }
    const r = await load([row('Pat Onequill', 1), row('Lou Twoquill', 1)]);
    expect(r).toMatchObject({ households: { created: 0, found: 2 }, guests: { created: 0, found: 2, unnamedCreated: 0 } });
    expect(await all(/Onequill|Twoquill/)).toHaveLength(2);
  });

  it('two lines written the same are one line, and the second is said; a father and son told apart on the sheet are two people', async () => {
    const r = await load([row('Barton Zarnquill', 1), row('barton  zarnquill', 1), row('Corwin Zarkquill Sr.', 1), row('Corwin Zarkquill Jr.', 1)]);
    expect(r.skipped).toEqual([{ sheetRow: 3, reason: 'duplicate_line' }]);
    expect(await all(/Zarnquill/)).toHaveLength(1);
    const corwins = await all(/Zarkquill/);
    expect(corwins.map((g) => g.lastName).sort()).toEqual(['Zarkquill Jr.', 'Zarkquill Sr.']);
    expect(new Set(corwins.map((g) => g.householdId)).size).toBe(2);
    // Loaded again, each is still himself.
    const again = await load([row('Barton Zarnquill', 1), row('Corwin Zarkquill Sr.', 1), row('Corwin Zarkquill Jr.', 1)]);
    expect(again.guests).toMatchObject({ created: 0, found: 3 });
  });

  it('someone moved into another line’s household is found there, and not made again in the one they left', async () => {
    const d = await db();
    const sheet = [row('Ava and Ben Hopquill', 2), row('Zed Hopquill', 1)];
    await load(sheet);
    const [zed] = await guestNamed('Zed', 'Hopquill');
    const [ava] = await guestNamed('Ava', 'Hopquill');
    await upsertGuest(d, { id: zed!.id, householdId: ava!.householdId, firstName: 'Zed' });
    const r = await load(sheet);
    expect(r.guests).toEqual({ created: 0, found: 3, completed: 0, unnamedCreated: 0 });
    expect(await all(/Hopquill/)).toHaveLength(3);
  });

  it('a head the line still counts is never renamed to someone the load did not recognise', async () => {
    const d = await db();
    const sheet = [row('Amy and Kristofer Countquill', 2, '', 1)];
    await load(sheet);
    const [amy] = await guestNamed('Amy', 'Countquill');
    const [kris] = await guestNamed('Kristofer', 'Countquill');
    const before = (await d.select().from(guests).where(eq(guests.householdId, amy!.householdId))).filter((g) => !g.isNamed);
    expect(before).toHaveLength(1);
    await upsertGuest(d, { id: kris!.id, householdId: kris!.householdId, firstName: 'Christopher', lastName: 'Countquill-Hale' });
    await load(sheet);
    const after = await d.select().from(guests).where(eq(guests.householdId, amy!.householdId));
    // The plus-one the line still counts is the same record, still unnamed; no second one was made.
    expect(after.filter((g) => !g.isNamed).map((g) => [g.id, g.firstName, g.kind])).toEqual([[before[0]!.id, 'Guest', 'plus_one']]);
  });

  it('a new line never adopts the household of someone another line already has under a corrected name', async () => {
    const d = await db();
    await load([row('Rob Halequill', 1)]);
    const [son] = await guestNamed('Rob', 'Halequill');
    await upsertGuest(d, { id: son!.id, householdId: son!.householdId, firstName: 'Robert' });
    // His grandfather, of the same name, is added to the sheet with an address.
    const r = await load([row('Rob Halequill', 1), row('Robert Halequill', 1, '', '', 'grandfather.halequill@example.test')]);
    expect(r).toMatchObject({ households: { created: 1, found: 1 }, guests: { created: 1, found: 1 }, emailsAdded: 1 });
    const roberts = await guestNamed('Robert', 'Halequill');
    expect(roberts).toHaveLength(2);
    expect(new Set(roberts.map((g) => g.householdId)).size).toBe(2);
    expect(roberts.find((g) => g.id === son!.id)!.email).toBeNull();
    expect(roberts.find((g) => g.id !== son!.id)!.email).toBe('grandfather.halequill@example.test');
  });

  it('a father and son in households the couple renamed each keep their own, whichever line comes first', async () => {
    const d = await db();
    const sheet = [row('Barton Orderquill', 1), row('Barton Orderquill and Mara Orderquill', 2)];
    await load(sheet);
    for (const h of new Set((await all(/Orderquill/)).map((g) => g.householdId))) await d.update(households).set({ name: `Renamed ${h}` }).where(eq(households.id, h));
    const r = await load(sheet);
    expect(r.skipped).toEqual([]);
    expect(r).toMatchObject({ households: { created: 0, found: 2 }, guests: { created: 0, found: 3 } });
    expect(await all(/Orderquill/)).toHaveLength(3);
  });

  it('an address is given only to the person on the line it names, and only while they are in the line’s household', async () => {
    const d = await db();
    const sheet = [row('Ava and Ben Mailquill', 2, '', '', 'ben.mailquill@example.test'), row('Mr and Mrs Tom Wedquill', 2, '', '', 'mary.wedquill@example.test')];
    await load([row('Ava and Ben Mailquill', 2)]);
    const elsewhere = await upsertHousehold(d, { name: 'Ben Mailquill, moved' });
    if (!elsewhere.ok) throw elsewhere.error;
    const [ben] = await guestNamed('Ben', 'Mailquill');
    await upsertGuest(d, { id: ben!.id, householdId: elsewhere.value.id, firstName: 'Ben' });
    const r = await load(sheet);
    // Ben's address is not Ava's because she is the one left; his wife's is not Tom's because he is the one named.
    expect(r.emailsAdded).toBe(0);
    expect((await guestNamed('Ava', 'Mailquill'))[0]!.email).toBeNull();
    expect((await guestNamed('Tom', 'Wedquill'))[0]!.email).toBeNull();
  });

  it('a tally or a typo for a head count is left alone and said', async () => {
    const r = await load([row('Total', 120), row('Bigge Countquill', 2026), row('Fine Countquill', 2)]);
    expect(r.skipped).toEqual([{ sheetRow: 2, reason: 'nobody_named' }, { sheetRow: 3, reason: 'too_many_heads' }]);
    expect(r.guests).toMatchObject({ created: 1, unnamedCreated: 1 });
    expect(await guestNamed('Bigge', 'Countquill')).toHaveLength(0);
  });

  it('a second address on a line does not replace the first', async () => {
    await load([row('Solo Mailquill', 1, '', '', 'first.address@example.test; second.address@example.test')]);
    expect((await guestNamed('Solo', 'Mailquill'))[0]!.email).toBe('first.address@example.test');
  });
});

describe('signing in with Google or Facebook, by name, as either person on a line', () => {
  beforeAll(async () => {
    await sync([
      row("Ines Vantquill and Rory O'Dellquill", 2),
      row('Otto Marquill and Petra', 2),
      row('Gus and Wren Haloquill', 2),
      row('Uma Solquill', 1),
      row('Odessa Bellquill', 1),
    ]);
    for (const [f, l] of [['Ines', 'Vantquill'], ['Otto', 'Marquill'], ['Gus', 'Haloquill'], ['Odessa', 'Bellquill']] as const) await markSent(f, l);
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

  it('S-24: a given name one letter out signs in nobody, and is kept for the couple with who it nearly was', async () => {
    const [odessa] = await guestNamed('Odessa', 'Bellquill');
    const near = await signIn({ name: 'Odesa Bellquill' });
    expect(near.r).toEqual({ ok: false, redirectTo: GUEST_SIGN_IN_FAIL_PATH });
    expect(near.sink.setCookies).toHaveLength(0);
    expect(await whoIs('Odessa', 'Bellquill')).toBe(0);
    const [review] = (await boundGuestOf(near.accountId)).reviews;
    expect(review).toMatchObject({ reason: 'no_match', candidateGuestIds: [odessa!.id] });
    // A slip in the surname alone, under her given name as listed, is plainly her.
    expect((await signIn({ name: 'Odessa Belquill' })).r.ok).toBe(true);
    expect(await whoIs('Odessa', 'Bellquill')).toBe(1);
  });

  it('two guests a name nearly fits do not turn away a verified email that is one guest’s', async () => {
    const d = await db();
    await sync([row('Zorande Nearquill', 1, '', '', 'zorande@example.test'), row('Zoranda Nearquill', 1)]);
    await markSent('Zorande', 'Nearquill');
    const { r, sink } = await signIn({ name: 'Zorandi Nearquill', email: 'zorande@example.test', emailVerified: true });
    expect(r.ok).toBe(true);
    expect(sink.setCookies.length).toBeGreaterThan(0);
    expect(await whoIs('Zorande', 'Nearquill')).toBe(1);
    // Without the email the same name signs in nobody, and both are kept for the couple.
    const near = await signIn({ name: 'Zorandi Nearquill' });
    expect(near.r).toEqual({ ok: false, redirectTo: GUEST_SIGN_IN_FAIL_PATH });
    expect((await boundGuestOf(near.accountId)).reviews[0]).toMatchObject({ reason: 'no_match' });
    expect(d).toBeTruthy();
  });

  it('someone whose save-the-date has not gone out is not signed in, whichever name they use', async () => {
    const { r, sink, accountId } = await signIn({ name: 'Uma Solquill' });
    expect(r).toEqual({ ok: false, redirectTo: GUEST_SIGN_IN_FAIL_PATH });
    expect(sink.setCookies).toHaveLength(0);
    expect((await boundGuestOf(accountId)).reviews.map((x) => x.reason)).toEqual(['not_sent']);
  });
});
