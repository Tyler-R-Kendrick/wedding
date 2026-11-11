import { isEmailShape, normalizeEmail } from '@/domain/identity/mask';
import type { OAuthProfile } from './oauth';

/** Verified provider email for administrator matching only (never used for guest matching). */
export function verifiedProviderEmail(profile: OAuthProfile): string | null {
  if (!profile.emailVerified || !profile.email) return null;
  const normalized = normalizeEmail(profile.email);
  return isEmailShape(normalized) ? normalized : null;
}
