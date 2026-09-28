import { afterAll, describe, expect, it } from 'vitest';
import { createCapabilityContext, invoke } from '@/capabilities';
import { adminListExternalActions } from '@/capabilities/admin_external_actions';
import { adminCheckGiftSetup, adminDeleteGiftFund, adminDeleteGiftLink, adminDeleteGiftRail, adminListGiftLinks, adminUpsertGiftFund, adminUpsertGiftLink, adminUpsertGiftRail } from '@/capabilities/admin_gifts';
import { adminUpsertReservationVenue } from '@/capabilities/admin_reservations';
import { getReservationOptions } from '@/capabilities/get_reservation_options';
import { listGiftLinksCapability } from '@/capabilities/list_gift_links';
import { openGiftFund } from '@/capabilities/open_gift_fund';
import { openGiftLink } from '@/capabilities/open_gift_link';
import { openReservationLink } from '@/capabilities/open_reservation_link';
import { prepareReservation } from '@/capabilities/prepare_reservation';
import type { AdminId, AuthIdentityId, GuestId, HouseholdId, IdempotencyKey } from '@/contracts/ids';
import { newId } from '@/contracts/ids';
import type { AdminPrincipal, GuestPrincipal, Principal } from '@/contracts/principal';
import { getDb } from '@/db/client';
import { eq, inArray, sql } from 'drizzle-orm';
import { externalActionRecords, giftFunds, giftLinks, giftPaymentRails, reservationVenues } from '@/db/schema';
import { FORBIDDEN_GIFT_WORDS } from '@/domain/gifts/copy';
import { listAuditEvents } from '@/lib/audit';
import { resetProviders } from '@/providers/registry';

const guest: GuestPrincipal = { kind: 'guest', authIdentityId: 'a' as AuthIdentityId, guestId: newId<GuestId>(), householdId: newId<HouseholdId>(), actsFor: [], entitlements: new Set(['view_event']), authenticatedAt: new Date().toISOString(), sessionId: 's' };
guest.actsFor.push(guest.guestId);
const admin: AdminPrincipal = { kind: 'admin', authIdentityId: 'b' as AuthIdentityId, adminId: 'A1' as AdminId, roles: new Set(['owner']), entitlements: new Set(['admin_content', 'admin_audit']), authenticatedAt: new Date().toISOString(), sessionId: 's' };
const anon: Principal = { kind: 'anonymous' };
/**
 * The registry is behind the account menu: its capabilities refuse an anonymous caller. The closest a
 * caller now comes to the old anonymous view is signed in with no invitation entitlements (a revoked
 * or delegate session), which is what these tests read the registry as.
 */
const visitor: GuestPrincipal = { ...guest, entitlements: new Set() };
let n = 0;
async function run<I, O>(descriptor: Parameters<typeof invoke<I, O>>[0], principal: Principal, input: unknown, extra: { idempotencyKey?: string; surface?: 'ui' | 'ai' | 'webmcp'; requestId?: string } = {}) {
  const ctx = await createCapabilityContext({ principal, requestId: extra.requestId ?? `req-gr-${++n}`, surface: extra.surface ?? 'ui', idempotencyKey: extra.idempotencyKey });
  return invoke(descriptor, ctx, input);
}
const key = () => newId<IdempotencyKey>();
const EVIL = ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'http://www.zola.com/', 'https://evil.example/', 'https://zola.com.evil.example/', 'https://www.google.com/search?q=x', 'https://user:pw@www.zola.com/'];

afterAll(() => resetProviders());

