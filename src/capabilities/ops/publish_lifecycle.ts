import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { canTransition, LIFECYCLE_STATES } from '@/contracts/lifecycle';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { getLifecycle, setLifecycle } from '@/db/repos/site';
import { describeTransition } from '@/domain/ops';
import { stableHash } from '@/lib/crypto';
import type { ConfirmationService } from '@/policy/confirmation';
import { requireService } from '../services';
import { lifecycleStateSchema, opsDb } from './_shared';

/** The exact payload the confirm step receives, and what the token is bound to. */
const publishInput = z.object({
  to: lifecycleStateSchema,
  /** Why, in the publisher's words. Stored on the row; admin-only. */
  note: z.string().trim().max(500).optional(),
});

const draftOutput = z.object({
  from: lifecycleStateSchema,
  publish: z.object({ to: lifecycleStateSchema, note: z.string().optional() }),
  direction: z.enum(['forward', 'back']),
  navGained: z.array(z.string()),
  navLost: z.array(z.string()),
  consequences: z.array(z.string()),
});

/**
 * Draft step for publishing a new lifecycle state. Publishing reconfigures every guest-facing page
 * at once — navigation, the home page's primary action, whether RSVP is open — so it gets the same
 * shape as the other consequential switches in this app: a proposal that restates what changes, and
 * a single-use confirmation token bound to the exact state and note being published.
 */
export const draftLifecycleTransition = defineCapability<z.infer<typeof publishInput>, z.infer<typeof draftOutput>>({
  name: 'draft_lifecycle_transition',
  title: 'Review a lifecycle change',
  description: 'Restates what moving the site to another lifecycle state changes for guests and returns a confirmation token bound to that exact state and note. No side effects. Admins only.',
  kind: 'draft',
  auth: 'admin',
  requires: ['admin_lifecycle'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input: publishInput,
  output: draftOutput,
  async handler(ctx, i) {
    const db = opsDb(ctx);
    const from = (await getLifecycle(db))?.state ?? LIFECYCLE_STATES[0];
    if (!canTransition(from, i.to)) {
      return err(new CapabilityError('conflict', `Cannot move the site from ${from} to ${i.to}.`, { from, to: i.to }));
    }
    const change = describeTransition(from, i.to);
    // Exactly the parsed shape the confirm step will present, key for key: the pipeline hashes the
    // validated input, and `canonicalJson` drops undefined but keeps an empty string, so an omitted
    // note and a blank one are different payloads and must be carried through unchanged.
    const payload = { to: i.to, ...(i.note !== undefined ? { note: i.note } : {}) };
    const confirmation = requireService<ConfirmationService>(ctx, 'confirmation');
    const issued = confirmation.issue(
      { capability: 'admin_publish_lifecycle', principalRef: toPrincipalRef(ctx.principal), payloadHash: stableHash(payload), surface: ctx.surface ?? 'ui' },
      { now: ctx.now },
    );
    return ok({
      data: {
        from,
        publish: payload,
        direction: change.direction,
        navGained: change.navGained,
        navLost: change.navLost,
        consequences: [
          `Every guest sees ${i.to} on their next page load; there is no per-guest rollout.`,
          change.navGained.length ? `Navigation gains: ${change.navGained.join(', ')}.` : 'Navigation gains nothing.',
          change.navLost.length ? `Navigation loses: ${change.navLost.join(', ')}.` : 'Navigation loses nothing.',
          'The RSVP window follows the lifecycle unless it has been set to open or closed manually on Events.',
          change.direction === 'back' ? 'Going back one state is allowed once; from there only forward.' : 'Going back is allowed by exactly one state afterwards.',
        ],
      },
      sources: [],
      confirmation: { token: issued.token, expiresAt: issued.expiresAt, summary: `Publish ${from} → ${i.to}` },
    });
  },
});

const publishOutput = z.object({
  from: lifecycleStateSchema,
  state: lifecycleStateSchema,
  publishedAt: z.string(),
  note: z.string().nullable(),
});

/**
 * Publishes a lifecycle state. `setLifecycle` re-validates the transition against the row it is
 * about to overwrite (the draft's check is advisory: the state can move between the two calls) and
 * writes the `lifecycle.published` audit row.
 */
export const adminPublishLifecycle = defineCapability<z.infer<typeof publishInput>, z.infer<typeof publishOutput>>({
  name: 'admin_publish_lifecycle',
  title: 'Publish a lifecycle state',
  description: 'Moves the published lifecycle state forward (any distance) or back by one, for every guest at once. Requires the confirmation token from draft_lifecycle_transition. Admins only.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_lifecycle'],
  confirmation: 'explicit',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  exposure: { ui: true, ai: false, webmcp: false },
  input: publishInput,
  output: publishOutput,
  async handler(ctx, i) {
    const db = opsDb(ctx);
    const from = (await getLifecycle(db))?.state ?? LIFECYCLE_STATES[0];
    const result = await setLifecycle(db, {
      to: i.to,
      actor: toPrincipalRef(ctx.principal),
      requestId: ctx.requestId,
      audit: ctx.audit,
      ...(i.note ? { note: i.note } : {}),
    });
    if (!result.ok) return err(result.error);
    return ok({ data: { from, state: result.value.state, publishedAt: (result.value.publishedAt ?? ctx.now).toISOString(), note: result.value.note }, sources: [] });
  },
});
