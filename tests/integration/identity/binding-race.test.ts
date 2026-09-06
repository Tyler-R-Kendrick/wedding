import { and, eq, isNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { guestAccessBindings } from '@/db/schema';
import { bindIdentity, ensureAuthUser } from '@/domain/identity/bindings';
import { getAuditSink, listAuditEvents } from '@/lib/audit';
import { seed } from './harness';

/** Review S9: the database, not a check-then-insert, guarantees one active binding per guest. */
describe('binding race', () => {
  it('two concurrent binds by different identities: exactly one wins, the other is a conflict, one active row', async () => {
    const f = await seed('race1');
    const db = await getDb();
    const audit = await getAuditSink();
    const a = await ensureAuthUser(db, 'a+race1@example.test');
    const b = await ensureAuthUser(db, 'b+race1@example.test');
    if (!a.ok || !b.ok) throw new Error('seed');
    const mk = (id: string) => bindIdentity(db, { authIdentityId: id, guestId: f.guests.chidi, role: 'self', claimMethod: 'otp', actor: { kind: 'system', component: 'race' }, requestId: 'race1', audit });
    const results = await Promise.all([mk(a.value.id), mk(b.value.id), mk(a.value.id), mk(b.value.id)]);
    const winners = results.filter((r) => r.ok);
    const losers = results.filter((r) => !r.ok);
    expect(winners.length).toBeGreaterThanOrEqual(1);
    expect(losers.length).toBeGreaterThanOrEqual(1);
    for (const l of losers) if (!l.ok) expect(l.error.code).toBe('conflict');
    const active = await db.select().from(guestAccessBindings).where(and(eq(guestAccessBindings.guestId, f.guests.chidi), isNull(guestAccessBindings.revokedAt)));
    expect(active).toHaveLength(1);
    expect(new Set(winners.map((w) => w.ok && w.value.authIdentityId)).size).toBe(1);
    const denied = (await listAuditEvents(db, { action: 'identity.bound', targetId: f.guests.chidi })).filter((e) => e.outcome === 'denied');
    expect(denied.length).toBeGreaterThanOrEqual(1);
  });

  it('a revoked binding does not block a new one (partial index), and the row-level guard still applies', async () => {
    const f = await seed('race2');
    const db = await getDb();
    const audit = await getAuditSink();
    const a = await ensureAuthUser(db, 'a+race2@example.test');
    const b = await ensureAuthUser(db, 'b+race2@example.test');
    if (!a.ok || !b.ok) throw new Error('seed');
    const first = await bindIdentity(db, { authIdentityId: a.value.id, guestId: f.guests.amara, role: 'self', claimMethod: 'otp', actor: { kind: 'system', component: 'race' }, requestId: 'race2', audit });
    expect(first.ok).toBe(true);
    await db.update(guestAccessBindings).set({ revokedAt: new Date(), revokedReason: 'test' }).where(eq(guestAccessBindings.guestId, f.guests.amara));
    const second = await bindIdentity(db, { authIdentityId: b.value.id, guestId: f.guests.amara, role: 'self', claimMethod: 'otp', actor: { kind: 'system', component: 'race' }, requestId: 'race2', audit });
    expect(second.ok).toBe(true);
    const third = await bindIdentity(db, { authIdentityId: a.value.id, guestId: f.guests.amara, role: 'self', claimMethod: 'otp', actor: { kind: 'system', component: 'race' }, requestId: 'race2', audit });
    expect(third.ok).toBe(false);
  });
});