describe('gifts', () => {
  it('offers no links at all until the couple choose a provider, and says so in their language', async () => {
    // This asserted two built-in rows on `www.zola.com` with `placeholder: true`. The brief lists
    // Registry as NOT settled, so those rows named a company the couple have not chosen and linked
    // to it — on the page as "via Zola", and in this very output, which the AI concierge and WebMCP
    // both read. An empty list plus an editorial "still to come" is the honest answer; `placeholder`
    // on a card carrying a brand is not.
    const r = await run(listGiftLinksCapability, visitor, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.data.copy.title).toBe('Help us with our next adventures');
    expect(r.value.data.links).toEqual([]);
    expect(r.value.data.copy.registryPending.length).toBeGreaterThan(10);
    expect(r.value.data.copy.adventurePending.length).toBeGreaterThan(10);
    expect(JSON.stringify(r.value.data)).not.toMatch(/zola|theknot|withjoy/i);
    const text = JSON.stringify(r.value.data.copy);
    for (const re of FORBIDDEN_GIFT_WORDS) expect(text).not.toMatch(re);
    expect(r.value.sources[0]?.url).toBe('/the-wedding');
  });

  it('records a handoff (host only) when a link is opened, never a purchase', async () => {
    // A link to open has to be configured first: there are no built-in ones any more.
    const configured = await run(
      adminUpsertGiftLink,
      admin,
      { id: 'knot-registry', kind: 'registry', provider: 'theknot', label: 'Our registry on The Knot', url: 'https://www.theknot.com/us/sara-and-tyler', note: 'Physical wishlist' },
      { idempotencyKey: key() },
    );
    expect(configured.ok).toBe(true);
    const r = await run(openGiftLink, visitor, { linkId: 'knot-registry' }, { requestId: 'req-gift-open' });
    expect(r.ok && r.value.handoffUrl).toBe('https://www.theknot.com/us/sara-and-tyler');
    expect(r.ok && r.value.data.handoff).toMatchObject({ providerDisplayName: 'The Knot', opensNewTab: true });
    const db = await getDb();
    const rec = (await db.select().from(externalActionRecords)).find((x) => x.kind === 'gift_link');
    expect(rec).toMatchObject({ status: 'initiated', provider: 'theknot', urlHost: 'www.theknot.com', actor: { kind: 'guest' }, targetId: 'knot-registry', requestId: 'req-gift-open' });
    const audit = await listAuditEvents(db, { requestId: 'req-gift-open' });
    expect(audit.map((e) => e.action).sort()).toEqual(['capability.invoked', 'external_action.initiated']);
    expect((await run(openGiftLink, visitor, { linkId: 'nope' })).ok).toBe(false);
    expect((await run(openGiftLink, visitor, { linkId: '../etc' })).ok).toBe(false);
    const ai = await run(openGiftLink, visitor, { linkId: 'knot-registry' }, { surface: 'ai' });
    expect(ai.ok && ai.value.handoffUrl).toBe('https://www.theknot.com/us/sara-and-tyler');
  });

  it('admin links must be on the allowlist at write time AND at read time (open-redirect guard)', async () => {
    for (const url of EVIL) {
      const r = await run(adminUpsertGiftLink, admin, { id: 'bad-link', kind: 'registry', provider: 'custom', label: 'x', url }, { idempotencyKey: key() });
      expect(r.ok, url).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('validation');
    }
    const good = await run(adminUpsertGiftLink, admin, { id: 'knot-registry', kind: 'registry', provider: 'theknot', label: 'Our registry on The Knot', url: 'https://www.theknot.com/us/sara-and-tyler', note: 'Physical wishlist' }, { idempotencyKey: key() });
    expect(good.ok).toBe(true);
    const asGuest = await run(adminUpsertGiftLink, guest, { id: 'g', kind: 'registry', provider: 'zola', label: 'x', url: 'https://www.zola.com/' }, { idempotencyKey: key() });
    expect(!asGuest.ok && asGuest.error.code).toBe('forbidden');
    // Tampered row written behind the capability layer: dropped on read.
    const db = await getDb();
    await db.insert(giftLinks).values({ id: 'tampered', kind: 'registry', provider: 'custom', label: 'Evil', url: 'https://evil.example/pay', placeholder: false, active: true, sortOrder: 5, updatedBy: { kind: 'system', component: 'test' } });
    const list = await run(listGiftLinksCapability, visitor, {});
    // One admin row for registry and nothing for the adventure fund: an unconfigured kind is an
    // empty section the page fills with its own editorial note, not a built-in card.
    expect(list.ok && list.value.data.links.map((l) => [l.id, l.kind, l.origin, l.placeholder])).toEqual([['knot-registry', 'registry', 'admin', false]]);
    expect(JSON.stringify(list)).not.toContain('evil.example');
    expect((await run(openGiftLink, visitor, { linkId: 'tampered' })).ok).toBe(false);
    const opened = await run(openGiftLink, visitor, { linkId: 'knot-registry' });
    expect(opened.ok && opened.value.data.handoff.providerDisplayName).toBe('The Knot');
  });

  it('never prints the authoring marker in a label a guest reads', async () => {
    // The label is the hand-off card's heading and its button text. An admin who types the marker
    // into the label field is saying "not final yet" — that belongs in `placeholder`, which renders
    // as the editorial sentence, not as `TODO(...)` on a public page.
    const r = await run(
      adminUpsertGiftLink,
      admin,
      { id: 'marker-registry', kind: 'registry', provider: 'zola', label: 'TODO(Tyler & Sara): registry link (backlog C-09)', url: 'https://www.zola.com/registry/x', placeholder: true },
      { idempotencyKey: key() },
    );
    expect(r.ok).toBe(true);
    const list = await run(listGiftLinksCapability, visitor, {});
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    const link = list.value.data.links.find((l) => l.id === 'marker-registry');
    expect(link).toBeDefined();
    expect(link?.placeholder).toBe(true);
    expect(link?.label).toBe('registry link');
    expect(JSON.stringify(list.value.data.links)).not.toContain('TODO(');
  });
});

