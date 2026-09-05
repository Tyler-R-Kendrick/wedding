import { describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { DbAuditSink, listAuditEvents } from '@/lib/audit';

describe('DbAuditSink', () => {
  it('writes append-only rows with redacted metadata', async () => {
    const db = await getDb();
    const sink = new DbAuditSink(db);
    const id = await sink.record({
      actor: { kind: 'system', component: 'test' },
      action: 'flag.changed',
      target: { type: 'feature_flag', id: 'X' },
      outcome: 'success',
      requestId: 'req-audit-1',
      metadata: { otp: '123456', voucherCode: 'ABC', readiness: true, nested: { a: 1 } },
    });
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    const rows = await listAuditEvents(db, { requestId: 'req-audit-1' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'flag.changed', targetType: 'feature_flag', targetId: 'X', outcome: 'success' });
    expect(rows[0]!.metadata).toEqual({ otp: '[redacted]', voucherCode: '[redacted]', readiness: true, nested: '[object]' });
    expect(await listAuditEvents(db, { action: 'flag.changed', targetType: 'feature_flag', targetId: 'X', limit: 5 })).toHaveLength(1);
  });
});
