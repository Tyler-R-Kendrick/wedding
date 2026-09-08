import { describe, expect, it } from 'vitest';
import { adminSearchAudit } from '@/capabilities/ops';
import { siteStatus } from '@/capabilities';
import type { AdminId, AuthIdentityId } from '@/contracts/ids';
import type { AdminPrincipal } from '@/contracts/principal';
import { getDb } from '@/db/client';
import { auditEvents } from '@/db/schema';
import { newId } from '@/contracts/ids';
import { DbAuditSink } from '@/lib/audit';
import { expectErr, expectOk, run } from './helpers/swarm-e';

const admin = (entitlements: string[] = ['admin_audit']): AdminPrincipal => ({
  kind: 'admin',
  authIdentityId: 'A' as AuthIdentityId,
  adminId: 'AD-AUD' as AdminId,
  roles: new Set(['moderator']),
  entitlements: new Set(entitlements as never),
  authenticatedAt: new Date().toISOString(),
  sessionId: 'aud-session',
});

const search = async (input: unknown, p = admin()) => expectOk(await run(adminSearchAudit, p, input)).data;

describe('admin_search_audit', () => {
  it('requires admin_audit', async () => {
    expect(expectErr(await run(adminSearchAudit, admin(['admin_content']), {})).code).toBe('forbidden');
  });

  it('finds the rows the pipeline itself writes, filtered by action, outcome and request id', async () => {
    await run(siteStatus, { kind: 'anonymous' }, {}, { requestId: 'req-audit-seed' });
    const byRequest = await search({ requestId: 'req-audit-seed' });
    expect(byRequest.rows).toHaveLength(1);
    expect(byRequest.rows[0]).toMatchObject({ action: 'capability.invoked', targetType: 'capability', targetId: 'site_status', outcome: 'success' });
    expect(byRequest.rows[0]!.actor).toEqual({ kind: 'anonymous', ref: null });

    const denied = await search({ outcome: 'denied' });
    expect(denied.rows.every((r) => r.outcome === 'denied')).toBe(true);

    const byAction = await search({ actions: ['capability.invoked'] });
    expect(byAction.rows.every((r) => r.action === 'capability.invoked')).toBe(true);
  });

  it('never renders a value that the audit trail is supposed to hide', async () => {
    // The row a careless future level writes. `redactForAudit` catches three of these on the way in;
    // `guestEmail` it does not (its pattern is anchored), and the read side is what stops it.
    const db = await getDb();
    await new DbAuditSink(db).record({
      actor: { kind: 'system', component: 'test' },
      action: 'identity.reset',
      target: { type: 'guest', id: 'G-LEAK' },
      outcome: 'success',
      requestId: 'req-audit-leak',
      metadata: { otp: '483920', voucherCode: 'UBER-SECRET', needs: 'severe nut allergy', guestEmail: 'leak@example.com', reason: 'she called from 555-0100', includeNeeds: true },
    });
    const page = await search({ requestId: 'req-audit-leak' });
    const row = page.rows[0]!;
    const rendered = JSON.stringify(row);
    for (const secret of ['483920', 'UBER-SECRET', 'nut allergy', 'leak@example.com', '555-0100']) {
      expect(rendered).not.toContain(secret);
    }
    expect(row.metadata).toMatchObject({ otp: '[redacted]', guestEmail: '[redacted]', reason: '[withheld]', includeNeeds: 'true' });
    expect(row.metadataRedacted).toBe(true);
  });

  it('pages with a keyset cursor and never repeats or skips a row', async () => {
    const db = await getDb();
    const sink = new DbAuditSink(db);
    for (let i = 0; i < 7; i++) {
      await sink.record({ actor: { kind: 'system', component: 'test' }, action: 'content.updated', target: { type: 'page', id: `p${i}` }, outcome: 'success', requestId: `req-page-${i}` });
    }
    const first = await search({ actions: ['content.updated'], limit: 3 });
    expect(first.rows).toHaveLength(3);
    expect(first.nextCursor).not.toBeNull();
    const second = await search({ actions: ['content.updated'], limit: 3, cursor: first.nextCursor });
    expect(second.rows).toHaveLength(3);
    const third = await search({ actions: ['content.updated'], limit: 3, cursor: second.nextCursor });
    const ids = [...first.rows, ...second.rows, ...third.rows].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(7);
    expect(third.nextCursor).toBeNull();
  });

  it('orders by time then id, so rows written in the same millisecond still page correctly', async () => {
    const db = await getDb();
    const at = new Date('2027-01-01T00:00:00.000Z');
    const ids = [newId(), newId(), newId()].sort();
    for (const id of ids) {
      await db.insert(auditEvents).values({ id, at, actor: { kind: 'system', component: 'tie' }, action: 'content.verified', targetType: 'tie', targetId: id, outcome: 'success', requestId: 'req-tie', metadata: null });
    }
    const page1 = await search({ requestId: 'req-tie', limit: 2 });
    const page2 = await search({ requestId: 'req-tie', limit: 2, cursor: page1.nextCursor });
    expect([...page1.rows, ...page2.rows].map((r) => r.id)).toEqual([...ids].reverse());
  });

  it('reports totals by outcome and the busiest actions', async () => {
    const totals = await search({});
    expect(totals.window.total).toBeGreaterThan(0);
    expect(Object.keys(totals.window.byOutcome).length).toBeGreaterThan(0);
    expect(totals.window.topActions.length).toBeGreaterThan(0);
    expect(totals.window.topActions[0]!.count).toBeGreaterThanOrEqual(totals.window.topActions.at(-1)!.count);
  });

  it('is not offered to the concierge or to WebMCP', async () => {
    expect(adminSearchAudit.exposure).toEqual({ ui: true, ai: false, webmcp: false });
    expect(expectErr(await run(adminSearchAudit, admin(), {}, { surface: 'ai' })).code).toBe('not_found');
  });
});