describe('gifts setup checks (/admin/gifts flows)', () => {
  it('checks a registry link before it is saved: provider from the host, home pages and off-list hosts refused', async () => {
    const zola = await run(adminCheckGiftSetup, admin, { kind: 'link', url: 'zola.com/registry/saraandtyler' });
    expect(zola.ok && zola.value.data).toMatchObject({ kind: 'link', provider: 'zola', providerName: 'Zola', url: 'https://zola.com/registry/saraandtyler' });
    const home = await run(adminCheckGiftSetup, admin, { kind: 'link', url: 'https://www.theknot.com/' });
    expect(!home.ok && home.error.message).toMatch(/home page/);
    for (const url of EVIL) {
      const r = await run(adminCheckGiftSetup, admin, { kind: 'link', url });
      expect(r.ok, url).toBe(false);
    }
    const asGuest = await run(adminCheckGiftSetup, guest, { kind: 'link', url: 'https://www.zola.com/registry/x' });
    expect(!asGuest.ok && asGuest.error.code).toBe('forbidden');
  });

  it('checks a way to give and returns exactly what guests will be handed, saving nothing', async () => {
    const bad = await run(adminCheckGiftSetup, admin, { kind: 'rail', rail: 'venmo', handle: 'abc' });
    expect(!bad.ok && bad.error.details?.issues).toEqual([{ path: 'handle', message: expect.stringMatching(/Venmo username/) }]);
    const venmo = await run(adminCheckGiftSetup, admin, { kind: 'rail', rail: 'venmo', handle: '@Sara-Tyler' });
    expect(venmo.ok && venmo.value.data).toMatchObject({ kind: 'rail', handle: 'Sara-Tyler', url: expect.stringMatching(/^https:\/\/venmo\.com\/Sara-Tyler\?/) });
    const zelle = await run(adminCheckGiftSetup, admin, { kind: 'rail', rail: 'zelle', handle: '+1 312.555.0142' });
    expect(zelle.ok && zelle.value.data).toMatchObject({ handle: '(312) 555-0142', url: null, instructions: expect.stringContaining('(312) 555-0142') });
    const db = await getDb();
    expect(await db.select().from(giftPaymentRails)).toEqual([]);
  });

  it('reads the provider from the link and stamps the check with the server clock', async () => {
    const r = await run(adminUpsertGiftLink, admin, { id: 'joy-check', kind: 'registry', label: 'Our registry on Joy', url: 'https://withjoy.com/sara-and-tyler/registry', active: false, confirmed: true }, { idempotencyKey: key() });
    expect(r.ok && r.value.data).toMatchObject({ provider: 'withjoy', verifiedAt: expect.any(String), active: false });
  });
});

