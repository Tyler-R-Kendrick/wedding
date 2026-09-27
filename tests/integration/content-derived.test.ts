import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createCapabilityContext, invoke } from '@/capabilities';
import { saveContentRecord } from '@/capabilities/content';
import { newId } from '@/contracts/ids';
import type { AdminPrincipal } from '@/contracts/principal';
import { getDb } from '@/db/client';
import { faqEntries } from '@/db/schema';
import { slugify } from '@/domain/content/admin';

/*
 * The content flow never asks the admin for a slug or a list position (the 2026-09-27 admin
 * review, blocker 4). `saveContentRecord` fills them in: a slug from the title, unique in its
 * table, and a new record at the end of the list; an edit that leaves them empty keeps them.
 */

const admin: AdminPrincipal = { kind: 'admin', authIdentityId: 'a' as never, adminId: 'adm1' as never, roles: new Set(['owner']), entitlements: new Set(['admin_content']), authenticatedAt: new Date().toISOString(), sessionId: 's2' };
const ctx = () => createCapabilityContext({ principal: admin, requestId: `req-${newId()}`, surface: 'ui', idempotencyKey: newId() });

const faq = (question: string) => ({
  slug: null, order: null, category: 'basics', question, answer: 'An answer.', route: null,
  sourceId: '01SEED00000000000000000101', sourceType: 'authored', sourceUrl: null, verifiedAt: '2026-09-05T00:00:00.000Z', validFrom: null, validUntil: null,
  trustClass: 'TRUSTED_WEDDING', visibility: 'private-draft', placeholder: false,
});

describe('derived content fields', () => {
  it('slugify makes a web address name from a title', () => {
    expect(slugify('Cindy’s Rooftop: café hours!')).toBe('cindys-rooftop-cafe-hours');
    expect(slugify('   ')).toBe('');
  });

  it('a new record gets a unique slug from its title and the next position; an edit keeps both', async () => {
    const db = await getDb();
    const before = await db.select({ order: faqEntries.order }).from(faqEntries);
    const last = Math.max(0, ...before.map((r) => r.order));

    const first = await invoke(saveContentRecord, await ctx(), { table: 'faq_entries', data: faq('Is there a shuttle from the hotel?') });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await invoke(saveContentRecord, await ctx(), { table: 'faq_entries', data: faq('Is there a shuttle from the hotel?') });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const [a] = await db.select().from(faqEntries).where(eq(faqEntries.id, first.value.data.id));
    const [b] = await db.select().from(faqEntries).where(eq(faqEntries.id, second.value.data.id));
    expect(a).toMatchObject({ slug: 'is-there-a-shuttle-from-the-hotel', order: last + 1 });
    expect(b).toMatchObject({ slug: 'is-there-a-shuttle-from-the-hotel-2', order: last + 2 });

    const edited = await invoke(saveContentRecord, await ctx(), { table: 'faq_entries', id: a!.id, data: { ...faq('Is there a shuttle back, too?') } });
    expect(edited.ok).toBe(true);
    const [after] = await db.select().from(faqEntries).where(eq(faqEntries.id, a!.id));
    expect(after).toMatchObject({ question: 'Is there a shuttle back, too?', slug: 'is-there-a-shuttle-from-the-hotel', order: last + 1 });
  });

  it('keeps a slug the admin typed', async () => {
    const r = await invoke(saveContentRecord, await ctx(), { table: 'faq_entries', data: { ...faq('Where do we park?'), slug: 'valet-and-parking' } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [row] = await (await getDb()).select().from(faqEntries).where(eq(faqEntries.id, r.value.data.id));
    expect(row!.slug).toBe('valet-and-parking');
  });
});
