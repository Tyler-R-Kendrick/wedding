import type { AnyCapability } from '@/contracts/capability';
import '@/domain/biometrics/jobs';
import { adminBiometricStatus } from './admin_biometric_status';
import { adminDisableBiometricReadiness } from './admin_disable_biometric_readiness';
import { adminEnableBiometricReadiness } from './admin_enable_biometric_readiness';
import { draftBiometricConsent } from './draft_biometric_consent';
import { draftBiometricReadiness } from './draft_biometric_readiness';
import { enrollBiometricReference } from './enroll_biometric_reference';
import { findPhotosOfMe } from './find_photos_of_me';
import { getMyBiometricConsent } from './get_my_biometric_consent';
import { grantBiometricConsent } from './grant_biometric_consent';
import { requestBiometricDeletion } from './request_biometric_deletion';
import { revokeBiometricConsent } from './revoke_biometric_consent';

/**
 * Swarm I: biometric-ready privacy subsystem (feature-gated OFF). Importing this module registers
 * the biometric.delete / biometric.sweep job handlers and installs the consent lookup the provider
 * seam uses for `assertReady(subjectId)`.
 */
export const biometricCapabilities: readonly AnyCapability[] = [
  getMyBiometricConsent,
  draftBiometricConsent,
  grantBiometricConsent,
  revokeBiometricConsent,
  requestBiometricDeletion,
  enrollBiometricReference,
  findPhotosOfMe,
  adminBiometricStatus,
  draftBiometricReadiness,
  adminEnableBiometricReadiness,
  adminDisableBiometricReadiness,
];

export { getMyBiometricConsent, draftBiometricConsent, grantBiometricConsent, revokeBiometricConsent, requestBiometricDeletion, enrollBiometricReference, findPhotosOfMe, adminBiometricStatus, draftBiometricReadiness, adminEnableBiometricReadiness, adminDisableBiometricReadiness };
export type { MyBiometricConsent } from './get_my_biometric_consent';
export type { FindPhotosOfMeResult } from './find_photos_of_me';
export type { BiometricStatusView } from './admin_biometric_status';
export { consentIpHash } from './_shared';
