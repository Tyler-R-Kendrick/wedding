import type { Metadata } from 'next';
import type { CollectionSummary, QueueItem } from '@/capabilities/media';
import { AdminGate, AdminMediaNav } from '@/components/media/AdminMediaNav';
import { ImportForm } from '@/components/media/ImportForm';
import { MediaPage, MediaSection } from '@/components/media/MediaShell';
import { currentPrincipal, invokeForRequest } from '@/components/media/server';
import { isMediaAdmin } from '@/domain/media';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Import professional media', robots: { index: false, follow: false } };

export default async function ImportPage() {
  const principal = await currentPrincipal();
  if (principal.kind !== 'admin' || !isMediaAdmin(principal)) return <AdminGate />;
  const r = await invokeForRequest<{ items: QueueItem[]; collections: CollectionSummary[] }>('admin_list_media', { limit: 1 }, principal);
  const chapters = r.ok ? r.data.collections.filter((c) => c.kind === 'professional') : [];
  return (
    <MediaPage eyebrow="Admin" title="Import professional media" lede="Photographer and videographer deliveries, with their rights recorded up front. Files come from this machine; nothing is fetched from a vendor gallery." actions={<AdminMediaNav current="import" />}>
      <MediaSection id="import">
        <ImportForm chapters={chapters} />
      </MediaSection>
    </MediaPage>
  );
}
