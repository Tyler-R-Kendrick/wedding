import { z } from 'zod';
import type { CapabilityContext } from '@/contracts/capability';
import type { FeatureFlag } from '@/contracts/flags';
import type { Db } from '@/db/client';
import { DELETION_REASONS, DELETION_STATUSES } from '@/db/schema/biometrics';
import { resolveVaultKey, type VaultKey } from '@/domain/biometrics/vault';
import { env } from '@/lib/env';
import { hmacSha256, keyedHash } from '@/lib/crypto';
import { DEV_CONFIRMATION_SECRET } from '@/policy/confirmation';
import type { BiometricProvider } from '@/providers/biometric/types';
import type { StorageProvider } from '@/providers/storage/types';
import type { VectorIndexProvider } from '@/providers/vector-index/types';
import { appServices } from '../context';

export interface BiometricServices {
  db: Db;
  storage: StorageProvider;
  biometric: BiometricProvider;
  vectorIndex: VectorIndexProvider;
  readiness: (flag: FeatureFlag) => Promise<boolean>;
  /** Keyed hash of the caller's IP, present only when the request came through /api/biometrics/*. */
  clientIpHash: string | null;
}

export function biometricServices(ctx: CapabilityContext): BiometricServices {
  const { db, providers, readiness, clientIpHash } = appServices(ctx);
  return {
    db,
    storage: providers('storage'),
    biometric: providers('biometric'),
    vectorIndex: providers('vector-index'),
    readiness: readiness ?? (async () => false),
    clientIpHash: typeof clientIpHash === 'string' ? clientIpHash : null,
  };
}

export type VaultResolution = { ok: true; key: VaultKey } | { ok: false; reason: 'missing_in_production' };

export function vaultKey(): VaultResolution {
  return resolveVaultKey({ BIOMETRIC_VAULT_KEY: env.BIOMETRIC_VAULT_KEY, CONFIRMATION_SECRET: env.CONFIRMATION_SECRET, isProduction: env.isProduction });
}

let ipKey: string | undefined;
/** Consent IP hashes use their own derived key: unguessable without the server secret, never the audit key itself. */
export function consentIpHash(ip: string): string {
  ipKey ??= hmacSha256(env.AUDIT_HASH_KEY ?? env.CONFIRMATION_SECRET ?? DEV_CONFIRMATION_SECRET, 'biometric-consent-ip');
  return keyedHash(ipKey, ip);
}

export const ID = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'invalid id');

export const consentPolicySchema = z.object({
  version: z.string(),
  textHash: z.string(),
  text: z.string(),
  scope: z.literal('self_match'),
  purpose: z.string(),
  term: z.string(),
  retention: z.string(),
  providerDisclosure: z.string(),
  minors: z.string(),
  counselReviewed: z.literal(false),
});

export const consentRecordSchema = z.object({
  id: z.string(),
  policyVersion: z.string(),
  textHash: z.string(),
  scope: z.string(),
  grantedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});

export const deletionRecordSchema = z.object({
  id: z.string(),
  reason: z.enum(DELETION_REASONS),
  status: z.enum(DELETION_STATUSES),
  requestedAt: z.string(),
  completedAt: z.string().nullable(),
  proof: z.object({ identityRefsDeleted: z.number(), matchesDeleted: z.number(), providerSubjectsDeleted: z.number() }).nullable(),
});

/** The grant payload the draft step binds the confirmation token to. */
export const grantPayloadSchema = z.object({
  policyVersion: z.string().min(1).max(64),
  textHash: z.string().regex(/^[a-f0-9]{64}$/),
  adultAttested: z.literal(true),
});
export type GrantPayload = z.infer<typeof grantPayloadSchema>;
