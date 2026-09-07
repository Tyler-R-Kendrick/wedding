import type { Metadata } from 'next';
import type { CollectionSummary, QueueItem } from '@/capabilities/media';
import { AdminGate, AdminMediaNav } from '@/components/media/AdminMediaNav';
import { MediaPage, MediaSection } from '@/components/media/MediaShell';
import { ModerationQueue } from '@/components/media/ModerationQueue';
import { currentPrincipal, invokeForRequest } from '@/components/media/server';
import { isMediaAdmin } from '@/domain/media';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Media queue', robots: { index: false, follow: false } };

export default async function AdminMediaPage() {
  const principal = await currentPrincipal();
  if (principal.kind !== 'admin' || !isMediaAdmin(principal)) return <AdminGate />;
  const queue = await invokeForRequest<{ items: QueueItem[]; collections: CollectionSummary[]; nextCursor?: string }>('admin_list_media', { status: 'private', limit: 50 }, principal);
  return (
    <MediaPage eyebrow="Admin" title="Media queue" lede="Everything guests and vendors have added, in the state it is in. Approve to publish; nothing reaches the gallery without a decision here." actions={<AdminMediaNav current="queue" />}>
      <MediaSection id="queue">{queue.ok ? <ModerationQueue initial={queue.data} initialStatus="private" /> : <p className="media-lede">{queue.error.message}</p>}</MediaSection>
    </MediaPage>
  );
}
