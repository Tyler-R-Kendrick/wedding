import { describe, expect, it } from 'vitest';
import { createCapabilityContext, invoke } from '@/capabilities';
import { adminCheckGiftSetup, adminListGiftLinks, adminUpsertGiftFund, adminUpsertGiftLink, adminUpsertGiftRail } from '@/capabilities/admin_gifts';
import { adminUpsertReservationVenue } from '@/capabilities/admin_reservations';
import type { AdminId, AuthIdentityId, ContentSourceId, IdempotencyKey } from '@/contracts/ids';
import { newId } from '@/contracts/ids';
import type { AdminPrincipal } from '@/contracts/principal';
import { getDb } from '@/db/client';
import { eq } from 'drizzle-orm';
import { giftLinks, reservationVenues } from '@/db/schema';

/**
 * Edits in /admin/gifts and /admin/reservations: a save that leaves a field out keeps it (the console
 * never sees a row's citation, and its one-click Hide/Up/Down send only what the page has), `null`
 * or an empty string clears it, a check cannot be dated in the future, and a save refuses what the
 * check step refuses.
 */
const admin: AdminPrincipal = { kind: 'admin', authIdentityId: 'b' as AuthIdentityId, adminId: 'A1' as AdminId, roles: new Set(['owner']), entitlements: new Set(['admin_content', 'admin_audit']), authenticatedAt: new Date().toISOString(), sessionId: 's' };
let n = 0;
async function run<I, O>(descriptor: Parameters<typeof invoke<I, O>>[0], input: unknown) {
  const ctx = await createCapabilityContext({ principal: admin, requestId: `req-gre-${++n}`, surface: 'ui', idempotencyKey: newId<IdempotencyKey>() });
  return invoke(descriptor, ctx, input);
}
const linkRow = async (id: string) => (await (await getDb()).select().from(giftLinks).where(eq(giftLinks.id, id)))[0]!;
const placeRow = async (id: string) => (await (await getDb()).select().from(reservationVenues).where(eq(reservationVenues.id, id)))[0]!;
const inAnHour = () => new Date(Date.now() + 60 * 60_000).toISOString();

