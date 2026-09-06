import { and, desc, eq, inArray } from 'drizzle-orm';
import { CapabilityError } from '@/contracts/errors';
import type { FeatureFlag, FlagValues } from '@/contracts/flags';
import { newId } from '@/contracts/ids';
import type { GuestPrincipal } from '@/contracts/principal';
import { err, ok, type Result } from '@/contracts/result';
import type { Db } from '@/db/client';
import { biometricIdentityRefs, biometricMatches, type BiometricIdentityRefRow, type BiometricMatchRow } from '@/db/schema/biometrics';
import { mediaAssets, mediaCollections, mediaDerivatives, professionalMediaRights, type MediaAssetRow, type MediaCollectionRow } from '@/db/schema/media';
import { canViewPublishedAsset, isOwner } from '@/domain/media/acl';
import { pickAiDerivative, professionalAiAllowed } from '@/domain/mediaai/eligibility';
import { isServableKey } from '@/lib/media/keys';
import type { BiometricProvider } from '@/providers/biometric/types';
import type { StorageProvider } from '@/providers/storage/types';
import { openTemplate, sealTemplate, type VaultKey } from './vault';

/**
 * Consent-scoped enrolment and matching (ADR-0006 §4). The guest picks 1..3 of THEIR OWN uploads
 * as references; a template is extracted from the gallery DERIVATIVE, sealed with the vault key,
 * and stored in biometric.identity_refs. Matching runs only over candidate photos the guest
 * chooses and may view; candidate templates are transient (never stored), and only
 * (guest, asset, score) survives. Professional media is excluded from candidates unless the
 * PRO_MEDIA_AI_PROCESSING gate is open. No bulk extraction exists anywhere in this module.
 */
export const MAX_REFERENCE_ASSETS = 3;
export const MAX_CANDIDATES_PER_CALL = 40;
export const MATCH_THRESHOLD = 0.8;

export interface EnrollmentDeps {
  db: Db;
  storage: StorageProvider;
  biometric: BiometricProvider;
  vaultKey: VaultKey;
  flags: FlagValues;
  readiness: (flag: FeatureFlag) => Promise<boolean>;
  now: Date;
  requestId: string;
}

async function loadAssets(db: Db, ids: string[]): Promise<{ asset: MediaAssetRow; collection: MediaCollectionRow }[]> {
  if (ids.length === 0) return [];
  return db.select({ asset: mediaAssets, collection: mediaCollections }).from(mediaAssets).innerJoin(mediaCollections, eq(mediaCollections.id, mediaAssets.collectionId)).where(inArray(mediaAssets.id, ids));
}

async function derivativeBytes(deps: Pick<EnrollmentDeps, 'db' | 'storage'>, asset: MediaAssetRow): Promise<{ key: string; contentType: string; bytes: Uint8Array } | null> {
  const rows = await deps.db.select().from(mediaDerivatives).where(eq(mediaDerivatives.assetId, asset.id));
  const d = pickAiDerivative(asset.kind, rows);
  if (!d || !isServableKey(d.key)) return null;
  const obj = await deps.storage.getObject(d.key);
  if (!obj.ok || !obj.value) return null;
  return { key: d.key, contentType: d.contentType, bytes: obj.value.body };
}

export async function getIdentityRef(db: Db, guestId: string): Promise<BiometricIdentityRefRow | null> {
  return (await db.select().from(biometricIdentityRefs).where(eq(biometricIdentityRefs.guestId, guestId)).orderBy(desc(biometricIdentityRefs.enrolledAt)).limit(1))[0] ?? null;
}

/** Averages the reference templates into one unit vector. */
export function combineTemplates(vectors: readonly number[][]): number[] {
  const dims = vectors[0]?.length ?? 0;
  const sum = new Array<number>(dims).fill(0);
  for (const v of vectors) for (let i = 0; i < dims; i++) sum[i] = (sum[i] ?? 0) + (v[i] ?? 0);
  const norm = Math.sqrt(sum.reduce((s, x) => s + x * x, 0)) || 1;
  return sum.map((x) => x / norm);
}

/** Enrols the guest from their own uploads. Replaces any earlier reference (old provider subject deleted). */
export async function enrollFromOwnAssets(deps: EnrollmentDeps, guest: GuestPrincipal, consentId: string, assetIds: string[]): Promise<Result<{ identityRefId: string; enrolledAt: string; references: number }, CapabilityError>> {
  const ids = [...new Set(assetIds)].slice(0, MAX_REFERENCE_ASSETS);
  if (ids.length === 0) return err(new CapabilityError('validation', 'Pick at least one photo of yourself.'));
  const rows = await loadAssets(deps.db, ids);
  const own = rows.filter(({ asset }) => isOwner(guest, asset) && asset.kind === 'image' && !asset.deletedAt && asset.source === 'guest');
  if (own.length !== ids.length) return err(new CapabilityError('forbidden', 'Reference photos must be your own uploads.'));

  const vectors: number[][] = [];
  for (const { asset } of own) {
    const d = await derivativeBytes(deps, asset);
    if (!d) return err(new CapabilityError('conflict', 'That photo is still being prepared. Try again in a moment.'));
    const extracted = await deps.biometric.extract({ subjectId: guest.guestId, bytes: d.bytes, contentType: d.contentType });
    if (!extracted.ok) return err(new CapabilityError('provider_unavailable', 'Face matching is not available right now.', { provider: extracted.error.provider }));
    if (!extracted.value.faceDetected) return err(new CapabilityError('validation', 'We could not find a face in one of those photos. Pick a clear photo of yourself.'));
    vectors.push(extracted.value.vector);
  }
  const combined = combineTemplates(vectors);
  const previous = await getIdentityRef(deps.db, guest.guestId);
  if (previous) {
    await deps.biometric.delete(previous.subjectId);
    await deps.db.delete(biometricMatches).where(eq(biometricMatches.guestId, guest.guestId));
    await deps.db.delete(biometricIdentityRefs).where(eq(biometricIdentityRefs.guestId, guest.guestId));
  }
  const enrolled = await deps.biometric.enroll({ subjectId: guest.guestId, vector: combined });
  if (!enrolled.ok) return err(new CapabilityError('provider_unavailable', 'Face matching is not available right now.', { provider: enrolled.error.provider }));
  const id = newId();
  await deps.db.insert(biometricIdentityRefs).values({
    id,
    guestId: guest.guestId,
    consentId,
    providerName: deps.biometric.name,
    subjectId: enrolled.value.subjectId,
    templateSealed: sealTemplate(deps.vaultKey, combined),
    templateKeyId: deps.vaultKey.id,
    sourceAssetIds: ids,
    enrolledAt: deps.now,
    createdAt: deps.now,
  });
  return ok({ identityRefId: id, enrolledAt: deps.now.toISOString(), references: ids.length });
}

