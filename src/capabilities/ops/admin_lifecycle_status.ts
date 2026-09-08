import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { LIFECYCLE_STATES } from '@/contracts/lifecycle';
import { ok } from '@/contracts/result';
import { getLifecycle, getSiteSettings } from '@/db/repos/site';
import { lifecycleStatus } from '@/domain/ops';
import { PREVIEW_TTL_SECONDS } from '@/domain/lifecycle/constants';
import { actorSchema, lifecycleStateSchema, metadataSchema, opsDb } from './_shared';

const input = z.object({ historyLimit: z.number().int().min(1).max(100).optional() }).optional();

const output = z.object({
  state: lifecycleStateSchema,
  mode: z.string(),
  publishedAt: z.string().nullable(),
  publishedBy: actorSchema.nullable(),
  note: z.string().nullable(),
  suggested: lifecycleStateSchema,
  behindSchedule: z.boolean(),
  states: z.array(lifecycleStateSchema),
  transitions: z.array(
    z.object({
      to: lifecycleStateSchema,
      direction: z.enum(['forward', 'back']),
      navGained: z.array(z.string()),
      navLost: z.array(z.string()),
      mode: z.string(),
    }),
  ),
  history: z.array(
    z.object({ id: z.string(), at: z.string(), action: z.string(), actor: actorSchema, outcome: z.string(), requestId: z.string(), metadata: metadataSchema }),
  ),
  /** How long a minted preview stays valid. A rehearsal is a session, not a setting (ADR-0012 §3). */
  previewTtlSeconds: z.number().int(),
});
export type LifecycleStatus = z.infer<typeof output>;

/**
 * What state the site is published in, what the calendar suggests, where it may go next and what
 * each move changes for a guest. Manual publish always beats the wall clock, so `suggested` is a
 * proposal and never applied by anything (ADR-0012 §2).
 */
export const adminLifecycleStatus = defineCapability<z.infer<typeof input>, LifecycleStatus>({
  name: 'admin_lifecycle_status',
  title: 'Lifecycle',
  description: 'The published lifecycle state, who published it and when, the state the calendar suggests, the transitions allowed from here with the guest navigation each one changes, and the recent publish/preview trail. Admins only; reads only.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_lifecycle'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  maxOutputChars: 60_000,
  async handler(ctx, i) {
    const db = opsDb(ctx);
    const [row, site] = await Promise.all([getLifecycle(db), getSiteSettings(db)]);
    const status = await lifecycleStatus(db, {
      state: row?.state ?? LIFECYCLE_STATES[0],
      publishedAt: row?.publishedAt ?? null,
      publishedBy: row?.publishedBy ?? null,
      note: row?.note ?? null,
      now: ctx.now,
      weddingDateIso: site?.weddingDate,
      historyLimit: i?.historyLimit,
    });
    return ok({ data: { ...status, previewTtlSeconds: PREVIEW_TTL_SECONDS }, sources: [] });
  },
});
