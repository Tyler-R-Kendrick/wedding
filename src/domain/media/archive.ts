import type { PrincipalRef } from '@/contracts/principal';
import type { MediaAssetRow } from '@/db/schema/media';
import { archiveManifestKey } from '@/lib/media/keys';
import type { StorageProvider } from '@/providers/storage/types';

/**
 * Archive manifests (ADR-0005 §6): deletions leave a record of what was removed, by whom and
 * when, under `archive/<year>/manifests/deletions/<assetId>.json`. Admin-only prefix; never signed.
 * Contains no guest PII beyond the log-safe principal ref and no location data.
 */
export interface DeletionManifest {
  assetId: string;
  source: MediaAssetRow['source'];
  kind: MediaAssetRow['kind'];
  collectionId: string;
  sha256: string | null;
  bytes: number;
  originalKey: string | null;
  deletedBy: PrincipalRef;
  deletedAt: string;
  mode: 'hard' | 'soft';
  reason?: string;
}

export async function writeDeletionManifest(storage: StorageProvider, asset: MediaAssetRow, input: { actor: PrincipalRef; now: Date; mode: 'hard' | 'soft'; reason?: string }): Promise<void> {
  const manifest: DeletionManifest = {
    assetId: asset.id,
    source: asset.source,
    kind: asset.kind,
    collectionId: asset.collectionId,
    sha256: asset.sha256,
    bytes: asset.bytes,
    originalKey: asset.originalKey,
    deletedBy: input.actor,
    deletedAt: input.now.toISOString(),
    mode: input.mode,
    ...(input.reason ? { reason: input.reason } : {}),
  };
  const key = archiveManifestKey(input.now.getUTCFullYear(), 'deletions', asset.id);
  await storage.putObject(key, new TextEncoder().encode(JSON.stringify(manifest)), { contentType: 'application/json' });
}
