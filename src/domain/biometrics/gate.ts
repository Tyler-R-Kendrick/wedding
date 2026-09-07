import type { CapabilityContext } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import type { FeatureFlag } from '@/contracts/flags';
import type { GuestPrincipal, Principal } from '@/contracts/principal';
import { err, ok, type Result } from '@/contracts/result';
import { getDb, type Db } from '@/db/client';
import { setBiometricConsentLookup } from '@/providers/biometric';
import { getConsentState, hasCurrentConsent } from './consent';

/**
 * THE gate. Every biometric operation goes through `biometricGate` before any provider call:
 *   1. FLAG BIOMETRICS_ENABLED (env) must be on, else feature_disabled
 *   2. the persisted readiness switch (counsel review) must be on, else feature_disabled
 *   3. the guest must hold a current, versioned consent, else conflict { reason: 'consent_required' }
 * The provider's own `assertReady(subjectId)` re-checks the same three facts through the consent
 * lookup installed below, so a caller that bypasses the domain still cannot do biometric work.
 */
export type GateRefusal = { code: 'feature_disabled'; reason: 'flag_off' | 'readiness_off' } | { code: 'conflict'; reason: 'consent_required' | 'consent_superseded' | 'consent_revoked' } | { code: 'forbidden'; reason: 'not_a_guest' };

export interface GateDeps {
  flags: Pick<Record<FeatureFlag, boolean>, 'BIOMETRICS_ENABLED'>;
  readiness?: (flag: FeatureFlag) => Promise<boolean>;
  db: Db;
}

/** Flag + readiness only (no subject). */
export async function biometricFeatureReady(deps: Pick<GateDeps, 'flags' | 'readiness'>): Promise<{ ready: true } | { ready: false; reason: 'flag_off' | 'readiness_off' }> {
  if (!deps.flags.BIOMETRICS_ENABLED) return { ready: false, reason: 'flag_off' };
  // Readiness-gated flags fail closed without a readiness service (same rule as the invoke pipeline).
  const ready = deps.readiness ? await deps.readiness('BIOMETRICS_ENABLED') : false;
  if (!ready) return { ready: false, reason: 'readiness_off' };
  return { ready: true };
}

export async function biometricGate(deps: GateDeps, principal: Principal): Promise<Result<{ guest: GuestPrincipal; consentId: string }, GateRefusal>> {
  const feature = await biometricFeatureReady(deps);
  if (!feature.ready) return err({ code: 'feature_disabled', reason: feature.reason });
  if (principal.kind !== 'guest') return err({ code: 'forbidden', reason: 'not_a_guest' });
  const state = await getConsentState(deps.db, principal.guestId);
  if (!hasCurrentConsent(state)) {
    const reason = state.status === 'superseded' ? 'consent_superseded' : state.status === 'revoked' ? 'consent_revoked' : 'consent_required';
    return err({ code: 'conflict', reason });
  }
  return ok({ guest: principal, consentId: state.grant!.id });
}

export function gateError(refusal: GateRefusal): CapabilityError {
  switch (refusal.code) {
    case 'feature_disabled':
      return new CapabilityError('feature_disabled', 'Face matching is not available.', { reason: refusal.reason });
    case 'conflict':
      return new CapabilityError('conflict', 'Please review and agree to the face-matching consent first.', { reason: refusal.reason });
    case 'forbidden':
      return new CapabilityError('forbidden', 'Face matching is only available to signed-in guests, for their own photos.');
  }
}

/** Convenience for capability handlers: gate deps from a capability context. */
export function gateDepsFrom(ctx: CapabilityContext, db: Db): GateDeps {
  const readiness = (ctx.services as { readiness?: (flag: FeatureFlag) => Promise<boolean> }).readiness;
  return { flags: ctx.flags, readiness, db };
}

const g = globalThis as unknown as { __weddingBiometricConsentInstalled?: boolean };

/**
 * Installs the consent lookup the biometric provider uses for `assertReady(subjectId)`. Idempotent;
 * runs at module load of the biometrics domain. Any failure to look up = no consent.
 */
export function installBiometricConsentLookup(): void {
  if (g.__weddingBiometricConsentInstalled) return;
  setBiometricConsentLookup(async (subjectId) => {
    try {
      const db = await getDb();
      return hasCurrentConsent(await getConsentState(db, subjectId));
    } catch {
      return false;
    }
  });
  g.__weddingBiometricConsentInstalled = true;
}
