import type { ProviderDescriptor, ProviderFailure } from '@/contracts/providers';
import type { Result } from '@/contracts/result';

export interface BiometricEnrollment {
  subjectId: string;
  enrolledAt: string;
}

export interface BiometricMatch {
  subjectId: string;
  /** 0..1 */
  score: number;
}

/**
 * Face matching (Illinois BIPA). Every operation must call `assertReady()` first, which
 * throws `feature_disabled` unless FLAG BIOMETRICS_ENABLED and the readiness row are both on.
 * Consent ledger, retention, and deletion live in the media swarm; this is only the seam.
 */
export interface BiometricProvider extends ProviderDescriptor {
  kind: 'biometric';
  assertReady(): Promise<void>;
  enroll(input: { subjectId: string; vector: number[] }): Promise<Result<BiometricEnrollment, ProviderFailure>>;
  match(input: { vector: number[]; k?: number; threshold?: number }): Promise<Result<BiometricMatch[], ProviderFailure>>;
  delete(subjectId: string): Promise<Result<{ deleted: boolean }, ProviderFailure>>;
}