export interface MatchOutcome {
  matched: { assetId: string; score: number }[];
  checked: number;
  skipped: { assetId: string; reason: 'not_visible' | 'professional_gate' | 'not_ready' }[];
}

/** Matches the guest's sealed reference against the candidate photos they chose and may view. */
export async function findPhotosOfGuest(deps: EnrollmentDeps, guest: GuestPrincipal, candidateAssetIds: string[]): Promise<Result<MatchOutcome, CapabilityError>> {
  const ref = await getIdentityRef(deps.db, guest.guestId);
  if (!ref) return err(new CapabilityError('conflict', 'Add a reference photo of yourself first.', { reason: 'not_enrolled' }));
  const reference = openTemplate(deps.vaultKey, ref.templateSealed);
  if (!reference) return err(new CapabilityError('internal', 'Something went wrong on our side. Please try again in a moment.', undefined, new Error('biometric template could not be opened (vault key mismatch?)')));
  const ids = [...new Set(candidateAssetIds)].slice(0, MAX_CANDIDATES_PER_CALL);
  const rows = await loadAssets(deps.db, ids);
  const proReady = { PRO_MEDIA_AI_PROCESSING: await deps.readiness('PRO_MEDIA_AI_PROCESSING') } as Partial<Record<FeatureFlag, boolean>>;
  const outcome: MatchOutcome = { matched: [], checked: 0, skipped: [] };
  const matchedRows: (typeof biometricMatches.$inferInsert)[] = [];
  // An id that matched no row at all is reported exactly like one the guest may not see, so the
  // skip list cannot be used to ask "does this asset exist?".
  const found = new Set(rows.map((r) => r.asset.id));
  for (const id of ids) if (!found.has(id)) outcome.skipped.push({ assetId: id, reason: 'not_visible' });
  for (const { asset, collection } of rows) {
    if (asset.kind !== 'image' || !canViewPublishedAsset(guest, asset, collection)) {
      outcome.skipped.push({ assetId: asset.id, reason: 'not_visible' });
      continue;
    }
    if (asset.source === 'professional') {
      const rights = (await deps.db.select().from(professionalMediaRights).where(eq(professionalMediaRights.assetId, asset.id)).limit(1))[0] ?? null;
      if (!professionalAiAllowed(rights, deps.flags, proReady)) {
        outcome.skipped.push({ assetId: asset.id, reason: 'professional_gate' });
        continue;
      }
    }
    const d = await derivativeBytes(deps, asset);
    if (!d) {
      outcome.skipped.push({ assetId: asset.id, reason: 'not_ready' });
      continue;
    }
    // Transient: the candidate template lives in this loop iteration and nowhere else.
    const candidate = await deps.biometric.extract({ subjectId: guest.guestId, bytes: d.bytes, contentType: d.contentType });
    if (!candidate.ok) return err(new CapabilityError('provider_unavailable', 'Face matching is not available right now.', { provider: candidate.error.provider }));
    outcome.checked++;
    if (!candidate.value.faceDetected) continue;
    const m = await deps.biometric.match({ vector: candidate.value.vector, k: 1, threshold: MATCH_THRESHOLD, subjectId: guest.guestId });
    if (!m.ok) return err(new CapabilityError('provider_unavailable', 'Face matching is not available right now.', { provider: m.error.provider }));
    const hit = m.value.find((x) => x.subjectId === ref.subjectId);
    if (hit) {
      outcome.matched.push({ assetId: asset.id, score: Number(hit.score.toFixed(4)) });
      matchedRows.push({ id: newId(), guestId: guest.guestId, identityRefId: ref.id, assetId: asset.id, score: hit.score, matchedAt: deps.now, requestId: deps.requestId });
    }
  }
  if (ids.length) await deps.db.delete(biometricMatches).where(and(eq(biometricMatches.guestId, guest.guestId), inArray(biometricMatches.assetId, ids)));
  if (matchedRows.length) await deps.db.insert(biometricMatches).values(matchedRows);
  return ok(outcome);
}

export async function listMatches(db: Db, guestId: string): Promise<BiometricMatchRow[]> {
  return db.select().from(biometricMatches).where(eq(biometricMatches.guestId, guestId)).orderBy(desc(biometricMatches.matchedAt));
}
