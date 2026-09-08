import type { Metadata } from 'next';
import type { CollectionSummary, QueueItem } from '@/capabilities/media';
import { ModerationQueue } from '@/components/media/ModerationQueue';
import { ConsoleGate, ConsolePage, Note, Section, SubNav } from '../_components/console';
import { MEDIA_SUBNAV } from '../_components/sections';
import { currentPrincipal, invokeForRequest } from '@/components/media/server';
import { isMediaAdmin } from '@/domain/media';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Media queue', robots: { index: false, follow: false } };

export default async function AdminMediaPage() {
  const principal = await currentPrincipal();
  if (principal.kind !== 'admin' || !isMediaAdmin(principal)) return <ConsoleGate what="The media queue" />;
  const queue = await invokeForRequest<{ items: QueueItem[]; collections: CollectionSummary[]; nextCursor?: string }>('admin_list_media', { status: 'private', limit: 50 }, principal);
  return (
    <ConsolePage title="Media queue" lede="Everything guests and vendors have added, in the state it is in. Approve to publish; nothing reaches the gallery without a decision here." actions={<SubNav label="Media" items={MEDIA_SUBNAV.map((i) => ({ ...i, current: i.href === '/admin/media' }))} />}>
      <Section id="queue">{queue.ok ? <ModerationQueue initial={queue.data} initialStatus="private" /> : <Note>{queue.error.message}</Note>}</Section>
    </ConsolePage>
  );
}
