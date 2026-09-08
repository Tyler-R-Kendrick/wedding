import { inArray } from 'drizzle-orm';
import { FEATURE_FLAGS, READINESS_GATED, type FeatureFlag, type FlagValues } from '@/contracts/flags';
import type { Db } from '@/db/client';
import { featureFlags } from '@/db/schema';

/**
 * A flag whose persisted readiness switch is held shut by something outside this application:
 * a signature, a review, a piece of paper. The application cannot observe any of them, so
 * `preconditionMet` is a literal `false` in source — the only way it becomes true is a person
 * editing this file, in a diff, with the evidence in the commit message.
 *
 * This is why this console has no "turn it on" control. `setReadiness` has exactly two callers
 * (`admin_enable_biometric_readiness`, `admin_disable_biometric_readiness`); the enable side is
 * behind a counsel-review reference, step-up and a single-use UI-only confirmation on
 * `/admin/biometrics`, and `PRO_MEDIA_AI_PROCESSING` has no enable path anywhere in the app at all.
 * A generic "flip any readiness switch" capability would have replaced both of those with one
 * button, so this level did not build one. See `tests/integration/ops-flags.test.ts`, which fails
 * if a future level adds one.
 */
export interface LegalGate {
  flag: FeatureFlag;
  /** Backlog ids in docs/content/backlog.md that must close first. */
  backlogIds: string[];
  requirement: string;
  /** The screen that owns the switch, when one does. Null means no screen may flip it. */
  ownedBy: { label: string; route: string } | null;
  preconditionMet: false;
}

export const LEGAL_GATES: Readonly<Partial<Record<FeatureFlag, LegalGate>>> = {
  BIOMETRICS_ENABLED: {
    flag: 'BIOMETRICS_ENABLED',
    backlogIds: ['X-05'],
    requirement: 'Illinois privacy counsel has reviewed the consent text, retention schedule and vendor arrangement (ADR-0006 §7), and the retention period and counsel name are settled.',
    ownedBy: { label: 'Face matching', route: '/admin/biometrics' },
    preconditionMet: false,
  },
  PRO_MEDIA_AI_PROCESSING: {
    flag: 'PRO_MEDIA_AI_PROCESSING',
    backlogIds: ['C-09', 'V-03'],
    requirement: 'Written confirmation from Brooke Alaina Photography and Oakhouse Visuals that professionally delivered media may be processed by third-party AI.',
    ownedBy: null,
    preconditionMet: false,
  },
};

export const legalGateFor = (flag: FeatureFlag): LegalGate | null => LEGAL_GATES[flag] ?? null;

export interface FlagView {
  name: FeatureFlag;
  /** The shipped default in `src/contracts/flags.ts`. */
  defaultValue: boolean;
  /** What `FLAG_<NAME>` resolves to in this environment. */
  envValue: boolean;
  /** True when the environment overrides the shipped default. */
  overridden: boolean;
  readinessGated: boolean;
  /** The persisted switch; null for a flag that is not readiness-gated. */
  readiness: boolean | null;
  /** Env value AND (not gated OR readiness on). What the pipeline actually enforces. */
  effective: boolean;
  updatedAt: string | null;
  updatedBy: { kind: string; ref: string | null } | null;
  /** Whether a justification is recorded on the row. The text itself is not returned. */
  hasNote: boolean;
  gate: LegalGate | null;
}

/**
 * Every flag, with both halves of its gate and who moved the persisted half last. The recorded
 * justification (`feature_flags.note`) is reported as present/absent rather than returned: it is
 * free text an admin typed, it is already on the screen that owns the switch, and this page is
 * read by roles that do not own it.
 */
export async function flagInventory(db: Db, flags: FlagValues): Promise<FlagView[]> {
  const gated = READINESS_GATED as readonly FeatureFlag[];
  const rows = gated.length ? await db.select().from(featureFlags).where(inArray(featureFlags.name, gated as string[])) : [];
  const byName = new Map(rows.map((r) => [r.name, r]));
  return (Object.keys(FEATURE_FLAGS) as FeatureFlag[]).map((name) => {
    const isGated = gated.includes(name);
    const row = byName.get(name);
    const readiness = isGated ? row?.readiness === true : null;
    const actor = row?.updatedBy as Record<string, unknown> | null | undefined;
    const ref = actor ? (actor.adminId ?? actor.guestId ?? actor.component ?? null) : null;
    return {
      name,
      defaultValue: FEATURE_FLAGS[name],
      envValue: flags[name],
      overridden: flags[name] !== FEATURE_FLAGS[name],
      readinessGated: isGated,
      readiness,
      effective: flags[name] && (!isGated || readiness === true),
      updatedAt: row?.updatedAt?.toISOString() ?? null,
      updatedBy: actor ? { kind: String(actor.kind ?? 'unknown'), ref: typeof ref === 'string' ? ref : null } : null,
      hasNote: Boolean(row?.note),
      gate: legalGateFor(name),
    };
  });
}
