import { isServableKey } from '@/lib/media/keys';
import { READ_URL_TTL_SECONDS } from '@/lib/media/limits';
import type { StorageProvider } from '@/providers/storage/types';

export interface SignedRead {
  url: string;
  expiresAt: string;
}

/**
 * The ONLY place a read URL is ever issued (ADR-0005 compliance: `grep -rn "originals/" src/app`
 * must stay empty). Refuses anything outside `derivatives/`, so quarantine and originals can never
 * be signed for a browser, whatever a caller passes.
 */
export async function signDerivativeRead(storage: StorageProvider, key: string, ttlSeconds: number = READ_URL_TTL_SECONDS): Promise<SignedRead | null> {
  if (!isServableKey(key)) return null;
  const signed = await storage.createSignedReadUrl({ key, expiresInSeconds: ttlSeconds });
  if (!signed.ok) return null;
  return { url: signed.value.url, expiresAt: signed.value.expiresAt };
}
