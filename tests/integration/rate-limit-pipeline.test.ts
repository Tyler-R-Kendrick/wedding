import { beforeAll, describe, expect, it } from 'vitest';
import { createCapabilityContext, invoke } from '@/capabilities';
import { listMyEvents } from '@/capabilities/rsvp';
import { newId } from '@/contracts/ids';
import { fixturePrincipal } from '@/db/seed/fixtures';
import { seedSwarmE } from './helpers/swarm-e';

/**
 * The per-principal budget lives inside `invoke`, not in the JSON capability route, so that every
 * entry point shares it. Before this, `src/app/(guest)/rsvp/actions.ts` reached `invoke` through
 * `uiContext` and was unlimited: a signed-in guest could drive unbounded RSVP submissions, each
 * writing an outbox row and enqueuing an e-mail job. Idempotency does not help — the client picks a
 * fresh key every submit.
 */
describe('the capability pipeline owns the per-principal rate limit', () => {
  beforeAll(async () => {
    await seedSwarmE();
  });

  const call = (rateLimit: boolean) =>
    createCapabilityContext({ principal: fixturePrincipal('A1'), requestId: `req-${newId()}`, surface: 'ui', rateLimit }).then((ctx) => invoke(listMyEvents, ctx, {}));

  it('refuses once the budget is spent, wherever the caller entered from', async () => {
    // capacity is 60 with a 1/s refill; 80 back-to-back calls must hit the wall.
    let limited = 0;
    for (let i = 0; i < 80; i++) {
      const r = await call(true);
      if (!r.ok && r.error.code === 'rate_limited') limited++;
    }
    expect(limited).toBeGreaterThan(0);
  });

  it('does not limit in-process callers that do not wire it (tests, seeding)', async () => {
    const results = await Promise.all(Array.from({ length: 30 }, () => call(false)));
    expect(results.every((r) => r.ok || r.error.code !== 'rate_limited')).toBe(true);
  });
});
