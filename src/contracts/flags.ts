/**
 * Feature flags. Defaults are the production-safe values. Legal/rights gates
 * are OFF and require an explicit readiness switch in addition to the flag.
 */
export const FEATURE_FLAGS = {
  /** Illinois BIPA: production face matching stays off until counsel review + readiness. */
  BIOMETRICS_ENABLED: false,
  /** Third-party AI processing of professionally delivered media (needs written vendor confirmation). */
  PRO_MEDIA_AI_PROCESSING: false,
  /** Floating design switcher (Gilded Hour / Conservatory) visible to everyone. */
  DESIGN_SWITCHER: true,
  /** Register WebMCP tools when `document.modelContext` exists. */
  WEBMCP: true,
  /** Embedded concierge (uses the mock model when no provider key is configured). */
  AI_CONCIERGE: true,
  /** Guest media uploads (QR upload page). */
  GUEST_UPLOADS: true,
  /** Semantic media search (non-biometric). */
  MEDIA_SEMANTIC_SEARCH: true,
  /** Live flight/hotel search tools (adapters fall back to deep links when unconfigured). */
  TRAVEL_LIVE_SEARCH: true,
  /** Transportation benefit claims (Uber vouchers / manual codes). */
  TRANSPORT_BENEFITS: true,
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;
export type FlagValues = { [K in FeatureFlag]: boolean };

const TRUTHY = new Set(['1', 'true', 'on', 'yes']);
const FALSY = new Set(['0', 'false', 'off', 'no']);

/**
 * Resolve flags from an env-like record: `FLAG_<NAME>=on|off` overrides the default.
 * Public flags (needed in the browser) are mirrored by the app as NEXT_PUBLIC_FLAG_<NAME>.
 */
export function readFlags(env: Record<string, string | undefined>): FlagValues {
  const out = { ...FEATURE_FLAGS } as FlagValues;
  for (const name of Object.keys(FEATURE_FLAGS) as FeatureFlag[]) {
    const raw = env[`FLAG_${name}`] ?? env[`NEXT_PUBLIC_FLAG_${name}`];
    if (raw === undefined) continue;
    const v = raw.trim().toLowerCase();
    if (TRUTHY.has(v)) out[name] = true;
    else if (FALSY.has(v)) out[name] = false;
  }
  return out;
}

/** Flags that additionally require a persisted readiness switch (admin + legal) before they take effect. */
export const READINESS_GATED: readonly FeatureFlag[] = ['BIOMETRICS_ENABLED', 'PRO_MEDIA_AI_PROCESSING'];
