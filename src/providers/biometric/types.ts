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

/** A face template extracted from one image. Transient unless sealed into the vault by the domain. */
export interface BiometricTemplate {
  vector: number[];
  /** Whether the adapter believes a face was present at all. */
  faceDetected: boolean;
  model: string;
}

/**
 * Face matching (Illinois BIPA). Every operation must call `assertReady(subjectId)` first, which
 * throws `feature_disabled` unless FLAG BIOMETRICS_ENABLED and the readiness row are both on AND
 * that subject holds a current consent. Consent ledger, retention, and deletion live in
 * src/domain/biometrics; this is only the seam.
 *
 * `extract` runs on bytes the domain hands it (a guest's own reference derivative, or a
 * candidate the guest chose); adapters must not persist anything from it. There is no
 * bulk-extraction operation on purpose (ADR-0006 §4: no bystander extraction path).
 *
 * **`subjectId` is required on every operation that touches a template, `match` included.** v1
 * scope is `self_match`: the only question this seam may answer is "is THIS consenting guest in
 * this image". The 1:N "who is this?" query has no representation here on purpose — an optional
 * subject would make the consent half of the gate optional with it, and adding the operation back
 * must be a visible ADR change rather than an omitted argument.
 */
export interface BiometricProvider extends ProviderDescriptor {
  kind: 'biometric';
  /** Fails closed without a subject: no subject means no consent to check, which means no. */
  assertReady(subjectId?: string): Promise<void>;
  extract(input: { subjectId: string; bytes: Uint8Array; contentType: string }): Promise<Result<BiometricTemplate, ProviderFailure>>;
  enroll(input: { subjectId: string; vector: number[] }): Promise<Result<BiometricEnrollment, ProviderFailure>>;
  match(input: { vector: number[]; k?: number; threshold?: number; subjectId: string }): Promise<Result<BiometricMatch[], ProviderFailure>>;
  /** Must work even when the feature is off (retention and deletion obligations). */
  delete(subjectId: string): Promise<Result<{ deleted: boolean }, ProviderFailure>>;
}
