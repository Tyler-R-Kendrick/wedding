import { Vault } from '@/domain/external/vault';
import { hmacSha256 } from '@/lib/crypto';
import { env } from '@/lib/env';
import { DEV_CONFIRMATION_SECRET } from '@/policy/confirmation';

const KEY_INFO = 'wedding-guest-sign-in-pass-v1';

let singleton: Vault | undefined;

/** Seals pass codes at rest for prefilling the sign-in page and verifying on POST. */
export async function getGuestPassVault(): Promise<Vault> {
  if (singleton) return singleton;
  let material = env.GUEST_PASS_SECRETS_KEY;
  if (!material) {
    const base = env.CONFIRMATION_SECRET;
    if (!base && env.isProduction) throw new Error('GUEST_PASS_SECRETS_KEY or CONFIRMATION_SECRET is required in production');
    material = hmacSha256(base ?? DEV_CONFIRMATION_SECRET, KEY_INFO);
  }
  singleton = new Vault(material);
  return singleton;
}

/** Tests only. */
export function resetGuestPassVault(): void {
  singleton = undefined;
}
