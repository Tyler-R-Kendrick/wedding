import type { Metadata } from 'next';
import { AdminGate, AdminMediaNav } from '@/components/media/AdminMediaNav';
import { DuplicateClusters, type Cluster } from '@/components/media/DuplicateClusters';
import { MediaPage, MediaSection } from '@/components/media/MediaShell';
import { currentPrincipal, invokeForRequest } from '@/components/media/server';
import { isMediaAdmin } from '@/domain/media';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Duplicate media', robots: { index: false, follow: false } };

export default async function DuplicatesPage() {
  const principal = await currentPrincipal();
  if (principal.kind !== 'admin' || !isMediaAdmin(principal)) return <AdminGate />;
  const r = await invokeForRequest<{ clusters: Cluster[] }>('admin_media_duplicates', {}, principal);
  return (
    <MediaPage eyebrow="Admin" title="Duplicates" lede="Identical files (same checksum) and near-identical images (perceptual hash). Keeping the earliest and rejecting the rest is reversible from the queue." actions={<AdminMediaNav current="duplicates" />}>
      <MediaSection id="clusters">{r.ok ? <DuplicateClusters clusters={r.data.clusters} /> : <p className="media-lede">{r.error.message}</p>}</MediaSection>
    </MediaPage>
  );
}
