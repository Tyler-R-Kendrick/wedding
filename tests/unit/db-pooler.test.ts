import { describe, expect, it } from 'vitest';
import { usesTransactionPooler } from '@/db/client';

/**
 * postgres-js prepares every static query unless told not to, and PgBouncer in transaction mode
 * cannot serve a prepared statement across connections. The deploy runbook mandates Supabase's
 * pooled string and the Vercel connector injects exactly that, so getting this wrong is not an
 * edge case — it is an intermittent "prepared statement does not exist" once guests arrive.
 */
describe('recognising a transaction-mode pooler', () => {
  it('recognises the shapes the connectors actually hand out', () => {
    expect(usesTransactionPooler('postgres://u:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres')).toBe(true);
    expect(usesTransactionPooler('postgres://u:p@db.example.test:5432/app?pgbouncer=true')).toBe(true);
    expect(usesTransactionPooler('postgres://u:p@ep-cool-name-pooler.us-east-2.aws.neon.tech/app')).toBe(true);
  });

  it('leaves a direct connection alone, where prepared statements are the faster path', () => {
    expect(usesTransactionPooler('postgres://u:p@db.abcdefgh.supabase.co:5432/postgres')).toBe(false);
    expect(usesTransactionPooler('postgres://u:p@localhost:5432/wedding')).toBe(false);
    expect(usesTransactionPooler('postgres://u:p@db.example.test:5432/app?pgbouncer=false')).toBe(false);
  });

  it('says no rather than throwing on something that is not a URL', () => {
    expect(usesTransactionPooler('not a url')).toBe(false);
  });
});