describe('gifts of money (ADR-0013)', () => {
  const ZELLE = 'sara.and.tyler@example.com';
  const STREET = '1 Example Street';

  it('shows no funds until there is a way to give, then all four defaults', async () => {
    const before = await run(listGiftLinksCapability, visitor, {});
    expect(before.ok && [before.value.data.funds, before.value.data.rails]).toEqual([[], []]);

    for (const [rail, handle, recipientName] of [
      ['venmo', '@Sara-Tyler', 'Sara + Tyler'],
      ['zelle', ZELLE, 'Sara Example'],
      ['check', ['Sara + Tyler', STREET, 'Chicago, IL 60603'], 'Sara + Tyler'],
    ] as const) {
      const r = await run(adminUpsertGiftRail, admin, { rail, handle, recipientName }, { idempotencyKey: key() });
      expect(r.ok, rail).toBe(true);
    }

    const r = await run(listGiftLinksCapability, visitor, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { funds, rails, statement } = r.value.data;
    expect(funds.map((f) => f.id)).toEqual(['honeymoon', 'home', 'adoption', 'next-adventures']);
    expect(funds[0]!.links).toEqual([
      expect.objectContaining({ rail: 'venmo', providerDisplayName: 'Venmo', host: 'venmo.com', url: 'https://venmo.com/Sara-Tyler?txn=pay&note=Our%20honeymoon%20(wedding%20gift)', opensNewTab: true }),
    ]);
    expect(rails.map((x) => [x.rail, x.mode, x.needsInvitation])).toEqual([
      ['zelle', 'direct', true],
      ['venmo', 'link', false],
      ['check', 'direct', true],
    ]);
    expect(statement).toContain('Venmo');
    expect(statement).toContain('never touches or holds the money');
    const text = JSON.stringify(r.value.data);
    for (const re of FORBIDDEN_GIFT_WORDS) expect(text).not.toMatch(re);
  });

  it('never hands an anonymous visitor (or the concierge answering one) an email, phone or address', async () => {
    for (const surface of ['ui', 'ai', 'webmcp'] as const) {
      // Anonymous is refused outright now: the registry sits behind the signed-in account menu.
      for (const [capability, input] of [[listGiftLinksCapability, {}], [openGiftLink, { linkId: 'knot-registry' }], [openGiftFund, { fundId: 'home', rail: 'venmo' }]] as const) {
        const refused = await run(capability as typeof listGiftLinksCapability, anon, input, { surface });
        expect(!refused.ok && refused.error.code, `${surface} ${capability.name}`).toBe('unauthenticated');
      }
      const r = await run(listGiftLinksCapability, visitor, {}, { surface });
      const text = JSON.stringify(r);
      expect(text, surface).not.toContain(ZELLE);
      expect(text, surface).not.toContain(STREET);
      expect(text, surface).not.toContain('Sara Example');
    }
    const asGuest = await run(listGiftLinksCapability, guest, {});
    expect(asGuest.ok).toBe(true);
    if (!asGuest.ok) return;
    const zelle = asGuest.value.data.rails.find((x) => x.rail === 'zelle');
    expect(zelle).toMatchObject({ needsInvitation: false, recipientName: 'Sara Example' });
    expect(zelle?.instructions).toContain(ZELLE);
    expect(asGuest.value.data.rails.find((x) => x.rail === 'check')?.instructions).toBe(`Make it out to Sara + Tyler and mail it to:\nSara + Tyler\n${STREET}\nChicago, IL 60603`);
  });

  it('stops showing personal details once an invitation is revoked, though the session lives on', async () => {
    // The resolver derives no entitlements for a guest whose invitation was revoked or expired, but
    // their session is still a `guest` one. The couple's address must go with the invitation.
    const revoked: GuestPrincipal = { ...guest, entitlements: new Set() };
    const r = await run(listGiftLinksCapability, revoked, {});
    expect(r.ok).toBe(true);
    const text = JSON.stringify(r);
    expect(text).not.toContain(ZELLE);
    expect(text).not.toContain(STREET);
    expect(r.ok && r.value.data.rails.filter((x) => x.needsInvitation).map((x) => x.rail)).toEqual(['zelle', 'check']);
  });

  it('keeps what a save leaves out: a fund’s place and words, a rail’s payee', async () => {
    const fund = async (input: Record<string, unknown>) => {
      const r = await run(adminUpsertGiftFund, admin, input, { idempotencyKey: key() });
      expect(r.ok, JSON.stringify(r)).toBe(true);
      return r.ok ? r.value.data : null;
    };
    // A default hidden by its first row keeps its built-in words.
    expect(await fund({ id: 'home', title: 'Our home', active: false })).toMatchObject({ description: 'Toward a house of our own.', sortOrder: 10, active: false });
    expect(await fund({ id: 'home', title: 'Our home', sortOrder: 55, description: 'A porch, eventually.' })).toMatchObject({ sortOrder: 55, description: 'A porch, eventually.' });
    expect(await fund({ id: 'home', title: 'Our first home' })).toMatchObject({ title: 'Our first home', sortOrder: 55, description: 'A porch, eventually.' });
    // Back to the built-in default (no row), which later tests read.
    await (await getDb()).delete(giftFunds).where(eq(giftFunds.id, 'home'));

    const rail = await run(adminUpsertGiftRail, admin, { rail: 'venmo', handle: '@Sara-Tyler' }, { idempotencyKey: key() });
    expect(rail.ok && rail.value.data.recipientName).toBe('Sara + Tyler');
  });

  it('never invents who a check is made out to', async () => {
    const db = await getDb();
    await db.delete(giftPaymentRails).where(eq(giftPaymentRails.rail, 'check'));
    const noName = await run(adminUpsertGiftRail, admin, { rail: 'check', handle: ['Sara + Tyler', STREET, 'Chicago, IL 60603'] }, { idempotencyKey: key() });
    expect(!noName.ok && noName.error.details).toMatchObject({ issues: [{ path: 'recipientName' }] });
    // A row with no payee (written before this rule, or by hand) says where to mail it, and nothing more.
    await db.insert(giftPaymentRails).values({ rail: 'check', handle: `${STREET}\nChicago, IL 60603`, recipientName: null, active: true, sortOrder: 40, updatedBy: { kind: 'system', component: 'test' } });
    const r = await run(listGiftLinksCapability, guest, {});
    expect(r.ok && r.value.data.rails.find((x) => x.rail === 'check')?.instructions).toBe(`Mail it to:\n${STREET}\nChicago, IL 60603`);
    expect(JSON.stringify(r)).not.toContain('Sara or Tyler');
    const withName = await run(adminUpsertGiftRail, admin, { rail: 'check', handle: ['Sara + Tyler', STREET, 'Chicago, IL 60603'], recipientName: 'Sara + Tyler' }, { idempotencyKey: key() });
    expect(withName.ok).toBe(true);
  });

  it('lets the couple rename, hide and add funds; the defaults need no row', async () => {
    expect((await run(adminUpsertGiftFund, admin, { id: 'adoption', title: 'Growing our family', active: false }, { idempotencyKey: key() })).ok).toBe(true);
    expect((await run(adminUpsertGiftFund, admin, { id: 'date-nights', title: 'Date nights', description: 'Dinner somewhere new.', sortOrder: 15 }, { idempotencyKey: key() })).ok).toBe(true);
    const r = await run(listGiftLinksCapability, visitor, {});
    expect(r.ok && r.value.data.funds.map((f) => f.id)).toEqual(['honeymoon', 'home', 'date-nights', 'next-adventures']);
    const adminView = await run(adminListGiftLinks, admin, {});
    expect(adminView.ok && adminView.value.data.funds.map((f) => [f.id, f.active, f.origin])).toEqual([
      ['honeymoon', true, 'default'],
      ['home', true, 'default'],
      ['date-nights', true, 'admin'],
      ['adoption', false, 'admin'],
      ['next-adventures', true, 'default'],
    ]);
    // restore, so later assertions read the defaults
    await run(adminUpsertGiftFund, admin, { id: 'adoption', title: 'Growing our family', description: 'Toward adoption, and the family we hope to grow.' }, { idempotencyKey: key() });
    await run(adminUpsertGiftFund, admin, { id: 'date-nights', title: 'Date nights', active: false }, { idempotencyKey: key() });
  });

  it('validates every handle, and only admins can set one', async () => {
    for (const [rail, handle] of [
      ['venmo', 'https://evil.example/'],
      ['paypal', 'not a name'],
      ['cashapp', '$123'],
      ['zelle', 'call me'],
    ] as const) {
      const r = await run(adminUpsertGiftRail, admin, { rail, handle }, { idempotencyKey: key() });
      expect(!r.ok && r.error.code, `${rail} ${handle}`).toBe('validation');
    }
    const asGuest = await run(adminUpsertGiftRail, guest, { rail: 'venmo', handle: '@someone-else' }, { idempotencyKey: key() });
    expect(!asGuest.ok && asGuest.error.code).toBe('forbidden');
    const r = await run(listGiftLinksCapability, visitor, {});
    expect(r.ok && r.value.data.funds[0]!.links[0]!.url).toContain('venmo.com/Sara-Tyler');
  });

  it('records a hand-off to Venmo (host only), never a payment; Zelle has nothing to open', async () => {
    const r = await run(openGiftFund, visitor, { fundId: 'home', rail: 'venmo' }, { requestId: 'req-fund-open' });
    expect(r.ok && r.value.handoffUrl).toBe('https://venmo.com/Sara-Tyler?txn=pay&note=Our%20home%20(wedding%20gift)');
    const db = await getDb();
    const rec = (await db.select().from(externalActionRecords)).find((x) => x.kind === 'gift_fund');
    expect(rec).toMatchObject({ status: 'initiated', provider: 'venmo', urlHost: 'venmo.com', targetType: 'gift_fund', targetId: 'home', requestId: 'req-fund-open' });
    expect(JSON.stringify(rec)).not.toContain('txn=pay');
    expect((await run(openGiftFund, visitor, { fundId: 'home', rail: 'zelle' })).ok).toBe(false);
    expect((await run(openGiftFund, visitor, { fundId: 'adoption', rail: 'paypal' })).ok).toBe(false);
    expect((await run(openGiftFund, visitor, { fundId: 'date-nights', rail: 'venmo' })).ok).toBe(false);
    expect((await run(openGiftFund, visitor, { fundId: '../etc', rail: 'venmo' })).ok).toBe(false);
  });

  it('drops a tampered rail row whose handle would build a link off the allowlist', async () => {
    const db = await getDb();
    await db.insert(giftPaymentRails).values({ rail: 'cashapp', handle: 'x/../../evil.example', active: true, sortOrder: 30, updatedBy: { kind: 'system', component: 'test' } });
    const r = await run(listGiftLinksCapability, visitor, {});
    expect(r.ok && r.value.data.funds[0]!.links.map((l) => l.rail)).toEqual(['venmo']);
    expect(JSON.stringify(r)).not.toContain('evil.example');
    await db.delete(giftPaymentRails).where(eq(giftPaymentRails.rail, 'cashapp'));
  });

  it('caps the number of funds, and at the cap the concierge can still read the whole page', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) {
      const id = `extra-fund-${i}`;
      const r = await run(adminUpsertGiftFund, admin, { id, title: `A fund with a long enough title ${i}`.padEnd(80, '.'), description: 'x'.repeat(200) }, { idempotencyKey: key() });
      if (!r.ok) {
        expect(r.error.details).toMatchObject({ issues: [{ path: 'id' }] });
        break;
      }
      ids.push(id);
    }
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThan(30); // the cap refused one
    const db = await getDb();
    // Every rail configured, so every fund carries every link.
    for (const [rail, handle] of [['paypal', 'SaraTyler'], ['cashapp', '$SaraTyler']] as const) {
      expect((await run(adminUpsertGiftRail, admin, { rail, handle }, { idempotencyKey: key() })).ok, rail).toBe(true);
    }
    for (const surface of ['ai', 'webmcp'] as const) {
      const r = await run(listGiftLinksCapability, guest, {}, { surface });
      expect(r.ok, `${surface} ${JSON.stringify(r).slice(0, 300)}`).toBe(true);
      // Room left for registry links on top of a full set of funds.
      expect(r.ok && JSON.stringify(r.value.data).length, surface).toBeLessThan(26_000);
    }
    await db.delete(giftFunds).where(inArray(giftFunds.id, ids));
    await db.delete(giftPaymentRails).where(inArray(giftPaymentRails.rail, ['paypal', 'cashapp']));
  });

  it('keeps /admin/gifts up when a rail row names a rail this build does not know', async () => {
    const db = await getDb();
    await db.execute(sql`INSERT INTO gift_payment_rails (rail, handle, active, sort_order, updated_by) VALUES ('carrier-pigeon', 'coop 4', true, 99, '{"kind":"system","component":"test"}'::jsonb)`);
    try {
      const a = await run(adminListGiftLinks, admin, {});
      expect(a.ok, JSON.stringify(a)).toBe(true);
      expect(a.ok && a.value.data.rails.map((x) => x.rail)).not.toContain('carrier-pigeon');
      const g = await run(listGiftLinksCapability, guest, {});
      expect(g.ok && g.value.data.rails.map((x) => x.rail)).not.toContain('carrier-pigeon');
    } finally {
      await db.execute(sql`DELETE FROM gift_payment_rails WHERE rail = 'carrier-pigeon'`);
    }
  });

  it('keeps /gifts and /admin/gifts up on a database the migration has not reached (a preview)', async () => {
    // Previews never run migrations (scripts/deploy/migrate-on-deploy.mjs). Take the tables away for
    // real, so this is the error Postgres actually raises rather than a stand-in for it.
    const db = await getDb();
    await db.execute(sql`ALTER TABLE gift_payment_rails RENAME TO gift_payment_rails_hidden`);
    await db.execute(sql`ALTER TABLE gift_funds RENAME TO gift_funds_hidden`);
    try {
      const r = await run(listGiftLinksCapability, visitor, {});
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(r.ok && [r.value.data.funds, r.value.data.rails]).toEqual([[], []]);
      expect(r.ok && r.value.data.links.length).toBeGreaterThan(0); // the registry links still show
      const a = await run(adminListGiftLinks, admin, {});
      expect(a.ok && a.value.data.fundsAvailable).toBe(false);
    } finally {
      await db.execute(sql`ALTER TABLE gift_payment_rails_hidden RENAME TO gift_payment_rails`);
      await db.execute(sql`ALTER TABLE gift_funds_hidden RENAME TO gift_funds`);
    }
    const back = await run(adminListGiftLinks, admin, {});
    expect(back.ok && back.value.data.fundsAvailable).toBe(true);
  });
});

