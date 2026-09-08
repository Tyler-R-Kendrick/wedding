import type { Metadata } from 'next';
import type { CollectionSummary, QueueItem } from '@/capabilities/media';
import { ImportForm } from '@/components/media/ImportForm';
import { currentPrincipal, invokeForRequest } from '@/components/media/server';
import { ConsoleGate, ConsolePage, Section, SubNav } from '../../_components/console';
import { MEDIA_SUBNAV } from '../../_components/sections';
import { isMediaAdmin } from '@/domain/media';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Import professional media', robots: { index: false, follow: false } };

export default async function ImportPage() {
  const principal = await currentPrincipal();
  if (principal.kind !== 'admin' || !isMediaAdmin(principal)) return <ConsoleGate what="Importing professional media" />;
  const r = await invokeForRequest<{ items: QueueItem[]; collections: CollectionSummary[] }>('admin_list_media', { limit: 1 }, principal);
  const chapters = r.ok ? r.data.collections.filter((c) => c.kind === 'professional') : [];
  return (
    <ConsolePage title="Import professional media" lede="Photographer and videographer deliveries, with their rights recorded up front. Files come from this machine; nothing is fetched from a vendor gallery." actions={<SubNav label="Media" items={MEDIA_SUBNAV.map((i) => ({ ...i, current: i.href === '/admin/media/import' }))} />}>
      <Section id="import">
        <ImportForm chapters={chapters} />
      </Section>
    </ConsolePage>
  );
}
