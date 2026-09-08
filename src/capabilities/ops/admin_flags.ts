import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { FEATURE_FLAGS, READINESS_GATED, type FeatureFlag } from '@/contracts/flags';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { flagInventory, legalGateFor } from '@/domain/ops';
import { setReadiness } from '@/lib/flags';
import { actorSchema, opsDb } from './_shared';

const flagNames = Object.keys(FEATURE_FLAGS) as [FeatureFlag, ...FeatureFlag[]];
const flagName = z.enum(flagNames);
const gatedFlagName = z.enum(READINESS_GATED as unknown as [FeatureFlag, ...FeatureFlag[]]);

const gateSchema = z
  .object({
    flag: flagName,
    backlogIds: z.array(z.string()),
    requirement: z.string(),
    ownedBy: z.object({ label: z.string(), route: z.string() }).nullable(),
    preconditionMet: z.literal(false),
  })
  .nullable();

const flagSchema = z.object({
  name: flagName,
  defaultValue: z.boolean(),
  envValue: z.boolean(),
  overridden: z.boolean(),
  readinessGated: z.boolean(),
  readiness: z.boolean().nullable(),
  effective: z.boolean(),
  updatedAt: z.string().nullable(),
  updatedBy: actorSchema.nullable(),
  hasNote: z.boolean(),
  gate: gateSchema,
});

const statusOutput = z.object({
  flags: z.array(flagSchema),
  /**
   * Why this console has no control that turns a readiness switch on. Rendered verbatim so the
   * absence reads as a decision rather than as something nobody got round to.
   */
  enablement: z.object({
    available: z.literal(false),
    reason: z.string(),
  }),
});
export type FlagStatusView = z.infer<typeof statusOutput>;

const ENABLEMENT_REASON =
  'Readiness switches cannot be turned on from this page. Both are legal gates whose precondition is a document this application cannot see: ' +
  'BIOMETRICS_ENABLED is switched on only from Face matching, behind a counsel-review reference, a fresh session and a single-use confirmation; ' +
  'PRO_MEDIA_AI_PROCESSING has no enable path anywhere in the app, and gets one when backlog C-09 and V-03 close.';

/**
 * Both halves of every feature gate: the environment flag and, for the two readiness-gated flags,
 * the persisted switch, who moved it last, and the legal precondition that holds it shut.
 *
 * The recorded justification on a readiness row (`feature_flags.note`) is reported as present or
 * absent, not returned: it is free text, and the screen that owns the switch already shows it to
 * the entitlement that owns it.
 */
const statusInput = z.object({}).optional();

export const adminFlagStatus = defineCapability<z.infer<typeof statusInput>, FlagStatusView>({
  name: 'admin_flag_status',
  title: 'Feature flags',
  description: 'Every feature flag: its shipped default, what the environment resolves it to, whether it is readiness-gated, the persisted readiness switch with who moved it and when, and what the pipeline actually enforces. Also states why readiness cannot be switched on here. Admins only; reads only.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_lifecycle'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input: statusInput,
  output: statusOutput,
  maxOutputChars: 40_000,
  async handler(ctx) {
    return ok({ data: { flags: await flagInventory(opsDb(ctx), ctx.flags), enablement: { available: false, reason: ENABLEMENT_REASON } }, sources: [] });
  },
});

const disableInput = z.object({ flag: gatedFlagName });
const disableOutput = z.object({ flag: flagName, envValue: z.boolean(), readiness: z.boolean(), effective: z.boolean(), changed: z.boolean() });

/**
 * The off switch, and only the off switch.
 *
 * Deliberately the weakest door in the console — no confirmation token, no reference, no feature
 * flag, no step-up — for the same reason a guest's withdrawal of biometric consent is
 * unconditional: turning a legal gate OFF must never be blocked by a missing precondition, and must
 * not depend on holding the entitlement that owns the feature. `admin_disable_biometric_readiness`
 * already exists but requires `admin_ai`, which a planner does not hold; this one requires
 * `admin_lifecycle`, so whoever is running the site on the day can always close the gate.
 *
 * There is no matching enable capability, and that is the point: `setReadiness(…, ready: true)` has
 * exactly one caller in the whole application, behind counsel review on `/admin/biometrics`.
 * `tests/integration/ops-flags.test.ts` fails if a second one appears.
 */
export const adminDisableFlagReadiness = defineCapability<z.infer<typeof disableInput>, z.infer<typeof disableOutput>>({
  name: 'admin_disable_flag_readiness',
  title: 'Switch a readiness gate off',
  description: 'Turns the persisted readiness switch of a legally gated feature (BIOMETRICS_ENABLED, PRO_MEDIA_AI_PROCESSING) off, immediately, clearing the justification recorded on the row. There is no corresponding switch-on: that is not something this console can do. Admins only.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_lifecycle'],
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  exposure: { ui: true, ai: false, webmcp: false },
  input: disableInput,
  output: disableOutput,
  async handler(ctx, i) {
    if (!legalGateFor(i.flag)) {
      return err(new CapabilityError('validation', 'That flag has no readiness switch.', { issues: [{ path: 'flag', message: 'not readiness-gated' }] }));
    }
    const db = opsDb(ctx);
    const before = await flagInventory(db, ctx.flags);
    const was = before.find((f) => f.name === i.flag)?.readiness === true;
    await setReadiness(db, { flag: i.flag, ready: false, actor: toPrincipalRef(ctx.principal), requestId: ctx.requestId, audit: ctx.audit });
    return ok({ data: { flag: i.flag, envValue: ctx.flags[i.flag], readiness: false, effective: false, changed: was }, sources: [] });
  },
});