describe('deleting from /admin/gifts', () => {
  it('deletes a registry link: guests stop being sent to it, and only an admin can', async () => {
    const made = await run(adminUpsertGiftLink, admin, { id: 'zola-gone', kind: 'registry', label: 'Our registry on Zola', url: 'https://www.zola.com/registry/sara-and-tyler-gone' }, { idempotencyKey: key() });
    expect(made.ok).toBe(true);
    const asGuest = await run(adminDeleteGiftLink, guest, { id: 'zola-gone' }, { idempotencyKey: key() });
    expect(!asGuest.ok && asGuest.error.code).toBe('forbidden');
    const r = await run(adminDeleteGiftLink, admin, { id: 'zola-gone' }, { idempotencyKey: key(), requestId: 'req-gift-link-delete' });
    expect(r.ok && r.value.data).toEqual({ id: 'zola-gone', deleted: true });
    const db = await getDb();
    expect(await db.select().from(giftLinks).where(eq(giftLinks.id, 'zola-gone'))).toEqual([]);
    const g = await run(listGiftLinksCapability, visitor, {});
    expect(g.ok && g.value.data.links.map((l) => l.id)).not.toContain('zola-gone');
    const audit = await listAuditEvents(db, { requestId: 'req-gift-link-delete' });
    expect(audit.find((e) => e.action === 'content.updated')).toMatchObject({ targetType: 'gift_link', targetId: 'zola-gone', metadata: { op: 'delete' } });
    const again = await run(adminDeleteGiftLink, admin, { id: 'zola-gone' }, { idempotencyKey: key() });
    expect(!again.ok && again.error.code).toBe('not_found');
    expect((await run(adminDeleteGiftLink, admin, { id: '../etc' }, { idempotencyKey: key() })).ok).toBe(false);
  });

  it('deletes a fund the couple added, and resets a built-in one to its built-in words instead', async () => {
    expect((await run(adminUpsertGiftFund, admin, { id: 'bike-fund', title: 'Two bikes', description: 'For the lakefront path.' }, { idempotencyKey: key() })).ok).toBe(true);
    const custom = await run(adminDeleteGiftFund, admin, { id: 'bike-fund' }, { idempotencyKey: key() });
    expect(custom.ok && custom.value.data).toEqual({ id: 'bike-fund', outcome: 'deleted' });
    const missing = await run(adminDeleteGiftFund, admin, { id: 'bike-fund' }, { idempotencyKey: key() });
    expect(!missing.ok && missing.error.code).toBe('not_found');

    expect((await run(adminUpsertGiftFund, admin, { id: 'honeymoon', title: 'Somewhere warm', description: 'Sun, eventually.', active: false, sortOrder: 90 }, { idempotencyKey: key() })).ok).toBe(true);
    const reset = await run(adminDeleteGiftFund, admin, { id: 'honeymoon' }, { idempotencyKey: key() });
    expect(reset.ok && reset.value.data).toEqual({ id: 'honeymoon', outcome: 'reset' });
    const a = await run(adminListGiftLinks, admin, {});
    expect(a.ok && a.value.data.funds.map((f) => f.id)).not.toContain('bike-fund');
    expect(a.ok && a.value.data.funds.find((f) => f.id === 'honeymoon')).toEqual({ id: 'honeymoon', title: 'Our honeymoon', description: 'Toward the first trip of our married life.', active: true, sortOrder: 0, origin: 'default' });
    // A built-in fund with nothing to reset is already reset: asking again is not an error.
    const again = await run(adminDeleteGiftFund, admin, { id: 'honeymoon' }, { idempotencyKey: key() });
    expect(again.ok && again.value.data.outcome).toBe('reset');
  });

  it('deletes a way to give with step-up, and guests stop being offered it', async () => {
    expect((await run(adminUpsertGiftRail, admin, { rail: 'paypal', handle: 'SaraTylerGifts' }, { idempotencyKey: key() })).ok).toBe(true);
    const stale = { ...admin, authenticatedAt: new Date(Date.now() - 24 * 3600_000).toISOString() };
    const refused = await run(adminDeleteGiftRail, stale, { rail: 'paypal' }, { idempotencyKey: key() });
    expect(!refused.ok && refused.error.code).toBe('step_up_required');
    const asGuest = await run(adminDeleteGiftRail, guest, { rail: 'paypal' }, { idempotencyKey: key() });
    expect(!asGuest.ok && asGuest.error.code).toBe('forbidden');

    const r = await run(adminDeleteGiftRail, admin, { rail: 'paypal' }, { idempotencyKey: key(), requestId: 'req-gift-rail-delete' });
    expect(r.ok && r.value.data).toEqual({ rail: 'paypal', deleted: true });
    const db = await getDb();
    expect(await db.select().from(giftPaymentRails).where(eq(giftPaymentRails.rail, 'paypal'))).toEqual([]);
    const g = await run(listGiftLinksCapability, guest, {});
    expect(g.ok && g.value.data.rails.map((x) => x.rail)).not.toContain('paypal');
    // The audit names the rail, never the handle it held.
    expect(JSON.stringify(await listAuditEvents(db, { requestId: 'req-gift-rail-delete' }))).not.toContain('SaraTylerGifts');
    const again = await run(adminDeleteGiftRail, admin, { rail: 'paypal' }, { idempotencyKey: key() });
    expect(!again.ok && again.error.code).toBe('not_found');
  });
});

