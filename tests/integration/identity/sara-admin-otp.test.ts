import { describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { seed } from '@/db/seed/seed';
import { resolveAdminRoles } from '@/domain/identity/principal';
import { call, expectOk } from './harness';

describe('Sara administrator access', () => {
  it('grants owner through admin_roles after migrations', async () => {
    const db = await getDb();
    await seed(db);
    const roles = await resolveAdminRoles(db, 'safitzgerald7@gmail.com', []);
    expect([...roles]).toEqual(['owner']);
  });

  it('accepts request_otp for the owner email without a guest invitation', async () => {
    const sent = expectOk(
      await call<{ sent: boolean }>('request_otp', { purpose: 'sign_in', email: 'safitzgerald7@gmail.com' }, { ip: '10.9.9.9' }),
    );
    expect(sent.data.sent).toBe(true);
  });
});