describe('gift links: an edit keeps what it leaves out', () => {
  const SOURCE = newId<ContentSourceId>();
  const base = { id: 'edit-zola', kind: 'registry', label: 'Our registry on Zola', url: 'https://www.zola.com/registry/sara-and-tyler' } as const;

  it('keeps the disclosure, citation, check, note, order and placeholder flag through a Hide that omits them', async () => {
    const first = await run(adminUpsertGiftLink, { ...base, note: 'Kitchen things', disclosure: 'Zola keeps the list.', sourceId: SOURCE, sortOrder: 30, placeholder: true, confirmed: true });
    expect(first.ok, JSON.stringify(first)).toBe(true);
    const verifiedAt = (await linkRow(base.id)).verifiedAt;
    expect(verifiedAt).toBeInstanceOf(Date);

    // The console's Hide, as a caller that knows only the words: nothing else is sent.
    const hide = await run(adminUpsertGiftLink, { ...base, active: false });
    expect(hide.ok, JSON.stringify(hide)).toBe(true);
    expect(await linkRow(base.id)).toMatchObject({ active: false, note: 'Kitchen things', disclosure: 'Zola keeps the list.', sourceId: SOURCE, sortOrder: 30, placeholder: true, verifiedAt });

    // A later edit that omits `active` does not un-hide it.
    const rename = await run(adminUpsertGiftLink, { ...base, label: 'Our Zola registry' });
    expect(rename.ok).toBe(true);
    expect(await linkRow(base.id)).toMatchObject({ label: 'Our Zola registry', active: false, sourceId: SOURCE, disclosure: 'Zola keeps the list.' });
  });

  it('clears a note or disclosure sent as null or an empty string, and the citation and check sent as null', async () => {
    const cleared = await run(adminUpsertGiftLink, { ...base, note: '', disclosure: null, sourceId: null, verifiedAt: null });
    expect(cleared.ok, JSON.stringify(cleared)).toBe(true);
    expect(await linkRow(base.id)).toMatchObject({ note: null, disclosure: null, sourceId: null, verifiedAt: null, active: false });
    // Whitespace alone is empty too.
    await run(adminUpsertGiftLink, { ...base, note: 'Back again' });
    await run(adminUpsertGiftLink, { ...base, note: '   ' });
    expect((await linkRow(base.id)).note).toBeNull();
  });

  it('takes the defaults on a first save: shown, not a placeholder, first in order', async () => {
    const r = await run(adminUpsertGiftLink, { id: 'edit-joy', kind: 'registry', label: 'Joy', url: 'https://withjoy.com/sara-and-tyler/registry' });
    expect(r.ok && r.value.data).toMatchObject({ active: true, placeholder: false, sortOrder: 0, note: null, verifiedAt: null });
  });

  it('refuses a check dated in the future, and keeps one sent back unchanged', async () => {
    const future = await run(adminUpsertGiftLink, { ...base, verifiedAt: inAnHour() });
    expect(!future.ok && future.error.code).toBe('validation');
    expect(!future.ok && future.error.details?.issues).toEqual([{ path: 'verifiedAt', message: expect.any(String) }]);
    // Within a small clock skew is fine; `confirmed` wins over a time sent with it.
    const skew = new Date(Date.now() + 20_000).toISOString();
    expect((await run(adminUpsertGiftLink, { ...base, verifiedAt: skew })).ok).toBe(true);
    const before = Date.now();
    const confirmed = await run(adminUpsertGiftLink, { ...base, verifiedAt: inAnHour(), confirmed: true });
    expect(confirmed.ok).toBe(true);
    const stamped = (await linkRow(base.id)).verifiedAt!.getTime();
    expect(stamped).toBeGreaterThanOrEqual(before - 1000);
    expect(stamped).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('refuses a registry site’s home page on save, not only in the check step', async () => {
    for (const url of ['https://www.zola.com/', 'https://www.theknot.com', 'https://withjoy.com/?ref=share']) {
      const r = await run(adminUpsertGiftLink, { id: 'edit-home', kind: 'registry', label: 'Home', url });
      expect(!r.ok && r.error.code, url).toBe('validation');
      expect(!r.ok && r.error.message, url).toMatch(/home page/);
      // The same sentence the check step gives.
      const check = await run(adminCheckGiftSetup, { kind: 'link', url });
      expect(!check.ok && check.error.message).toBe(!r.ok ? r.error.message : '');
    }
    expect((await (await getDb()).select().from(giftLinks).where(eq(giftLinks.id, 'edit-home')))).toEqual([]);
    // An existing link cannot be pointed at one either.
    const repoint = await run(adminUpsertGiftLink, { ...base, url: 'https://www.zola.com/' });
    expect(!repoint.ok && repoint.error.message).toMatch(/home page/);
    // A row saved with one before this rule can still be hidden: its address is not changing.
    const db = await getDb();
    await db.insert(giftLinks).values({ id: 'legacy-home', kind: 'registry', provider: 'zola', label: 'Legacy', url: 'https://www.zola.com/', placeholder: false, active: true, sortOrder: 50, updatedBy: { kind: 'system', component: 'test' } });
    const hideLegacy = await run(adminUpsertGiftLink, { id: 'legacy-home', kind: 'registry', label: 'Legacy', url: 'https://www.zola.com/', active: false });
    expect(hideLegacy.ok, JSON.stringify(hideLegacy)).toBe(true);
    const listed = await run(adminListGiftLinks, {});
    expect(listed.ok && listed.value.data.rows.find((r) => r.id === 'legacy-home')?.active).toBe(false);
  });
});

describe('gift funds and rails: Hide survives a save that omits it', () => {
  it('keeps a hidden fund hidden when a rename leaves `active` out; a new fund is shown', async () => {
    expect((await run(adminUpsertGiftFund, { id: 'honeymoon', title: 'Our honeymoon', active: false })).ok).toBe(true);
    const renamed = await run(adminUpsertGiftFund, { id: 'honeymoon', title: 'The honeymoon' });
    expect(renamed.ok && renamed.value.data).toMatchObject({ title: 'The honeymoon', active: false, sortOrder: 0 });
    const moved = await run(adminUpsertGiftFund, { id: 'honeymoon', title: 'The honeymoon', sortOrder: 70 });
    expect(moved.ok && moved.value.data).toMatchObject({ active: false, sortOrder: 70 });
    const added = await run(adminUpsertGiftFund, { id: 'edit-new-fund', title: 'Bikes' });
    expect(added.ok && added.value.data).toMatchObject({ active: true, sortOrder: 100 });
  });

  it('keeps a hidden rail hidden when a save leaves `active` out', async () => {
    expect((await run(adminUpsertGiftRail, { rail: 'venmo', handle: '@Sara-Tyler', active: false })).ok).toBe(true);
    const again = await run(adminUpsertGiftRail, { rail: 'venmo', handle: '@Sara-Tyler-2' });
    expect(again.ok && again.value.data).toMatchObject({ handle: 'Sara-Tyler-2', active: false });
  });

  it('caps a rail handle before it is parsed, in the check step and the save alike', async () => {
    const long = 'x'.repeat(601);
    for (const handle of [long, ['a'.repeat(201)], Array.from({ length: 13 }, () => 'line')]) {
      const check = await run(adminCheckGiftSetup, { kind: 'rail', rail: 'check', handle });
      expect(!check.ok && check.error.code).toBe('validation');
      const save = await run(adminUpsertGiftRail, { rail: 'check', handle, recipientName: 'Sara + Tyler' });
      expect(!save.ok && save.error.code).toBe('validation');
    }
    // A real address, one line per row, is well inside it.
    const ok = await run(adminCheckGiftSetup, { kind: 'rail', rail: 'check', handle: ['Sara + Tyler', '1 Example Street', 'Chicago, IL 60603'] });
    expect(ok.ok).toBe(true);
  });
});

describe('reservable places: an edit keeps what it leaves out', () => {
  const SOURCE = newId<ContentSourceId>();
  const base = { id: 'edit-place', name: 'Edit Place' } as const;

  it('keeps the citation and check through the console’s Hide and move, which never send them', async () => {
    const first = await run(adminUpsertReservationVenue, { ...base, resySlug: 'edit-place', note: 'Window table', placeRef: 'ref-1', sourceId: SOURCE, sortOrder: 20, placeholder: true, confirmed: true });
    expect(first.ok, JSON.stringify(first)).toBe(true);
    const saved = await placeRow(base.id);
    expect(saved.verifiedAt).toBeInstanceOf(Date);

    // What the reservations page's one-click Hide sends: the row as it has it, without `sourceId`.
    const hide = await run(adminUpsertReservationVenue, { ...base, resySlug: 'edit-place', note: 'Window table', placeRef: 'ref-1', placeholder: true, active: false, sortOrder: 20, verifiedAt: saved.verifiedAt!.toISOString() });
    expect(hide.ok, JSON.stringify(hide)).toBe(true);
    expect(await placeRow(base.id)).toMatchObject({ active: false, sourceId: SOURCE, verifiedAt: saved.verifiedAt });

    // A bare save of the name keeps every other field, `active` included.
    const bare = await run(adminUpsertReservationVenue, { ...base, name: 'Edit Place, renamed' });
    expect(bare.ok).toBe(true);
    expect(await placeRow(base.id)).toMatchObject({ name: 'Edit Place, renamed', resySlug: 'edit-place', note: 'Window table', placeRef: 'ref-1', sourceId: SOURCE, sortOrder: 20, placeholder: true, active: false, verifiedAt: saved.verifiedAt });
  });

  it('clears what the admin emptied: null or an empty string', async () => {
    const r = await run(adminUpsertReservationVenue, { ...base, resySlug: null, note: '', placeRef: null, url: '', verifiedAt: null });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(await placeRow(base.id)).toMatchObject({ resySlug: null, note: null, placeRef: null, url: null, verifiedAt: null, sourceId: SOURCE, active: false });
  });

  it('takes the defaults on a first save', async () => {
    const r = await run(adminUpsertReservationVenue, { id: 'edit-new-place', name: 'New Place' });
    expect(r.ok && r.value.data).toMatchObject({ active: true, placeholder: false, sortOrder: 0, note: null, verifiedAt: null });
  });

  it('refuses a check dated in the future', async () => {
    const r = await run(adminUpsertReservationVenue, { ...base, verifiedAt: inAnHour() });
    expect(!r.ok && r.error.code).toBe('validation');
    expect(!r.ok && r.error.details?.issues).toEqual([{ path: 'verifiedAt', message: expect.any(String) }]);
    expect((await run(adminUpsertReservationVenue, { ...base, verifiedAt: '2026-01-01T00:00:00Z' })).ok).toBe(true);
  });
});