describe('reservations ladder', () => {
  it('answers with the url rung for Cindy’s and an honest unavailable rung for the placeholder', async () => {
    const r = await run(getReservationOptions, anon, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.retrievedAt).toBeTruthy();
    expect(r.value.data.options.map((o) => [o.venue.id, o.rung, o.canCommit, o.handoff?.host ?? null])).toEqual([
      ['caa-cindys', 'url', false, 'www.chicagoathletichotel.com'],
      ['placeholder-restaurant', 'unavailable', false, null],
    ]);
    expect(r.value.data.options[1]!.unavailable).toEqual({ message: expect.stringMatching(/Ask us/), contactRoute: '/ask-us' });
    expect(r.value.sources.map((s) => s.title).sort()).toEqual(["Tyler's brief 2026-09-04", 'chicagoathletichotel.com']);
    const missing = await run(getReservationOptions, anon, { venueId: 'nowhere' });
    expect(!missing.ok && missing.error.code).toBe('not_found');
  });

  it('unavailable rung: open_reservation_link returns no handoff and records nothing', async () => {
    const r = await run(openReservationLink, anon, { venueId: 'placeholder-restaurant' });
    expect(r.ok && r.value.data).toMatchObject({ rung: 'unavailable', unavailable: { contactRoute: '/ask-us' } });
    expect(r.ok && r.value.handoffUrl).toBeUndefined();
    const db = await getDb();
    expect((await db.select().from(externalActionRecords)).filter((x) => x.kind === 'reservation_link')).toHaveLength(0);
  });

  it('admin-configured deep links climb the ladder; bad URLs are rejected or dropped', async () => {
    for (const url of EVIL) {
      const r = await run(adminUpsertReservationVenue, admin, { id: 'bad-venue', name: 'Bad', url }, { idempotencyKey: key() });
      expect(r.ok, url).toBe(false);
    }
    for (const slug of ['../x', 'a b', 'x/y']) {
      expect((await run(adminUpsertReservationVenue, admin, { id: 'v', name: 'V', resySlug: slug }, { idempotencyKey: key() })).ok, slug).toBe(false);
    }
    const resy = await run(adminUpsertReservationVenue, admin, { id: 'test-resy', name: 'Test Resy Place', resySlug: 'test-resy-place', note: 'fixture' }, { idempotencyKey: key() });
    expect(resy.ok).toBe(true);
    const ot = await run(adminUpsertReservationVenue, admin, { id: 'test-ot', name: 'Test OpenTable Place', openTableId: 'test-ot-place' }, { idempotencyKey: key() });
    expect(ot.ok).toBe(true);
    const db = await getDb();
    await db.insert(reservationVenues).values({ id: 'tampered-venue', name: 'Tampered', url: 'https://evil.example/book', placeholder: false, active: true, sortOrder: 9, updatedBy: { kind: 'system', component: 'test' } });

    const opts = await run(getReservationOptions, anon, { date: '2027-07-16', partySize: 4 });
    expect(opts.ok).toBe(true);
    if (!opts.ok) return;
    const byId = Object.fromEntries(opts.value.data.options.map((o) => [o.venue.id, o]));
    expect(byId['test-resy']).toMatchObject({ rung: 'deep-link', handoff: { host: 'resy.com', providerDisplayName: 'Resy' } });
    expect(byId['test-resy']!.handoff!.url).toBe('https://resy.com/cities/chi/test-resy-place?date=2027-07-16&seats=4');
    expect(byId['test-ot']).toMatchObject({ rung: 'deep-link', handoff: { host: 'www.opentable.com', providerDisplayName: 'OpenTable' } });
    expect(byId['tampered-venue']).toMatchObject({ rung: 'unavailable' });
    expect(JSON.stringify(opts)).not.toContain('evil.example');
    expect(byId['caa-cindys']).toBeUndefined(); // admin rows replace the built-in defaults

    const open = await run(openReservationLink, anon, { venueId: 'test-resy', date: '2027-07-16', partySize: 2 }, { requestId: 'req-res-open' });
    expect(open.ok && open.value.handoffUrl).toBe('https://resy.com/cities/chi/test-resy-place?date=2027-07-16&seats=2');
    const rec = (await db.select().from(externalActionRecords)).find((x) => x.kind === 'reservation_link');
    expect(rec).toMatchObject({ provider: 'resy', status: 'initiated', urlHost: 'resy.com', targetId: 'test-resy', metadata: { rung: 'deep-link', partySize: 2, date: '2027-07-16' } });
    expect(JSON.stringify(rec)).not.toContain('seats='); // host only, never the full deep link
    const tamperedOpen = await run(openReservationLink, anon, { venueId: 'tampered-venue' });
    expect(tamperedOpen.ok && tamperedOpen.value.handoffUrl).toBeUndefined();
    expect((await run(openReservationLink, anon, { venueId: 'x', date: '16/07/2027' })).ok).toBe(false);
  });

  it('prepare_reservation builds the card for a signed-in guest and keeps contact details out of records', async () => {
    const anonPrep = await run(prepareReservation, anon, { venueId: 'test-resy', date: '2027-07-16', time: '19:00', partySize: 2, contactName: 'Pat Example' });
    expect(!anonPrep.ok && anonPrep.error.code).toBe('unauthenticated');
    const prep = await run(prepareReservation, guest, { venueId: 'test-resy', date: '2027-07-16', time: '19:00', partySize: 2, contactName: 'Pat Example' }, { requestId: 'req-res-prep' });
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;
    expect(prep.value.data).toMatchObject({ card: { venue: { id: 'test-resy' }, date: '2027-07-16', time: '19:00', partySize: 2, contactName: 'Pat Example' }, rung: 'deep-link', canCommit: false, nextStep: 'open_reservation_link' });
    expect(prep.value.confirmation).toBeUndefined(); // no API rung: nothing to confirm here
    const db = await getDb();
    const rec = (await db.select().from(externalActionRecords)).find((x) => x.kind === 'reservation_prepare');
    expect(rec).toMatchObject({ status: 'prepared', provider: 'resy', targetId: 'test-resy' });
    expect(JSON.stringify(rec)).not.toContain('Pat Example');
    expect(JSON.stringify(await listAuditEvents(db, { requestId: 'req-res-prep' }))).not.toContain('Pat Example');
    const unavailable = await run(prepareReservation, guest, { venueId: 'tampered-venue', date: '2027-07-16', time: '19:00', partySize: 2, contactName: 'Pat' });
    expect(unavailable.ok && unavailable.value.data).toMatchObject({ rung: 'unavailable', nextStep: 'ask_us' });
    expect((await run(prepareReservation, guest, { venueId: 'test-resy', date: '2027-07-16', time: '7pm', partySize: 2, contactName: 'Pat' })).ok).toBe(false);
  });

  it('exposes the external action log to admins with audit access only', async () => {
    const r = await run(adminListExternalActions, admin, {});
    // 3 gift opens (knot, the same on the ai surface, knot again from the guard test), 1 hand-off to
    // Venmo for a fund, 1 reservation link (resy), 2 preparations (resy, unavailable tampered venue).
    expect(r.ok && r.value.data.records.map((x) => x.kind).sort()).toEqual(['gift_fund', 'gift_link', 'gift_link', 'gift_link', 'reservation_link', 'reservation_prepare', 'reservation_prepare']);
    expect(r.ok && r.value.data.records.filter((x) => x.kind === 'reservation_prepare').map((x) => x.provider).sort()).toEqual(['none', 'resy']);
    expect(JSON.stringify(r)).not.toMatch(/seats=|Pat Example/);
    const filtered = await run(adminListExternalActions, admin, { kind: 'reservation_link' });
    expect(filtered.ok && filtered.value.data.records).toHaveLength(1);
    expect((await run(adminListExternalActions, guest, {})).ok).toBe(false);
    expect((await run(adminListExternalActions, { ...admin, entitlements: new Set(['admin_content']) }, {})).ok).toBe(false);
  });
});
