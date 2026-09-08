import type { Metadata } from 'next';
import { DuplicateClusters, type Cluster } from '@/components/media/DuplicateClusters';
import { currentPrincipal, invokeForRequest } from '@/components/media/server';
import { ConsoleGate, ConsolePage, Note, Section, SubNav } from '../../_components/console';
import { MEDIA_SUBNAV } from '../../_components/sections';
import { isMediaAdmin } from '@/domain/media';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Duplicate media', robots: { index: false, follow: false } };

export default async function DuplicatesPage() {
  const principal = await currentPrincipal();
  if (principal.kind !== 'admin' || !isMediaAdmin(principal)) return <ConsoleGate what="Duplicate media" />;
  const r = await invokeForRequest<{ clusters: Cluster[] }>('admin_media_duplicates', {}, principal);
  return (
    <ConsolePage title="Duplicates" lede="Identical files (same checksum) and near-identical images (perceptual hash). Keeping the earliest and rejecting the rest is reversible from the queue." actions={<SubNav label="Media" items={MEDIA_SUBNAV.map((i) => ({ ...i, current: i.href === '/admin/media/duplicates' }))} />}>
      <Section id="clusters">{r.ok ? <DuplicateClusters clusters={r.data.clusters} /> : <Note>{r.error.message}</Note>}</Section>
    </ConsolePage>
  );
}
