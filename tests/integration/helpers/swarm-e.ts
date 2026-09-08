import { createCapabilityContext, invoke } from '@/capabilities';
import type { CapabilityDescriptor, CapabilityExposure } from '@/contracts/capability';
import { newId } from '@/contracts/ids';
import type { Principal } from '@/contracts/principal';
import { getDb } from '@/db/client';
import { seedTestFixtures } from '@/db/seed/fixtures';
import { seedEventsAndPlans } from '@/domain/events/seed';

/** Seeds Swarm E's events/plans and the fictional fixture households on the per-file PGlite. */
export async function seedSwarmE() {
  const db = await getDb();
  await seedEventsAndPlans(db);
  await seedTestFixtures(db);
  return db;
}

export interface RunOptions {
  surface?: keyof CapabilityExposure;
  idempotencyKey?: string;
  /** Send no idempotency key at all (to prove the pipeline demands one). */
  noKey?: boolean;
  confirmationToken?: string;
  now?: Date;
  requestId?: string;
}

/** Runs a capability through the real pipeline as `principal`. Mutations get a fresh key unless one is given. */
export async function run<I, O>(cap: CapabilityDescriptor<I, O>, principal: Principal, input: unknown, opts: RunOptions = {}) {
  const mutation = cap.kind === 'action' || cap.kind === 'transaction' || cap.kind === 'external';
  const ctx = await createCapabilityContext({
    principal,
    requestId: opts.requestId ?? `req-${newId()}`,
    surface: opts.surface ?? 'ui',
    idempotencyKey: opts.noKey ? undefined : (opts.idempotencyKey ?? (mutation && cap.idempotent ? newId() : undefined)),
    confirmationToken: opts.confirmationToken,
    now: opts.now,
  });
  return invoke(cap, ctx, input);
}

/**
 * Calls a capability's HANDLER directly, with the same context `run` builds but no pipeline.
 *
 * Needed since level 15: `guestIdentityRequired` refuses an admin inside `authorize()` (pipeline
 * step 3), which is upstream of the handler's own guest-only guard. A test that drives an admin
 * through `run` therefore proves the pipeline refuses, and says nothing at all about the guard —
 * so the guard could be deleted with the test still green. Use this to keep the guard covered:
 * the two layers are deliberately independent, and the handler is the one that survives a
 * descriptor being edited.
 */
export async function runHandler<I, O>(cap: CapabilityDescriptor<I, O>, principal: Principal, input: I, opts: RunOptions = {}) {
  const ctx = await createCapabilityContext({
    principal,
    requestId: opts.requestId ?? `req-${newId()}`,
    surface: opts.surface ?? 'ui',
    idempotencyKey: opts.idempotencyKey,
    confirmationToken: opts.confirmationToken,
    now: opts.now,
  });
  return cap.handler(ctx, input);
}

export function expectOk<T, E>(r: { ok: true; value: T } | { ok: false; error: E }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
}

export function expectErr<T, E>(r: { ok: true; value: T } | { ok: false; error: E }): E {
  if (r.ok) throw new Error(`expected error, got ok ${JSON.stringify(r.value).slice(0, 300)}`);
  return r.error;
}
