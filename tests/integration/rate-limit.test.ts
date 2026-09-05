import { describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { DbRateLimit } from '@/providers/rate-limit';

describe('DbRateLimit', () => {
  it('persists a token bucket per key and refills over time', async () => {
    const db = await getDb();
    let now = 1_000_000;
    const rl = new DbRateLimit(db, () => now);
    const policy = { capacity: 3, refillPerSecond: 1 };
    expect((await rl.consume('otp:a', policy)).remaining).toBe(2);
    expect((await rl.consume('otp:a', policy)).remaining).toBe(1);
    expect((await rl.consume('otp:a', policy)).remaining).toBe(0);
    const denied = await rl.consume('otp:a', policy);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect((await rl.consume('otp:b', policy)).allowed).toBe(true);
    now += 2_000;
    expect((await rl.consume('otp:a', policy)).remaining).toBe(1);
    await rl.reset('otp:a');
    expect((await rl.consume('otp:a', policy)).remaining).toBe(2);
    expect((await rl.consume('cap:x', 'capability')).remaining).toBe(59);
  });
});
